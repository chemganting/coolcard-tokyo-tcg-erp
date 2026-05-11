import cors from "cors";
import bcrypt from "bcryptjs";
import express from "express";
import fs from "node:fs/promises";
import { google } from "googleapis";
import jwt from "jsonwebtoken";
import morgan from "morgan";
import path from "node:path";
import cron from "node-cron";
import { fileURLToPath } from "node:url";
import { initDb, pool, query, rowsToCamel, toCamel } from "./db.js";

const app = express();
const port = process.env.PORT ?? 4000;
const jwtSecret = process.env.JWT_SECRET ?? "local-development-secret-change-me";
const allowedUnits = new Set(["單張", "包", "盒", "箱", "組", "其他"]);
const reportSheetTabs = ["今日營收", "庫存總表", "熱銷排行"];
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backupDir = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.join(__dirname, "backups");
const backupTables = ["users", "products", "sales"];

function publicUser(row) {
  const user = toCamel(row);
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    displayName: user.displayName ?? user.name,
    role: user.role,
    isActive: user.isActive ?? true
  };
}

const allowedOrigins = (process.env.CLIENT_ORIGIN ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("CORS origin not allowed"));
  }
}));
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));

async function currentUser(request, response, next) {
  const auth = request.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  try {
    const payload = jwt.verify(token, jwtSecret);
    const { rows } = await query("SELECT id, username, name, display_name, role, is_active FROM users WHERE id = $1", [payload.sub]);
    const row = rows[0];
    if (!row || row.is_active === false) return response.status(401).json({ message: "請先登入" });
    request.user = publicUser(row);
    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      return response.status(401).json({ message: "請先登入" });
    }
    next(error);
  }
}

function requireAdmin(request, response, next) {
  if (request.user.role !== "admin") {
    return response.status(403).json({ message: "此操作需要管理員權限" });
  }
  next();
}

function productPayload(body) {
  return {
    name: String(body.name ?? "").trim(),
    series: String(body.series ?? "").trim(),
    rarity: String(body.rarity ?? "").trim(),
    condition: String(body.condition ?? "").trim(),
    unit: allowedUnits.has(String(body.unit ?? "").trim()) ? String(body.unit).trim() : "其他",
    cardsPerUnit: Number(body.cardsPerUnit),
    packageSpec: String(body.packageSpec ?? "").trim(),
    cost: Number(body.cost),
    price: Number(body.price),
    stock: Number(body.stock),
    lowStockThreshold: Number(body.lowStockThreshold),
    notes: String(body.notes ?? "").trim()
  };
}

function validateProduct(product) {
  if (!product.name || !product.series || !product.rarity || !product.condition) return false;
  if (!product.unit || !product.packageSpec) return false;
  return [product.cardsPerUnit, product.cost, product.price, product.stock, product.lowStockThreshold].every(Number.isFinite) &&
    product.cardsPerUnit > 0 &&
    product.cost >= 0 &&
    product.price >= 0 &&
    product.stock >= 0 &&
    product.lowStockThreshold >= 0;
}

function grossMargin(revenue, cost) {
  return revenue === 0 ? 0 : ((revenue - cost) / revenue) * 100;
}

async function getProfitReport() {
  const [
    todaySummary,
    monthSummary,
    todayRevenueRows,
    inventoryRows,
    hotRankingRows,
    lowStockRows
  ] = await Promise.all([
    query(`
      SELECT
        COALESCE(SUM(sales.total), 0)::float AS revenue,
        COALESCE(SUM(products.cost * sales.quantity), 0)::float AS cost,
        COALESCE(SUM(sales.quantity), 0)::int AS quantity
      FROM sales
      JOIN products ON products.id = sales.product_id
      WHERE sales.sold_at = CURRENT_DATE
    `),
    query(`
      SELECT
        COALESCE(SUM(sales.total), 0)::float AS revenue,
        COALESCE(SUM(products.cost * sales.quantity), 0)::float AS cost
      FROM sales
      JOIN products ON products.id = sales.product_id
      WHERE date_trunc('month', sales.sold_at) = date_trunc('month', CURRENT_DATE)
    `),
    query(`
      SELECT
        to_char(sales.sold_at, 'YYYY-MM-DD') AS date,
        products.name AS product_name,
        sales.quantity,
        sales.unit_price::float AS unit_price,
        sales.total::float AS total,
        (products.cost * sales.quantity)::float AS cost,
        (sales.total - products.cost * sales.quantity)::float AS profit,
        CASE WHEN sales.total = 0 THEN 0 ELSE ((sales.total - products.cost * sales.quantity) / sales.total * 100)::float END AS margin_rate,
        users.name AS staff_name
      FROM sales
      JOIN products ON products.id = sales.product_id
      JOIN users ON users.id = sales.user_id
      WHERE sales.sold_at = CURRENT_DATE
      ORDER BY sales.id DESC
    `),
    query(`
      SELECT
        name,
        series,
        rarity,
        condition,
        unit,
        package_spec,
        cost::float AS cost,
        price::float AS price,
        stock,
        (cost * stock)::float AS inventory_cost,
        (price * stock)::float AS inventory_price,
        ((price - cost) * stock)::float AS estimated_profit
      FROM products
      ORDER BY stock ASC, name ASC
    `),
    query(`
      SELECT
        products.name AS product_name,
        COALESCE(SUM(sales.quantity), 0)::int AS quantity,
        COALESCE(SUM(sales.total), 0)::float AS revenue,
        COALESCE(SUM(products.cost * sales.quantity), 0)::float AS cost,
        COALESCE(SUM(sales.total - products.cost * sales.quantity), 0)::float AS profit,
        CASE WHEN COALESCE(SUM(sales.total), 0) = 0 THEN 0
             ELSE (SUM(sales.total - products.cost * sales.quantity) / SUM(sales.total) * 100)::float
        END AS margin_rate
      FROM sales
      JOIN products ON products.id = sales.product_id
      GROUP BY products.id, products.name
      ORDER BY quantity DESC, revenue DESC
      LIMIT 10
    `),
    query(`
      SELECT id, name, series, rarity, unit, package_spec, stock, low_stock_threshold
      FROM products
      WHERE stock <= low_stock_threshold
      ORDER BY stock ASC, name ASC
      LIMIT 10
    `)
  ]);

  const today = todaySummary.rows[0];
  const month = monthSummary.rows[0];
  const todayProfit = today.revenue - today.cost;
  const monthProfit = month.revenue - month.cost;

  return {
    summary: {
      todayRevenue: today.revenue,
      todayCost: today.cost,
      todayProfit,
      todayMarginRate: grossMargin(today.revenue, today.cost),
      monthRevenue: month.revenue,
      monthProfit,
      totalSalesQuantity: today.quantity
    },
    todayRevenueRows: rowsToCamel(todayRevenueRows.rows),
    inventoryRows: rowsToCamel(inventoryRows.rows),
    hotRankingRows: rowsToCamel(hotRankingRows.rows).map((row, index) => ({ rank: index + 1, ...row })),
    lowStockRows: rowsToCamel(lowStockRows.rows)
  };
}

function serviceAccountCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not configured");

  const parsed = JSON.parse(raw);
  if (parsed.private_key) {
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  }
  return parsed;
}

async function googleSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccountCredentials(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
  return google.sheets({ version: "v4", auth });
}

function sheetValues(report) {
  return {
    "今日營收": [
      ["日期", "商品名稱", "數量", "單價", "總金額", "成本", "毛利", "毛利率", "店員"],
      ...report.todayRevenueRows.map((row) => [
        row.date,
        row.productName,
        row.quantity,
        row.unitPrice,
        row.total,
        row.cost,
        row.profit,
        `${row.marginRate.toFixed(2)}%`,
        row.staffName
      ])
    ],
    "庫存總表": [
      ["商品名稱", "系列", "稀有度", "卡況", "單位", "包裝規格", "進貨成本", "售價", "庫存數量", "庫存總成本", "預估庫存售價", "預估毛利"],
      ...report.inventoryRows.map((row) => [
        row.name,
        row.series,
        row.rarity,
        row.condition,
        row.unit,
        row.packageSpec,
        row.cost,
        row.price,
        row.stock,
        row.inventoryCost,
        row.inventoryPrice,
        row.estimatedProfit
      ])
    ],
    "熱銷排行": [
      ["排名", "商品名稱", "銷售數量", "營業額", "成本", "毛利", "毛利率"],
      ...report.hotRankingRows.map((row) => [
        row.rank,
        row.productName,
        row.quantity,
        row.revenue,
        row.cost,
        row.profit,
        `${row.marginRate.toFixed(2)}%`
      ])
    ]
  };
}

async function ensureSheetTabs(sheets, spreadsheetId) {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = new Set(spreadsheet.data.sheets?.map((sheet) => sheet.properties?.title).filter(Boolean));
  const requests = reportSheetTabs
    .filter((title) => !existing.has(title))
    .map((title) => ({ addSheet: { properties: { title } } }));

  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests }
    });
  }
}

async function syncReportToGoogleSheets(report) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error("GOOGLE_SHEET_ID is not configured");

  const sheets = await googleSheetsClient();
  await ensureSheetTabs(sheets, spreadsheetId);
  const values = sheetValues(report);

  for (const [title, rows] of Object.entries(values)) {
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `'${title}'`
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${title}'!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: rows }
    });
  }
}

function backupStorageTargets() {
  return {
    local: { enabled: true, path: backupDir },
    googleDrive: { enabled: false, reserved: true },
    s3: { enabled: false, reserved: true },
    cloudinary: { enabled: false, reserved: true }
  };
}

function backupFilename(type) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `coolcard-backup-${type}-${timestamp}.json`;
}

function assertSafeBackupFilename(filename) {
  const decoded = path.basename(String(filename ?? ""));
  if (!/^coolcard-backup-(manual|auto)-[\w.-]+\.json$/.test(decoded)) {
    throw new Error("備份檔名不合法");
  }
  return decoded;
}

async function ensureBackupDir() {
  await fs.mkdir(backupDir, { recursive: true });
}

async function backupFilePath(filename) {
  const safeName = assertSafeBackupFilename(filename);
  await ensureBackupDir();
  return path.join(backupDir, safeName);
}

async function getDashboardSnapshot() {
  const [todayRevenue, monthRevenue, totalSalesQuantity, lowStockCount, totalStock, hotProducts, inventoryOverview] = await Promise.all([
    query("SELECT COALESCE(SUM(total), 0)::float AS value FROM sales WHERE sold_at = CURRENT_DATE"),
    query("SELECT COALESCE(SUM(total), 0)::float AS value FROM sales WHERE date_trunc('month', sold_at) = date_trunc('month', CURRENT_DATE)"),
    query("SELECT COALESCE(SUM(quantity), 0)::int AS value FROM sales"),
    query("SELECT COUNT(*)::int AS value FROM products WHERE stock <= low_stock_threshold"),
    query("SELECT COALESCE(SUM(stock), 0)::int AS value FROM products"),
    query(`
      SELECT products.id, products.name, products.series, COALESCE(SUM(sales.quantity), 0)::int AS sold_quantity, COALESCE(SUM(sales.total), 0)::float AS revenue
      FROM sales
      JOIN products ON products.id = sales.product_id
      GROUP BY products.id
      ORDER BY sold_quantity DESC, revenue DESC
      LIMIT 5
    `),
    query(`
      SELECT id, name, series, rarity, unit, cards_per_unit, package_spec, stock, low_stock_threshold
      FROM products
      ORDER BY stock ASC, name ASC
      LIMIT 8
    `)
  ]);

  return {
    todayRevenue: todayRevenue.rows[0].value,
    monthRevenue: monthRevenue.rows[0].value,
    totalSalesQuantity: totalSalesQuantity.rows[0].value,
    lowStockCount: lowStockCount.rows[0].value,
    totalStock: totalStock.rows[0].value,
    hotProducts: rowsToCamel(hotProducts.rows),
    inventoryOverview: rowsToCamel(inventoryOverview.rows)
  };
}

async function createDatabaseBackup(type = "manual") {
  const normalizedType = type === "auto" ? "auto" : "manual";
  const [schemaRows, users, products, sales, inventory, dashboard, profitReport] = await Promise.all([
    query(`
      SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1)
      ORDER BY table_name, ordinal_position
    `, [backupTables]),
    query("SELECT id, username, password_hash, name, display_name, role, is_active, created_at, updated_at FROM users ORDER BY id"),
    query(`
      SELECT id, name, series, rarity, condition, unit, cards_per_unit, package_spec, cost::text, price::text, stock, low_stock_threshold, notes, created_at, updated_at
      FROM products
      ORDER BY id
    `),
    query(`
      SELECT id, product_id, user_id, quantity, sale_unit, cards_per_unit, unit_price::text, total::text, sold_at, created_at
      FROM sales
      ORDER BY id
    `),
    query(`
      SELECT id, name, series, rarity, condition, unit, cards_per_unit, package_spec, stock, low_stock_threshold, (cost * stock)::float AS inventory_cost, (price * stock)::float AS inventory_price
      FROM products
      ORDER BY name ASC
    `),
    getDashboardSnapshot(),
    getProfitReport()
  ]);

  const createdAt = new Date().toISOString();
  const filename = backupFilename(normalizedType);
  const payload = {
    metadata: {
      appName: "Coolcard Tokyo TCG ERP",
      database: "postgresql",
      format: "json",
      type: normalizedType,
      filename,
      createdAt,
      tables: backupTables,
      storage: backupStorageTargets()
    },
    schema: rowsToCamel(schemaRows.rows),
    data: {
      users: users.rows,
      products: products.rows,
      sales: sales.rows
    },
    inventory: rowsToCamel(inventory.rows),
    reports: {
      dashboard,
      profitReport
    }
  };

  await ensureBackupDir();
  const targetPath = path.join(backupDir, filename);
  await fs.writeFile(targetPath, JSON.stringify(payload, null, 2), "utf8");
  const stat = await fs.stat(targetPath);
  return {
    filename,
    createdAt,
    size: stat.size,
    type: normalizedType,
    storage: "local"
  };
}

async function listBackups() {
  await ensureBackupDir();
  const entries = await fs.readdir(backupDir, { withFileTypes: true });
  const backups = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const filePath = await backupFilePath(entry.name);
      const [stat, raw] = await Promise.all([
        fs.stat(filePath),
        fs.readFile(filePath, "utf8")
      ]);
      const parsed = JSON.parse(raw);
      backups.push({
        filename: entry.name,
        createdAt: parsed.metadata?.createdAt ?? stat.birthtime.toISOString(),
        size: stat.size,
        type: parsed.metadata?.type ?? (entry.name.includes("-auto-") ? "auto" : "manual")
      });
    } catch {
      continue;
    }
  }

  return backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function cleanupOldAutoBackups() {
  const backups = (await listBackups()).filter((backup) => backup.type === "auto");
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const stale = backups.filter((backup, index) => index >= 7 || new Date(backup.createdAt).getTime() < sevenDaysAgo);

  for (const backup of stale) {
    const filePath = await backupFilePath(backup.filename);
    await fs.unlink(filePath).catch(() => {});
  }
}

async function restoreDatabaseBackup(filename) {
  const filePath = await backupFilePath(filename);
  const backup = JSON.parse(await fs.readFile(filePath, "utf8"));
  const data = backup.data ?? {};
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("TRUNCATE TABLE sales, products, users RESTART IDENTITY CASCADE");

    for (const user of data.users ?? []) {
      await client.query(
        `
          INSERT INTO users (id, username, password_hash, name, display_name, role, is_active, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, NOW()), COALESCE($9::timestamptz, NOW()))
        `,
        [user.id, user.username, user.password_hash, user.name, user.display_name ?? user.name, user.role, user.is_active !== false, user.created_at, user.updated_at]
      );
    }

    for (const product of data.products ?? []) {
      await client.query(
        `
          INSERT INTO products
            (id, name, series, rarity, condition, unit, cards_per_unit, package_spec, cost, price, stock, low_stock_threshold, notes, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::numeric, $10::numeric, $11, $12, $13, COALESCE($14::timestamptz, NOW()), COALESCE($15::timestamptz, NOW()))
        `,
        [
          product.id,
          product.name,
          product.series,
          product.rarity,
          product.condition,
          product.unit ?? "單張",
          product.cards_per_unit ?? 1,
          product.package_spec ?? "單張卡",
          product.cost,
          product.price,
          product.stock ?? 0,
          product.low_stock_threshold ?? 3,
          product.notes ?? "",
          product.created_at,
          product.updated_at
        ]
      );
    }

    for (const sale of data.sales ?? []) {
      await client.query(
        `
          INSERT INTO sales (id, product_id, user_id, quantity, sale_unit, cards_per_unit, unit_price, total, sold_at, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8::numeric, $9::date, COALESCE($10::timestamptz, NOW()))
        `,
        [
          sale.id,
          sale.product_id,
          sale.user_id,
          sale.quantity,
          sale.sale_unit ?? "單張",
          sale.cards_per_unit ?? 1,
          sale.unit_price,
          sale.total,
          sale.sold_at,
          sale.created_at
        ]
      );
    }

    for (const tableName of backupTables) {
      await client.query(`
        SELECT setval(pg_get_serial_sequence('${tableName}', 'id'), COALESCE((SELECT MAX(id) FROM ${tableName}), 1), TRUE)
      `);
    }

    await client.query("COMMIT");
    return { ok: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function startScheduledBackups() {
  if (process.env.DISABLE_AUTO_BACKUP === "true") return;
  cron.schedule("0 0 * * *", async () => {
    try {
      await createDatabaseBackup("auto");
      await cleanupOldAutoBackups();
      console.log("Automatic PostgreSQL backup completed");
    } catch (error) {
      console.error("Automatic PostgreSQL backup failed", error);
    }
  }, {
    timezone: process.env.BACKUP_TIMEZONE ?? "Asia/Taipei"
  });
}

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, database: "postgres" });
});

app.post("/api/login", async (request, response, next) => {
  const { username, password } = request.body;
  try {
    const { rows } = await query(
      "SELECT id, username, password_hash, name, display_name, role, is_active FROM users WHERE username = $1",
      [username]
    );
    const row = rows[0];

    if (!row || !bcrypt.compareSync(String(password ?? ""), row.password_hash ?? "")) {
      return response.status(401).json({ message: "帳號或密碼錯誤" });
    }
    if (row.is_active === false) {
      return response.status(403).json({ message: "此帳號已停用" });
    }

    const user = publicUser(row);
    const token = jwt.sign(
      { sub: String(user.id), username: user.username, role: user.role },
      jwtSecret,
      { expiresIn: process.env.JWT_EXPIRES_IN ?? "7d" }
    );
    response.json({ token, user });
  } catch (error) {
    next(error);
  }
});

app.get("/api/me", currentUser, (request, response) => {
  response.json(request.user);
});

async function activeAdminCount() {
  const { rows } = await query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND is_active = TRUE");
  return rows[0].count;
}

async function isLastActiveAdmin(userId) {
  const { rows } = await query("SELECT role, is_active FROM users WHERE id = $1", [userId]);
  const user = rows[0];
  return user?.role === "admin" && user.is_active === true && (await activeAdminCount()) <= 1;
}

function userPayload(body) {
  return {
    username: String(body.username ?? "").trim(),
    name: String(body.name ?? "").trim(),
    displayName: String(body.displayName ?? body.name ?? "").trim(),
    role: ["admin", "clerk"].includes(body.role) ? body.role : "clerk",
    isActive: body.isActive !== false
  };
}

function validateUserPayload(user) {
  return Boolean(user.username && user.name && user.displayName && ["admin", "clerk"].includes(user.role));
}

app.get("/api/users", currentUser, requireAdmin, async (_request, response, next) => {
  try {
    const { rows } = await query(`
      SELECT id, username, name, display_name, role, is_active, created_at, updated_at
      FROM users
      ORDER BY created_at DESC, id DESC
    `);
    response.json(rowsToCamel(rows));
  } catch (error) {
    next(error);
  }
});

app.post("/api/users", currentUser, requireAdmin, async (request, response, next) => {
  const user = userPayload(request.body);
  const password = String(request.body.password ?? "");
  if (!validateUserPayload(user) || password.length < 6) {
    return response.status(400).json({ message: "員工資料不完整，密碼至少 6 碼" });
  }

  try {
    const { rows } = await query(
      `
        INSERT INTO users (username, password_hash, name, display_name, role, is_active)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `,
      [user.username, bcrypt.hashSync(password, 12), user.name, user.displayName, user.role, user.isActive]
    );
    response.status(201).json({ id: rows[0].id });
  } catch (error) {
    if (error.code === "23505") return response.status(409).json({ message: "帳號已存在" });
    next(error);
  }
});

app.put("/api/users/:id", currentUser, requireAdmin, async (request, response, next) => {
  const userId = Number(request.params.id);
  const user = userPayload(request.body);
  if (!validateUserPayload(user)) return response.status(400).json({ message: "員工資料不完整" });

  try {
    if (user.role !== "admin" && await isLastActiveAdmin(userId)) {
      return response.status(409).json({ message: "不允許移除最後一個 admin" });
    }

    const result = await query(
      `
        UPDATE users
        SET name = $1, display_name = $2, role = $3, updated_at = NOW()
        WHERE id = $4
      `,
      [user.name, user.displayName, user.role, userId]
    );
    if (result.rowCount === 0) return response.status(404).json({ message: "員工不存在" });
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/users/:id/password", currentUser, requireAdmin, async (request, response, next) => {
  const password = String(request.body.password ?? "");
  if (password.length < 6) return response.status(400).json({ message: "密碼至少 6 碼" });

  try {
    const result = await query(
      "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2",
      [bcrypt.hashSync(password, 12), Number(request.params.id)]
    );
    if (result.rowCount === 0) return response.status(404).json({ message: "員工不存在" });
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/users/:id/status", currentUser, requireAdmin, async (request, response, next) => {
  const userId = Number(request.params.id);
  const isActive = request.body.isActive === true;

  try {
    if (!isActive && await isLastActiveAdmin(userId)) {
      return response.status(409).json({ message: "不允許停用最後一個 admin" });
    }

    const result = await query(
      "UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2",
      [isActive, userId]
    );
    if (result.rowCount === 0) return response.status(404).json({ message: "員工不存在" });
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/users/:id", currentUser, requireAdmin, async (request, response, next) => {
  const userId = Number(request.params.id);
  if (userId === request.user.id) return response.status(409).json({ message: "不允許刪除目前登入中的自己" });

  try {
    if (await isLastActiveAdmin(userId)) {
      return response.status(409).json({ message: "不允許刪除最後一個 admin" });
    }

    const result = await query("DELETE FROM users WHERE id = $1", [userId]);
    if (result.rowCount === 0) return response.status(404).json({ message: "員工不存在" });
    response.json({ ok: true });
  } catch (error) {
    if (error.code === "23503") return response.status(409).json({ message: "此員工已有銷售紀錄，無法刪除，可改為停用" });
    next(error);
  }
});

app.get("/api/products", currentUser, async (request, response, next) => {
  const keyword = `%${String(request.query.q ?? "").trim()}%`;
  try {
    const { rows } = await query(
      `
        SELECT id, name, series, rarity, condition, unit, cards_per_unit, package_spec,
               cost::float AS cost, price::float AS price, stock, low_stock_threshold, notes, created_at, updated_at
        FROM products
        WHERE name ILIKE $1 OR series ILIKE $1 OR rarity ILIKE $1 OR condition ILIKE $1
           OR unit ILIKE $1 OR package_spec ILIKE $1 OR notes ILIKE $1
        ORDER BY updated_at DESC, id DESC
      `,
      [keyword]
    );
    response.json(rowsToCamel(rows));
  } catch (error) {
    next(error);
  }
});

app.post("/api/products", currentUser, requireAdmin, async (request, response, next) => {
  const product = productPayload(request.body);
  if (!validateProduct(product)) return response.status(400).json({ message: "商品資料不完整或格式錯誤" });

  try {
    const { rows } = await query(
      `
        INSERT INTO products
          (name, series, rarity, condition, unit, cards_per_unit, package_spec, cost, price, stock, low_stock_threshold, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id
      `,
      [
        product.name,
        product.series,
        product.rarity,
        product.condition,
        product.unit,
        product.cardsPerUnit,
        product.packageSpec,
        product.cost,
        product.price,
        product.stock,
        product.lowStockThreshold,
        product.notes
      ]
    );
    response.status(201).json({ id: rows[0].id });
  } catch (error) {
    next(error);
  }
});

app.put("/api/products/:id", currentUser, requireAdmin, async (request, response, next) => {
  const product = productPayload(request.body);
  if (!validateProduct(product)) return response.status(400).json({ message: "商品資料不完整或格式錯誤" });

  try {
    const result = await query(
      `
        UPDATE products
        SET name = $1,
            series = $2,
            rarity = $3,
            condition = $4,
            unit = $5,
            cards_per_unit = $6,
            package_spec = $7,
            cost = $8,
            price = $9,
            stock = $10,
            low_stock_threshold = $11,
            notes = $12,
            updated_at = NOW()
        WHERE id = $13
      `,
      [
        product.name,
        product.series,
        product.rarity,
        product.condition,
        product.unit,
        product.cardsPerUnit,
        product.packageSpec,
        product.cost,
        product.price,
        product.stock,
        product.lowStockThreshold,
        product.notes,
        Number(request.params.id)
      ]
    );
    if (result.rowCount === 0) return response.status(404).json({ message: "商品不存在" });
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/products/:id", currentUser, requireAdmin, async (request, response, next) => {
  try {
    const saleCount = await query("SELECT COUNT(*)::int AS count FROM sales WHERE product_id = $1", [request.params.id]);
    if (saleCount.rows[0].count > 0) {
      return response.status(409).json({ message: "已有銷售紀錄的商品不可刪除" });
    }

    const result = await query("DELETE FROM products WHERE id = $1", [request.params.id]);
    if (result.rowCount === 0) return response.status(404).json({ message: "商品不存在" });
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

function parseCsv(text) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "\"" && inQuotes && next === "\"") {
      current += "\"";
      index += 1;
    } else if (char === "\"") {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(current.trim());
      current = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(current.trim());
      current = "";
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
    } else {
      current += char;
    }
  }

  row.push(current.trim());
  if (row.some((cell) => cell !== "")) rows.push(row);
  return rows;
}

function importValue(row, names) {
  const keys = Array.isArray(names) ? names : [names];
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== "") return row[key];
  }
  return "";
}

function normalizeImportRows(body) {
  if (Array.isArray(body.rows)) return body.rows;
  const csvText = String(body.csv ?? "").trim();
  if (!csvText) return [];

  const rows = parseCsv(csvText);
  const headers = rows.shift()?.map((header) => header.trim()) ?? [];
  return rows.map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]))
  );
}

app.post("/api/products/import", currentUser, requireAdmin, async (request, response, next) => {
  const rows = normalizeImportRows(request.body);
  if (rows.length === 0) return response.status(400).json({ message: "沒有可匯入的資料" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let imported = 0;

    for (const row of rows) {
      const unit = String(importValue(row, ["單位", "unit"]) || "單張").trim();
      const cardsPerUnit = importValue(row, ["每單位張數", "cardsPerUnit", "cards_per_unit"]) || 1;
      const product = productPayload({
        name: importValue(row, ["商品名稱", "name"]),
        series: importValue(row, ["卡牌系列", "series"]),
        rarity: importValue(row, ["稀有度", "rarity"]) || "未分類",
        condition: importValue(row, ["卡況", "condition"]) || "未標示",
        unit,
        cardsPerUnit,
        packageSpec: importValue(row, ["包裝規格", "packageSpec", "package_spec"]) || `${cardsPerUnit} 張/${unit}`,
        cost: importValue(row, ["進貨成本", "cost"]),
        price: importValue(row, ["售價", "price"]),
        stock: importValue(row, ["庫存數量", "stock"]),
        lowStockThreshold: importValue(row, ["低庫存門檻", "lowStockThreshold", "low_stock_threshold"]) || 3,
        notes: importValue(row, ["備註", "notes"])
      });

      if (!validateProduct(product)) continue;

      await client.query(
        `
          INSERT INTO products
            (name, series, rarity, condition, unit, cards_per_unit, package_spec, cost, price, stock, low_stock_threshold, notes)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `,
        [
          product.name,
          product.series,
          product.rarity,
          product.condition,
          product.unit,
          product.cardsPerUnit,
          product.packageSpec,
          product.cost,
          product.price,
          product.stock,
          product.lowStockThreshold,
          product.notes
        ]
      );
      imported += 1;
    }

    await client.query("COMMIT");
    response.status(201).json({ imported });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

app.get("/api/sales", currentUser, async (request, response, next) => {
  const { from, to } = request.query;
  const params = [];
  const filters = [];
  if (from) {
    params.push(from);
    filters.push(`sales.sold_at >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    filters.push(`sales.sold_at <= $${params.length}::date`);
  }

  try {
    const { rows } = await query(
      `
        SELECT
          sales.id,
          sales.quantity,
          sales.sale_unit,
          sales.cards_per_unit,
          sales.unit_price::float AS unit_price,
          sales.total::float AS total,
          to_char(sales.sold_at, 'YYYY-MM-DD') AS sold_at,
          sales.created_at,
          products.name AS product_name,
          products.series AS product_series,
          products.unit AS product_unit,
          products.cards_per_unit AS product_cards_per_unit,
          users.name AS staff_name,
          users.role AS staff_role
        FROM sales
        JOIN products ON products.id = sales.product_id
        JOIN users ON users.id = sales.user_id
        ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
        ORDER BY sales.sold_at DESC, sales.id DESC
      `,
      params
    );
    response.json(rowsToCamel(rows));
  } catch (error) {
    next(error);
  }
});

app.post("/api/sales", currentUser, async (request, response, next) => {
  const productId = Number(request.body.productId);
  const quantity = Number(request.body.quantity);
  const unitPrice = Number(request.body.unitPrice);
  const saleUnit = allowedUnits.has(String(request.body.saleUnit ?? "").trim()) ? String(request.body.saleUnit).trim() : "其他";
  const saleCardsPerUnit = Number(request.body.cardsPerUnit);
  const soldAt = String(request.body.soldAt ?? "").trim() || new Date().toISOString().slice(0, 10);

  if (!productId || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0 || !Number.isFinite(saleCardsPerUnit) || saleCardsPerUnit <= 0) {
    return response.status(400).json({ message: "銷售資料不完整或格式錯誤" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const productResult = await client.query(
      "SELECT id, name, stock, unit, cards_per_unit FROM products WHERE id = $1 FOR UPDATE",
      [productId]
    );
    const product = productResult.rows[0];

    if (!product) {
      await client.query("ROLLBACK");
      return response.status(404).json({ message: "商品不存在" });
    }
    if (product.stock < quantity) {
      await client.query("ROLLBACK");
      return response.status(409).json({ message: `${product.name} 庫存不足，目前剩餘 ${product.stock}` });
    }

    const total = unitPrice * quantity;
    const sale = await client.query(
      `
        INSERT INTO sales (product_id, user_id, quantity, sale_unit, cards_per_unit, unit_price, total, sold_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `,
      [productId, request.user.id, quantity, saleUnit, saleCardsPerUnit, unitPrice, total, soldAt]
    );

    await client.query("UPDATE products SET stock = stock - $1, updated_at = NOW() WHERE id = $2", [quantity, productId]);
    await client.query("COMMIT");
    response.status(201).json({ id: sale.rows[0].id });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

app.delete("/api/sales/:id", currentUser, requireAdmin, async (request, response, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const saleResult = await client.query("SELECT product_id, quantity FROM sales WHERE id = $1", [request.params.id]);
    const sale = saleResult.rows[0];
    if (!sale) {
      await client.query("ROLLBACK");
      return response.status(404).json({ message: "銷售紀錄不存在" });
    }

    await client.query("DELETE FROM sales WHERE id = $1", [request.params.id]);
    await client.query("UPDATE products SET stock = stock + $1, updated_at = NOW() WHERE id = $2", [sale.quantity, sale.product_id]);
    await client.query("COMMIT");
    response.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

app.get("/api/dashboard", currentUser, async (_request, response, next) => {
  try {
    const [todayRevenue, monthRevenue, totalSalesQuantity, lowStockCount, totalStock, hotProducts, inventoryOverview] = await Promise.all([
      query("SELECT COALESCE(SUM(total), 0)::float AS value FROM sales WHERE sold_at = CURRENT_DATE"),
      query("SELECT COALESCE(SUM(total), 0)::float AS value FROM sales WHERE date_trunc('month', sold_at) = date_trunc('month', CURRENT_DATE)"),
      query("SELECT COALESCE(SUM(quantity), 0)::int AS value FROM sales"),
      query("SELECT COUNT(*)::int AS value FROM products WHERE stock <= low_stock_threshold"),
      query("SELECT COALESCE(SUM(stock), 0)::int AS value FROM products"),
      query(`
        SELECT products.id, products.name, products.series, COALESCE(SUM(sales.quantity), 0)::int AS sold_quantity, COALESCE(SUM(sales.total), 0)::float AS revenue
        FROM sales
        JOIN products ON products.id = sales.product_id
        GROUP BY products.id
        ORDER BY sold_quantity DESC, revenue DESC
        LIMIT 5
      `),
      query(`
        SELECT id, name, series, rarity, unit, cards_per_unit, package_spec, stock, low_stock_threshold
        FROM products
        ORDER BY stock ASC, name ASC
        LIMIT 8
      `)
    ]);

    response.json({
      todayRevenue: todayRevenue.rows[0].value,
      monthRevenue: monthRevenue.rows[0].value,
      totalSalesQuantity: totalSalesQuantity.rows[0].value,
      lowStockCount: lowStockCount.rows[0].value,
      totalStock: totalStock.rows[0].value,
      hotProducts: rowsToCamel(hotProducts.rows),
      inventoryOverview: rowsToCamel(inventoryOverview.rows)
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/profit-report", currentUser, async (_request, response, next) => {
  try {
    const report = await getProfitReport();
    response.json({
      ...report,
      googleSheetUrl: process.env.GOOGLE_SHEET_URL ?? ""
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/reports/google-sync", currentUser, requireAdmin, async (_request, response, next) => {
  try {
    const report = await getProfitReport();
    await syncReportToGoogleSheets(report);
    response.json({
      ok: true,
      googleSheetUrl: process.env.GOOGLE_SHEET_URL ?? ""
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/backups", currentUser, requireAdmin, async (_request, response, next) => {
  try {
    response.json(await listBackups());
  } catch (error) {
    next(error);
  }
});

app.post("/api/backups/create", currentUser, requireAdmin, async (_request, response, next) => {
  try {
    const backup = await createDatabaseBackup("manual");
    response.status(201).json(backup);
  } catch (error) {
    next(error);
  }
});

app.post("/api/backups/restore/:filename", currentUser, requireAdmin, async (request, response, next) => {
  try {
    await restoreDatabaseBackup(request.params.filename);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/backups/:filename", currentUser, requireAdmin, async (request, response, next) => {
  try {
    const filePath = await backupFilePath(request.params.filename);
    await fs.unlink(filePath);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ message: "伺服器發生錯誤" });
});

initDb()
  .then(() => {
    app.listen(port, "0.0.0.0", () => {
      console.log(`Coolcard Tokyo TCG ERP API listening on http://localhost:${port}`);
    });
    startScheduledBackups();
  })
  .catch((error) => {
    console.error("Failed to initialize PostgreSQL database", error);
    process.exit(1);
  });
