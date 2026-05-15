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
const productTypes = new Set(["normal", "graded"]);
const gradingCompanies = new Set(["PSA", "BGS", "CGC"]);
const paymentStatuses = new Set(["未付款", "已付款", "部分付款"]);
const orderStatuses = new Set(["pending", "completed", "cancelled"]);
const reportSheetTabs = ["今日營收", "庫存總表", "熱銷排行"];
const reportTimeZone = process.env.REPORT_TIMEZONE ?? process.env.BACKUP_TIMEZONE ?? "Asia/Taipei";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backupDir = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.join(__dirname, "backups");
const backupTables = ["users", "products", "sales", "orders", "order_items", "audit_logs", "inventory_logs", "purchases"];

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
app.use((request, response, next) => {
  const startedAt = process.hrtime.bigint();
  response.on("finish", () => {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    if (elapsedMs >= 250) {
      console.log(`[api] ${request.method} ${request.originalUrl} ${response.statusCode} ${elapsedMs.toFixed(1)}ms`);
    }
  });
  next();
});

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
  const productType = productTypes.has(String(body.productType ?? "").trim()) ? String(body.productType).trim() : "normal";
  const gradingCompany = String(body.gradingCompany ?? "").trim().toUpperCase();
  const grade = String(body.grade ?? "").trim();
  const certNumber = String(body.certNumber ?? "").trim();
  return {
    name: String(body.name ?? "").trim(),
    series: String(body.series ?? "").trim(),
    rarity: String(body.rarity ?? "").trim(),
    condition: String(body.condition ?? "").trim(),
    productType,
    gradingCompany: productType === "graded" && gradingCompanies.has(gradingCompany) ? gradingCompany : null,
    grade: productType === "graded" && grade ? grade : null,
    certNumber: productType === "graded" && certNumber ? certNumber : null,
    unit: allowedUnits.has(String(body.unit ?? "").trim()) ? String(body.unit).trim() : "其他",
    cardsPerUnit: Number(body.cardsPerUnit),
    packageSpec: String(body.packageSpec ?? "").trim(),
    cost: Number(body.cost ?? 0),
    price: Number(body.price),
    stock: Number(body.stock ?? 0),
    lowStockThreshold: Number(body.lowStockThreshold ?? 3),
    notes: String(body.notes ?? "").trim()
  };
}

function validateProduct(product) {
  if (!product.name || !product.series || !product.rarity || !product.condition) return false;
  if (!product.unit || !product.packageSpec) return false;
  const baseValid = [product.cardsPerUnit, product.cost, product.price, product.stock, product.lowStockThreshold].every(Number.isFinite) &&
    product.cardsPerUnit > 0 &&
    product.cost >= 0 &&
    product.price >= 0 &&
    product.stock >= 0 &&
    product.lowStockThreshold >= 0;
  if (!baseValid) return false;
  if (!productTypes.has(product.productType)) return false;
  if (product.productType === "normal") {
    return product.gradingCompany === null && product.grade === null && product.certNumber === null;
  }
  return Boolean(product.gradingCompany && gradingCompanies.has(product.gradingCompany) && product.grade && product.certNumber);
}

function purchasePayload(body) {
  const quantity = Number(body.quantity);
  const unitCost = Number(body.unitCost);
  return {
    supplier: String(body.supplier ?? "").trim(),
    purchaseDate: String(body.purchaseDate ?? "").trim() || new Date().toISOString().slice(0, 10),
    productId: Number(body.productId),
    quantity,
    unit: allowedUnits.has(String(body.unit ?? "").trim()) ? String(body.unit).trim() : "其他",
    unitCost,
    totalCost: Number.isFinite(quantity) && Number.isFinite(unitCost) ? quantity * unitCost : NaN,
    paymentStatus: paymentStatuses.has(String(body.paymentStatus ?? "").trim()) ? String(body.paymentStatus).trim() : "未付款",
    notes: String(body.notes ?? "").trim()
  };
}

function normalizeOrderStatus(status) {
  if (["cancelled", "canceled", "已取消"].includes(status)) return "cancelled";
  if (["completed", "done", "已完成", "已出貨"].includes(status)) return "completed";
  if (["pending", "待處理", "待出貨"].includes(status)) return "pending";
  return "pending";
}

function isPendingOrderStatus(status) {
  return normalizeOrderStatus(status) === "pending";
}

function validatePurchase(purchase) {
  return Boolean(
    purchase.supplier &&
    purchase.productId &&
    purchase.purchaseDate &&
    Number.isFinite(purchase.quantity) &&
    purchase.quantity > 0 &&
    Number.isFinite(purchase.unitCost) &&
    purchase.unitCost >= 0
  );
}

function orderPayload(body) {
  return {
    customerName: String(body.customerName ?? "").trim(),
    phone: String(body.phone ?? "").trim(),
    shippingInfo: String(body.shippingInfo ?? "").trim(),
    lineName: String(body.lineName ?? "").trim(),
    status: "pending",
    items: Array.isArray(body.items)
      ? body.items.map((item) => ({
          productId: Number(item.productId),
          quantity: Number(item.quantity)
        }))
      : []
  };
}

function validateOrder(order) {
  return Boolean(
    order.customerName &&
    Array.isArray(order.items) &&
    order.items.length > 0 &&
    order.items.every((item) => Number.isFinite(item.productId) && item.productId > 0 && Number.isFinite(item.quantity) && item.quantity > 0) &&
    orderStatuses.has(normalizeOrderStatus(order.status))
  );
}

function orderStatusLabel(status) {
  const normalized = normalizeOrderStatus(status);
  if (normalized === "completed") return "已完成";
  if (normalized === "cancelled") return "已取消";
  return "待處理";
}

function orderStatusTone(status) {
  const normalized = normalizeOrderStatus(status);
  if (normalized === "cancelled") return "bg-slate-100 text-slate-700";
  if (normalized === "completed") return "bg-emerald-50 text-emerald-700";
  if (normalized === "pending") return "bg-amber-50 text-amber-700";
  return "bg-rose-50 text-rose-700";
}

function grossMargin(revenue, cost) {
  return revenue === 0 ? 0 : ((revenue - cost) / revenue) * 100;
}

function productCostExpression() {
  return "COALESCE(NULLIF(products.average_cost, 0), products.cost)";
}

function reportMonthSheetTitle(date = new Date()) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: reportTimeZone,
    year: "numeric",
    month: "2-digit"
  }).formatToParts(date);
  const value = (partType) => parts.find((part) => part.type === partType)?.value ?? "00";
  return `${value("year")}${value("month")}營收`;
}

function reportSalesRows(rows) {
  return rows.map((row) => [
    row.date,
    row.orderNumber,
    row.customerName,
    row.productName,
    row.quantity,
    row.revenue,
    row.cost,
    row.profit,
    `${Number(row.marginRate ?? 0).toFixed(2)}%`,
    row.staffName
  ]);
}

function reportSalesHeaders() {
  return ["日期", "訂單編號", "客戶名稱", "商品名稱", "數量", "營業額", "成本", "毛利", "毛利率", "店員"];
}

async function getProfitReport() {
  const [
    todaySummary,
    monthSummary,
    todayRevenueRows,
    monthRevenueRows,
    inventoryRows,
    hotRankingRows,
    lowStockRows
  ] = await Promise.all([
    query(`
      SELECT
        COALESCE(SUM(sales.total), 0)::float AS revenue,
        COALESCE(SUM(COALESCE(NULLIF(products.average_cost, 0), products.cost) * sales.quantity), 0)::float AS cost,
        COALESCE(SUM(sales.quantity), 0)::int AS quantity
      FROM sales
      JOIN products ON products.id = sales.product_id
      WHERE sales.sold_at = CURRENT_DATE
        AND sales.voided_at IS NULL
    `),
    query(`
      SELECT
        COALESCE(SUM(sales.total), 0)::float AS revenue,
        COALESCE(SUM(COALESCE(NULLIF(products.average_cost, 0), products.cost) * sales.quantity), 0)::float AS cost
      FROM sales
      JOIN products ON products.id = sales.product_id
      WHERE date_trunc('month', sales.sold_at) = date_trunc('month', CURRENT_DATE)
        AND sales.voided_at IS NULL
    `),
    query(`
      SELECT
        to_char(sales.sold_at, 'YYYY-MM-DD') AS date,
        COALESCE(('ORD-' || LPAD(orders.id::text, 6, '0')), '-') AS order_number,
        COALESCE(orders.customer_name, '-') AS customer_name,
        products.name AS product_name,
        sales.quantity,
        sales.total::float AS revenue,
        (COALESCE(NULLIF(products.average_cost, 0), products.cost) * sales.quantity)::float AS cost,
        (sales.total - COALESCE(NULLIF(products.average_cost, 0), products.cost) * sales.quantity)::float AS profit,
        CASE WHEN sales.total = 0 THEN 0 ELSE ((sales.total - COALESCE(NULLIF(products.average_cost, 0), products.cost) * sales.quantity) / sales.total * 100)::float END AS margin_rate,
        users.name AS staff_name
      FROM sales
      JOIN products ON products.id = sales.product_id
      JOIN users ON users.id = sales.user_id
      LEFT JOIN orders ON orders.id = sales.order_id
      WHERE sales.sold_at = CURRENT_DATE
        AND sales.voided_at IS NULL
      ORDER BY sales.id DESC
    `),
    query(`
      SELECT
        to_char(sales.sold_at, 'YYYY-MM-DD') AS date,
        COALESCE(('ORD-' || LPAD(orders.id::text, 6, '0')), '-') AS order_number,
        COALESCE(orders.customer_name, '-') AS customer_name,
        products.name AS product_name,
        sales.quantity,
        sales.total::float AS revenue,
        (COALESCE(NULLIF(products.average_cost, 0), products.cost) * sales.quantity)::float AS cost,
        (sales.total - COALESCE(NULLIF(products.average_cost, 0), products.cost) * sales.quantity)::float AS profit,
        CASE WHEN sales.total = 0 THEN 0 ELSE ((sales.total - COALESCE(NULLIF(products.average_cost, 0), products.cost) * sales.quantity) / sales.total * 100)::float END AS margin_rate,
        users.name AS staff_name
      FROM sales
      JOIN products ON products.id = sales.product_id
      JOIN users ON users.id = sales.user_id
      LEFT JOIN orders ON orders.id = sales.order_id
      WHERE date_trunc('month', sales.sold_at) = date_trunc('month', CURRENT_DATE)
        AND sales.voided_at IS NULL
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
        COALESCE(NULLIF(average_cost, 0), cost)::float AS cost,
        average_cost::float AS average_cost,
        price::float AS price,
        stock,
        (COALESCE(NULLIF(average_cost, 0), cost) * stock)::float AS inventory_cost,
        (price * stock)::float AS inventory_price,
        ((price - cost) * stock)::float AS estimated_profit
      FROM products
      WHERE deleted_at IS NULL
      ORDER BY stock ASC, name ASC
    `),
    query(`
      SELECT
        products.name AS product_name,
        COALESCE(SUM(sales.quantity), 0)::int AS quantity,
        COALESCE(SUM(sales.total), 0)::float AS revenue,
        COALESCE(SUM(COALESCE(NULLIF(products.average_cost, 0), products.cost) * sales.quantity), 0)::float AS cost,
        COALESCE(SUM(sales.total - COALESCE(NULLIF(products.average_cost, 0), products.cost) * sales.quantity), 0)::float AS profit,
        CASE WHEN COALESCE(SUM(sales.total), 0) = 0 THEN 0
             ELSE (SUM(sales.total - COALESCE(NULLIF(products.average_cost, 0), products.cost) * sales.quantity) / SUM(sales.total) * 100)::float
        END AS margin_rate
      FROM sales
      JOIN products ON products.id = sales.product_id
      WHERE sales.voided_at IS NULL
      GROUP BY products.id, products.name
      ORDER BY quantity DESC, revenue DESC
      LIMIT 10
    `),
    query(`
      SELECT id, name, series, rarity, unit, package_spec, stock, low_stock_threshold
      FROM products
      WHERE deleted_at IS NULL AND stock <= low_stock_threshold
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
      monthCost: month.cost,
      monthProfit,
      monthMarginRate: grossMargin(month.revenue, month.cost),
      totalSalesQuantity: today.quantity
    },
    todayRevenueRows: rowsToCamel(todayRevenueRows.rows),
    monthRevenueRows: rowsToCamel(monthRevenueRows.rows),
    inventoryRows: rowsToCamel(inventoryRows.rows),
    hotRankingRows: rowsToCamel(hotRankingRows.rows).map((row, index) => ({ rank: index + 1, ...row })),
    lowStockRows: rowsToCamel(lowStockRows.rows),
    monthSheetTitle: reportMonthSheetTitle()
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
      reportSalesHeaders(),
      ...reportSalesRows(report.todayRevenueRows)
    ],
    [report.monthSheetTitle ?? reportMonthSheetTitle()]: [
      reportSalesHeaders(),
      ...reportSalesRows(report.monthRevenueRows)
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

async function ensureSheetTabs(sheets, spreadsheetId, sheetTitles = reportSheetTabs) {
  try {
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const existing = new Set(spreadsheet.data.sheets?.map((sheet) => sheet.properties?.title).filter(Boolean));
    const requests = sheetTitles
      .filter((title) => !existing.has(title))
      .map((title) => ({ addSheet: { properties: { title } } }));

    if (requests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests }
      });
    }
  } catch (error) {
    console.error("建立 Google Sheets 分頁失敗", error);
    throw error;
  }
}

async function ensureSheetTabWithHeader(sheets, spreadsheetId, title, headerRow) {
  try {
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const existing = new Set(spreadsheet.data.sheets?.map((sheet) => sheet.properties?.title).filter(Boolean));
    if (!existing.has(title)) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title } } }]
        }
      });
      if (headerRow?.length) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `'${title}'!A1`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [headerRow] }
        });
      }
    }
  } catch (error) {
    console.error(`建立 Google Sheets 分頁 ${title} 失敗`, error);
    throw error;
  }
}

async function syncReportToGoogleSheets(report) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error("GOOGLE_SHEET_ID is not configured");

  const sheets = await googleSheetsClient();
  const values = sheetValues(report);
  const monthSheetTitle = report.monthSheetTitle ?? reportMonthSheetTitle();
  await ensureSheetTabWithHeader(sheets, spreadsheetId, monthSheetTitle, reportSalesHeaders());
  await ensureSheetTabs(sheets, spreadsheetId, Object.keys(values));

  for (const [title, rows] of Object.entries(values)) {
    try {
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
    } catch (error) {
      console.error(`寫入 Google Sheets 分頁 ${title} 失敗`, error);
      throw error;
    }
  }
}

let reportSheetSyncPromise = null;
let reportSheetSyncQueued = false;

async function syncReportsInBackground() {
  if (!process.env.GOOGLE_SHEET_ID || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return;
  reportSheetSyncQueued = true;
  if (reportSheetSyncPromise) return reportSheetSyncPromise;

  reportSheetSyncPromise = (async () => {
    while (reportSheetSyncQueued) {
      reportSheetSyncQueued = false;
      try {
        const report = await getProfitReport();
        await syncReportToGoogleSheets(report);
      } catch (error) {
        console.error("自動同步月報表失敗", error);
      }
    }
  })().finally(() => {
    reportSheetSyncPromise = null;
  });

  return reportSheetSyncPromise;
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
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: process.env.BACKUP_TIMEZONE ?? "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(new Date());
  const value = (partType) => parts.find((part) => part.type === partType)?.value ?? "00";
  const timestamp = `${value("year")}${value("month")}${value("day")}-${value("hour")}${value("minute")}${value("second")}`;
  return `backup-${timestamp}.json`;
}

function assertSafeBackupFilename(filename) {
  const decoded = path.basename(String(filename ?? ""));
  const isCurrentFormat = /^backup-\d{8}-\d{6}\.json$/.test(decoded);
  const isLegacyFormat = /^coolcard-backup-(manual|auto)-[\w.-]+\.json$/.test(decoded);
  if (!isCurrentFormat && !isLegacyFormat) {
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
    const [todaySummary, monthRevenue, totalSalesQuantity, lowStockCount, totalProductCount, totalStock, hotProducts, inventoryOverview] = await Promise.all([
      query(`
        SELECT
          COALESCE(SUM(sales.total), 0)::float AS revenue,
          COALESCE(SUM(COALESCE(NULLIF(products.average_cost, 0), products.cost) * sales.quantity), 0)::float AS cost
        FROM sales
        JOIN products ON products.id = sales.product_id
        WHERE sales.sold_at = CURRENT_DATE AND sales.voided_at IS NULL
      `),
    query("SELECT COALESCE(SUM(total), 0)::float AS value FROM sales WHERE date_trunc('month', sold_at) = date_trunc('month', CURRENT_DATE) AND voided_at IS NULL"),
    query("SELECT COALESCE(SUM(quantity), 0)::int AS value FROM sales WHERE voided_at IS NULL"),
    query("SELECT COUNT(*)::int AS value FROM products WHERE deleted_at IS NULL AND stock <= low_stock_threshold"),
    query("SELECT COUNT(*)::int AS value FROM products WHERE deleted_at IS NULL"),
    query("SELECT COALESCE(SUM(stock), 0)::int AS value FROM products WHERE deleted_at IS NULL"),
    query(`
      SELECT products.id, products.name, products.series, COALESCE(SUM(sales.quantity), 0)::int AS sold_quantity, COALESCE(SUM(sales.total), 0)::float AS revenue
      FROM sales
      JOIN products ON products.id = sales.product_id
      WHERE sales.voided_at IS NULL
      GROUP BY products.id
      ORDER BY sold_quantity DESC, revenue DESC
      LIMIT 5
    `),
    query(`
      SELECT id, name, series, rarity, unit, cards_per_unit, package_spec, stock, low_stock_threshold
      FROM products
      WHERE deleted_at IS NULL AND stock <= low_stock_threshold
      ORDER BY stock ASC, name ASC
      LIMIT 8
    `)
  ]);

  return {
      todayRevenue: todaySummary.rows[0].revenue,
      todayCost: todaySummary.rows[0].cost,
      todayProfit: todaySummary.rows[0].revenue - todaySummary.rows[0].cost,
      todayMarginRate: grossMargin(todaySummary.rows[0].revenue, todaySummary.rows[0].cost),
    monthRevenue: monthRevenue.rows[0].value,
    totalSalesQuantity: totalSalesQuantity.rows[0].value,
    lowStockCount: lowStockCount.rows[0].value,
    totalProductCount: totalProductCount.rows[0].value,
    totalStock: totalStock.rows[0].value,
    hotProducts: rowsToCamel(hotProducts.rows),
    inventoryOverview: rowsToCamel(inventoryOverview.rows)
  };
}

async function createDatabaseBackup(type = "manual") {
  const normalizedType = type === "auto" ? "auto" : "manual";
  const [schemaRows, users, products, sales, orders, orderItems, auditLogs, inventoryLogs, purchases, inventory, dashboard, profitReport] = await Promise.all([
    query(`
      SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1)
      ORDER BY table_name, ordinal_position
    `, [backupTables]),
    query("SELECT id, username, password_hash, name, display_name, role, is_active, created_at, updated_at FROM users ORDER BY id"),
    query(`
      SELECT id, name, series, rarity, condition, product_type, grading_company, grade, cert_number, unit, cards_per_unit, package_spec, cost::text, average_cost::text, price::text, stock, low_stock_threshold, notes, deleted_at, deleted_by, created_at, updated_at
      FROM products
      ORDER BY id
    `),
    query(`
      SELECT id, product_id, user_id, order_id, quantity, sale_unit, cards_per_unit, unit_price::text, total::text, sold_at, voided_at, voided_by, created_at
      FROM sales
      ORDER BY id
    `),
    query(`
      SELECT id, customer_name, phone, shipping_info, line_name, status, total_amount::text AS total_amount, created_by, created_at, updated_at
      FROM orders
      ORDER BY id
    `),
    query(`
      SELECT id, order_id, product_id, product_name, product_series, quantity, unit_price::text, subtotal::text, created_at
      FROM order_items
      ORDER BY id
    `),
    query(`
      SELECT id, user_id, username, action_type, entity_type, before_data, after_data, undone_at, created_at
      FROM audit_logs
      ORDER BY id
    `),
    query(`
      SELECT id, product_id, user_id, action_type, quantity_delta, stock_before, stock_after, reference_type, reference_id, note, created_at
      FROM inventory_logs
      ORDER BY id
    `),
    query(`
      SELECT id, supplier, purchase_date, product_id, quantity, unit, unit_cost::text, total_cost::text, payment_status, notes,
             created_by, voided_at, voided_by, void_reason, created_at, updated_at
      FROM purchases
      ORDER BY id
    `),
    query(`
      SELECT id, name, series, rarity, condition, unit, cards_per_unit, package_spec, stock, low_stock_threshold, (COALESCE(NULLIF(average_cost, 0), cost) * stock)::float AS inventory_cost, (price * stock)::float AS inventory_price
      FROM products
      WHERE deleted_at IS NULL
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
      sales: sales.rows,
      orders: orders.rows,
      order_items: orderItems.rows,
      audit_logs: auditLogs.rows,
      inventory_logs: inventoryLogs.rows,
      purchases: purchases.rows
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
  const stale = backups.filter((_backup, index) => index >= 7);

  for (const backup of stale) {
    const filePath = await backupFilePath(backup.filename);
    await fs.unlink(filePath).catch(() => {});
  }
}

async function restoreDatabaseBackup(filename) {
  const filePath = await backupFilePath(filename);
  await fs.access(filePath);
  const backup = JSON.parse(await fs.readFile(filePath, "utf8"));
  const data = backup.data ?? {};
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("TRUNCATE TABLE order_items, orders, inventory_logs, audit_logs, purchases, sales, products, users RESTART IDENTITY CASCADE");

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
            (id, name, series, rarity, condition, product_type, grading_company, grade, cert_number, unit, cards_per_unit, package_spec, cost, average_cost, price, stock, low_stock_threshold, notes, deleted_at, deleted_by, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::numeric, $14::numeric, $15::numeric, $16, $17, $18, $19::timestamptz, $20, COALESCE($21::timestamptz, NOW()), COALESCE($22::timestamptz, NOW()))
        `,
        [
          product.id,
          product.name,
          product.series,
          product.rarity,
          product.condition,
          product.product_type ?? product.productType ?? "normal",
          product.grading_company ?? product.gradingCompany ?? null,
          product.grade ?? null,
          product.cert_number ?? product.certNumber ?? null,
          product.unit ?? "單張",
          product.cards_per_unit ?? 1,
          product.package_spec ?? "單張卡",
          product.cost,
          product.average_cost ?? product.averageCost ?? product.cost ?? 0,
          product.price,
          product.stock ?? 0,
          product.low_stock_threshold ?? 3,
          product.notes ?? "",
          product.deleted_at,
          product.deleted_by,
          product.created_at,
          product.updated_at
        ]
      );
    }

    for (const order of data.orders ?? []) {
      await client.query(
        `
          INSERT INTO orders (id, customer_name, phone, shipping_info, line_name, status, total_amount, created_by, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, (SELECT id FROM users WHERE id = $8), COALESCE($9::timestamptz, NOW()), COALESCE($10::timestamptz, NOW()))
        `,
        [
          order.id,
          order.customer_name ?? order.customerName ?? "",
          order.phone ?? "",
          order.shipping_info ?? order.shippingInfo ?? "",
          order.line_name ?? order.lineName ?? "",
          normalizeOrderStatus(order.status ?? order.orderStatus),
          order.total_amount ?? order.totalAmount ?? 0,
          order.created_by,
          order.created_at,
          order.updated_at
        ]
      );
    }

    for (const item of data.order_items ?? data.orderItems ?? []) {
      await client.query(
        `
          INSERT INTO order_items (id, order_id, product_id, product_name, product_series, quantity, unit_price, subtotal, created_at)
          VALUES ($1, (SELECT id FROM orders WHERE id = $2), (SELECT id FROM products WHERE id = $3), $4, $5, $6, $7::numeric, $8::numeric, COALESCE($9::timestamptz, NOW()))
        `,
        [
          item.id,
          item.order_id ?? item.orderId,
          item.product_id ?? item.productId,
          item.product_name ?? item.productName ?? "",
          item.product_series ?? item.productSeries ?? "",
          item.quantity,
          item.unit_price ?? item.unitPrice ?? 0,
          item.subtotal ?? 0,
          item.created_at
        ]
      );
    }

    for (const sale of data.sales ?? []) {
      await client.query(
        `
          INSERT INTO sales (id, product_id, user_id, order_id, quantity, sale_unit, cards_per_unit, unit_price, total, sold_at, voided_at, voided_by, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8::numeric, $9::numeric, $10::date, $11::timestamptz, $12, COALESCE($13::timestamptz, NOW()))
        `,
        [
          sale.id,
          sale.product_id,
          sale.user_id,
          sale.order_id ?? sale.orderId ?? null,
          sale.quantity,
          sale.sale_unit ?? "單張",
          sale.cards_per_unit ?? 1,
          sale.unit_price,
          sale.total,
          sale.sold_at,
          sale.voided_at,
          sale.voided_by,
          sale.created_at
        ]
      );
    }

    for (const log of data.audit_logs ?? data.auditLogs ?? []) {
      await client.query(
        `
          INSERT INTO audit_logs (id, user_id, username, action_type, entity_type, before_data, after_data, undone_at, created_at)
          VALUES ($1, (SELECT id FROM users WHERE id = $2), $3, $4, $5, $6::jsonb, $7::jsonb, $8::timestamptz, COALESCE($9::timestamptz, NOW()))
        `,
        [
          log.id,
          log.user_id,
          log.username ?? "system",
          log.action_type,
          log.entity_type,
          JSON.stringify(log.before_data ?? null),
          JSON.stringify(log.after_data ?? null),
          log.undone_at,
          log.created_at
        ]
      );
    }

    for (const log of data.inventory_logs ?? data.inventoryLogs ?? []) {
      await client.query(
        `
          INSERT INTO inventory_logs (id, product_id, user_id, action_type, quantity_delta, stock_before, stock_after, reference_type, reference_id, note, created_at)
          VALUES ($1, (SELECT id FROM products WHERE id = $2), (SELECT id FROM users WHERE id = $3), $4, $5, $6, $7, $8, $9, $10, COALESCE($11::timestamptz, NOW()))
        `,
        [
          log.id,
          log.product_id,
          log.user_id,
          log.action_type,
          log.quantity_delta,
          log.stock_before,
          log.stock_after,
          log.reference_type,
          log.reference_id,
          log.note ?? "",
          log.created_at
        ]
      );
    }

    for (const purchase of data.purchases ?? []) {
      await client.query(
        `
          INSERT INTO purchases
            (id, supplier, purchase_date, product_id, quantity, unit, unit_cost, total_cost, payment_status, notes, created_by, voided_at, voided_by, void_reason, created_at, updated_at)
          VALUES ($1, $2, $3::date, (SELECT id FROM products WHERE id = $4), $5, $6, $7::numeric, $8::numeric, $9, $10, (SELECT id FROM users WHERE id = $11), $12::timestamptz, (SELECT id FROM users WHERE id = $13), $14, COALESCE($15::timestamptz, NOW()), COALESCE($16::timestamptz, NOW()))
        `,
        [
          purchase.id,
          purchase.supplier,
          purchase.purchase_date,
          purchase.product_id,
          purchase.quantity,
          purchase.unit ?? "單張",
          purchase.unit_cost,
          purchase.total_cost,
          purchase.payment_status ?? "未付款",
          purchase.notes ?? "",
          purchase.created_by,
          purchase.voided_at,
          purchase.voided_by,
          purchase.void_reason,
          purchase.created_at,
          purchase.updated_at
        ]
      );
    }

    const adminCount = await client.query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND is_active = TRUE");
    if (adminCount.rows[0].count === 0) {
      const adminPasswordHash = bcrypt.hashSync(process.env.ADMIN_PASSWORD ?? "admin123", 12);
      await client.query(
        `
          INSERT INTO users (username, password_hash, name, display_name, role, is_active)
          VALUES ($1, $2, $3, $4, $5, TRUE)
          ON CONFLICT (username) DO UPDATE SET
            password_hash = EXCLUDED.password_hash,
            name = EXCLUDED.name,
            display_name = EXCLUDED.display_name,
            role = 'admin',
            is_active = TRUE,
            updated_at = NOW()
        `,
        ["admin", adminPasswordHash, "Brian", "Brian", "admin"]
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

async function tableExists(tableName) {
  const { rowCount } = await query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1",
    [tableName]
  );
  return rowCount > 0;
}

async function clearDemoData() {
  const backup = await createDatabaseBackup("manual");
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const tables = ["audit_logs", "purchases", "sales", "products"];
    if (await tableExists("inventory_logs")) tables.unshift("inventory_logs");

    await client.query(`TRUNCATE TABLE ${tables.join(", ")} RESTART IDENTITY CASCADE`);
    await client.query("COMMIT");
    return { ok: true, backup, clearedTables: tables };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function startScheduledBackups() {
  if (process.env.DISABLE_AUTO_BACKUP === "true") return;
  cron.schedule("0 3 * * *", async () => {
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

async function writeAuditLog(client, request, actionType, entityType, beforeData, afterData) {
  await client.query(
    `
      INSERT INTO audit_logs (user_id, username, action_type, entity_type, before_data, after_data)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
    `,
    [
      request.user?.id ?? null,
      request.user?.username ?? "system",
      actionType,
      entityType,
      JSON.stringify(beforeData ?? null),
      JSON.stringify(afterData ?? null)
    ]
  );
}

async function writeInventoryLog(client, request, productId, actionType, quantityDelta, stockBefore, stockAfter, referenceType, referenceId, note = "") {
  await client.query(
    `
      INSERT INTO inventory_logs (product_id, user_id, action_type, quantity_delta, stock_before, stock_after, reference_type, reference_id, note)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      productId,
      request.user?.id ?? null,
      actionType,
      quantityDelta,
      stockBefore,
      stockAfter,
      referenceType,
      referenceId,
      note
    ]
  );
}

async function productById(client, id) {
  const { rows } = await client.query(
    `
      SELECT id, name, series, rarity, condition, product_type, grading_company, grade, cert_number, unit, cards_per_unit, package_spec, cost::text, average_cost::text, price::text, stock, low_stock_threshold, notes, deleted_at, deleted_by, created_at, updated_at
      FROM products
      WHERE id = $1
    `,
    [id]
  );
  return rows[0] ?? null;
}

async function saleById(client, id) {
  const { rows } = await client.query(
    `
      SELECT id, product_id, user_id, order_id, quantity, sale_unit, cards_per_unit, unit_price::text, total::text, sold_at, voided_at, voided_by, created_at
      FROM sales
      WHERE id = $1
    `,
    [id]
  );
  return rows[0] ?? null;
}

async function purchaseById(client, id) {
  const { rows } = await client.query(
    `
      SELECT id, supplier, purchase_date, product_id, quantity, unit, unit_cost::text, total_cost::text,
             payment_status, notes, created_by, voided_at, voided_by, void_reason, created_at, updated_at
      FROM purchases
      WHERE id = $1
    `,
    [id]
  );
  return rows[0] ?? null;
}

async function orderById(client, id) {
  const { rows } = await client.query(
    `
      SELECT
        orders.id,
        orders.customer_name,
        orders.phone,
        orders.shipping_info,
        orders.line_name,
        orders.status,
        orders.total_amount::float AS total_amount,
        orders.created_by,
        orders.created_at,
        orders.updated_at,
        users.name AS created_by_name,
        COALESCE(
          json_agg(
            json_build_object(
              'id', order_items.id,
              'productId', order_items.product_id,
              'productName', order_items.product_name,
              'productSeries', order_items.product_series,
              'quantity', order_items.quantity,
              'unitPrice', order_items.unit_price::float,
              'subtotal', order_items.subtotal::float
            )
            ORDER BY order_items.id
          ) FILTER (WHERE order_items.id IS NOT NULL),
          '[]'::json
        ) AS items
      FROM orders
      LEFT JOIN users ON users.id = orders.created_by
      LEFT JOIN order_items ON order_items.order_id = orders.id
      WHERE orders.id = $1
      GROUP BY orders.id, users.name
    `,
    [id]
  );
  const row = rows[0] ?? null;
  if (!row) return null;
  return {
    ...row,
    status: normalizeOrderStatus(row.status)
  };
}

async function orderItemsByOrderId(client, orderId) {
  const { rows } = await client.query(
    `
      SELECT id, order_id, product_id, product_name, product_series, quantity, unit_price::text, subtotal::text, created_at
      FROM order_items
      WHERE order_id = $1
      ORDER BY id
    `,
    [orderId]
  );
  return rows;
}

async function salesByOrderId(client, orderId) {
  const { rows } = await client.query(
    `
      SELECT id, product_id, user_id, order_id, quantity, sale_unit, cards_per_unit, unit_price::text, total::text, sold_at, voided_at, voided_by, created_at
      FROM sales
      WHERE order_id = $1
      ORDER BY id
      FOR UPDATE
    `,
    [orderId]
  );
  return rows;
}

async function recalculateAverageCost(client, productId) {
  const { rows } = await client.query(
    `
      SELECT
        COALESCE(SUM(quantity * unit_cost), 0)::numeric AS total_cost,
        COALESCE(SUM(quantity), 0)::numeric AS total_quantity
      FROM purchases
      WHERE product_id = $1 AND voided_at IS NULL
    `,
    [productId]
  );
  const totalQuantity = Number(rows[0].total_quantity);
  const averageCost = totalQuantity > 0 ? Number(rows[0].total_cost) / totalQuantity : 0;
  await client.query("UPDATE products SET average_cost = $1, cost = $1, updated_at = NOW() WHERE id = $2", [averageCost, productId]);
  return averageCost;
}

async function userById(client, id) {
  const { rows } = await client.query(
    "SELECT id, username, password_hash, name, display_name, role, is_active, created_at, updated_at FROM users WHERE id = $1",
    [id]
  );
  return rows[0] ?? null;
}

async function restoreProductSnapshot(client, product) {
  await client.query(
    `
      INSERT INTO products
        (id, name, series, rarity, condition, product_type, grading_company, grade, cert_number, unit, cards_per_unit, package_spec, cost, average_cost, price, stock, low_stock_threshold, notes, deleted_at, deleted_by, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::numeric, $14::numeric, $15::numeric, $16, $17, $18, $19::timestamptz, $20, COALESCE($21::timestamptz, NOW()), COALESCE($22::timestamptz, NOW()))
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        series = EXCLUDED.series,
        rarity = EXCLUDED.rarity,
        condition = EXCLUDED.condition,
        product_type = EXCLUDED.product_type,
        grading_company = EXCLUDED.grading_company,
        grade = EXCLUDED.grade,
        cert_number = EXCLUDED.cert_number,
        unit = EXCLUDED.unit,
        cards_per_unit = EXCLUDED.cards_per_unit,
        package_spec = EXCLUDED.package_spec,
        cost = EXCLUDED.cost,
        average_cost = EXCLUDED.average_cost,
        price = EXCLUDED.price,
        stock = EXCLUDED.stock,
        low_stock_threshold = EXCLUDED.low_stock_threshold,
        notes = EXCLUDED.notes,
        deleted_at = EXCLUDED.deleted_at,
        deleted_by = EXCLUDED.deleted_by,
        updated_at = NOW()
    `,
    [
      product.id,
      product.name,
      product.series,
      product.rarity,
      product.condition,
      product.product_type ?? product.productType ?? "normal",
      product.grading_company ?? product.gradingCompany ?? null,
      product.grade ?? null,
      product.cert_number ?? product.certNumber ?? null,
      product.unit ?? "單張",
      product.cards_per_unit ?? 1,
      product.package_spec ?? "單張卡",
      product.cost,
      product.average_cost ?? product.averageCost ?? product.cost ?? 0,
      product.price,
      product.stock ?? 0,
      product.low_stock_threshold ?? 3,
      product.notes ?? "",
      product.deleted_at,
      product.deleted_by,
      product.created_at,
      product.updated_at
    ]
  );
}

async function restoreUserSnapshot(client, user) {
  await client.query(
    `
      INSERT INTO users (id, username, password_hash, name, display_name, role, is_active, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, NOW()), COALESCE($9::timestamptz, NOW()))
      ON CONFLICT (id) DO UPDATE SET
        username = EXCLUDED.username,
        password_hash = EXCLUDED.password_hash,
        name = EXCLUDED.name,
        display_name = EXCLUDED.display_name,
        role = EXCLUDED.role,
        is_active = EXCLUDED.is_active,
        updated_at = NOW()
    `,
    [user.id, user.username, user.password_hash, user.name, user.display_name ?? user.name, user.role, user.is_active !== false, user.created_at, user.updated_at]
  );
}

async function restoreSaleSnapshot(client, sale) {
  await client.query(
    `
      INSERT INTO sales (id, product_id, user_id, quantity, sale_unit, cards_per_unit, unit_price, total, sold_at, voided_at, voided_by, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8::numeric, $9::date, $10::timestamptz, $11, COALESCE($12::timestamptz, NOW()))
      ON CONFLICT (id) DO UPDATE SET
        product_id = EXCLUDED.product_id,
        user_id = EXCLUDED.user_id,
        quantity = EXCLUDED.quantity,
        sale_unit = EXCLUDED.sale_unit,
        cards_per_unit = EXCLUDED.cards_per_unit,
        unit_price = EXCLUDED.unit_price,
        total = EXCLUDED.total,
        sold_at = EXCLUDED.sold_at,
        voided_at = EXCLUDED.voided_at,
        voided_by = EXCLUDED.voided_by
    `,
    [sale.id, sale.product_id, sale.user_id, sale.quantity, sale.sale_unit ?? "單張", sale.cards_per_unit ?? 1, sale.unit_price, sale.total, sale.sold_at, sale.voided_at, sale.voided_by, sale.created_at]
  );
}

async function restoreOrderSnapshot(client, order) {
  const normalizedStatus = normalizeOrderStatus(order.status ?? order.orderStatus);
  await client.query(
    `
      INSERT INTO orders (id, customer_name, phone, shipping_info, line_name, status, total_amount, created_by, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8, COALESCE($9::timestamptz, NOW()), COALESCE($10::timestamptz, NOW()))
      ON CONFLICT (id) DO UPDATE SET
        customer_name = EXCLUDED.customer_name,
        phone = EXCLUDED.phone,
        shipping_info = EXCLUDED.shipping_info,
        line_name = EXCLUDED.line_name,
        status = EXCLUDED.status,
        total_amount = EXCLUDED.total_amount,
        created_by = EXCLUDED.created_by,
        updated_at = NOW()
    `,
    [
      order.id,
      order.customer_name ?? order.customerName ?? "",
      order.phone ?? "",
      order.shipping_info ?? order.shippingInfo ?? "",
      order.line_name ?? order.lineName ?? "",
      normalizedStatus,
      order.total_amount ?? order.totalAmount ?? 0,
      order.created_by ?? order.createdBy ?? null,
      order.created_at,
      order.updated_at
    ]
  );

  await client.query("DELETE FROM order_items WHERE order_id = $1", [order.id]);
  for (const item of order.items ?? []) {
    await client.query(
      `
        INSERT INTO order_items (order_id, product_id, product_name, product_series, quantity, unit_price, subtotal, created_at)
        VALUES ($1, $2, $3, $4, $5, $6::numeric, $7::numeric, COALESCE($8::timestamptz, NOW()))
      `,
      [
        order.id,
        item.product_id ?? item.productId ?? null,
        item.product_name ?? item.productName ?? "",
        item.product_series ?? item.productSeries ?? "",
        item.quantity,
        item.unit_price ?? item.unitPrice ?? 0,
        item.subtotal ?? 0,
        item.created_at
      ]
    );
  }
}

async function syncSequence(client, tableName) {
  await client.query(`SELECT setval(pg_get_serial_sequence('${tableName}', 'id'), COALESCE((SELECT MAX(id) FROM ${tableName}), 1), TRUE)`);
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
    response.json(rowsToCamel(rows).map((order) => ({
      ...order,
      status: normalizeOrderStatus(order.status)
    })));
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

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `
        INSERT INTO users (username, password_hash, name, display_name, role, is_active)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, username, password_hash, name, display_name, role, is_active, created_at, updated_at
      `,
      [user.username, bcrypt.hashSync(password, 12), user.name, user.displayName, user.role, user.isActive]
    );
    await writeAuditLog(client, request, "create", "user", null, rows[0]);
    await client.query("COMMIT");
    response.status(201).json({ id: rows[0].id });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") return response.status(409).json({ message: "帳號已存在" });
    next(error);
  } finally {
    client.release();
  }
});

app.put("/api/users/:id", currentUser, requireAdmin, async (request, response, next) => {
  const userId = Number(request.params.id);
  const user = userPayload(request.body);
  if (!validateUserPayload(user)) return response.status(400).json({ message: "員工資料不完整" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (user.role !== "admin" && await isLastActiveAdmin(userId)) {
      await client.query("ROLLBACK");
      return response.status(409).json({ message: "不允許移除最後一個 admin" });
    }

    const before = await userById(client, userId);
    if (!before) {
      await client.query("ROLLBACK");
      return response.status(404).json({ message: "員工不存在" });
    }

    const result = await client.query(
      `
        UPDATE users
        SET name = $1, display_name = $2, role = $3, updated_at = NOW()
        WHERE id = $4
        RETURNING id, username, password_hash, name, display_name, role, is_active, created_at, updated_at
      `,
      [user.name, user.displayName, user.role, userId]
    );
    await writeAuditLog(client, request, "update", "user", before, result.rows[0]);
    await client.query("COMMIT");
    response.json({ ok: true });

    void syncReportsInBackground();
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

app.patch("/api/users/:id/password", currentUser, requireAdmin, async (request, response, next) => {
  const password = String(request.body.password ?? "");
  if (password.length < 6) return response.status(400).json({ message: "密碼至少 6 碼" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await userById(client, Number(request.params.id));
    const result = await client.query(
      "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2 RETURNING id, username, password_hash, name, display_name, role, is_active, created_at, updated_at",
      [bcrypt.hashSync(password, 12), Number(request.params.id)]
    );
    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return response.status(404).json({ message: "員工不存在" });
    }
    await writeAuditLog(client, request, "update", "user", before, result.rows[0]);
    await client.query("COMMIT");
    response.json({ ok: true });

    void syncReportsInBackground();
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

app.patch("/api/users/:id/status", currentUser, requireAdmin, async (request, response, next) => {
  const userId = Number(request.params.id);
  const isActive = request.body.isActive === true;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!isActive && await isLastActiveAdmin(userId)) {
      await client.query("ROLLBACK");
      return response.status(409).json({ message: "不允許停用最後一個 admin" });
    }

    const before = await userById(client, userId);
    const result = await client.query(
      "UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING id, username, password_hash, name, display_name, role, is_active, created_at, updated_at",
      [isActive, userId]
    );
    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return response.status(404).json({ message: "員工不存在" });
    }
    await writeAuditLog(client, request, "update", "user", before, result.rows[0]);
    await client.query("COMMIT");
    response.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

app.delete("/api/users/:id", currentUser, requireAdmin, async (request, response, next) => {
  const userId = Number(request.params.id);
  if (userId === request.user.id) return response.status(409).json({ message: "不允許刪除目前登入中的自己" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (await isLastActiveAdmin(userId)) {
      await client.query("ROLLBACK");
      return response.status(409).json({ message: "不允許刪除最後一個 admin" });
    }

    const before = await userById(client, userId);
    const result = await client.query("DELETE FROM users WHERE id = $1", [userId]);
    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return response.status(404).json({ message: "員工不存在" });
    }
    await writeAuditLog(client, request, "delete", "user", before, null);
    await client.query("COMMIT");
    response.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23503") return response.status(409).json({ message: "此員工已有銷售紀錄，無法刪除，可改為停用" });
    next(error);
  } finally {
    client.release();
  }
});

app.get("/api/products", currentUser, async (request, response, next) => {
  const keyword = `%${String(request.query.q ?? "").trim()}%`;
  try {
    const { rows } = await query(
      `
        SELECT id, name, series, rarity, condition, product_type, grading_company, grade, cert_number, unit, cards_per_unit, package_spec,
               cost::float AS cost, price::float AS price, stock, low_stock_threshold, notes, deleted_at, deleted_by, created_at, updated_at
        FROM products
        WHERE deleted_at IS NULL
          AND (name ILIKE $1 OR series ILIKE $1 OR rarity ILIKE $1 OR condition ILIKE $1
           OR product_type ILIKE $1 OR grading_company ILIKE $1 OR grade ILIKE $1 OR cert_number ILIKE $1
           OR unit ILIKE $1 OR package_spec ILIKE $1 OR notes ILIKE $1)
        ORDER BY updated_at DESC, id DESC
      `,
      [keyword]
    );
    response.json(rowsToCamel(rows).map((order) => ({
      ...order,
      status: normalizeOrderStatus(order.status)
    })));
  } catch (error) {
    next(error);
  }
});

app.get("/api/products/deleted", currentUser, requireAdmin, async (_request, response, next) => {
  try {
    const { rows } = await query(
      `
        SELECT products.id, products.name, products.series, products.rarity, products.condition, products.product_type,
               products.grading_company, products.grade, products.cert_number, products.unit,
               products.cards_per_unit, products.package_spec, products.cost::float AS cost, products.price::float AS price,
               products.stock, products.low_stock_threshold, products.notes, products.deleted_at, products.deleted_by,
               products.created_at, products.updated_at, users.name AS deleted_by_name
        FROM products
        LEFT JOIN users ON users.id = products.deleted_by
        WHERE products.deleted_at IS NOT NULL
        ORDER BY products.deleted_at DESC, products.id DESC
      `
    );
    response.json(rowsToCamel(rows).map((order) => ({
      ...order,
      status: normalizeOrderStatus(order.status)
    })));
  } catch (error) {
    next(error);
  }
});

app.post("/api/products", currentUser, requireAdmin, async (request, response, next) => {
  const product = productPayload(request.body);
  if (!validateProduct(product)) return response.status(400).json({ message: "商品資料不完整或格式錯誤" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `
        INSERT INTO products
          (name, series, rarity, condition, product_type, grading_company, grade, cert_number, unit, cards_per_unit, package_spec, cost, price, stock, low_stock_threshold, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        RETURNING id, name, series, rarity, condition, product_type, grading_company, grade, cert_number, unit, cards_per_unit, package_spec, cost::text, average_cost::text, price::text, stock, low_stock_threshold, notes, created_at, updated_at
      `,
      [
        product.name,
        product.series,
        product.rarity,
        product.condition,
        product.productType,
        product.gradingCompany,
        product.grade,
        product.certNumber,
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
    await writeAuditLog(client, request, "create", "product", null, rows[0]);
    await client.query("COMMIT");
    response.status(201).json({ id: rows[0].id });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

app.put("/api/products/:id", currentUser, requireAdmin, async (request, response, next) => {
  const product = productPayload(request.body);
  if (!validateProduct(product)) return response.status(400).json({ message: "商品資料不完整或格式錯誤" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await productById(client, Number(request.params.id));
    if (!before) {
      await client.query("ROLLBACK");
      return response.status(404).json({ message: "商品不存在" });
    }
    if (before.deleted_at) {
      await client.query("ROLLBACK");
      return response.status(409).json({ message: "已刪除商品需先還原才能編輯" });
    }

    const entityType = before.stock !== product.stock ? "inventory" : "product";
    const result = await client.query(
      `
        UPDATE products
        SET name = $1,
            series = $2,
            rarity = $3,
            condition = $4,
            product_type = $5,
            grading_company = $6,
            grade = $7,
            cert_number = $8,
            unit = $9,
            cards_per_unit = $10,
            package_spec = $11,
            cost = $12,
            price = $13,
            stock = $14,
            low_stock_threshold = $15,
            notes = $16,
            updated_at = NOW()
        WHERE id = $17
        RETURNING id, name, series, rarity, condition, product_type, grading_company, grade, cert_number, unit, cards_per_unit, package_spec, cost::text, average_cost::text, price::text, stock, low_stock_threshold, notes, deleted_at, deleted_by, created_at, updated_at
      `,
      [
        product.name,
        product.series,
        product.rarity,
        product.condition,
        product.productType,
        product.gradingCompany,
        product.grade,
        product.certNumber,
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
    if (before.stock !== result.rows[0].stock) {
      await writeInventoryLog(client, request, result.rows[0].id, "manual_adjustment", result.rows[0].stock - before.stock, before.stock, result.rows[0].stock, "product", result.rows[0].id, "商品庫存調整");
    }
    await writeAuditLog(client, request, "update", entityType, before, result.rows[0]);
    await client.query("COMMIT");
    response.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

app.delete("/api/products/:id", currentUser, requireAdmin, async (request, response, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await productById(client, Number(request.params.id));
    if (!before) {
      await client.query("ROLLBACK");
      return response.status(404).json({ message: "商品不存在" });
    }
    if (before.deleted_at) {
      await client.query("ROLLBACK");
      return response.status(409).json({ message: "商品已在已刪除列表" });
    }

    const result = await client.query(
      `
        UPDATE products
        SET deleted_at = NOW(), deleted_by = $1, updated_at = NOW()
        WHERE id = $2 AND deleted_at IS NULL
        RETURNING id, name, series, rarity, condition, unit, cards_per_unit, package_spec, cost::text, average_cost::text, price::text, stock, low_stock_threshold, notes, deleted_at, deleted_by, created_at, updated_at
      `,
      [request.user.id, request.params.id]
    );
    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return response.status(404).json({ message: "商品不存在" });
    }
    await writeAuditLog(client, request, "delete", "product", before, result.rows[0]);
    await client.query("COMMIT");
    response.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

app.patch("/api/products/:id/restore", currentUser, requireAdmin, async (request, response, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await productById(client, Number(request.params.id));
    if (!before) {
      await client.query("ROLLBACK");
      return response.status(404).json({ message: "商品不存在" });
    }
    if (!before.deleted_at) {
      await client.query("ROLLBACK");
      return response.status(409).json({ message: "商品未被刪除" });
    }

    const result = await client.query(
      `
        UPDATE products
        SET deleted_at = NULL, deleted_by = NULL, updated_at = NOW()
        WHERE id = $1
        RETURNING id, name, series, rarity, condition, product_type, grading_company, grade, cert_number, unit, cards_per_unit, package_spec, cost::text, average_cost::text, price::text, stock, low_stock_threshold, notes, deleted_at, deleted_by, created_at, updated_at
      `,
      [request.params.id]
    );
    await writeAuditLog(client, request, "restore", "product", before, result.rows[0]);
    await client.query("COMMIT");
    response.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

function parseDelimitedRows(text, delimiter) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;
  const source = String(text ?? "").replace(/^\uFEFF/, "");

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "\"" && inQuotes && next === "\"") {
      current += "\"";
      index += 1;
    } else if (char === "\"") {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
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

  if (inQuotes) {
    const error = new Error("CSV 格式錯誤：引號未正確關閉");
    error.statusCode = 400;
    throw error;
  }

  row.push(current.trim());
  if (row.some((cell) => cell !== "")) rows.push(row);
  return rows;
}

function parseCsv(text) {
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  const candidates = [",", "\t", ";", "，"];
  const parsed = candidates.map((delimiter) => {
    const rows = parseDelimitedRows(source, delimiter);
    return {
      delimiter,
      rows,
      score: rows[0]?.length ?? 0
    };
  });

  parsed.sort((a, b) => b.score - a.score);
  return parsed[0]?.rows ?? [];
}

const importHeaderMap = {
  商品名稱: "name",
  name: "name",
  商品類型: "productType",
  productType: "productType",
  product_type: "productType",
  成本: "cost",
  進貨成本: "cost",
  cost: "cost",
  售價: "price",
  price: "price",
  庫存數量: "stock",
  stock: "stock",
  系列: "series",
  卡牌系列: "series",
  series: "series",
  單位: "unit",
  unit: "unit",
  包裝規格: "packageSpec",
  packageSpec: "packageSpec",
  package_spec: "packageSpec",
  鑑定公司: "gradingCompany",
  gradingCompany: "gradingCompany",
  grading_company: "gradingCompany",
  grade: "grade",
  Grade: "grade",
  鑑定編號: "certNumber",
  certNumber: "certNumber",
  cert_number: "certNumber",
  稀有度: "rarity",
  rarity: "rarity",
  卡況: "condition",
  condition: "condition",
  每單位張數: "cardsPerUnit",
  cardsPerUnit: "cardsPerUnit",
  cards_per_unit: "cardsPerUnit",
  低庫存門檻: "lowStockThreshold",
  lowStockThreshold: "lowStockThreshold",
  low_stock_threshold: "lowStockThreshold",
  備註: "notes",
  notes: "notes"
};

function normalizeImportHeader(header) {
  const value = String(header ?? "").replace(/^\uFEFF/, "").trim();
  return importHeaderMap[value] ?? value;
}

function normalizeImportCell(value) {
  return String(value ?? "").replace(/^\uFEFF/, "").trim();
}

function importValue(row, names) {
  const keys = Array.isArray(names) ? names : [names];
  for (const key of keys) {
    if (row[key] !== undefined && String(row[key]).trim() !== "") return row[key];
  }
  return "";
}

function normalizeImportRows(body) {
  if (Array.isArray(body.rows)) return body.rows;
  const csvText = String(body.csv ?? "").replace(/^\uFEFF/, "").trim();
  if (!csvText) {
    const error = new Error("CSV 內容是空的");
    error.statusCode = 400;
    throw error;
  }

  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    const error = new Error("CSV 沒有可讀取的資料列");
    error.statusCode = 400;
    throw error;
  }

  const headers = rows.shift()?.map(normalizeImportHeader) ?? [];
  if (headers.length === 0 || headers.every((header) => header === "")) {
    const error = new Error("CSV 缺少欄位標題");
    error.statusCode = 400;
    throw error;
  }
  const requiredHeaders = ["name", "series", "cost", "price", "stock"];
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) {
    const error = new Error(`CSV 欄位無法對應：缺少 ${missingHeaders.join(", ")}。請確認 header 包含商品名稱、系列、成本、售價、庫存數量。`);
    error.statusCode = 400;
    throw error;
  }

  const dataRows = rows.filter((cells) => cells.some((cell) => String(cell ?? "").trim() !== ""));
  if (dataRows.length === 0) {
    const error = new Error("CSV 只有欄位標題，沒有商品資料列");
    error.statusCode = 400;
    throw error;
  }

  return dataRows.map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, normalizeImportCell(cells[index])]))
  );
}

app.post("/api/products/import", currentUser, requireAdmin, async (request, response, next) => {
  let rows;
  try {
    rows = normalizeImportRows(request.body);
  } catch (error) {
    if (error.statusCode === 400) return response.status(400).json({ message: error.message });
    return next(error);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let imported = 0;
    const invalidRows = [];

    for (const [index, row] of rows.entries()) {
      const unit = String(importValue(row, ["單位", "unit"]) || "單張").trim();
      const cardsPerUnit = importValue(row, ["cardsPerUnit", "每單位張數", "cards_per_unit"]) || 1;
      const product = productPayload({
        name: importValue(row, ["name", "商品名稱"]),
        series: importValue(row, ["series", "系列", "卡牌系列"]),
        rarity: importValue(row, ["稀有度", "rarity"]) || "未分類",
        condition: importValue(row, ["卡況", "condition"]) || "未標示",
        productType: importValue(row, ["productType", "商品類型"]) || "normal",
        gradingCompany: importValue(row, ["gradingCompany", "鑑定公司"]),
        grade: importValue(row, ["grade", "Grade"]),
        certNumber: importValue(row, ["certNumber", "cert_number", "鑑定編號"]),
        unit,
        cardsPerUnit,
        packageSpec: importValue(row, ["packageSpec", "包裝規格", "package_spec"]) || `${cardsPerUnit} 張/${unit}`,
        cost: importValue(row, ["cost", "成本", "進貨成本"]),
        price: importValue(row, ["price", "售價"]),
        stock: importValue(row, ["stock", "庫存數量"]),
        lowStockThreshold: importValue(row, ["lowStockThreshold", "低庫存門檻", "low_stock_threshold"]) || 3,
        notes: importValue(row, ["備註", "notes"])
      });

      if (!validateProduct(product)) {
        invalidRows.push(index + 2);
        continue;
      }

      const inserted = await client.query(
        `
          INSERT INTO products
            (name, series, rarity, condition, product_type, grading_company, grade, cert_number, unit, cards_per_unit, package_spec, cost, price, stock, low_stock_threshold, notes)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
          RETURNING id, name, series, rarity, condition, product_type, grading_company, grade, cert_number, unit, cards_per_unit, package_spec, cost::text, average_cost::text, price::text, stock, low_stock_threshold, notes, created_at, updated_at
        `,
        [
          product.name,
          product.series,
          product.rarity,
          product.condition,
          product.productType,
          product.gradingCompany,
          product.grade,
          product.certNumber,
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
      await writeAuditLog(client, request, "create", "product", null, inserted.rows[0]);
      imported += 1;
    }

    if (imported === 0) {
      await client.query("ROLLBACK");
      return response.status(400).json({ message: `CSV 已成功讀取 ${rows.length} 筆資料列，但第 ${invalidRows.join(", ")} 列未通過驗證。請確認商品名稱、系列、成本、售價與庫存數量。` });
    }

    await client.query("COMMIT");
    response.status(201).json({ imported, parsed: rows.length });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

app.get("/api/purchases", currentUser, async (request, response, next) => {
  const params = [];
  const filters = ["purchases.voided_at IS NULL"];
  if (request.query.from) {
    params.push(request.query.from);
    filters.push(`purchases.purchase_date >= $${params.length}::date`);
  }
  if (request.query.to) {
    params.push(request.query.to);
    filters.push(`purchases.purchase_date <= $${params.length}::date`);
  }
  if (request.query.supplier) {
    params.push(`%${String(request.query.supplier).trim()}%`);
    filters.push(`purchases.supplier ILIKE $${params.length}`);
  }
  if (request.query.product) {
    params.push(`%${String(request.query.product).trim()}%`);
    filters.push(`products.name ILIKE $${params.length}`);
  }
  if (request.query.paymentStatus && paymentStatuses.has(String(request.query.paymentStatus))) {
    params.push(request.query.paymentStatus);
    filters.push(`purchases.payment_status = $${params.length}`);
  }

  try {
    const { rows } = await query(
      `
        SELECT purchases.id, purchases.supplier, to_char(purchases.purchase_date, 'YYYY-MM-DD') AS purchase_date,
               purchases.product_id, products.name AS product_name, products.series AS product_series,
               purchases.quantity, purchases.unit, purchases.unit_cost::float AS unit_cost,
               purchases.total_cost::float AS total_cost, purchases.payment_status, purchases.notes,
               purchases.created_by, users.name AS created_by_name, purchases.created_at, purchases.updated_at,
               purchases.voided_at, purchases.voided_by, purchases.void_reason
        FROM purchases
        JOIN products ON products.id = purchases.product_id
        LEFT JOIN users ON users.id = purchases.created_by
        WHERE ${filters.join(" AND ")}
        ORDER BY purchases.purchase_date DESC, purchases.id DESC
        LIMIT 200
      `,
      params
    );
    response.json(rowsToCamel(rows));
  } catch (error) {
    next(error);
  }
});

app.get("/api/purchases/:id", currentUser, async (request, response, next) => {
  try {
    const { rows } = await query(
      `
        SELECT purchases.id, purchases.supplier, to_char(purchases.purchase_date, 'YYYY-MM-DD') AS purchase_date,
               purchases.product_id, products.name AS product_name, products.series AS product_series,
               purchases.quantity, purchases.unit, purchases.unit_cost::float AS unit_cost,
               purchases.total_cost::float AS total_cost, purchases.payment_status, purchases.notes,
               purchases.created_by, users.name AS created_by_name, purchases.created_at, purchases.updated_at,
               purchases.voided_at, purchases.voided_by, purchases.void_reason
        FROM purchases
        JOIN products ON products.id = purchases.product_id
        LEFT JOIN users ON users.id = purchases.created_by
        WHERE purchases.id = $1
      `,
      [request.params.id]
    );
    if (!rows[0]) return response.status(404).json({ message: "進貨單不存在" });
    response.json(toCamel(rows[0]));
  } catch (error) {
    next(error);
  }
});

app.post("/api/purchases", currentUser, requireAdmin, async (request, response, next) => {
  const purchase = purchasePayload(request.body);
  if (!validatePurchase(purchase)) return response.status(400).json({ message: "進貨資料不完整或格式錯誤" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const productResult = await client.query(
      "SELECT id, name, stock, average_cost::float AS average_cost, cost::float AS cost, deleted_at FROM products WHERE id = $1 FOR UPDATE",
      [purchase.productId]
    );
    const product = productResult.rows[0];
    if (!product || product.deleted_at) {
      await client.query("ROLLBACK");
      return response.status(404).json({ message: "商品不存在" });
    }

    const inserted = await client.query(
      `
        INSERT INTO purchases (supplier, purchase_date, product_id, quantity, unit, unit_cost, total_cost, payment_status, notes, created_by)
        VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id, supplier, purchase_date, product_id, quantity, unit, unit_cost::text, total_cost::text, payment_status, notes, created_by, voided_at, voided_by, void_reason, created_at, updated_at
      `,
      [purchase.supplier, purchase.purchaseDate, purchase.productId, purchase.quantity, purchase.unit, purchase.unitCost, purchase.totalCost, purchase.paymentStatus, purchase.notes, request.user.id]
    );
    const stockBefore = product.stock;
    const stockAfter = stockBefore + purchase.quantity;
    await client.query("UPDATE products SET stock = $1, updated_at = NOW() WHERE id = $2", [stockAfter, purchase.productId]);
    await recalculateAverageCost(client, purchase.productId);
    const afterProduct = await productById(client, purchase.productId);
    await writeInventoryLog(client, request, purchase.productId, "purchase", purchase.quantity, stockBefore, stockAfter, "purchase", inserted.rows[0].id, "新增進貨單增加庫存");
    await writeAuditLog(client, request, "create", "purchase", null, { purchase: inserted.rows[0], product: afterProduct });
    await client.query("COMMIT");
    response.status(201).json({ id: inserted.rows[0].id });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

app.put("/api/purchases/:id", currentUser, requireAdmin, async (request, response, next) => {
  const purchase = purchasePayload(request.body);
  if (!validatePurchase(purchase)) return response.status(400).json({ message: "進貨資料不完整或格式錯誤" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await purchaseById(client, Number(request.params.id));
    if (!before || before.voided_at) {
      await client.query("ROLLBACK");
      return response.status(404).json({ message: "進貨單不存在" });
    }

    const productIds = [...new Set([before.product_id, purchase.productId])];
    const lockedProducts = await client.query(
      "SELECT id, stock FROM products WHERE id = ANY($1) AND deleted_at IS NULL FOR UPDATE",
      [productIds]
    );
    if (lockedProducts.rowCount !== productIds.length) {
      await client.query("ROLLBACK");
      return response.status(404).json({ message: "商品不存在" });
    }
    const productByIdMap = new Map(lockedProducts.rows.map((product) => [product.id, product]));

    if (before.product_id === purchase.productId) {
      const product = productByIdMap.get(purchase.productId);
      const diff = purchase.quantity - before.quantity;
      const stockAfter = product.stock + diff;
      if (stockAfter < 0) {
        await client.query("ROLLBACK");
        return response.status(409).json({ message: "庫存不足，無法修改進貨單" });
      }
      await client.query("UPDATE products SET stock = $1, updated_at = NOW() WHERE id = $2", [stockAfter, purchase.productId]);
      if (diff !== 0) await writeInventoryLog(client, request, purchase.productId, "purchase_update", diff, product.stock, stockAfter, "purchase", before.id, "編輯進貨單調整庫存");
    } else {
      const oldProduct = productByIdMap.get(before.product_id);
      const newProduct = productByIdMap.get(purchase.productId);
      const oldStockAfter = oldProduct.stock - before.quantity;
      if (oldStockAfter < 0) {
        await client.query("ROLLBACK");
        return response.status(409).json({ message: "原商品庫存不足，無法修改進貨單" });
      }
      await client.query("UPDATE products SET stock = $1, updated_at = NOW() WHERE id = $2", [oldStockAfter, before.product_id]);
      await client.query("UPDATE products SET stock = $1, updated_at = NOW() WHERE id = $2", [newProduct.stock + purchase.quantity, purchase.productId]);
      await writeInventoryLog(client, request, before.product_id, "purchase_update", -before.quantity, oldProduct.stock, oldStockAfter, "purchase", before.id, "編輯進貨單移出原商品庫存");
      await writeInventoryLog(client, request, purchase.productId, "purchase_update", purchase.quantity, newProduct.stock, newProduct.stock + purchase.quantity, "purchase", before.id, "編輯進貨單移入新商品庫存");
    }

    const updated = await client.query(
      `
        UPDATE purchases
        SET supplier = $1, purchase_date = $2::date, product_id = $3, quantity = $4, unit = $5,
            unit_cost = $6, total_cost = $7, payment_status = $8, notes = $9, updated_at = NOW()
        WHERE id = $10
        RETURNING id, supplier, purchase_date, product_id, quantity, unit, unit_cost::text, total_cost::text, payment_status, notes, created_by, voided_at, voided_by, void_reason, created_at, updated_at
      `,
      [purchase.supplier, purchase.purchaseDate, purchase.productId, purchase.quantity, purchase.unit, purchase.unitCost, purchase.totalCost, purchase.paymentStatus, purchase.notes, request.params.id]
    );
    await recalculateAverageCost(client, before.product_id);
    if (before.product_id !== purchase.productId) await recalculateAverageCost(client, purchase.productId);
    await writeAuditLog(client, request, "update", "purchase", before, updated.rows[0]);
    await client.query("COMMIT");
    response.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

async function voidPurchase(request, response, next) {
  const reason = String(request.body?.voidReason ?? request.body?.reason ?? "").trim();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await purchaseById(client, Number(request.params.id));
    if (!before || before.voided_at) {
      await client.query("ROLLBACK");
      return response.status(404).json({ message: "進貨單不存在" });
    }
    const productResult = await client.query("SELECT id, stock FROM products WHERE id = $1 FOR UPDATE", [before.product_id]);
    const product = productResult.rows[0];
    if (!product) {
      await client.query("ROLLBACK");
      return response.status(404).json({ message: "商品不存在" });
    }
    const stockAfter = product.stock - before.quantity;
    if (stockAfter < 0) {
      await client.query("ROLLBACK");
      return response.status(409).json({ message: "庫存不足，無法作廢進貨單" });
    }

    await client.query("UPDATE products SET stock = $1, updated_at = NOW() WHERE id = $2", [stockAfter, before.product_id]);
    const voided = await client.query(
      `
        UPDATE purchases
        SET voided_at = NOW(), voided_by = $1, void_reason = $2, updated_at = NOW()
        WHERE id = $3
        RETURNING id, supplier, purchase_date, product_id, quantity, unit, unit_cost::text, total_cost::text, payment_status, notes, created_by, voided_at, voided_by, void_reason, created_at, updated_at
      `,
      [request.user.id, reason, request.params.id]
    );
    await recalculateAverageCost(client, before.product_id);
    await writeInventoryLog(client, request, before.product_id, "purchase_void", -before.quantity, product.stock, stockAfter, "purchase", before.id, "作廢進貨單回扣庫存");
    await writeAuditLog(client, request, "delete", "purchase", before, voided.rows[0]);
    await client.query("COMMIT");
    response.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
}

app.post("/api/purchases/:id/void", currentUser, requireAdmin, voidPurchase);
app.delete("/api/purchases/:id", currentUser, requireAdmin, voidPurchase);

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
          sales.order_id,
          ('ORD-' || LPAD(orders.id::text, 6, '0')) AS order_number,
          sales.quantity,
          sales.sale_unit,
          sales.cards_per_unit,
          sales.unit_price::float AS unit_price,
          sales.total::float AS total,
          to_char(sales.sold_at, 'YYYY-MM-DD') AS sold_at,
          sales.voided_at,
          sales.voided_by,
          sales.created_at,
          products.name AS product_name,
          products.series AS product_series,
          products.unit AS product_unit,
          products.cards_per_unit AS product_cards_per_unit,
          orders.status AS order_status,
          orders.customer_name AS customer_name,
          users.name AS staff_name,
          users.role AS staff_role
        FROM sales
        JOIN products ON products.id = sales.product_id
        JOIN users ON users.id = sales.user_id
        LEFT JOIN orders ON orders.id = sales.order_id
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
  response.status(405).json({ message: "銷售紀錄由訂單完成自動建立，請使用訂單流程" });
});

async function voidSale(request, response, next) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const saleResult = await client.query(
      "SELECT id, product_id, user_id, quantity, sale_unit, cards_per_unit, unit_price::text, total::text, sold_at, voided_at, voided_by, created_at FROM sales WHERE id = $1 FOR UPDATE",
      [request.params.id]
    );
    const sale = saleResult.rows[0];
    if (!sale) {
      await client.query("ROLLBACK");
      return response.status(404).json({ message: "銷售紀錄不存在" });
    }
    if (sale.voided_at) {
      await client.query("ROLLBACK");
      return response.status(409).json({ message: "銷售紀錄已作廢" });
    }

    const beforeProduct = await productById(client, sale.product_id);
    await client.query("UPDATE products SET stock = stock + $1, updated_at = NOW() WHERE id = $2", [sale.quantity, sale.product_id]);
    const voidedSale = await client.query(
      `
        UPDATE sales
        SET voided_at = NOW(), voided_by = $1
        WHERE id = $2
        RETURNING id, product_id, user_id, quantity, sale_unit, cards_per_unit, unit_price::text, total::text, sold_at, voided_at, voided_by, created_at
      `,
      [request.user.id, request.params.id]
    );
    const afterProduct = await productById(client, sale.product_id);
    await writeInventoryLog(client, request, sale.product_id, "sale_void", sale.quantity, beforeProduct.stock, afterProduct.stock, "sale", sale.id, "銷售作廢補回庫存");
    await writeAuditLog(client, request, "update", "sale", { sale, product: beforeProduct }, { sale: voidedSale.rows[0], product: afterProduct });
    await client.query("COMMIT");
    response.json({ ok: true });

    void syncReportsInBackground();
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
}

app.post("/api/sales/:id/void", currentUser, requireAdmin, voidSale);
app.delete("/api/sales/:id", currentUser, requireAdmin, voidSale);

app.get("/api/orders", currentUser, async (request, response, next) => {
  const params = [];
  const filters = [];
  const search = String(request.query.search ?? "").trim();
  const status = String(request.query.status ?? "").trim();
  const from = String(request.query.from ?? "").trim();
  const to = String(request.query.to ?? "").trim();

  if (search) {
    params.push(`%${search}%`);
    filters.push(`(orders.customer_name ILIKE $${params.length} OR orders.phone ILIKE $${params.length} OR orders.line_name ILIKE $${params.length} OR ('ORD-' || LPAD(orders.id::text, 6, '0')) ILIKE $${params.length})`);
  }
  const normalizedStatus = normalizeOrderStatus(status);
  if (status && orderStatuses.has(normalizedStatus)) {
    params.push(normalizedStatus);
    filters.push(`orders.status = $${params.length}`);
  }
  if (from) {
    params.push(from);
    filters.push(`orders.created_at::date >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    filters.push(`orders.created_at::date <= $${params.length}::date`);
  }

  try {
    const { rows } = await query(
      `
        SELECT
          orders.id,
          ('ORD-' || LPAD(orders.id::text, 6, '0')) AS order_number,
          orders.customer_name,
          orders.phone,
          orders.shipping_info,
          orders.line_name,
          orders.status,
          orders.total_amount::float AS total_amount,
          orders.created_by,
          orders.created_at,
          orders.updated_at,
          users.name AS created_by_name,
          COALESCE(
            json_agg(
              json_build_object(
                'id', order_items.id,
                'productId', order_items.product_id,
                'productName', order_items.product_name,
                'productSeries', order_items.product_series,
                'quantity', order_items.quantity,
                'unitPrice', order_items.unit_price::float,
                'subtotal', order_items.subtotal::float
              )
              ORDER BY order_items.id
            ) FILTER (WHERE order_items.id IS NOT NULL),
            '[]'::json
          ) AS items
        FROM orders
        LEFT JOIN users ON users.id = orders.created_by
        LEFT JOIN order_items ON order_items.order_id = orders.id
        ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
        GROUP BY orders.id, users.name
        ORDER BY orders.created_at DESC, orders.id DESC
      `,
      params
    );
    response.json(rowsToCamel(rows));
  } catch (error) {
    next(error);
  }
});

app.post("/api/orders", currentUser, async (request, response, next) => {
  const order = orderPayload(request.body);
  if (!validateOrder(order)) {
    return response.status(400).json({ message: "訂單資料不完整或格式錯誤" });
  }

  const groupedItems = new Map();
  for (const item of order.items) {
    groupedItems.set(item.productId, (groupedItems.get(item.productId) ?? 0) + item.quantity);
  }
  const productIds = [...groupedItems.keys()];
  if (productIds.length === 0) {
    return response.status(400).json({ message: "訂單至少需要一項商品" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const productResult = await client.query(
      `
        SELECT id, name, series, product_type, grading_company, grade, cert_number, unit, cards_per_unit, package_spec, cost::text, average_cost::text, price::text, stock, deleted_at, deleted_by, created_at, updated_at
        FROM products
        WHERE id = ANY($1)
        ORDER BY id
        FOR UPDATE
      `,
      [productIds]
    );
    if (productResult.rows.length !== productIds.length) {
      await client.query("ROLLBACK");
      return response.status(404).json({ message: "商品不存在" });
    }

    const productMap = new Map(productResult.rows.map((product) => [product.id, product]));
    for (const productId of productIds) {
      const product = productMap.get(productId);
      if (!product) {
        await client.query("ROLLBACK");
        return response.status(404).json({ message: "商品不存在" });
      }
      if (product.deleted_at) {
        await client.query("ROLLBACK");
        return response.status(409).json({ message: `${product.name} 已刪除，無法建立訂單` });
      }
    }

    const totalAmount = productIds.reduce((sum, productId) => {
      const product = productMap.get(productId);
      return sum + Number(product.price) * groupedItems.get(productId);
    }, 0);

    for (const productId of productIds) {
      const product = productMap.get(productId);
      const quantity = groupedItems.get(productId);
      if (product.stock < quantity) {
        await client.query("ROLLBACK");
        return response.status(409).json({ message: `${product.name} 庫存不足，無法建立訂單` });
      }
    }

    const insertedOrder = await client.query(
      `
        INSERT INTO orders (customer_name, phone, shipping_info, line_name, status, total_amount, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, customer_name, phone, shipping_info, line_name, status, total_amount::float AS total_amount, created_by, created_at, updated_at
      `,
      [order.customerName, order.phone, order.shippingInfo, order.lineName, order.status, totalAmount, request.user.id]
    );

    const beforeProducts = productIds.map((productId) => ({ ...productMap.get(productId) }));
    const insertedItems = [];

    const afterProducts = [];
    for (const productId of productIds) {
      const product = productMap.get(productId);
      const quantity = groupedItems.get(productId);
      const unitPrice = Number(product.price);
      const subtotal = unitPrice * quantity;
      const stockBefore = product.stock;
      const stockAfter = stockBefore - quantity;
      await client.query("UPDATE products SET stock = $1, updated_at = NOW() WHERE id = $2", [stockAfter, productId]);
      const afterProduct = await productById(client, productId);
      afterProducts.push(afterProduct);
      productMap.set(productId, afterProduct);
      const item = await client.query(
        `
          INSERT INTO order_items (order_id, product_id, product_name, product_series, quantity, unit_price, subtotal)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id, order_id, product_id, product_name, product_series, quantity, unit_price::float AS unit_price, subtotal::float AS subtotal, created_at
        `,
        [insertedOrder.rows[0].id, productId, product.name, product.series, quantity, unitPrice, subtotal]
      );
      insertedItems.push(item.rows[0]);
      await writeInventoryLog(client, request, productId, "order_created", -quantity, stockBefore, stockAfter, "order", insertedOrder.rows[0].id, "建立訂單扣除庫存");
    }

    const orderRow = await orderById(client, insertedOrder.rows[0].id);
    await writeAuditLog(
      client,
      request,
      "create",
      "order",
      { products: beforeProducts },
      { order: orderRow, items: insertedItems, products: afterProducts }
    );

    await client.query("COMMIT");
    response.status(201).json({ id: insertedOrder.rows[0].id });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

async function updateOrderStatus(request, response, next) {
  const nextStatus = normalizeOrderStatus(String(request.body.status ?? "").trim());
  if (!orderStatuses.has(nextStatus)) {
    return response.status(400).json({ message: "訂單狀態不合法" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const orderResult = await client.query(
      "SELECT id, customer_name, phone, shipping_info, line_name, status, total_amount::float AS total_amount, created_by, created_at, updated_at FROM orders WHERE id = $1 FOR UPDATE",
      [request.params.id]
    );
    const beforeOrder = orderResult.rows[0];
    if (!beforeOrder) {
      await client.query("ROLLBACK");
      return response.status(404).json({ message: "訂單不存在" });
    }

    const beforeSnapshot = await orderById(client, beforeOrder.id);
    const currentStatus = normalizeOrderStatus(beforeOrder.status);
    if (currentStatus === nextStatus) {
      await client.query("ROLLBACK");
      return response.json(rowsToCamel([beforeSnapshot])[0]);
    }
    if (currentStatus !== "pending") {
      await client.query("ROLLBACK");
      return response.status(409).json({ message: "只有待處理訂單可以變更狀態" });
    }

    const items = await orderItemsByOrderId(client, beforeOrder.id);
    const sales = await salesByOrderId(client, beforeOrder.id);
    const itemMap = new Map();
    for (const item of items) {
      itemMap.set(item.product_id, (itemMap.get(item.product_id) ?? 0) + Number(item.quantity));
    }

    const beforeProducts = [];
    const afterProducts = [];
    const productIds = [...itemMap.keys()];
    const productResult = await client.query(
      `
        SELECT id, name, series, rarity, condition, product_type, grading_company, grade, cert_number, unit, cards_per_unit, package_spec, cost::text, average_cost::text, price::text, stock, low_stock_threshold, notes, deleted_at, deleted_by, created_at, updated_at
        FROM products
        WHERE id = ANY($1)
        ORDER BY id
        FOR UPDATE
      `,
      [productIds]
    );
    const productMap = new Map(productResult.rows.map((product) => [product.id, product]));
    if (productMap.size !== productIds.length) {
      await client.query("ROLLBACK");
      return response.status(404).json({ message: "商品不存在" });
    }

    for (const productId of productIds) {
      const product = productMap.get(productId);
      beforeProducts.push({ ...product });
    }

    if (nextStatus === "completed") {
      for (const productId of productIds) {
        const product = productMap.get(productId);
        const quantity = itemMap.get(productId);
        const activeSales = sales.filter((sale) => sale.product_id === productId && !sale.voided_at);
        if (activeSales.length > 0) continue;
        const item = items.find((currentItem) => currentItem.product_id === productId);
        const total = Number(item?.unit_price ?? product.price) * quantity;
        await client.query(
          `
            INSERT INTO sales (product_id, user_id, order_id, quantity, sale_unit, cards_per_unit, unit_price, total, sold_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_DATE)
            RETURNING id
          `,
          [productId, request.user.id, beforeOrder.id, quantity, product.unit, product.cards_per_unit, Number(item?.unit_price ?? product.price), total]
        );
      }
      await writeInventoryLog(client, request, null, "order_completed", 0, 0, 0, "order", beforeOrder.id, "訂單已完成");
    } else if (nextStatus === "cancelled") {
      for (const productId of productIds) {
        const product = productMap.get(productId);
        const quantity = itemMap.get(productId);
        const stockBefore = product.stock;
        const stockAfter = stockBefore + quantity;
        await client.query("UPDATE products SET stock = $1, updated_at = NOW() WHERE id = $2", [stockAfter, productId]);
        const afterProduct = await productById(client, productId);
        productMap.set(productId, afterProduct);
        afterProducts.push(afterProduct);
        await writeInventoryLog(
          client,
          request,
          productId,
          "order_cancelled",
          quantity,
          stockBefore,
          stockAfter,
          "order",
          beforeOrder.id,
          "訂單取消回補庫存"
        );
      }
    }

    await client.query("UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2", [nextStatus, beforeOrder.id]);
    const afterOrder = await orderById(client, beforeOrder.id);
    await writeAuditLog(
      client,
      request,
      "update",
      "order",
      { order: beforeSnapshot, products: beforeProducts.length ? beforeProducts : undefined },
      {
        order: afterOrder,
        statusMessage: nextStatus === "completed" ? "訂單已完成" : nextStatus === "cancelled" ? "訂單已取消" : "訂單已回到待處理",
        products: afterProducts.length ? afterProducts : undefined
      }
    );
    await client.query("COMMIT");
    response.json(rowsToCamel([afterOrder])[0]);

    if (nextStatus === "completed") {
      void syncReportsInBackground();
    }
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
}

app.get("/api/orders/:id", currentUser, async (request, response, next) => {
  try {
    const { rows } = await query(
      `
        SELECT
          orders.id,
          ('ORD-' || LPAD(orders.id::text, 6, '0')) AS order_number,
          orders.customer_name,
          orders.phone,
          orders.shipping_info,
          orders.line_name,
          orders.status,
          orders.total_amount::float AS total_amount,
          orders.created_by,
          orders.created_at,
          orders.updated_at,
          users.name AS created_by_name,
          COALESCE(
            json_agg(
              json_build_object(
                'id', order_items.id,
                'productId', order_items.product_id,
                'productName', order_items.product_name,
                'productSeries', order_items.product_series,
                'quantity', order_items.quantity,
                'unitPrice', order_items.unit_price::float,
                'subtotal', order_items.subtotal::float
              )
              ORDER BY order_items.id
            ) FILTER (WHERE order_items.id IS NOT NULL),
            '[]'::json
          ) AS items
        FROM orders
        LEFT JOIN users ON users.id = orders.created_by
        LEFT JOIN order_items ON order_items.order_id = orders.id
        WHERE orders.id = $1
        GROUP BY orders.id, users.name
      `,
      [request.params.id]
    );
    if (!rows[0]) return response.status(404).json({ message: "訂單不存在" });
    const order = rowsToCamel(rows)[0];
    response.json({
      ...order,
      status: normalizeOrderStatus(order.status)
    });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/orders/:id/status", currentUser, updateOrderStatus);
app.put("/api/orders/:id", currentUser, updateOrderStatus);

app.get("/api/audit-logs", currentUser, async (request, response, next) => {
  try {
    const params = [];
    const visibility = request.user.role === "admin" ? "" : "WHERE user_id = $1";
    if (request.user.role !== "admin") params.push(request.user.id);
    const { rows } = await query(
      `
        SELECT id, user_id, username, action_type, entity_type, before_data, after_data, undone_at, created_at
        FROM audit_logs
        ${visibility}
        ORDER BY created_at DESC, id DESC
        LIMIT 100
      `,
      params
    );
    response.json(rowsToCamel(rows));
  } catch (error) {
    next(error);
  }
});

app.get("/api/inventory-logs", currentUser, async (request, response, next) => {
  try {
    const params = [];
    const filters = [];

    if (request.query.from) {
      params.push(String(request.query.from));
      filters.push(`inventory_logs.created_at::date >= $${params.length}::date`);
    }
    if (request.query.to) {
      params.push(String(request.query.to));
      filters.push(`inventory_logs.created_at::date <= $${params.length}::date`);
    }
    if (request.query.type) {
      params.push(String(request.query.type));
      filters.push(`inventory_logs.action_type = $${params.length}`);
    }
    if (request.query.product) {
      params.push(`%${String(request.query.product).trim()}%`);
      filters.push(`products.name ILIKE $${params.length}`);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const { rows } = await query(
      `
        SELECT
          inventory_logs.id,
          inventory_logs.product_id,
          products.name AS product_name,
          inventory_logs.user_id,
          users.username,
          inventory_logs.action_type AS type,
          inventory_logs.quantity_delta AS quantity_change,
          inventory_logs.stock_before AS before_quantity,
          inventory_logs.stock_after AS after_quantity,
          inventory_logs.reference_type,
          inventory_logs.reference_id,
          inventory_logs.note,
          inventory_logs.created_at
        FROM inventory_logs
        LEFT JOIN products ON products.id = inventory_logs.product_id
        LEFT JOIN users ON users.id = inventory_logs.user_id
        ${where}
        ORDER BY inventory_logs.created_at DESC, inventory_logs.id DESC
      `,
      params
    );
    response.json(rowsToCamel(rows));
  } catch (error) {
    next(error);
  }
});

app.post("/api/undo", currentUser, async (request, response, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const params = [];
    const filters = ["undone_at IS NULL", "action_type <> 'restore'", "entity_type <> 'purchase'"];
    if (request.user.role !== "admin") {
      params.push(request.user.id);
      filters.push(`user_id = $${params.length}`);
    }
    if (request.body.auditLogId) {
      params.push(Number(request.body.auditLogId));
      filters.push(`id = $${params.length}`);
    }

    const { rows } = await client.query(
      `
        SELECT id, user_id, username, action_type, entity_type, before_data, after_data
        FROM audit_logs
        WHERE ${filters.join(" AND ")}
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        FOR UPDATE
      `,
      params
    );
    const log = rows[0];
    if (!log) {
      await client.query("ROLLBACK");
      return response.status(404).json({ message: "沒有可還原的操作" });
    }

    const before = log.before_data;
    const after = log.after_data;

    if (log.entity_type === "product" || log.entity_type === "inventory") {
      if (log.action_type === "create") {
        const beforeProduct = await productById(client, after.id);
        await client.query("UPDATE products SET deleted_at = NOW(), deleted_by = $1, updated_at = NOW() WHERE id = $2 AND deleted_at IS NULL", [request.user.id, after.id]);
        const afterProduct = await productById(client, after.id);
        if (beforeProduct && afterProduct) await writeAuditLog(client, request, "delete", "product", beforeProduct, afterProduct);
      } else if (log.action_type === "update") {
        await restoreProductSnapshot(client, before);
      } else if (log.action_type === "delete") {
        await restoreProductSnapshot(client, before);
        await syncSequence(client, "products");
      }
    } else if (log.entity_type === "sale") {
      if (log.action_type === "create") {
        await client.query("UPDATE sales SET voided_at = COALESCE(voided_at, NOW()), voided_by = COALESCE(voided_by, $1) WHERE id = $2", [request.user.id, after.sale.id]);
        if (before.product) await restoreProductSnapshot(client, before.product);
      } else if (log.action_type === "delete") {
        if (before.product) await restoreProductSnapshot(client, before.product);
        await restoreSaleSnapshot(client, before.sale);
        await syncSequence(client, "sales");
      } else if (log.action_type === "update") {
        if (before.product) await restoreProductSnapshot(client, before.product);
        await restoreSaleSnapshot(client, before.sale ?? before);
      }
    } else if (log.entity_type === "order") {
      if (log.action_type === "create") {
        const orderId = after.order?.id ?? after.id;
        if (orderId) {
          const currentOrder = await orderById(client, orderId);
          if (currentOrder) {
            const items = await orderItemsByOrderId(client, orderId);
            for (const item of items) {
              const productResult = await client.query("SELECT id, stock FROM products WHERE id = $1 FOR UPDATE", [item.product_id]);
              const product = productResult.rows[0];
              if (!product) continue;
              const stockAfter = product.stock + Number(item.quantity);
              await client.query("UPDATE products SET stock = $1, updated_at = NOW() WHERE id = $2", [stockAfter, item.product_id]);
              await writeInventoryLog(
                client,
                request,
                item.product_id,
                "cancel_sale",
                Number(item.quantity),
                product.stock,
                stockAfter,
                "order",
                orderId,
                "還原建立訂單補回庫存"
              );
            }
            await client.query("UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1", [orderId]);
          }
        }
      } else if (log.action_type === "update") {
        const orderId = after.order?.id ?? before.order?.id ?? after.id ?? before.id;
        if (orderId) {
          const currentOrder = await orderById(client, orderId);
          if (currentOrder && normalizeOrderStatus(before.order?.status) === "pending") {
            const items = await orderItemsByOrderId(client, orderId);
            if (normalizeOrderStatus(currentOrder.status) === "cancelled") {
              for (const item of items) {
                const productResult = await client.query("SELECT id, stock FROM products WHERE id = $1 FOR UPDATE", [item.product_id]);
                const product = productResult.rows[0];
                if (!product) continue;
                const stockAfter = product.stock - Number(item.quantity);
                await client.query("UPDATE products SET stock = $1, updated_at = NOW() WHERE id = $2", [stockAfter, item.product_id]);
                await writeInventoryLog(
                  client,
                  request,
                  item.product_id,
                  "sale",
                  -Number(item.quantity),
                  product.stock,
                  stockAfter,
                  "order",
                  orderId,
                  "還原訂單取消前的扣庫存"
                );
              }
            }
            await client.query("UPDATE orders SET status = 'pending', updated_at = NOW() WHERE id = $1", [orderId]);
          }
        }
      }
    } else if (log.entity_type === "user") {
      if (log.action_type === "create") {
        if (after.id === request.user.id) {
          await client.query("ROLLBACK");
          return response.status(409).json({ message: "不可還原刪除目前登入中的自己" });
        }
        await client.query("DELETE FROM users WHERE id = $1", [after.id]);
      } else if (log.action_type === "update") {
        await restoreUserSnapshot(client, before);
      } else if (log.action_type === "delete") {
        await restoreUserSnapshot(client, before);
        await syncSequence(client, "users");
      }
    }

    await client.query("UPDATE audit_logs SET undone_at = NOW() WHERE id = $1", [log.id]);
    await writeAuditLog(client, request, "restore", log.entity_type, after, before);
    await client.query("COMMIT");
    response.json({ ok: true, restoredAuditLogId: log.id });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23503") return response.status(409).json({ message: "資料已有關聯紀錄，無法自動還原" });
    next(error);
  } finally {
    client.release();
  }
});

app.get("/api/dashboard", currentUser, async (_request, response, next) => {
  try {
    const [todaySummary, monthRevenue, totalSalesQuantity, lowStockCount, totalProductCount, totalStock, hotProducts, inventoryOverview] = await Promise.all([
      query(`
        SELECT
          COALESCE(SUM(sales.total), 0)::float AS revenue,
          COALESCE(SUM(COALESCE(NULLIF(products.average_cost, 0), products.cost) * sales.quantity), 0)::float AS cost
        FROM sales
        JOIN products ON products.id = sales.product_id
        WHERE sales.sold_at = CURRENT_DATE AND sales.voided_at IS NULL
      `),
      query("SELECT COALESCE(SUM(total), 0)::float AS value FROM sales WHERE date_trunc('month', sold_at) = date_trunc('month', CURRENT_DATE) AND voided_at IS NULL"),
      query("SELECT COALESCE(SUM(quantity), 0)::int AS value FROM sales WHERE voided_at IS NULL"),
      query("SELECT COUNT(*)::int AS value FROM products WHERE deleted_at IS NULL AND stock <= low_stock_threshold"),
      query("SELECT COUNT(*)::int AS value FROM products WHERE deleted_at IS NULL"),
      query("SELECT COALESCE(SUM(stock), 0)::int AS value FROM products WHERE deleted_at IS NULL"),
      query(`
        SELECT products.id, products.name, products.series, COALESCE(SUM(sales.quantity), 0)::int AS sold_quantity, COALESCE(SUM(sales.total), 0)::float AS revenue
        FROM sales
        JOIN products ON products.id = sales.product_id
        WHERE sales.voided_at IS NULL
        GROUP BY products.id
        ORDER BY sold_quantity DESC, revenue DESC
        LIMIT 5
      `),
      query(`
        SELECT id, name, series, rarity, unit, cards_per_unit, package_spec, stock, low_stock_threshold
        FROM products
        WHERE deleted_at IS NULL AND stock <= low_stock_threshold
        ORDER BY stock ASC, name ASC
        LIMIT 8
      `)
    ]);

    response.json({
      todayRevenue: todaySummary.rows[0].revenue,
      todayCost: todaySummary.rows[0].cost,
      todayProfit: todaySummary.rows[0].revenue - todaySummary.rows[0].cost,
      todayMarginRate: grossMargin(todaySummary.rows[0].revenue, todaySummary.rows[0].cost),
      monthRevenue: monthRevenue.rows[0].value,
      totalSalesQuantity: totalSalesQuantity.rows[0].value,
      lowStockCount: lowStockCount.rows[0].value,
      totalProductCount: totalProductCount.rows[0].value,
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

app.post("/api/admin/clear-demo-data", currentUser, requireAdmin, async (_request, response, next) => {
  try {
    const result = await clearDemoData();
    response.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/backups/restore/:filename", currentUser, requireAdmin, async (request, response, next) => {
  try {
    await restoreDatabaseBackup(request.params.filename);
    response.json({ ok: true });
  } catch (error) {
    if (error.code === "ENOENT") return response.status(404).json({ message: "備份檔不存在" });
    if (error.message === "備份檔名不合法") return response.status(400).json({ message: error.message });
    next(error);
  }
});

app.delete("/api/backups/:filename", currentUser, requireAdmin, async (request, response, next) => {
  try {
    const filePath = await backupFilePath(request.params.filename);
    await fs.unlink(filePath);
    response.json({ ok: true });
  } catch (error) {
    if (error.code === "ENOENT") return response.status(404).json({ message: "備份檔不存在" });
    if (error.message === "備份檔名不合法") return response.status(400).json({ message: error.message });
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ message: "伺服器發生錯誤" });
});

initDb()
  .then(() => {
    return ensureBackupDir();
  })
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
