import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH ?? `${currentDir}/pokemon-card-erp.sqlite`;

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'clerk')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    series TEXT NOT NULL,
    rarity TEXT NOT NULL,
    condition TEXT NOT NULL,
    cost REAL NOT NULL,
    price REAL NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    low_stock_threshold INTEGER NOT NULL DEFAULT 3,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    total REAL NOT NULL,
    sold_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

const userColumns = db.prepare("PRAGMA table_info(users)").all();
const hasLegacyPassword = userColumns.some((column) => column.name === "password");
const hasPasswordHash = userColumns.some((column) => column.name === "password_hash");

if (!hasPasswordHash) {
  db.prepare("ALTER TABLE users ADD COLUMN password_hash TEXT").run();
}

if (hasLegacyPassword) {
  const legacyUsers = db.prepare("SELECT id, password, password_hash FROM users").all();
  const updatePasswordHash = db.prepare("UPDATE users SET password_hash = ? WHERE id = ?");
  legacyUsers.forEach((user) => {
    if (!user.password_hash && user.password) {
      updatePasswordHash.run(bcrypt.hashSync(user.password, 12), user.id);
    }
  });
}

const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;

if (userCount === 0) {
  const seed = db.transaction(() => {
    const insertUser = db.prepare(`
      INSERT INTO users (username, password_hash, name, role)
      VALUES (@username, @passwordHash, @name, @role)
    `);
    const insertProduct = db.prepare(`
      INSERT INTO products (name, series, rarity, condition, cost, price, stock, low_stock_threshold, notes)
      VALUES (@name, @series, @rarity, @condition, @cost, @price, @stock, @lowStockThreshold, @notes)
    `);

    [
      { username: "admin", passwordHash: bcrypt.hashSync(process.env.ADMIN_PASSWORD ?? "admin123", 12), name: "店長 小智", role: "admin" },
      { username: "clerk", passwordHash: bcrypt.hashSync(process.env.CLERK_PASSWORD ?? "clerk123", 12), name: "店員 小霞", role: "clerk" }
    ].forEach((user) => insertUser.run(user));

    [
      {
        name: "皮卡丘 ex",
        series: "朱&紫 擴充包",
        rarity: "SAR",
        condition: "近全新",
        cost: 1800,
        price: 2580,
        stock: 4,
        lowStockThreshold: 3,
        notes: "熱門展示卡，建議放防盜櫃。"
      },
      {
        name: "噴火龍 VSTAR",
        series: "VSTAR Universe",
        rarity: "RRR",
        condition: "良好",
        cost: 420,
        price: 780,
        stock: 2,
        lowStockThreshold: 3,
        notes: "低庫存，需補貨。"
      },
      {
        name: "莉莉艾的全力",
        series: "夢幻收藏",
        rarity: "SR",
        condition: "近全新",
        cost: 5200,
        price: 7200,
        stock: 1,
        lowStockThreshold: 2,
        notes: "高單價卡，售出前需二次確認卡況。"
      },
      {
        name: "月亮伊布",
        series: "Eevee Heroes",
        rarity: "HR",
        condition: "輕微白邊",
        cost: 9500,
        price: 12800,
        stock: 2,
        lowStockThreshold: 1,
        notes: "收藏客詢問度高。"
      },
      {
        name: "超夢 V",
        series: "Pokemon GO",
        rarity: "RR",
        condition: "近全新",
        cost: 120,
        price: 250,
        stock: 18,
        lowStockThreshold: 5,
        notes: "適合新手牌組搭配銷售。"
      },
      {
        name: "博士的研究",
        series: "標準環境補充",
        rarity: "U",
        condition: "全新",
        cost: 12,
        price: 30,
        stock: 72,
        lowStockThreshold: 20,
        notes: "常用訓練家卡。"
      }
    ].forEach((product) => insertProduct.run(product));

    const products = db.prepare("SELECT id, price FROM products ORDER BY id").all();
    const admin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
    const clerk = db.prepare("SELECT id FROM users WHERE username = 'clerk'").get();
    const insertSale = db.prepare(`
      INSERT INTO sales (product_id, user_id, quantity, unit_price, total, sold_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    [
      [products[0], clerk.id, 1, "2026-05-11"],
      [products[4], clerk.id, 3, "2026-05-11"],
      [products[5], admin.id, 8, "2026-05-10"],
      [products[1], admin.id, 1, "2026-05-09"]
    ].forEach(([product, userId, quantity, soldAt]) => {
      insertSale.run(product.id, userId, quantity, product.price, product.price * quantity, soldAt);
      db.prepare("UPDATE products SET stock = stock - ? WHERE id = ?").run(quantity, product.id);
    });
  });

  seed();
}

export function toCamel(row) {
  if (!row) return row;
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()),
      value
    ])
  );
}
