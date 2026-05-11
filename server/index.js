import cors from "cors";
import bcrypt from "bcryptjs";
import express from "express";
import jwt from "jsonwebtoken";
import morgan from "morgan";
import { initDb, pool, query, rowsToCamel, toCamel } from "./db.js";

const app = express();
const port = process.env.PORT ?? 4000;
const jwtSecret = process.env.JWT_SECRET ?? "local-development-secret-change-me";
const allowedUnits = new Set(["單張", "包", "盒", "箱", "組", "其他"]);

function publicUser(row) {
  const user = toCamel(row);
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    displayName: user.displayName ?? user.name,
    role: user.role
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
    const { rows } = await query("SELECT id, username, name, role FROM users WHERE id = $1", [payload.sub]);
    const row = rows[0];
    if (!row) return response.status(401).json({ message: "請先登入" });
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

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, database: "postgres" });
});

app.post("/api/login", async (request, response, next) => {
  const { username, password } = request.body;
  try {
    const { rows } = await query(
      "SELECT id, username, password_hash, name, role FROM users WHERE username = $1",
      [username]
    );
    const row = rows[0];

    if (!row || !bcrypt.compareSync(String(password ?? ""), row.password_hash ?? "")) {
      return response.status(401).json({ message: "帳號或密碼錯誤" });
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

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ message: "伺服器發生錯誤" });
});

initDb()
  .then(() => {
    app.listen(port, "0.0.0.0", () => {
      console.log(`Coolcard Tokyo TCG ERP API listening on http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize PostgreSQL database", error);
    process.exit(1);
  });
