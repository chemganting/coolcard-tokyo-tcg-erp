import bcrypt from "bcryptjs";
import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.warn("DATABASE_URL is not set. PostgreSQL connection will fail until it is configured.");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false }
});

export function toCamel(row) {
  if (!row) return row;
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()),
      value
    ])
  );
}

export function rowsToCamel(rows) {
  return rows.map(toCamel);
}

async function tableExists(client, tableName) {
  const { rowCount } = await client.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1",
    [tableName]
  );
  return rowCount > 0;
}

async function columnExists(client, tableName, columnName) {
  const { rowCount } = await client.query(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
    `,
    [tableName, columnName]
  );
  return rowCount > 0;
}

async function migrateLegacyPassword(client) {
  if (!(await columnExists(client, "users", "password"))) return;
  const { rows } = await client.query("SELECT id, password, password_hash FROM users");
  for (const user of rows) {
    if (!user.password_hash && user.password) {
      await client.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
        bcrypt.hashSync(user.password, 12),
        user.id
      ]);
    }
  }
}

async function migrateStoreManagerName(client) {
  const candidateTables = ["users", "staff", "staffs", "admin", "admins"];
  const candidateColumns = ["name", "displayName", "display_name", "fullName", "full_name"];

  for (const tableName of candidateTables) {
    if (!(await tableExists(client, tableName))) continue;

    for (const columnName of candidateColumns) {
      if (!(await columnExists(client, tableName, columnName))) continue;
      await client.query(
        `
          UPDATE ${quoteIdentifier(tableName)}
          SET ${quoteIdentifier(columnName)} = $1
          WHERE ${quoteIdentifier(columnName)} IN ($2, $3)
             OR ${quoteIdentifier(columnName)} LIKE $4
        `,
        ["Brian", "小智", "店長 小智", "%小智%"]
      );
    }
  }

  if ((await tableExists(client, "users")) && (await columnExists(client, "users", "username")) && (await columnExists(client, "users", "name"))) {
    await client.query("UPDATE users SET name = $1 WHERE username = $2", ["Brian", "admin"]);
  }
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll("\"", "\"\"")}"`;
}

export async function query(text, params = []) {
  const result = await pool.query(text, params);
  return result;
}

export async function initDb() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT,
        name TEXT NOT NULL,
        display_name TEXT,
        role TEXT NOT NULL CHECK (role IN ('admin', 'clerk')),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        series TEXT NOT NULL,
        rarity TEXT NOT NULL,
        condition TEXT NOT NULL,
        product_type TEXT NOT NULL DEFAULT 'normal' CHECK (product_type IN ('normal', 'graded')),
        grading_company TEXT CHECK (grading_company IS NULL OR grading_company IN ('PSA', 'BGS', 'CGC')),
        grade TEXT,
        cert_number TEXT,
        unit TEXT NOT NULL DEFAULT '單張',
        cards_per_unit INTEGER NOT NULL DEFAULT 1,
        package_spec TEXT NOT NULL DEFAULT '單張卡',
        cost NUMERIC NOT NULL,
        average_cost NUMERIC NOT NULL DEFAULT 0,
        price NUMERIC NOT NULL,
        stock INTEGER NOT NULL DEFAULT 0,
        low_stock_threshold INTEGER NOT NULL DEFAULT 3,
        notes TEXT NOT NULL DEFAULT '',
        deleted_at TIMESTAMPTZ,
        deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sales (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL REFERENCES products(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        order_id INTEGER,
        quantity INTEGER NOT NULL,
        sale_unit TEXT NOT NULL DEFAULT '單張',
        cards_per_unit INTEGER NOT NULL DEFAULT 1,
        unit_price NUMERIC NOT NULL,
        total NUMERIC NOT NULL,
        sold_at DATE NOT NULL,
        voided_at TIMESTAMPTZ,
        voided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS inventory_logs (
        id SERIAL PRIMARY KEY,
        product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action_type TEXT NOT NULL,
        quantity_delta INTEGER NOT NULL,
        stock_before INTEGER NOT NULL,
        stock_after INTEGER NOT NULL,
        reference_type TEXT,
        reference_id INTEGER,
        note TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS purchases (
        id SERIAL PRIMARY KEY,
        supplier TEXT NOT NULL,
        purchase_date DATE NOT NULL,
        product_id INTEGER NOT NULL REFERENCES products(id),
        quantity INTEGER NOT NULL,
        unit TEXT NOT NULL DEFAULT '單張',
        unit_cost NUMERIC NOT NULL,
        total_cost NUMERIC NOT NULL,
        payment_status TEXT NOT NULL CHECK (payment_status IN ('未付款', '已付款', '部分付款')),
        notes TEXT NOT NULL DEFAULT '',
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        voided_at TIMESTAMPTZ,
        voided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        void_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        customer_name TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        shipping_info TEXT NOT NULL DEFAULT '',
        line_name TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT '待處理' CHECK (status IN ('待處理', '已完成', '已取消')),
        total_amount NUMERIC NOT NULL DEFAULT 0,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
        product_name TEXT NOT NULL,
        product_series TEXT NOT NULL DEFAULT '',
        quantity INTEGER NOT NULL,
        unit_price NUMERIC NOT NULL,
        subtotal NUMERIC NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        username TEXT NOT NULL,
        action_type TEXT NOT NULL CHECK (action_type IN ('create', 'update', 'delete', 'restore')),
        entity_type TEXT NOT NULL CHECK (entity_type IN ('product', 'sale', 'user', 'inventory', 'purchase', 'order')),
        before_data JSONB,
        after_data JSONB,
        undone_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT");
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT");
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE");
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()");
    await client.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS product_type TEXT NOT NULL DEFAULT 'normal'");
    await client.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS grading_company TEXT");
    await client.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS grade TEXT");
    await client.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS cert_number TEXT");
    await client.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT '單張'");
    await client.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS cards_per_unit INTEGER NOT NULL DEFAULT 1");
    await client.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS package_spec TEXT NOT NULL DEFAULT '單張卡'");
    await client.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS average_cost NUMERIC NOT NULL DEFAULT 0");
    await client.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ");
    await client.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL");
    await client.query("ALTER TABLE products DROP CONSTRAINT IF EXISTS products_product_type_check");
    await client.query("ALTER TABLE products ADD CONSTRAINT products_product_type_check CHECK (product_type IN ('normal', 'graded'))");
    await client.query("ALTER TABLE products DROP CONSTRAINT IF EXISTS products_grading_company_check");
    await client.query("ALTER TABLE products ADD CONSTRAINT products_grading_company_check CHECK (grading_company IS NULL OR grading_company IN ('PSA', 'BGS', 'CGC'))");
    await client.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS sale_unit TEXT NOT NULL DEFAULT '單張'");
    await client.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS cards_per_unit INTEGER NOT NULL DEFAULT 1");
    await client.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS order_id INTEGER");
    await client.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ");
    await client.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS voided_by INTEGER REFERENCES users(id) ON DELETE SET NULL");
    await client.query("ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_order_id_fkey");
    await client.query("ALTER TABLE sales ADD CONSTRAINT sales_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL");
    await client.query("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS undone_at TIMESTAMPTZ");
    await client.query("ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_entity_type_check");
    await client.query("ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_entity_type_check CHECK (entity_type IN ('product', 'sale', 'user', 'inventory', 'purchase', 'order'))");
    await client.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name TEXT NOT NULL DEFAULT ''");
    await client.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT ''");
    await client.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_info TEXT NOT NULL DEFAULT ''");
    await client.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS line_name TEXT NOT NULL DEFAULT ''");
    await client.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT '待處理'");
    await client.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_amount NUMERIC NOT NULL DEFAULT 0");
    await client.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL");
    await client.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()");
    await client.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()");
    await client.query("ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check");
    await client.query("ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('待處理', '已完成', '已取消'))");
    await client.query("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE");
    await client.query("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_id INTEGER REFERENCES products(id) ON DELETE SET NULL");
    await client.query("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_name TEXT NOT NULL DEFAULT ''");
    await client.query("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_series TEXT NOT NULL DEFAULT ''");
    await client.query("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1");
    await client.query("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS unit_price NUMERIC NOT NULL DEFAULT 0");
    await client.query("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS subtotal NUMERIC NOT NULL DEFAULT 0");
    await client.query("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()");

    await client.query("UPDATE products SET unit = '單張' WHERE unit IS NULL OR unit = ''");
    await client.query("UPDATE products SET cards_per_unit = 1 WHERE cards_per_unit IS NULL OR cards_per_unit <= 0");
    await client.query("UPDATE products SET package_spec = '單張卡' WHERE package_spec IS NULL OR package_spec = ''");
    await client.query("UPDATE products SET average_cost = cost WHERE average_cost IS NULL OR average_cost = 0");
    await client.query("UPDATE products SET product_type = 'normal', grading_company = NULL, grade = NULL, cert_number = NULL WHERE product_type IS DISTINCT FROM 'normal' OR grading_company IS NOT NULL OR grade IS NOT NULL OR cert_number IS NOT NULL");
    await client.query("UPDATE sales SET sale_unit = '單張' WHERE sale_unit IS NULL OR sale_unit = ''");
    await client.query("UPDATE sales SET cards_per_unit = 1 WHERE cards_per_unit IS NULL OR cards_per_unit <= 0");
    await client.query("UPDATE users SET display_name = name WHERE display_name IS NULL OR display_name = ''");
    await client.query("UPDATE users SET is_active = TRUE WHERE is_active IS NULL");
    await client.query("UPDATE orders SET customer_name = '' WHERE customer_name IS NULL");
    await client.query("UPDATE orders SET phone = '' WHERE phone IS NULL");
    await client.query("UPDATE orders SET shipping_info = '' WHERE shipping_info IS NULL");
    await client.query("UPDATE orders SET line_name = '' WHERE line_name IS NULL");
    await client.query("UPDATE orders SET status = '待處理' WHERE status IS NULL OR status = '' OR status IN ('待付款', '已付款', '待出貨', '待處理', 'pending')");
    await client.query("UPDATE orders SET status = '已完成' WHERE status IN ('已出貨', 'completed', 'done')");
    await client.query("UPDATE orders SET status = '已取消' WHERE status IN ('cancelled', 'canceled')");
    await client.query("UPDATE sales SET order_id = NULL WHERE order_id IS NULL");

    await migrateLegacyPassword(client);

    const { rows: userCountRows } = await client.query("SELECT COUNT(*)::int AS count FROM users");
    if (userCountRows[0].count === 0) {
      await seedData(client);
    }

    await migrateStoreManagerName(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function seedData(client) {
  const adminPasswordHash = bcrypt.hashSync(process.env.ADMIN_PASSWORD ?? "admin123", 12);
  const clerkPasswordHash = bcrypt.hashSync(process.env.CLERK_PASSWORD ?? "clerk123", 12);

  const admin = await client.query(
    "INSERT INTO users (username, password_hash, name, display_name, role) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    ["admin", adminPasswordHash, "Brian", "Brian", "admin"]
  );
  const clerk = await client.query(
    "INSERT INTO users (username, password_hash, name, display_name, role) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    ["clerk", clerkPasswordHash, "店員 小霞", "店員 小霞", "clerk"]
  );

  const seedProducts = [
    ["皮卡丘 ex", "朱&紫 擴充包", "SAR", "近全新", "單張", 1, "單張卡", 1800, 2580, 4, 3, "熱門展示卡，建議放防盜櫃。"],
    ["噴火龍 VSTAR", "VSTAR Universe", "RRR", "良好", "單張", 1, "單張卡", 420, 780, 2, 3, "低庫存，需補貨。"],
    ["莉莉艾的全力", "夢幻收藏", "SR", "近全新", "單張", 1, "單張卡", 5200, 7200, 1, 2, "高單價卡，售出前需二次確認卡況。"],
    ["月亮伊布", "Eevee Heroes", "HR", "輕微白邊", "單張", 1, "單張卡", 9500, 12800, 2, 1, "收藏客詢問度高。"],
    ["超夢 V", "Pokemon GO", "RR", "近全新", "包", 5, "5 張/包", 120, 250, 18, 5, "適合新手牌組搭配銷售。"],
    ["博士的研究", "標準環境補充", "U", "全新", "盒", 30, "30 張/盒", 12, 30, 72, 20, "常用訓練家卡。"]
  ];

  const productIds = [];
  for (const product of seedProducts) {
    const { rows } = await client.query(
      `
        INSERT INTO products
          (name, series, rarity, condition, unit, cards_per_unit, package_spec, cost, price, stock, low_stock_threshold, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id, price
      `,
      product
    );
    productIds.push(rows[0]);
  }

  const seedSales = [
    [productIds[0], clerk.rows[0].id, 1, "2026-05-11"],
    [productIds[4], clerk.rows[0].id, 3, "2026-05-11"],
    [productIds[5], admin.rows[0].id, 8, "2026-05-10"],
    [productIds[1], admin.rows[0].id, 1, "2026-05-09"]
  ];

  for (const [product, userId, quantity, soldAt] of seedSales) {
    await client.query(
      `
        INSERT INTO sales (product_id, user_id, quantity, sale_unit, cards_per_unit, unit_price, total, sold_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [product.id, userId, quantity, "單張", 1, product.price, Number(product.price) * quantity, soldAt]
    );
    await client.query("UPDATE products SET stock = stock - $1 WHERE id = $2", [quantity, product.id]);
  }
}
