# Coolcard Tokyo TCG ERP

React + Tailwind 前端、Node.js + Express 後端、PostgreSQL/Neon 資料庫的 MVP。

## 功能

- 繁體中文登入頁與後台介面
- 管理員與店員兩種角色
- 商品庫存管理：名稱、系列、稀有度、卡況、成本、售價、庫存、低庫存門檻、備註
- 管理員可新增、編輯、刪除商品與刪除銷售紀錄
- 店員可查看庫存與新增銷售紀錄
- 新增銷售後自動扣除庫存
- 每日與指定日期區間銷售查詢
- Dashboard：今日營業額、本月營業額、總銷售量、低庫存商品數、熱賣排行、庫存總覽
- 響應式版面，支援桌面與手機瀏覽

## 測試帳號

| 角色 | 帳號 | 密碼 |
| --- | --- | --- |
| 管理員 | `admin` | `admin123` |
| 店員 | `clerk` | `clerk123` |

## 啟動方式

```bash
npm install --cache .npm-cache
npm run dev
```

前端：http://localhost:5173

後端：http://localhost:4000

後端會使用 `DATABASE_URL` 連線 PostgreSQL/Neon。首次啟動會自動建立 schema、執行 migration，並建立測試帳號、商品與銷售資料。

## 常用指令

```bash
npm run build
npm run server
npm run client
```

## 免費部署設定

### Render 後端

- Service type: Web Service
- Root directory: repo root
- Build command: `npm install --cache .npm-cache`
- Start command: `npm run start --workspace server`
- Environment variables:
  - `NODE_VERSION=22.16.0`
  - `CLIENT_ORIGIN=https://your-vercel-app.vercel.app`
  - `JWT_SECRET=<long random secret>`
  - `JWT_EXPIRES_IN=7d`
  - `ADMIN_PASSWORD=<initial admin password>`
  - `CLERK_PASSWORD=<initial clerk password>`
  - `DATABASE_URL=<Neon PostgreSQL connection string>`

### Vercel 前端

- Root directory: `client`
- Framework: Vite
- Build command: `npm run build`
- Output directory: `dist`
- Environment variables:
  - `VITE_API_URL=https://your-render-service.onrender.com`

Render 後端透過 `DATABASE_URL` 使用 Neon PostgreSQL，資料不再依賴 Render 暫時性檔案系統。
