import cors from "cors";
import bcrypt from "bcryptjs";
import express from "express";
import jwt from "jsonwebtoken";
import morgan from "morgan";
import { db, toCamel } from "./db.js";

const app = express();
const port = process.env.PORT ?? 4000;
const jwtSecret = process.env.JWT_SECRET ?? "local-development-secret-change-me";

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
app.use(express.json());
app.use(morgan("dev"));

function currentUser(request, response, next) {
  const auth = request.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  try {
    const payload = jwt.verify(token, jwtSecret);
    const row = db
      .prepare("SELECT id, username, name, role FROM users WHERE id = ?")
      .get(payload.sub);
    if (!row) return response.status(401).json({ message: "請先登入" });
    request.user = publicUser(row);
    next();
  } catch {
    return response.status(401).json({ message: "請先登入" });
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
    cost: Number(body.cost),
    price: Number(body.price),
    stock: Number(body.stock),
    lowStockThreshold: Number(body.lowStockThreshold),
    notes: String(body.notes ?? "").trim()
  };
}

function validateProduct(product) {
  if (!product.name || !product.series || !product.rarity || !product.condition) return false;
  return [product.cost, product.price, product.stock, product.lowStockThreshold].every(Number.isFinite) &&
    product.cost >= 0 &&
    product.price >= 0 &&
    product.stock >= 0 &&
    product.lowStockThreshold >= 0;
}

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.post("/api/login", (request, response) => {
  const { username, password } = request.body;
  const row = db
    .prepare("SELECT id, username, password_hash, name, role FROM users WHERE username = ?")
    .get(username);

  if (!row || !bcrypt.compareSync(String(password ?? ""), row.password_hash ?? "")) {
    return response.status(401).json({ message: "帳號或密碼錯誤" });
  }

  const user = publicUser({
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role
  });
  const token = jwt.sign(
    { sub: String(user.id), username: user.username, role: user.role },
    jwtSecret,
    { expiresIn: process.env.JWT_EXPIRES_IN ?? "7d" }
  );
  response.json({ token, user });
});

app.get("/api/me", currentUser, (request, response) => {
  response.json(request.user);
});

app.get("/api/products", currentUser, (request, response) => {
  const keyword = `%${String(request.query.q ?? "").trim()}%`;
  const rows = db
    .prepare(`
      SELECT id, name, series, rarity, condition, cost, price, stock, low_stock_threshold, notes, created_at, updated_at
      FROM products
      WHERE name LIKE ? OR series LIKE ? OR rarity LIKE ? OR condition LIKE ? OR notes LIKE ?
      ORDER BY updated_at DESC, id DESC
    `)
    .all(keyword, keyword, keyword, keyword, keyword)
    .map(toCamel);
  response.json(rows);
});

app.post("/api/products", currentUser, requireAdmin, (request, response) => {
  const product = productPayload(request.body);
  if (!validateProduct(product)) return response.status(400).json({ message: "商品資料不完整或格式錯誤" });

  const result = db
    .prepare(`
      INSERT INTO products (name, series, rarity, condition, cost, price, stock, low_stock_threshold, notes)
      VALUES (@name, @series, @rarity, @condition, @cost, @price, @stock, @lowStockThreshold, @notes)
    `)
    .run(product);
  response.status(201).json({ id: result.lastInsertRowid });
});

app.put("/api/products/:id", currentUser, requireAdmin, (request, response) => {
  const product = productPayload(request.body);
  if (!validateProduct(product)) return response.status(400).json({ message: "商品資料不完整或格式錯誤" });

  const result = db
    .prepare(`
      UPDATE products
      SET name = @name,
          series = @series,
          rarity = @rarity,
          condition = @condition,
          cost = @cost,
          price = @price,
          stock = @stock,
          low_stock_threshold = @lowStockThreshold,
          notes = @notes,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `)
    .run({ ...product, id: Number(request.params.id) });

  if (result.changes === 0) return response.status(404).json({ message: "商品不存在" });
  response.json({ ok: true });
});

app.delete("/api/products/:id", currentUser, requireAdmin, (request, response) => {
  const saleCount = db.prepare("SELECT COUNT(*) AS count FROM sales WHERE product_id = ?").get(request.params.id).count;
  if (saleCount > 0) return response.status(409).json({ message: "已有銷售紀錄的商品不可刪除" });

  const result = db.prepare("DELETE FROM products WHERE id = ?").run(request.params.id);
  if (result.changes === 0) return response.status(404).json({ message: "商品不存在" });
  response.json({ ok: true });
});

app.get("/api/sales", currentUser, (request, response) => {
  const { from, to } = request.query;
  const params = [];
  const filters = [];
  if (from) {
    filters.push("date(sales.sold_at) >= date(?)");
    params.push(from);
  }
  if (to) {
    filters.push("date(sales.sold_at) <= date(?)");
    params.push(to);
  }

  const rows = db
    .prepare(`
      SELECT
        sales.id,
        sales.quantity,
        sales.unit_price,
        sales.total,
        sales.sold_at,
        sales.created_at,
        products.name AS product_name,
        products.series AS product_series,
        users.name AS staff_name,
        users.role AS staff_role
      FROM sales
      JOIN products ON products.id = sales.product_id
      JOIN users ON users.id = sales.user_id
      ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
      ORDER BY date(sales.sold_at) DESC, sales.id DESC
    `)
    .all(...params)
    .map(toCamel);
  response.json(rows);
});

app.post("/api/sales", currentUser, (request, response) => {
  const productId = Number(request.body.productId);
  const quantity = Number(request.body.quantity);
  const unitPrice = Number(request.body.unitPrice);
  const soldAt = String(request.body.soldAt ?? "").trim() || new Date().toISOString().slice(0, 10);

  if (!productId || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
    return response.status(400).json({ message: "銷售資料不完整或格式錯誤" });
  }

  const product = db.prepare("SELECT id, name, stock FROM products WHERE id = ?").get(productId);
  if (!product) return response.status(404).json({ message: "商品不存在" });
  if (product.stock < quantity) {
    return response.status(409).json({ message: `${product.name} 庫存不足，目前剩餘 ${product.stock}` });
  }

  const transaction = db.transaction(() => {
    const total = unitPrice * quantity;
    const sale = db
      .prepare(`
        INSERT INTO sales (product_id, user_id, quantity, unit_price, total, sold_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(productId, request.user.id, quantity, unitPrice, total, soldAt);

    db.prepare("UPDATE products SET stock = stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(quantity, productId);
    return sale.lastInsertRowid;
  });

  response.status(201).json({ id: transaction() });
});

app.delete("/api/sales/:id", currentUser, requireAdmin, (request, response) => {
  const sale = db.prepare("SELECT product_id, quantity FROM sales WHERE id = ?").get(request.params.id);
  if (!sale) return response.status(404).json({ message: "銷售紀錄不存在" });

  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM sales WHERE id = ?").run(request.params.id);
    db.prepare("UPDATE products SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(sale.quantity, sale.product_id);
  });
  transaction();
  response.json({ ok: true });
});

app.get("/api/dashboard", currentUser, (_request, response) => {
  const todayRevenue = db
    .prepare("SELECT COALESCE(SUM(total), 0) AS value FROM sales WHERE date(sold_at) = date('now', 'localtime')")
    .get().value;
  const monthRevenue = db
    .prepare("SELECT COALESCE(SUM(total), 0) AS value FROM sales WHERE strftime('%Y-%m', sold_at) = strftime('%Y-%m', 'now', 'localtime')")
    .get().value;
  const totalSalesQuantity = db.prepare("SELECT COALESCE(SUM(quantity), 0) AS value FROM sales").get().value;
  const lowStockCount = db.prepare("SELECT COUNT(*) AS value FROM products WHERE stock <= low_stock_threshold").get().value;
  const totalStock = db.prepare("SELECT COALESCE(SUM(stock), 0) AS value FROM products").get().value;

  const hotProducts = db
    .prepare(`
      SELECT products.id, products.name, products.series, COALESCE(SUM(sales.quantity), 0) AS sold_quantity, COALESCE(SUM(sales.total), 0) AS revenue
      FROM sales
      JOIN products ON products.id = sales.product_id
      GROUP BY products.id
      ORDER BY sold_quantity DESC, revenue DESC
      LIMIT 5
    `)
    .all()
    .map(toCamel);

  const inventoryOverview = db
    .prepare(`
      SELECT id, name, series, rarity, stock, low_stock_threshold
      FROM products
      ORDER BY stock ASC, name ASC
      LIMIT 8
    `)
    .all()
    .map(toCamel);

  response.json({ todayRevenue, monthRevenue, totalSalesQuantity, lowStockCount, totalStock, hotProducts, inventoryOverview });
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ message: "伺服器發生錯誤" });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Coolcard Tokyo TCG ERP API listening on http://localhost:${port}`);
});
