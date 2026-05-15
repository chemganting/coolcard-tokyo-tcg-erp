import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  CalendarDays,
  Database,
  Edit3,
  ChevronDown,
  LogOut,
  ExternalLink,
  History,
  Menu,
  Minus,
  PackagePlus,
  Plus,
  Search,
  Copy,
  ShieldCheck,
  ShoppingCart,
  Trash2,
  TrendingUp,
  RotateCcw,
  Undo2,
  UserRound,
  Warehouse,
  X
} from "lucide-react";
import "./index.css";

const currency = new Intl.NumberFormat("zh-TW", {
  style: "currency",
  currency: "TWD",
  maximumFractionDigits: 0
});
const number = new Intl.NumberFormat("zh-TW");
const oneDecimal = new Intl.NumberFormat("zh-TW", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
});

function authFromStorage() {
  try {
    return JSON.parse(localStorage.getItem("pokemon-erp-auth") ?? "null");
  } catch {
    return null;
  }
}

const API_BASE_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
const APP_NAME = "Coolcard Tokyo TCG ERP";
const UNIT_OPTIONS = ["單張", "包", "盒", "箱", "組", "其他"];
const PRODUCT_TYPE_OPTIONS = [
  { value: "normal", label: "一般商品" },
  { value: "graded", label: "PSA商品" }
];
const GRADING_COMPANIES = ["PSA", "BGS", "CGC"];
const ORDER_STATUS_OPTIONS = [
  { value: "pending", label: "待處理" },
  { value: "completed", label: "已完成" },
  { value: "cancelled", label: "已取消" }
];
const LIST_PAGE_SIZE = 10;
const INVENTORY_LOG_TYPE_OPTIONS = [
  { value: "全部", label: "全部異動類型" },
  { value: "purchase", label: "進貨" },
  { value: "sale_created", label: "成交建立" },
  { value: "order_created", label: "建立訂單" },
  { value: "order_completed", label: "完成訂單" },
  { value: "order_cancelled", label: "取消訂單" },
  { value: "import", label: "匯入" },
  { value: "restore", label: "還原" },
  { value: "manual_adjustment", label: "手動調整" },
  { value: "void_sale", label: "作廢銷售" },
  { value: "void_purchase", label: "作廢進貨" }
];
const WAKE_MESSAGE = "伺服器喚醒中，首次開啟約需 30–60 秒，請稍候";
const WAKE_NOTICE_DELAY = 5000;
const HEALTH_RETRY_DELAY = 2500;
const wakeListeners = new Set();

function notifyWakeListeners(isWaking) {
  for (const listener of wakeListeners) listener(isWaking);
}

function subscribeWakeListener(listener) {
  wakeListeners.add(listener);
  return () => wakeListeners.delete(listener);
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForBackendHealth() {
  while (true) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/health`, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // Keep retrying while the backend is waking.
    }
    await sleep(HEALTH_RETRY_DELAY);
  }
}

async function fetchWithWake(path, options = {}) {
  const target = `${API_BASE_URL}/api${path}`;
  let wakeStarted = false;
  const shouldRetryAfterWake = (response) => [502, 503, 504, 521, 522, 523, 524].includes(response.status);
  let wakeResolved;
  const wakeSignal = new Promise((resolve) => {
    wakeResolved = resolve;
  });
  const wakeTimer = window.setTimeout(() => {
    wakeStarted = true;
    notifyWakeListeners(true);
    waitForBackendHealth()
      .then(() => {
        notifyWakeListeners(false);
        wakeResolved();
      });
  }, WAKE_NOTICE_DELAY);

  try {
    const request = fetch(target, options)
      .then((response) => ({ type: "response", response }))
      .catch((error) => ({ type: "error", error }));
    const result = await Promise.race([
      request,
      wakeSignal.then(() => ({ type: "healthy" }))
    ]);

    if (result.type === "healthy") {
      window.clearTimeout(wakeTimer);
      return fetch(target, options);
    }

    window.clearTimeout(wakeTimer);
    if (result.type === "error") throw result.error;

    const { response } = result;
    if (shouldRetryAfterWake(response)) {
      wakeStarted = true;
      notifyWakeListeners(true);
      await waitForBackendHealth();
      notifyWakeListeners(false);
      return fetch(target, options);
    }
    if (wakeStarted) {
      await waitForBackendHealth();
      notifyWakeListeners(false);
    }
    return response;
  } catch (error) {
    window.clearTimeout(wakeTimer);
    wakeStarted = true;
    notifyWakeListeners(true);
    await waitForBackendHealth();
    notifyWakeListeners(false);
    return fetch(target, options);
  }
}

function formatStock(product) {
  return `${number.format(product.stock ?? 0)} ${product.unit ?? "單張"}`;
}

function formatRate(value) {
  return `${oneDecimal.format(Number(value ?? 0))}%`;
}

function orderStatusKey(status) {
  if (["pending", "待處理", "待出貨"].includes(status)) return "pending";
  if (["completed", "已完成", "已出貨", "done"].includes(status)) return "completed";
  if (["cancelled", "canceled", "已取消"].includes(status)) return "cancelled";
  return "pending";
}

function productTypeLabel(productType) {
  return PRODUCT_TYPE_OPTIONS.find((option) => option.value === productType)?.label ?? "一般商品";
}

function productTypeTone(productType) {
  return productType === "graded" ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-700";
}

function productBadgeLabel(product) {
  return product.productType === "graded" ? (product.grade ?? "-") : "-";
}

function orderStatusLabel(status) {
  const normalized = orderStatusKey(status);
  if (normalized === "completed") return "已完成";
  if (normalized === "cancelled") return "已取消";
  return "待處理";
}

function orderStatusTone(status) {
  const normalized = orderStatusKey(status);
  if (normalized === "cancelled") return "bg-slate-100 text-slate-700";
  if (normalized === "completed") return "bg-emerald-50 text-emerald-700";
  if (normalized === "pending") return "bg-amber-50 text-amber-700";
  return "bg-rose-50 text-rose-700";
}

function orderSummaryText(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  if (items.length === 0) return "無商品";
  return items
    .slice(0, 2)
    .map((item) => `${item.productName} x${item.quantity}`)
    .join("、") + (items.length > 2 ? ` 等 ${number.format(items.length)} 項商品` : "");
}

function orderShippingSummary(order) {
  const data = parseShippingAssistantData(order);
  return [
    data.storeName ? `7-11 ${data.storeName}` : "",
    data.storeNumber ? `店號 ${data.storeNumber}` : "",
    data.note ? `備註 ${data.note}` : ""
  ].filter(Boolean).join(" · ") || "尚無寄件資料";
}

function parseShippingAssistantData(order) {
  const shippingInfo = String(order?.shippingInfo ?? "").trim();
  const lines = shippingInfo
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const stripLabel = (line, labels) => {
    const found = labels.find((label) => line.includes(label));
    if (!found) return line.trim();
    return line
      .replace(found, "")
      .replace(/^[：:\s-]+/, "")
      .trim();
  };

  const storeNameLine = lines.find((line) => /(門市|店名)/.test(line) && !/(店號|代碼|號碼|編號)/.test(line))
    || lines.find((line) => line && !/(店號|代碼|號碼|編號)/.test(line))
    || "";
  const storeNumberLine = lines.find((line) => /(店號|代碼|號碼|編號)/.test(line))
    || lines.find((line) => /\d{3,6}/.test(line))
    || "";

  const storeName = storeNameLine
    ? stripLabel(storeNameLine, ["門市名稱", "門市", "店名", "超商門市", "門市代號"])
    : "";
  const storeNumber = storeNumberLine
    ? stripLabel(storeNumberLine, ["店號", "門市代碼", "代碼", "號碼", "編號"])
    : "";

  const noteLines = lines.filter((line) => line !== storeNameLine && line !== storeNumberLine);
  const note = noteLines.join("\n").trim() || shippingInfo;

  return {
    recipient: String(order?.customerName ?? "").trim(),
    phone: String(order?.phone ?? "").trim(),
    storeName,
    storeNumber,
    note
  };
}

function buildShippingAssistantText(order) {
  const data = parseShippingAssistantData(order);
  return [
    `收件人：${data.recipient || "-"}`,
    `電話：${data.phone || "-"}`,
    `7-11門市：${data.storeName || "-"}`,
    `7-11店號：${data.storeNumber || "-"}`,
    `備註：${data.note || "-"}`
  ].join("\n");
}

async function copyTextToClipboard(text) {
  const content = String(text ?? "");
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(content);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = content;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function buildPageNumbers(currentPage, pageCount) {
  const pages = [];
  if (pageCount <= 7) {
    for (let page = 1; page <= pageCount; page += 1) pages.push(page);
    return pages;
  }

  pages.push(1);
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(pageCount - 1, currentPage + 1);
  if (start > 2) pages.push("...");
  for (let page = start; page <= end; page += 1) pages.push(page);
  if (end < pageCount - 1) pages.push("...");
  pages.push(pageCount);
  return pages;
}

function PaginationFooter({ page, pageCount, onPageChange, summary }) {
  if (pageCount <= 1) return null;
  const pages = buildPageNumbers(page, pageCount);
  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-slate-500">{summary}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" disabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))}>
          上一頁
        </Button>
        {pages.map((item, index) =>
          item === "..." ? (
            <span key={`ellipsis-${index}`} className="px-2 text-sm text-slate-400">...</span>
          ) : (
            <Button
              key={item}
              type="button"
              variant={item === page ? "primary" : "secondary"}
              aria-current={item === page ? "page" : undefined}
              onClick={() => onPageChange(item)}
            >
              {item}
            </Button>
          )
        )}
        <Button type="button" variant="secondary" disabled={page >= pageCount} onClick={() => onPageChange(Math.min(pageCount, page + 1))}>
          下一頁
        </Button>
      </div>
    </div>
  );
}

function normalizeInventoryLogType(type) {
  if (type === "purchase_update") return "manual_adjustment";
  if (type === "sale_void") return "void_sale";
  if (type === "purchase_void") return "void_purchase";
  if (type === "sale") return "sale_created";
  if (type === "cancel_sale") return "order_cancelled";
  if (type === "completed_order") return "order_completed";
  return type ?? "";
}

function inventoryLogTypeLabel(type) {
  const normalizedType = normalizeInventoryLogType(type);
  return INVENTORY_LOG_TYPE_OPTIONS.find((option) => option.value === normalizedType)?.label ?? normalizedType;
}

function inventoryLogTypeTone(type) {
  const normalizedType = normalizeInventoryLogType(type);
  if (normalizedType === "void_sale" || normalizedType === "void_purchase" || normalizedType === "order_cancelled") return "bg-slate-100 text-slate-700";
  if (normalizedType === "sale_created") return "bg-rose-50 text-rose-700";
  if (normalizedType === "order_completed") return "bg-emerald-50 text-emerald-700";
  if (normalizedType === "order_created") return "bg-amber-50 text-amber-700";
  if (normalizedType === "manual_adjustment") return "bg-amber-50 text-amber-700";
  return "bg-emerald-50 text-emerald-700";
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

const actionLabels = {
  create: "新增",
  update: "更新",
  delete: "刪除",
  restore: "還原"
};

const entityLabels = {
  product: "商品",
  sale: "銷售紀錄",
  order: "訂單",
  user: "員工",
  inventory: "庫存",
  purchase: "進貨單"
};

async function api(path, options = {}) {
  const auth = authFromStorage();
  const response = await fetchWithWake(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(auth?.token ? { Authorization: `Bearer ${auth.token}` } : {}),
      ...(options.headers ?? {})
    }
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message ?? "請求失敗");
  }
  return response.json();
}

function TextInput(props) {
  return (
    <input
      {...props}
      className="h-12 rounded-md border border-slate-300 bg-white px-3 text-base outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100 sm:h-10 sm:text-sm"
    />
  );
}

function SelectInput(props) {
  return (
    <select
      {...props}
      className="h-12 rounded-md border border-slate-300 bg-white px-3 text-base outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100 sm:h-10 sm:text-sm"
    />
  );
}

function TextArea(props) {
  return (
    <textarea
      {...props}
      className="min-h-24 rounded-md border border-slate-300 bg-white px-3 py-2 text-base outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100 sm:min-h-20 sm:text-sm"
    />
  );
}

function Button({ variant = "primary", children, className = "", ...props }) {
  const variants = {
    primary: "bg-teal-700 text-white hover:bg-teal-800",
    secondary: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
    danger: "bg-rose-600 text-white hover:bg-rose-700",
    ghost: "text-slate-600 hover:bg-slate-100"
  };
  return (
    <button
      {...props}
      className={`inline-flex h-12 items-center justify-center gap-2 rounded-md px-4 text-base font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 sm:h-10 sm:px-3 sm:text-sm ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

function BottomDrawer({ open, title, onClose, children, footer }) {
  const dragStartRef = useRef(null);
  const [dragOffset, setDragOffset] = useState(0);

  useEffect(() => {
    if (!open) {
      setDragOffset(0);
      dragStartRef.current = null;
    }
  }, [open]);

  if (!open) return null;

  const handleTouchStart = (event) => {
    dragStartRef.current = event.touches[0].clientY;
  };

  const handleTouchMove = (event) => {
    if (dragStartRef.current == null) return;
    const delta = Math.max(0, event.touches[0].clientY - dragStartRef.current);
    setDragOffset(Math.min(delta, 180));
  };

  const handleTouchEnd = () => {
    if (dragOffset > 80) {
      onClose();
    } else {
      setDragOffset(0);
    }
    dragStartRef.current = null;
  };

  return (
    <div className="fixed inset-0 z-[75] lg:hidden">
      <button type="button" className="absolute inset-0 bg-slate-950/40" aria-label="關閉抽屜" onClick={onClose} />
      <div
        className="absolute inset-x-0 bottom-0 max-h-[88vh] rounded-t-2xl border-t border-slate-200 bg-white shadow-2xl"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)",
          transform: `translateY(${dragOffset}px)`,
          transition: dragOffset > 0 ? "none" : "transform 220ms ease"
        }}
      >
        <div
          className="flex items-center justify-center pt-3"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="h-1.5 w-12 rounded-full bg-slate-300" />
        </div>
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 pb-4 pt-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Mobile Drawer</p>
            <h3 className="truncate text-lg font-semibold text-slate-950">{title}</h3>
          </div>
          <Button type="button" variant="secondary" className="h-12 w-12 shrink-0 px-0" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>
        <div className="max-h-[calc(88vh-8rem)] overflow-y-auto px-4 py-4">
          {children}
        </div>
        {footer && <div className="border-t border-slate-200 px-4 pt-4">{footer}</div>}
      </div>
    </div>
  );
}

function ShippingAssistantPanel({ order, onCopyText, onOpen711 }) {
  const data = parseShippingAssistantData(order);
  const rows = [
    { label: "收件人", value: data.recipient },
    { label: "電話", value: data.phone },
    { label: "7-11 門市名稱", value: data.storeName },
    { label: "7-11 店號", value: data.storeNumber },
    { label: "備註", value: data.note }
  ];

  return (
    <div className="mt-3 rounded-xl border border-teal-200 bg-teal-50/40 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="text-sm font-semibold text-slate-950">寄件助手</h4>
          <p className="mt-1 text-xs text-slate-500">快速複製寄件資訊，貼到 7-11 交貨便。</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={onOpen711}>
            <ExternalLink className="h-4 w-4" />
            開啟 7-11 交貨便
          </Button>
          <Button type="button" className="w-full sm:w-auto" onClick={() => onCopyText(buildShippingAssistantText(order))}>
            <Copy className="h-4 w-4" />
            一鍵複製全部寄件資訊
          </Button>
        </div>
      </div>
      <div className="mt-3 grid gap-2">
        {rows.map((row) => (
          <div key={row.label} className="rounded-lg border border-teal-100 bg-white p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500">{row.label}</p>
                <p className="mt-1 break-words text-sm font-medium text-slate-950">{row.value || "-"}</p>
              </div>
              <Button type="button" variant="secondary" className="shrink-0" onClick={() => onCopyText(row.value || "")}>
                <Copy className="h-4 w-4" />
                複製
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, detail, tone }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
        </div>
        <div className={`rounded-md p-2 ${tone}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="mt-3 text-sm text-slate-500">{detail}</p>
    </section>
  );
}

function SkeletonCard() {
  return (
    <section className="animate-pulse rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="h-4 w-24 rounded bg-slate-200" />
      <div className="mt-4 h-8 w-32 rounded bg-slate-200" />
      <div className="mt-4 h-4 w-40 rounded bg-slate-100" />
    </section>
  );
}

function WakeNotice() {
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-100/90 px-4 backdrop-blur-sm">
      <section className="w-full max-w-md rounded-lg border border-amber-200 bg-white p-5 text-center shadow-lg">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-lg bg-amber-50 text-amber-700">
          <Database className="h-6 w-6" />
        </div>
        <p className="text-base font-semibold text-slate-950">{WAKE_MESSAGE}</p>
        <p className="mt-2 text-sm text-slate-500">系統會自動重新連線，不需要重新整理頁面。</p>
      </section>
    </div>
  );
}

const emptyProduct = {
  name: "",
  series: "",
  rarity: "RR",
  condition: "近全新",
  productType: "normal",
  gradingCompany: "PSA",
  grade: "",
  certNumber: "",
  unit: "單張",
  cardsPerUnit: "1",
  packageSpec: "單張卡",
  cost: "",
  price: "",
  stock: "",
  lowStockThreshold: "3",
  notes: ""
};

const emptyEmployee = {
  username: "",
  name: "",
  displayName: "",
  role: "clerk",
  password: "",
  isActive: true
};

const emptyPurchase = {
  supplier: "",
  purchaseDate: new Date().toISOString().slice(0, 10),
  productId: "",
  quantity: "1",
  unit: "單張",
  unitCost: "",
  paymentStatus: "未付款",
  notes: ""
};

function Login({ onLogin }) {
  const [form, setForm] = useState({ username: "admin", password: "admin123" });
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    try {
      const result = await api("/login", {
        method: "POST",
        body: JSON.stringify(form)
      });
      localStorage.setItem("pokemon-erp-auth", JSON.stringify(result));
      onLogin(result);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 px-4">
      <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-lg bg-teal-700 text-white">
            <Warehouse className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-950">{APP_NAME}</h1>
            <p className="text-sm text-slate-500">庫存與銷售管理後台</p>
          </div>
        </div>
        <form onSubmit={submit} className="grid gap-3">
          <TextInput required placeholder="帳號" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <TextInput required type="password" placeholder="密碼" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          <Button type="submit" className="w-full">
            <ShieldCheck className="h-4 w-4" />
            登入系統
          </Button>
        </form>
        <div className="mt-5 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
          <p className="font-medium text-slate-800">測試帳號</p>
          <p>管理員：admin / admin123</p>
          <p>店員：clerk / clerk123</p>
        </div>
      </section>
    </main>
  );
}

function App() {
  const [auth, setAuth] = useState(authFromStorage());
  const [backendReady, setBackendReady] = useState(false);
  const [wakingBackend, setWakingBackend] = useState(false);
  const [products, setProducts] = useState([]);
  const [deletedProducts, setDeletedProducts] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [sales, setSales] = useState([]);
  const [orders, setOrders] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [backups, setBackups] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [inventoryLogs, setInventoryLogs] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [profitReport, setProfitReport] = useState(null);
  const [syncingSheet, setSyncingSheet] = useState(false);
  const [clearingDemoData, setClearingDemoData] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [deletedProductsOpen, setDeletedProductsOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [productCreateTab, setProductCreateTab] = useState("manual");
  const [auditLoaded, setAuditLoaded] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [inventoryFilters, setInventoryFilters] = useState({
    product: "",
    from: "",
    to: "",
    type: "全部"
  });
  const [expandedInventoryLogId, setExpandedInventoryLogId] = useState(null);
  const [employeeOpen, setEmployeeOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState("");
  const [undoing, setUndoing] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [productTypeFilter, setProductTypeFilter] = useState("全部");
  const [gradeSearch, setGradeSearch] = useState("");
  const [certSearch, setCertSearch] = useState("");
  const [deletedProductSearch, setDeletedProductSearch] = useState("");
  const [unitFilter, setUnitFilter] = useState("全部");
  const [stockSort, setStockSort] = useState("asc");
  const [productPage, setProductPage] = useState(1);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [orderProductSearch, setOrderProductSearch] = useState("");
  const [selectedOrderProductId, setSelectedOrderProductId] = useState(null);
  const [selectedOrderQuantity, setSelectedOrderQuantity] = useState(1);
  const [orderItems, setOrderItems] = useState([]);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [orderForm, setOrderForm] = useState({
    customerName: "",
    phone: "",
    shippingInfo: "",
    lineName: ""
  });
  const [orderCustomerSearch, setOrderCustomerSearch] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState("全部");
  const [mobileOrderTab, setMobileOrderTab] = useState("待處理");
  const [mobileDrawer, setMobileDrawer] = useState(null);
  const [shippingAssistantOrderId, setShippingAssistantOrderId] = useState(null);
  const [orderStatusDrafts, setOrderStatusDrafts] = useState({});
  const [pendingOrderPage, setPendingOrderPage] = useState(1);
  const [completedOrderPage, setCompletedOrderPage] = useState(1);
  const [cancelledOrderPage, setCancelledOrderPage] = useState(1);
  const productFormRef = useRef(null);
  const purchaseFormRef = useRef(null);
  const [error, setError] = useState("");
  const [productForm, setProductForm] = useState(emptyProduct);
  const [purchaseForm, setPurchaseForm] = useState(emptyPurchase);
  const [editingPurchaseId, setEditingPurchaseId] = useState(null);
  const [purchasePage, setPurchasePage] = useState(1);
  const [purchaseFilters, setPurchaseFilters] = useState({
    from: new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
    supplier: "",
    product: "",
    paymentStatus: ""
  });
  const [employeeForm, setEmployeeForm] = useState(emptyEmployee);
  const [editingEmployeeId, setEditingEmployeeId] = useState(null);
  const [employeeDraft, setEmployeeDraft] = useState(null);
  const [passwordByUser, setPasswordByUser] = useState({});
  const [importCsv, setImportCsv] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [saleForm, setSaleForm] = useState({ productId: "", quantity: 1, saleUnit: "單張", cardsPerUnit: "1", unitPrice: "", soldAt: new Date().toISOString().slice(0, 10) });
  const [dateRange, setDateRange] = useState({ from: new Date().toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) });
  const productAutosaveReady = useRef(false);
  const employeeAutosaveReady = useRef(false);

  const isAdmin = auth?.user?.role === "admin";
  const navigationItems = useMemo(() => ([
    [BarChart3, "營業額儀表板"],
    [TrendingUp, "利潤分析"],
    [Boxes, "商品庫存"],
    [PackagePlus, "進貨管理"],
    [ShoppingCart, "快速下單"],
    [ShoppingCart, "訂單管理"],
    [History, "操作紀錄"],
    ...(isAdmin ? [[UserRound, "員工管理"], [Database, "系統備份"]] : [])
  ]), [isAdmin]);

  useEffect(() => subscribeWakeListener(setWakingBackend), []);

  useEffect(() => {
    let cancelled = false;
    api("/health")
      .then(() => {
        if (!cancelled) setBackendReady(true);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!auth?.token) return;
    api("/me")
      .then((user) => {
        const nextAuth = { ...auth, user };
        localStorage.setItem("pokemon-erp-auth", JSON.stringify(nextAuth));
        setAuth(nextAuth);
      })
      .catch(() => {
        localStorage.removeItem("pokemon-erp-auth");
        sessionStorage.removeItem("pokemon-erp-auth");
        setAuth(null);
      });
  }, [auth?.token]);

  const normalizeOrderRows = (rows) => rows.map((order) => ({
    ...order,
    status: orderStatusKey(order.status)
  }));

  const load = async (options = {}) => {
    if (!auth?.token) return;
    const scope = {
      products: true,
      deletedProducts: true,
      purchases: true,
      sales: true,
      orders: true,
      dashboard: true,
      profitReport: true,
      employees: true,
      backups: true,
      inventoryLogs: true,
      blocking: true,
      ...options
    };
    if (scope.blocking) setLoading(true);
    const saleQuery = `?from=${dateRange.from}&to=${dateRange.to}`;
    const purchaseQuery = new URLSearchParams(
      Object.fromEntries(Object.entries(purchaseFilters).filter(([, value]) => value))
    ).toString();
    try {
      const requests = [];
      if (scope.products) requests.push(["products", api("/products")]);
      if (scope.deletedProducts) requests.push(["deletedProducts", isAdmin ? api("/products/deleted").catch(() => []) : Promise.resolve([])]);
      if (scope.purchases) requests.push(["purchases", api(`/purchases${purchaseQuery ? `?${purchaseQuery}` : ""}`).catch(() => [])]);
      if (scope.sales) requests.push(["sales", api(`/sales${saleQuery}`)]);
      if (scope.orders) requests.push(["orders", api("/orders").catch(() => [])]);
      if (scope.dashboard) requests.push(["dashboard", api("/dashboard")]);
      if (scope.profitReport) requests.push(["profitReport", api("/profit-report")]);
      if (scope.employees) requests.push(["employees", isAdmin ? api("/users") : Promise.resolve([])]);
      if (scope.backups) requests.push(["backups", isAdmin ? api("/backups").catch(() => []) : Promise.resolve([])]);
      if (scope.inventoryLogs) requests.push(["inventoryLogs", api("/inventory-logs").catch(() => [])]);

      const resultRows = await Promise.all(requests.map(([, promise]) => promise));
      const data = Object.fromEntries(requests.map(([key], index) => [key, resultRows[index]]));

      if (scope.products) setProducts(data.products ?? []);
      if (scope.deletedProducts) setDeletedProducts(data.deletedProducts ?? []);
      if (scope.purchases) setPurchases(data.purchases ?? []);
      if (scope.sales) setSales(data.sales ?? []);
      if (scope.orders) setOrders(normalizeOrderRows(data.orders ?? []));
      if (scope.dashboard) setDashboard(data.dashboard ?? null);
      if (scope.profitReport) setProfitReport(data.profitReport ?? null);
      if (scope.employees) setEmployees(data.employees ?? []);
      if (scope.backups) setBackups(data.backups ?? []);
      if (scope.inventoryLogs) setInventoryLogs(data.inventoryLogs ?? []);
    } finally {
      if (scope.blocking) setLoading(false);
    }
  };

  const refreshProductsData = async () => load({
    products: true,
    deletedProducts: isAdmin,
    purchases: false,
    sales: false,
    orders: false,
    dashboard: true,
    profitReport: true,
    employees: false,
    backups: false,
    inventoryLogs: true,
    blocking: false
  });

  const refreshPurchasesData = async () => load({
    products: true,
    deletedProducts: false,
    purchases: true,
    sales: false,
    orders: false,
    dashboard: true,
    profitReport: true,
    employees: false,
    backups: false,
    inventoryLogs: true,
    blocking: false
  });

  const refreshOrdersData = async ({ includeSales = false } = {}) => load({
    products: true,
    deletedProducts: false,
    purchases: false,
    sales: includeSales,
    orders: true,
    dashboard: true,
    profitReport: true,
    employees: false,
    backups: false,
    inventoryLogs: true,
    blocking: false
  });

  const refreshSalesData = async () => load({
    products: true,
    deletedProducts: false,
    purchases: false,
    sales: true,
    orders: false,
    dashboard: true,
    profitReport: true,
    employees: false,
    backups: false,
    inventoryLogs: true,
    blocking: false
  });

  const refreshEmployeesData = async () => load({
    products: false,
    deletedProducts: false,
    purchases: false,
    sales: false,
    orders: false,
    dashboard: false,
    profitReport: false,
    employees: true,
    backups: false,
    inventoryLogs: false,
    blocking: false
  });

  const refreshBackupsData = async () => load({
    products: false,
    deletedProducts: false,
    purchases: false,
    sales: false,
    orders: false,
    dashboard: false,
    profitReport: false,
    employees: false,
    backups: true,
    inventoryLogs: false,
    blocking: false
  });

  const loadAuditLogs = async () => {
    if (!auth?.token) return;
    setAuditLoading(true);
    try {
      const rows = await api("/audit-logs").catch(() => []);
      setAuditLogs(rows);
      setAuditLoaded(true);
    } finally {
      setAuditLoading(false);
    }
  };

  const toggleAuditLogs = async () => {
    const nextOpen = !auditOpen;
    setAuditOpen(nextOpen);
    if (nextOpen && !auditLoaded) {
      await loadAuditLogs();
    }
  };

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [auth, dateRange.from, dateRange.to, purchaseFilters.from, purchaseFilters.to, purchaseFilters.supplier, purchaseFilters.product, purchaseFilters.paymentStatus]);

  useEffect(() => {
    if (!saleForm.productId && products[0]) {
      setSaleForm((current) => ({
        ...current,
        productId: String(products[0].id),
        saleUnit: products[0].unit,
        cardsPerUnit: String(products[0].cardsPerUnit),
        unitPrice: String(products[0].price)
      }));
    }
  }, [products, saleForm.productId]);

  useEffect(() => {
    if (!purchaseForm.productId && products[0]) {
      setPurchaseForm((current) => ({
        ...current,
        productId: String(products[0].id),
        unit: products[0].unit
      }));
    }
  }, [products, purchaseForm.productId]);

  useEffect(() => {
    if (!selectedOrderProductId) return;
    const selected = products.find((product) => product.id === selectedOrderProductId);
    if (!selected || selected.stock <= 0) {
      setSelectedOrderProductId(null);
      setSelectedOrderQuantity(1);
      return;
    }
    if (selectedOrderQuantity > selected.stock) {
      setSelectedOrderQuantity(selected.stock);
    }
  }, [products, selectedOrderProductId, selectedOrderQuantity]);

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === Number(saleForm.productId)),
    [products, saleForm.productId]
  );
  const selectedPurchaseProduct = useMemo(
    () => products.find((product) => product.id === Number(purchaseForm.productId)),
    [products, purchaseForm.productId]
  );
  const selectedOrderProduct = useMemo(
    () => products.find((product) => product.id === selectedOrderProductId) ?? null,
    [products, selectedOrderProductId]
  );
  const purchaseTotalCost = Number(purchaseForm.quantity || 0) * Number(purchaseForm.unitCost || 0);
  const productUnitOptions = useMemo(() => ["全部", ...Array.from(new Set(products.map((product) => product.unit).filter(Boolean)))], [products]);
  const filteredProducts = useMemo(() => {
    const keyword = searchInput.trim().toLowerCase();
    const gradeKeyword = gradeSearch.trim().toLowerCase();
    const certKeyword = certSearch.trim().toLowerCase();
    return products
      .filter((product) => {
        const matchesKeyword = !keyword ||
          String(product.name ?? "").toLowerCase().includes(keyword) ||
          String(product.series ?? "").toLowerCase().includes(keyword);
        const matchesType = productTypeFilter === "全部" || product.productType === productTypeFilter;
        const matchesGrade = !gradeKeyword || String(product.grade ?? "").toLowerCase().includes(gradeKeyword);
        const matchesCert = !certKeyword || String(product.certNumber ?? "").toLowerCase().includes(certKeyword);
        const matchesUnit = unitFilter === "全部" || product.unit === unitFilter;
        return matchesKeyword && matchesType && matchesGrade && matchesCert && matchesUnit;
      })
      .sort((a, b) => stockSort === "asc" ? a.stock - b.stock : b.stock - a.stock);
  }, [products, searchInput, productTypeFilter, gradeSearch, certSearch, unitFilter, stockSort]);
  const filteredDeletedProducts = useMemo(() => {
    const keyword = deletedProductSearch.trim().toLowerCase();
    return deletedProducts.filter((product) => {
      if (!keyword) return true;
      return [
        product.name,
        product.series,
        product.rarity,
        product.productType,
        product.grade,
        product.deletedByName
      ].some((value) => String(value ?? "").toLowerCase().includes(keyword));
    });
  }, [deletedProducts, deletedProductSearch]);
  const productPageCount = Math.max(1, Math.ceil(filteredProducts.length / LIST_PAGE_SIZE));
  const currentProductPage = Math.min(productPage, productPageCount);
  const visibleProducts = useMemo(() => {
    const start = (currentProductPage - 1) * LIST_PAGE_SIZE;
    return filteredProducts.slice(start, start + LIST_PAGE_SIZE);
  }, [filteredProducts, currentProductPage]);
  const filteredPurchases = purchases;
  const purchasePageCount = Math.max(1, Math.ceil(filteredPurchases.length / LIST_PAGE_SIZE));
  const currentPurchasePage = Math.min(purchasePage, purchasePageCount);
  const visiblePurchases = useMemo(() => {
    const start = (currentPurchasePage - 1) * LIST_PAGE_SIZE;
    return filteredPurchases.slice(start, start + LIST_PAGE_SIZE);
  }, [filteredPurchases, currentPurchasePage]);
  const orderProducts = useMemo(() => {
    const keyword = orderProductSearch.trim().toLowerCase();
    return products.filter((product) => {
      if (product.stock <= 0) return false;
      if (!keyword) return true;
      return [product.name, product.series, product.rarity, product.grade].filter(Boolean).some((value) => String(value).toLowerCase().includes(keyword));
    });
  }, [orderProductSearch, products]);
  const orderTotal = useMemo(
    () => orderItems.reduce((sum, item) => sum + item.quantity * Number(item.product.price || 0), 0),
    [orderItems]
  );
  const latestAuditTime = auditLogs[0]?.createdAt
    ? new Date(auditLogs[0].createdAt).toLocaleString("zh-TW")
    : (auditLoaded ? "尚無紀錄" : "尚未載入");
  const latestBackupTime = backups[0]?.createdAt
    ? new Date(backups[0].createdAt).toLocaleString("zh-TW")
    : "尚無備份";
  const filteredInventoryLogs = useMemo(() => {
    const keyword = inventoryFilters.product.trim().toLowerCase();
    const from = inventoryFilters.from || null;
    const to = inventoryFilters.to || null;
    const selectedType = inventoryFilters.type;
    return inventoryLogs.filter((log) => {
      const normalizedType = normalizeInventoryLogType(log.type);
      const matchesKeyword = !keyword || String(log.productName ?? "").toLowerCase().includes(keyword);
      const createdDate = String(log.createdAt ?? "").slice(0, 10);
      const matchesFrom = !from || createdDate >= from;
      const matchesTo = !to || createdDate <= to;
      const matchesType = selectedType === "全部" || normalizedType === selectedType;
      return matchesKeyword && matchesFrom && matchesTo && matchesType;
    });
  }, [inventoryFilters, inventoryLogs]);
  const todayInventoryLogCount = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return filteredInventoryLogs.filter((log) => String(log.createdAt ?? "").slice(0, 10) === today).length;
  }, [filteredInventoryLogs]);
  const latestInventoryLogTime = filteredInventoryLogs[0]?.createdAt
    ? new Date(filteredInventoryLogs[0].createdAt).toLocaleString("zh-TW")
    : "尚無紀錄";
  const filteredOrders = useMemo(() => {
    const keyword = orderCustomerSearch.trim().toLowerCase();
    return orders.filter((order) => {
      const itemNames = Array.isArray(order.items) ? order.items.map((item) => item.productName).filter(Boolean).join(" ") : "";
      const matchesKeyword = !keyword || [order.customerName, order.phone, order.lineName, order.orderNumber, order.shippingInfo, itemNames].filter(Boolean).some((value) => String(value).toLowerCase().includes(keyword));
      return matchesKeyword;
    });
  }, [orderCustomerSearch, orders]);
  const pendingOrders = useMemo(
    () => filteredOrders.filter((order) => orderStatusKey(order.status) === "pending"),
    [filteredOrders]
  );
  const completedOrders = useMemo(
    () => filteredOrders.filter((order) => orderStatusKey(order.status) === "completed"),
    [filteredOrders]
  );
  const cancelledOrders = useMemo(
    () => filteredOrders.filter((order) => orderStatusKey(order.status) === "cancelled"),
    [filteredOrders]
  );
  const pendingOrderPageCount = Math.max(1, Math.ceil(pendingOrders.length / LIST_PAGE_SIZE));
  const completedOrderPageCount = Math.max(1, Math.ceil(completedOrders.length / LIST_PAGE_SIZE));
  const cancelledOrderPageCount = Math.max(1, Math.ceil(cancelledOrders.length / LIST_PAGE_SIZE));
  const currentPendingOrderPage = Math.min(pendingOrderPage, pendingOrderPageCount);
  const currentCompletedOrderPage = Math.min(completedOrderPage, completedOrderPageCount);
  const currentCancelledOrderPage = Math.min(cancelledOrderPage, cancelledOrderPageCount);
  const visiblePendingOrders = useMemo(() => {
    const start = (currentPendingOrderPage - 1) * LIST_PAGE_SIZE;
    return pendingOrders.slice(start, start + LIST_PAGE_SIZE);
  }, [pendingOrders, currentPendingOrderPage]);
  const visibleCompletedOrders = useMemo(() => {
    const start = (currentCompletedOrderPage - 1) * LIST_PAGE_SIZE;
    return completedOrders.slice(start, start + LIST_PAGE_SIZE);
  }, [completedOrders, currentCompletedOrderPage]);
  const visibleCancelledOrders = useMemo(() => {
    const start = (currentCancelledOrderPage - 1) * LIST_PAGE_SIZE;
    return cancelledOrders.slice(start, start + LIST_PAGE_SIZE);
  }, [cancelledOrders, currentCancelledOrderPage]);

  useEffect(() => {
    setProductPage(1);
  }, [searchInput, productTypeFilter, gradeSearch, certSearch, unitFilter, stockSort]);

  useEffect(() => {
    setPurchasePage(1);
  }, [purchaseFilters.from, purchaseFilters.to, purchaseFilters.supplier, purchaseFilters.product, purchaseFilters.paymentStatus]);

  useEffect(() => {
    if (productPage > productPageCount) setProductPage(productPageCount);
  }, [productPage, productPageCount]);

  useEffect(() => {
    if (purchasePage > purchasePageCount) setPurchasePage(purchasePageCount);
  }, [purchasePage, purchasePageCount]);

  useEffect(() => {
    if (pendingOrderPage > pendingOrderPageCount) setPendingOrderPage(pendingOrderPageCount);
  }, [pendingOrderPage, pendingOrderPageCount]);

  useEffect(() => {
    if (completedOrderPage > completedOrderPageCount) setCompletedOrderPage(completedOrderPageCount);
  }, [completedOrderPage, completedOrderPageCount]);

  useEffect(() => {
    if (cancelledOrderPage > cancelledOrderPageCount) setCancelledOrderPage(cancelledOrderPageCount);
  }, [cancelledOrderPage, cancelledOrderPageCount]);

  useEffect(() => {
    if (!editingId) return undefined;
    if (!productAutosaveReady.current) {
      productAutosaveReady.current = true;
      return undefined;
    }

    const timer = window.setTimeout(async () => {
      setAutoSaveStatus("儲存中...");
      setError("");
      try {
        await api(`/products/${editingId}`, {
          method: "PUT",
          body: JSON.stringify({
            ...productForm,
            cardsPerUnit: Number(productForm.cardsPerUnit),
            cost: Number(productForm.cost),
            price: Number(productForm.price),
            stock: Number(productForm.stock),
            lowStockThreshold: Number(productForm.lowStockThreshold)
          })
        });
        setAutoSaveStatus("已自動儲存");
        await refreshProductsData();
      } catch (err) {
        setAutoSaveStatus("自動儲存失敗");
        setError(err.message);
      }
    }, 800);

    return () => window.clearTimeout(timer);
  }, [productForm, editingId]);

  useEffect(() => {
    if (!editingEmployeeId || !employeeDraft) return undefined;
    if (!employeeAutosaveReady.current) {
      employeeAutosaveReady.current = true;
      return undefined;
    }

    const timer = window.setTimeout(async () => {
      const employee = employees.find((item) => item.id === editingEmployeeId);
      if (!employee) return;
      setAutoSaveStatus("儲存中...");
      setError("");
      try {
        await api(`/users/${employee.id}`, {
          method: "PUT",
          body: JSON.stringify({
            username: employee.username,
            name: employeeDraft.name,
            displayName: employeeDraft.displayName || employeeDraft.name,
            role: employeeDraft.role,
            isActive: employee.isActive
          })
        });
        setAutoSaveStatus("已自動儲存");
        await refreshEmployeesData();
      } catch (err) {
        setAutoSaveStatus("自動儲存失敗");
        setError(err.message);
      }
    }, 800);

    return () => window.clearTimeout(timer);
  }, [employeeDraft, editingEmployeeId]);

  const submitProduct = async (event) => {
    event.preventDefault();
    setError("");
    const payload = {
      ...productForm,
      cardsPerUnit: Number(productForm.cardsPerUnit),
      cost: Number(productForm.cost),
      price: Number(productForm.price),
      stock: Number(productForm.stock),
      lowStockThreshold: Number(productForm.lowStockThreshold)
    };
    try {
      await api(editingId ? `/products/${editingId}` : "/products", {
        method: editingId ? "PUT" : "POST",
        body: JSON.stringify(payload)
      });
      setProductForm(emptyProduct);
      setEditingId(null);
      productAutosaveReady.current = false;
      setAutoSaveStatus("已自動儲存");
      await refreshProductsData();
    } catch (err) {
      setError(err.message);
    }
  };

  const editProduct = (product) => {
    setEditingId(product.id);
    setProductCreateTab("manual");
    productAutosaveReady.current = false;
    setProductForm({
      name: product.name,
      series: product.series,
      rarity: product.rarity,
      condition: product.condition,
      productType: product.productType ?? "normal",
      gradingCompany: product.gradingCompany ?? "PSA",
      grade: product.grade ?? "",
      certNumber: product.certNumber ?? "",
      unit: product.unit,
      cardsPerUnit: String(product.cardsPerUnit),
      packageSpec: product.packageSpec,
      cost: String(product.cost),
      price: String(product.price),
      stock: String(product.stock),
      lowStockThreshold: String(product.lowStockThreshold),
      notes: product.notes
    });
  };

  const deleteProduct = async (product) => {
    if (!window.confirm(`確定將「${product.name}」移到已刪除商品列表？此操作不會永久刪除資料。`)) return;
    try {
      await api(`/products/${product.id}`, { method: "DELETE" });
      setAutoSaveStatus("已自動儲存");
      await refreshProductsData();
    } catch (err) {
      setError(err.message);
    }
  };

  const restoreProduct = async (product) => {
    if (!window.confirm(`確定還原「${product.name}」？`)) return;
    try {
      await api(`/products/${product.id}/restore`, { method: "PATCH", body: JSON.stringify({}) });
      setAutoSaveStatus("已還原商品");
      await refreshProductsData();
      window.alert("商品已還原");
    } catch (err) {
      setError(err.message);
    }
  };

  const submitSale = async (event) => {
    event.preventDefault();
    setError("");
    try {
      await api("/sales", {
        method: "POST",
        body: JSON.stringify({
          productId: Number(saleForm.productId),
          quantity: Number(saleForm.quantity),
          saleUnit: saleForm.saleUnit,
          cardsPerUnit: Number(saleForm.cardsPerUnit),
          unitPrice: Number(saleForm.unitPrice),
          soldAt: saleForm.soldAt
        })
      });
      setSaleForm((current) => ({ ...current, quantity: 1 }));
      setAutoSaveStatus("已自動儲存");
      await refreshSalesData();
    } catch (err) {
      setError(err.message);
    }
  };

  const addOrderItem = (product, quantity = 1) => {
    console.log("[quick-order] add item clicked", {
      productId: product?.id ?? null,
      productName: product?.name ?? null,
      quantity,
      stock: product?.stock ?? null,
      selectedOrderProductId,
      selectedOrderQuantity
    });
    if (!product) {
      console.warn("[quick-order] add item blocked", { reason: "product missing" });
      setError("商品尚未載入，請稍候再試");
      return;
    }
    if (product.stock <= 0) {
      console.warn("[quick-order] add item blocked", { reason: "out of stock", productId: product.id, productName: product.name, stock: product.stock });
      setError(`${product.name} 目前沒有庫存`);
      return;
    }
    const numericQuantity = Number(quantity);
    const nextQuantity = Number.isFinite(numericQuantity) && numericQuantity > 0
      ? Math.max(1, Math.min(numericQuantity, product.stock))
      : 1;
    setOrderItems((current) => {
      const existing = current.find((item) => item.product.id === product.id);
      if (existing) {
        return current.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: Math.min(item.quantity + nextQuantity, product.stock) }
            : item
        );
      }
      return [...current, { product, quantity: nextQuantity }];
    });
    setSelectedOrderProductId(product.id);
    setSelectedOrderQuantity(1);
  };

  const updateOrderQuantity = (productId, delta) => {
    setOrderItems((current) =>
      current
        .map((item) =>
          item.product.id === productId
            ? { ...item, quantity: Math.max(0, Math.min(item.quantity + delta, item.product.stock)) }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const createOrder = async () => {
    console.log("[quick-order] button clicked");
    if (creatingOrder) return;
    setError("");
    if (products.length === 0) {
      setError("商品資料尚未載入完成，請稍候再試");
      console.warn("[quick-order] create order blocked", { reason: "products not loaded" });
      return;
    }
    if (!orderForm.customerName.trim()) {
      setError("請輸入客戶名稱");
      console.warn("[quick-order] create order blocked", { reason: "customer name missing" });
      return;
    }
    if (orderItems.length === 0) {
      setError("請先加入至少一項商品");
      console.warn("[quick-order] create order blocked", { reason: "no order items" });
      return;
    }
    const payload = {
      ...orderForm,
      items: orderItems.map((item) => ({
        productId: item.product?.id,
        quantity: Number(item.quantity)
      }))
    };
    const invalidItem = payload.items.find((item) => !Number.isFinite(item.productId) || item.productId <= 0 || !Number.isFinite(item.quantity) || item.quantity <= 0);
    if (invalidItem) {
      setError("訂單商品資料異常，請重新加入商品");
      console.warn("[quick-order] create order blocked", {
        reason: "invalid item payload",
        invalidItem,
        items: payload.items
      });
      return;
    }
    setCreatingOrder(true);
    try {
      console.log("[quick-order] createOrder payload", {
        selectedOrderProductId,
        selectedOrderProductIdResolved: selectedOrderProduct?.id ?? null,
        selectedOrderProductName: selectedOrderProduct?.name ?? null,
        selectedOrderQuantity,
        selectedProductId: selectedProduct?.id ?? null,
        selectedProductName: selectedProduct?.name ?? null,
        items: orderItems.map((item) => ({
          productId: item.product.id,
          productName: item.product.name,
          quantity: item.quantity,
          stock: item.product.stock
        }))
      });
      console.log("[quick-order] sending order", payload);
      await api("/orders", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setOrderItems([]);
      setSelectedOrderProductId(null);
      setSelectedOrderQuantity(1);
      setOrderProductSearch("");
      setOrderForm({
        customerName: "",
        phone: "",
        shippingInfo: "",
        lineName: ""
      });
      setAutoSaveStatus("已自動儲存");
      await refreshProductsData();
      await refreshOrdersData({ includeSales: false });
      window.alert("訂單已建立");
    } catch (err) {
      console.error("[quick-order] create order failed", err);
      setError(err.message);
    } finally {
      setCreatingOrder(false);
    }
  };

  const importProducts = async () => {
    if (!importCsv.trim()) return;
    setError("");
    try {
      const result = await api("/products/import", {
        method: "POST",
        body: JSON.stringify({ csv: importCsv })
      });
      setImportCsv("");
      await refreshProductsData();
      window.alert(`已匯入 ${result.imported} 筆商品`);
    } catch (err) {
      setError(err.message);
    }
  };

  const importCsvFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      setImportCsv(await file.text());
    } catch {
      setError("CSV 檔案讀取失敗，請確認檔案為 UTF-8 文字格式");
    } finally {
      event.target.value = "";
    }
  };

  const scrollToSection = (sectionId) => {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setMobileMenuOpen(false);
  };

  const showAllProducts = () => {
    scrollToSection("商品庫存");
  };

  const openMobileProductDrawer = (product) => {
    setMobileDrawer({ type: "product", product });
  };

  const openMobileOrderProductDrawer = (product) => {
    setSelectedOrderProductId(product.id);
    setSelectedOrderQuantity(1);
    setMobileDrawer({ type: "order-product", product });
  };

  const openMobileOrderDrawer = (order) => {
    setMobileDrawer({ type: "order", order });
  };

  const copyShippingText = async (text) => {
    setError("");
    try {
      await copyTextToClipboard(text);
      setAutoSaveStatus("寄件資訊已複製");
    } catch (err) {
      setError(err.message);
    }
  };

  const open711Delivery = () => {
    window.open("https://myship.7-11.com.tw/Home/Main", "_blank", "noopener,noreferrer");
  };

  const submitPurchase = async (event) => {
    event.preventDefault();
    setError("");
    try {
      await api(editingPurchaseId ? `/purchases/${editingPurchaseId}` : "/purchases", {
        method: editingPurchaseId ? "PUT" : "POST",
        body: JSON.stringify({
          ...purchaseForm,
          productId: Number(purchaseForm.productId),
          quantity: Number(purchaseForm.quantity),
          unitCost: Number(purchaseForm.unitCost)
        })
      });
      setPurchaseForm(emptyPurchase);
      setEditingPurchaseId(null);
      setAutoSaveStatus("已自動儲存");
      await refreshPurchasesData();
      window.alert(editingPurchaseId ? "進貨單已更新" : "進貨單已建立");
    } catch (err) {
      setError(err.message);
    }
  };

  const editPurchase = (purchase) => {
    setEditingPurchaseId(purchase.id);
    setPurchaseForm({
      supplier: purchase.supplier,
      purchaseDate: purchase.purchaseDate,
      productId: String(purchase.productId),
      quantity: String(purchase.quantity),
      unit: purchase.unit,
      unitCost: String(purchase.unitCost),
      paymentStatus: purchase.paymentStatus,
      notes: purchase.notes ?? ""
    });
  };

  const cancelPurchaseEdit = () => {
    setEditingPurchaseId(null);
    setPurchaseForm(emptyPurchase);
  };

  const voidPurchase = async (purchase) => {
    const voidReason = window.prompt(`請輸入作廢進貨單 #${purchase.id} 的原因`, "");
    if (voidReason === null) return;
    setError("");
    try {
      await api(`/purchases/${purchase.id}/void`, {
        method: "POST",
        body: JSON.stringify({ voidReason })
      });
      setAutoSaveStatus("已自動儲存");
      await refreshPurchasesData();
      window.alert("進貨單已作廢");
    } catch (err) {
      setError(err.message);
    }
  };

  const updateOrderStatus = async (orderId, status) => {
    setError("");
    try {
      await api(`/orders/${orderId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      setAutoSaveStatus("訂單狀態已更新");
      await refreshProductsData();
      await refreshOrdersData({ includeSales: true });
    } catch (err) {
      setError(err.message);
    }
  };

  const voidSale = async (sale) => {
    if (!window.confirm(`確定作廢銷售紀錄 #${sale.id}？作廢後會自動補回庫存，銷售紀錄仍會保留。`)) return;
    try {
      await api(`/sales/${sale.id}/void`, { method: "POST", body: JSON.stringify({}) });
      setAutoSaveStatus("已自動儲存");
      await refreshSalesData();
    } catch (err) {
      setError(err.message);
    }
  };

  const submitEmployee = async (event) => {
    event.preventDefault();
    setError("");
    try {
      const payload = {
        username: employeeForm.username,
        name: employeeForm.name,
        displayName: employeeForm.displayName || employeeForm.name,
        role: employeeForm.role,
        isActive: employeeForm.isActive
      };
      await api("/users", { method: "POST", body: JSON.stringify({ ...payload, password: employeeForm.password }) });
      setEmployeeForm(emptyEmployee);
      setAutoSaveStatus("已自動儲存");
      await refreshEmployeesData();
      window.alert("員工帳號已建立");
    } catch (err) {
      setError(err.message);
    }
  };

  const editEmployee = (employee) => {
    setEditingEmployeeId(employee.id);
    employeeAutosaveReady.current = false;
    setEmployeeDraft({
      username: employee.username,
      name: employee.name,
      displayName: employee.displayName || employee.name,
      role: employee.role,
      isActive: employee.isActive
    });
  };

  const cancelEmployeeEdit = () => {
    setEditingEmployeeId(null);
    setEmployeeDraft(null);
    employeeAutosaveReady.current = false;
  };

  const saveEmployeeEdit = async (employee) => {
    if (!employeeDraft) return;
    setError("");
    try {
      await api(`/users/${employee.id}`, {
        method: "PUT",
        body: JSON.stringify({
          username: employee.username,
          name: employeeDraft.name,
          displayName: employeeDraft.displayName || employeeDraft.name,
          role: employeeDraft.role,
          isActive: employee.isActive
        })
      });
      cancelEmployeeEdit();
      setAutoSaveStatus("已自動儲存");
      await refreshEmployeesData();
      window.alert("員工資料已更新");
    } catch (err) {
      setError(err.message);
    }
  };

  const updateEmployeePassword = async (employee) => {
    const password = passwordByUser[employee.id] ?? "";
    if (!password) return;
    setError("");
    try {
      await api(`/users/${employee.id}/password`, { method: "PATCH", body: JSON.stringify({ password }) });
      setPasswordByUser((current) => ({ ...current, [employee.id]: "" }));
      setAutoSaveStatus("已自動儲存");
      window.alert("密碼已更新");
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleEmployeeStatus = async (employee) => {
    setError("");
    try {
      await api(`/users/${employee.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !employee.isActive })
      });
      setAutoSaveStatus("已自動儲存");
      await refreshEmployeesData();
    } catch (err) {
      setError(err.message);
    }
  };

  const deleteEmployee = async (employee) => {
    if (!window.confirm(`確定刪除員工「${employee.displayName || employee.name}」？`)) return;
    setError("");
    try {
      await api(`/users/${employee.id}`, { method: "DELETE" });
      setAutoSaveStatus("已自動儲存");
      await refreshEmployeesData();
    } catch (err) {
      setError(err.message);
    }
  };

  const syncGoogleSheet = async () => {
    setError("");
    setSyncingSheet(true);
    try {
      const result = await api("/reports/google-sync", { method: "POST", body: JSON.stringify({}) });
      window.alert("已同步到 Google 試算表");
      if (result.googleSheetUrl) window.open(result.googleSheetUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncingSheet(false);
    }
  };

  const createBackup = async () => {
    setError("");
    try {
      await api("/backups/create", { method: "POST", body: JSON.stringify({}) });
      await refreshBackupsData();
      window.alert("資料庫備份已建立");
    } catch (err) {
      setError(err.message);
    }
  };

  const restoreBackup = async (backup) => {
    const firstConfirm = window.confirm(`即將使用備份「${backup.filename}」還原資料庫。這會覆蓋目前所有員工、商品與銷售資料，確定繼續？`);
    if (!firstConfirm) return;
    const secondConfirm = window.confirm("二次確認：還原後目前資料會被備份內容取代，且無法從介面復原。是否立即還原？");
    if (!secondConfirm) return;

    setError("");
    try {
      await api(`/backups/restore/${encodeURIComponent(backup.filename)}`, { method: "POST", body: JSON.stringify({}) });
      await load();
      window.alert("資料庫已還原");
    } catch (err) {
      setError(err.message);
    }
  };

  const deleteBackup = async (backup) => {
    if (!window.confirm(`確定刪除備份檔「${backup.filename}」？`)) return;
    setError("");
    try {
      await api(`/backups/${encodeURIComponent(backup.filename)}`, { method: "DELETE" });
      await refreshBackupsData();
    } catch (err) {
      setError(err.message);
    }
  };

  const clearDemoData = async () => {
    const firstConfirm = window.confirm("危險操作：即將清除系統預設商品、庫存、銷售紀錄、報表資料與測試紀錄。admin、clerk、員工帳號與系統設定會保留。確定繼續？");
    if (!firstConfirm) return;

    const typed = window.prompt("二次確認：請輸入「清除測試資料」才可執行。");
    if (typed !== "清除測試資料") {
      if (typed !== null) window.alert("輸入內容不符，未執行清除。");
      return;
    }

    setError("");
    setClearingDemoData(true);
    try {
      const result = await api("/admin/clear-demo-data", { method: "POST", body: JSON.stringify({}) });
      setOrderItems([]);
      setSelectedOrderProductId(null);
      setSelectedOrderQuantity(1);
      setOrderProductSearch("");
      setOrderForm({
        customerName: "",
        phone: "",
        shippingInfo: "",
        lineName: ""
      });
      await load();
      window.alert(`測試資料已清除，執行前備份已建立：${result.backup?.filename ?? "已建立"}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setClearingDemoData(false);
    }
  };

  const undoLastAction = async () => {
    if (undoing) return;
    if (!window.confirm("確定還原上一步操作？還原後會同步更新後端資料庫。")) return;
    setUndoing(true);
    setError("");
    try {
      await api("/undo", { method: "POST", body: JSON.stringify({}) });
      setAutoSaveStatus("已還原上一步");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setUndoing(false);
    }
  };

  const logout = () => {
    localStorage.removeItem("pokemon-erp-auth");
    setAuth(null);
  };

  if (!backendReady) {
    return (
      <>
        {wakingBackend && <WakeNotice />}
        {!wakingBackend && (
          <main className="grid min-h-screen place-items-center bg-slate-100 px-4">
            <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
              <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-lg bg-teal-50 text-teal-700">
                <Database className="h-6 w-6" />
              </div>
              <p className="font-semibold text-slate-950">正在連線伺服器</p>
            </section>
          </main>
        )}
      </>
    );
  }

  if (!auth?.token) {
    return (
      <>
        {wakingBackend && <WakeNotice />}
        <Login onLogin={setAuth} />
      </>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-100 pb-72 text-slate-900 lg:pb-0">
      {wakingBackend && <WakeNotice />}
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-slate-200 bg-white px-5 py-6 lg:block">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-teal-700 text-white">
            <Warehouse className="h-5 w-5" />
          </div>
          <div>
            <p className="text-lg font-semibold">{APP_NAME}</p>
            <p className="text-xs text-slate-500">Trading Card Store</p>
          </div>
        </div>
        <nav className="mt-8 space-y-1 text-sm font-medium text-slate-600">
          {navigationItems.map(([Icon, label]) => (
            <a key={label} href={`#${label}`} className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-slate-100">
              <Icon className="h-4 w-4" />
              {label}
            </a>
          ))}
        </nav>
      </aside>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" className="absolute inset-0 bg-slate-950/40" aria-label="關閉選單" onClick={() => setMobileMenuOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[82vw] max-w-xs border-r border-slate-200 bg-white px-5 py-5 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-teal-700 text-white">
                  <Warehouse className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-semibold">{APP_NAME}</p>
                  <p className="text-xs text-slate-500">Trading Card Store</p>
                </div>
              </div>
              <Button type="button" variant="ghost" className="h-12 w-12 px-0" onClick={() => setMobileMenuOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <nav className="mt-6 space-y-2 text-base font-medium text-slate-700">
              {navigationItems.map(([Icon, label]) => (
                <a
                  key={label}
                  href={`#${label}`}
                  className="flex min-h-12 items-center gap-3 rounded-md px-3 py-3 active:bg-slate-100"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <Icon className="h-5 w-5" />
                  {label}
                </a>
              ))}
            </nav>
          </aside>
        </div>
      )}

      <main className="min-w-0 max-w-full lg:ml-64 lg:w-[calc(100vw-16rem)]">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-6 lg:px-8">
          <div className="mx-auto flex w-full max-w-full min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <Button type="button" variant="secondary" className="h-12 w-12 px-0 lg:hidden" onClick={() => setMobileMenuOpen(true)}>
                <Menu className="h-5 w-5" />
              </Button>
              <div>
                <p className="text-sm text-slate-500">{APP_NAME}</p>
                <h1 className="text-lg font-semibold text-slate-950 sm:text-2xl">{APP_NAME}</h1>
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                {autoSaveStatus || "已自動儲存"}
              </div>
              <Button type="button" variant="secondary" disabled={undoing} onClick={undoLastAction}>
                <Undo2 className="h-4 w-4" />
                {undoing ? "還原中..." : "還原上一步"}
              </Button>
              <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <UserRound className="h-4 w-4 text-slate-500" />
                <span>{auth.user.name}</span>
                <span className="rounded bg-white px-2 py-0.5 text-xs text-slate-600">{isAdmin ? "管理員" : "店員"}</span>
              </div>
              <Button variant="secondary" onClick={logout}>
                <LogOut className="h-4 w-4" />
                登出
              </Button>
            </div>
          </div>
        </header>

        <div className="mx-auto w-full max-w-full min-w-0 space-y-6 px-3 py-4 sm:px-6 sm:py-6 lg:px-6 xl:px-8">
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          <section id="營業額儀表板" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {loading && !dashboard ? (
              <>
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </>
            ) : (
              <>
                <StatCard icon={CalendarDays} label="今日營業額" value={currency.format(dashboard?.todayRevenue ?? 0)} detail="依銷售日期統計" tone="bg-teal-50 text-teal-700" />
                <StatCard icon={BarChart3} label="今日成本" value={currency.format(dashboard?.todayCost ?? 0)} detail="依平均進貨成本計算" tone="bg-slate-50 text-slate-700" />
                <StatCard icon={TrendingUp} label="今日毛利" value={currency.format(dashboard?.todayProfit ?? 0)} detail="今日營業額扣除成本" tone="bg-emerald-50 text-emerald-700" />
                <StatCard icon={Boxes} label="毛利率" value={formatRate(dashboard?.todayMarginRate ?? 0)} detail={`低庫存 ${number.format(dashboard?.lowStockCount ?? 0)} 項`} tone="bg-cyan-50 text-cyan-700" />
              </>
            )}
          </section>

          <section id="利潤分析" className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-slate-700" />
                <h2 className="text-lg font-semibold">利潤分析</h2>
              </div>
              {isAdmin && (
                <div className="flex flex-col gap-3 sm:flex-row sm:gap-2">
                  <Button type="button" className="w-full sm:w-auto" onClick={syncGoogleSheet} disabled={syncingSheet}>
                    <Database className="h-4 w-4" />
                    {syncingSheet ? "同步中..." : "同步到 Google 試算表"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full sm:w-auto"
                    disabled={!profitReport?.googleSheetUrl}
                    onClick={() => window.open(profitReport.googleSheetUrl, "_blank", "noopener,noreferrer")}
                  >
                    <ExternalLink className="h-4 w-4" />
                    開啟 Google 試算表
                  </Button>
                </div>
              )}
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-5 w-5 text-slate-700" />
                  <h3 className="text-base font-semibold text-slate-900">今日分析</h3>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <StatCard icon={TrendingUp} label="今日營收" value={currency.format(profitReport?.summary?.todayRevenue ?? 0)} detail="今日銷售總額" tone="bg-teal-50 text-teal-700" />
                  <StatCard icon={CalendarDays} label="今日成本" value={currency.format(profitReport?.summary?.todayCost ?? 0)} detail="依今日銷售成本計算" tone="bg-slate-50 text-slate-700" />
                  <StatCard icon={TrendingUp} label="今日毛利" value={currency.format(profitReport?.summary?.todayProfit ?? 0)} detail="營收扣除成本" tone="bg-emerald-50 text-emerald-700" />
                  <StatCard icon={BarChart3} label="今日毛利率" value={formatRate(profitReport?.summary?.todayMarginRate ?? 0)} detail="毛利 / 營收" tone="bg-cyan-50 text-cyan-700" />
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-slate-700" />
                  <h3 className="text-base font-semibold text-slate-900">本月分析</h3>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <StatCard icon={TrendingUp} label="本月營收" value={currency.format(profitReport?.summary?.monthRevenue ?? 0)} detail="當月銷售總額" tone="bg-indigo-50 text-indigo-700" />
                  <StatCard icon={CalendarDays} label="本月成本" value={currency.format(profitReport?.summary?.monthCost ?? 0)} detail="依當月銷售成本計算" tone="bg-slate-50 text-slate-700" />
                  <StatCard icon={TrendingUp} label="本月毛利" value={currency.format(profitReport?.summary?.monthProfit ?? 0)} detail="營收扣除成本" tone="bg-emerald-50 text-emerald-700" />
                  <StatCard icon={BarChart3} label="本月毛利率" value={formatRate(profitReport?.summary?.monthMarginRate ?? 0)} detail="毛利 / 營收" tone="bg-cyan-50 text-cyan-700" />
                </div>
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <div>
                <h3 className="mb-3 font-semibold text-slate-900">熱銷商品排行</h3>
                <div className="space-y-3">
                  {(profitReport?.hotRankingRows ?? []).slice(0, 5).map((item) => (
                    <div key={`${item.rank}-${item.productName}`} className="flex items-center justify-between rounded-md border border-slate-200 p-3">
                      <div>
                        <p className="font-medium">{item.rank}. {item.productName}</p>
                        <p className="text-sm text-slate-500">毛利率 {formatRate(item.marginRate)}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">{currency.format(item.profit)}</p>
                        <p className="text-sm text-slate-500">{number.format(item.quantity)} 單位</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="mb-3 font-semibold text-slate-900">低庫存商品排行</h3>
                <div className="space-y-3">
                  {(profitReport?.lowStockRows ?? []).slice(0, 5).map((item) => (
                    <div key={item.id} className="flex items-center justify-between rounded-md border border-slate-200 p-3">
                      <div>
                        <p className="font-medium">{item.name}</p>
                        <p className="text-sm text-slate-500">{item.series} · {item.rarity} · {item.packageSpec}</p>
                      </div>
                      <span className="rounded bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700">
                        {formatStock(item)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

          </section>

          <section className="grid gap-6 xl:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-slate-700" />
                <h2 className="text-lg font-semibold">熱賣商品排行</h2>
              </div>
              <div className="space-y-3">
                {(dashboard?.hotProducts ?? []).map((product, index) => (
                  <div key={product.id} className="flex items-center justify-between rounded-md border border-slate-200 p-3">
                    <div>
                      <p className="font-medium">{index + 1}. {product.name}</p>
                      <p className="text-sm text-slate-500">{product.series}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{number.format(product.soldQuantity)} 單位</p>
                      <p className="text-sm text-slate-500">{currency.format(product.revenue)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <Warehouse className="h-5 w-5 text-slate-700" />
                  <h2 className="text-lg font-semibold">商品庫存總覽</h2>
                </div>
                <Button type="button" variant="secondary" onClick={showAllProducts}>
                  <Boxes className="h-4 w-4" />
                  查看全部商品
                </Button>
              </div>
              <div className="mb-4 grid gap-2 sm:grid-cols-3">
                <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  商品總數 <span className="font-semibold text-slate-950">{number.format(dashboard?.totalProductCount ?? 0)}</span>
                </div>
                <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  低庫存商品數 <span className="font-semibold">{number.format(dashboard?.lowStockCount ?? 0)}</span>
                </div>
                <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  目前顯示前 <span className="font-semibold text-slate-950">{number.format((dashboard?.inventoryOverview ?? []).length)}</span> 筆
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {(dashboard?.inventoryOverview ?? []).map((product) => (
                  <div key={product.id} className="rounded-md border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">{product.name}</p>
                      <span className={`rounded px-2 py-1 text-xs font-medium ${product.stock <= product.lowStockThreshold ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
                        {formatStock(product)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{product.series} · {product.rarity} · {product.packageSpec}</p>
                  </div>
                ))}
              </div>
            </div>

          </section>

          <section id="商品庫存">
            <div className="mb-4 flex items-center gap-2">
              <Boxes className="h-5 w-5 text-slate-700" />
              <h2 className="text-lg font-semibold">商品庫存管理</h2>
            </div>

            <div className="grid min-w-0 max-w-full gap-6 xl:grid-cols-[minmax(340px,35%)_minmax(0,65%)]">
              <div className="min-w-0">
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:sticky lg:top-24 lg:max-h-[calc(100vh-8rem)]">
                  <div className="border-b border-slate-200 px-4 py-4">
                    <div className="flex items-center gap-2">
                      <PackagePlus className="h-5 w-5 text-slate-700" />
                      <h3 className="text-base font-semibold">新增商品</h3>
                    </div>
                    {!isAdmin && <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">店員可查看庫存與新增銷售，但不能新增、編輯或刪除商品。</p>}
                  </div>

                  <div className="grid gap-4 px-4 pt-4">
                    <div className="grid grid-cols-2 rounded-lg border border-slate-200 bg-slate-50 p-1 text-sm font-medium">
                      <button
                        type="button"
                        onClick={() => setProductCreateTab("manual")}
                        className={`rounded-md px-3 py-2 transition ${productCreateTab === "manual" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
                      >
                        手動新增商品
                      </button>
                      <button
                        type="button"
                        onClick={() => setProductCreateTab("import")}
                        className={`rounded-md px-3 py-2 transition ${productCreateTab === "import" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
                      >
                        Excel / CSV 商品匯入
                      </button>
                    </div>
                  </div>

                  <div className="max-h-[calc(100vh-16rem)] overflow-y-auto px-4 pb-4 pt-4">
                    {productCreateTab === "manual" ? (
                      <form ref={productFormRef} onSubmit={submitProduct} className="grid gap-5">
                  <section>
                    <h4 className="mb-3 text-sm font-semibold text-slate-700">基本資訊</h4>
                    <div className="grid gap-3 sm:grid-cols-2 sm:[grid-template-columns:repeat(2,minmax(0,1fr))]">
                      <label className="grid gap-1 text-sm font-medium text-slate-600 sm:col-span-2">
                        商品類型
                        <SelectInput
                          disabled={!isAdmin}
                          value={productForm.productType}
                          onChange={(e) => setProductForm((current) => {
                            const nextType = e.target.value;
                            return {
                              ...current,
                              productType: nextType,
                              gradingCompany: nextType === "graded" ? (current.gradingCompany || "PSA") : "PSA",
                              grade: nextType === "graded" ? current.grade : "",
                              certNumber: nextType === "graded" ? current.certNumber : ""
                            };
                          })}
                        >
                          {PRODUCT_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </SelectInput>
                      </label>
                      <label className="grid gap-1 text-sm font-medium text-slate-600">
                        商品名稱
                        <TextInput disabled={!isAdmin} required value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} />
                      </label>
                      <label className="grid gap-1 text-sm font-medium text-slate-600">
                        系列
                        <TextInput disabled={!isAdmin} required value={productForm.series} onChange={(e) => setProductForm({ ...productForm, series: e.target.value })} />
                      </label>
                      <label className="grid gap-1 text-sm font-medium text-slate-600">
                        稀有度
                        <SelectInput disabled={!isAdmin} value={productForm.rarity} onChange={(e) => setProductForm({ ...productForm, rarity: e.target.value })}>
                          {["C", "U", "R", "RR", "RRR", "SR", "SAR", "UR", "HR", "PROMO"].map((rarity) => <option key={rarity}>{rarity}</option>)}
                        </SelectInput>
                      </label>
                      <label className="grid gap-1 text-sm font-medium text-slate-600">
                        卡況
                        <SelectInput disabled={!isAdmin} value={productForm.condition} onChange={(e) => setProductForm({ ...productForm, condition: e.target.value })}>
                          {["全新", "近全新", "良好", "輕微白邊", "明顯傷痕"].map((condition) => <option key={condition}>{condition}</option>)}
                        </SelectInput>
                      </label>
                      {productForm.productType === "graded" && (
                        <>
                          <label className="grid gap-1 text-sm font-medium text-slate-600">
                            鑑定公司
                            <SelectInput
                              disabled={!isAdmin}
                              value={productForm.gradingCompany}
                              onChange={(e) => setProductForm({ ...productForm, gradingCompany: e.target.value })}
                            >
                              {GRADING_COMPANIES.map((company) => <option key={company}>{company}</option>)}
                            </SelectInput>
                          </label>
                          <label className="grid gap-1 text-sm font-medium text-slate-600">
                            Grade
                            <TextInput
                              disabled={!isAdmin}
                              required
                              placeholder="例如 PSA10"
                              value={productForm.grade}
                              onChange={(e) => setProductForm({ ...productForm, grade: e.target.value })}
                            />
                          </label>
                          <label className="grid gap-1 text-sm font-medium text-slate-600 sm:col-span-2">
                            鑑定編號
                            <TextInput
                              disabled={!isAdmin}
                              required
                              placeholder="cert number"
                              value={productForm.certNumber}
                              onChange={(e) => setProductForm({ ...productForm, certNumber: e.target.value })}
                            />
                          </label>
                        </>
                      )}
                    </div>
                  </section>

                  <section>
                    <h4 className="mb-3 text-sm font-semibold text-slate-700">價格資訊</h4>
                    <div className="grid gap-3">
                      <label className="grid gap-1 text-sm font-medium text-slate-600">
                        售價
                        <TextInput disabled={!isAdmin} required min="0" type="number" value={productForm.price} onChange={(e) => setProductForm({ ...productForm, price: e.target.value })} />
                      </label>
                    </div>
                  </section>

                  <section>
                    <h4 className="mb-3 text-sm font-semibold text-slate-700">庫存資訊</h4>
                    <div className="grid gap-3 sm:grid-cols-2 sm:[grid-template-columns:repeat(2,minmax(0,1fr))]">
                      <label className="grid gap-1 text-sm font-medium text-slate-600">
                        單位
                        <SelectInput disabled={!isAdmin} value={productForm.unit} onChange={(e) => setProductForm({ ...productForm, unit: e.target.value })}>
                          {UNIT_OPTIONS.map((unit) => <option key={unit}>{unit}</option>)}
                        </SelectInput>
                      </label>
                      <label className="grid gap-1 text-sm font-medium text-slate-600">
                        每單位張數
                        <TextInput disabled={!isAdmin} required min="1" type="number" value={productForm.cardsPerUnit} onChange={(e) => setProductForm({ ...productForm, cardsPerUnit: e.target.value })} />
                      </label>
                      <label className="grid gap-1 text-sm font-medium text-slate-600 sm:col-span-2">
                        包裝規格
                        <TextInput disabled={!isAdmin} required placeholder="例如 5 張/包" value={productForm.packageSpec} onChange={(e) => setProductForm({ ...productForm, packageSpec: e.target.value })} />
                      </label>
                      <label className="grid gap-1 text-sm font-medium text-slate-600">
                        初始庫存數量
                        <TextInput disabled={!isAdmin} min="0" type="number" placeholder="預設 0" value={productForm.stock} onChange={(e) => setProductForm({ ...productForm, stock: e.target.value })} />
                        <span className="text-xs font-normal text-slate-500">正式進貨請使用進貨管理</span>
                      </label>
                      <label className="grid gap-1 text-sm font-medium text-slate-600">
                        低庫存門檻
                        <TextInput disabled={!isAdmin} required min="0" type="number" value={productForm.lowStockThreshold} onChange={(e) => setProductForm({ ...productForm, lowStockThreshold: e.target.value })} />
                      </label>
                      <label className="grid gap-1 text-sm font-medium text-slate-600 sm:col-span-2">
                        備註
                        <TextArea disabled={!isAdmin} value={productForm.notes} onChange={(e) => setProductForm({ ...productForm, notes: e.target.value })} />
                      </label>
                    </div>
                  </section>
                    <div className="flex flex-col gap-3 border-t border-slate-200 bg-white pt-4 sm:flex-row sm:gap-2">
                      <Button disabled={!isAdmin} type="submit" className="w-full">
                        <PackagePlus className="h-4 w-4" />
                        {editingId ? "儲存變更" : "建立商品"}
                      </Button>
                      {editingId && <Button variant="secondary" type="button" className="w-full sm:w-auto" onClick={() => { setEditingId(null); setProductForm(emptyProduct); }}>取消</Button>}
                    </div>
                      </form>
                    ) : (
                      <section className="grid gap-4">
                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                          <p className="text-sm font-medium text-slate-900">Excel / CSV 商品匯入</p>
                          <p className="mt-1 text-sm text-slate-500">批次匯入商品資料，支援 Excel 匯出的 CSV 檔案。</p>
                        </div>
                        <TextArea
                          placeholder={"貼上 UTF-8 CSV 內容，欄位：商品名稱,系列,單位,包裝規格,成本,售價,庫存數量"}
                          value={importCsv}
                          onChange={(e) => setImportCsv(e.target.value)}
                        />
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <p className="text-sm text-slate-500">未填稀有度/卡況時會自動補預設值。</p>
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <label className="inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-base font-medium text-slate-700 transition hover:bg-slate-50 sm:h-10 sm:px-3 sm:text-sm">
                              選擇 CSV
                              <input type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={importCsvFile} />
                            </label>
                            <Button type="button" className="w-full sm:w-auto" onClick={importProducts}>
                              <PackagePlus className="h-4 w-4" />
                              匯入商品
                            </Button>
                          </div>
                        </div>
                      </section>
                    )}
                  </div>
                </div>
              </div>

              <div className="min-w-0 max-w-full overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="font-semibold text-slate-900">完整商品列表</h3>
                    <p className="mt-1 text-sm text-slate-500">共 {number.format(filteredProducts.length)} 筆，顯示第 {number.format(currentProductPage)} / {number.format(productPageCount)} 頁</p>
                  </div>
                </div>
                <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(220px,1fr)_180px_180px_180px]">
                  <div className="relative min-w-0">
                    <Search className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
                    <input
                      value={searchInput}
                      onChange={(event) => setSearchInput(event.target.value)}
                      placeholder="搜尋商品名稱或系列"
                      className="h-12 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-base outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 sm:h-10 sm:text-sm"
                    />
                  </div>
                  <SelectInput value={productTypeFilter} onChange={(event) => setProductTypeFilter(event.target.value)}>
                    <option value="全部">全部類型</option>
                    {PRODUCT_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </SelectInput>
                  <TextInput
                    value={gradeSearch}
                    onChange={(event) => setGradeSearch(event.target.value)}
                    placeholder="搜尋 Grade"
                  />
                  <TextInput
                    value={certSearch}
                    onChange={(event) => setCertSearch(event.target.value)}
                    placeholder="搜尋 cert number"
                  />
                </div>
                <div className="mb-4 grid gap-3 lg:grid-cols-[180px_180px]">
                  <SelectInput value={unitFilter} onChange={(event) => setUnitFilter(event.target.value)}>
                    {productUnitOptions.map((unit) => <option key={unit} value={unit}>{unit === "全部" ? "全部單位" : unit}</option>)}
                  </SelectInput>
                  <SelectInput value={stockSort} onChange={(event) => setStockSort(event.target.value)}>
                    <option value="asc">庫存由低到高</option>
                    <option value="desc">庫存由高到低</option>
                  </SelectInput>
                </div>

                <div className="hidden overflow-x-auto lg:block">
                  <table className="min-w-full table-auto text-left text-sm">
                    <thead className="border-b border-slate-200 text-xs text-slate-500">
                      <tr>
                        <th className="py-3 pr-4">商品名稱</th>
                        <th className="py-3 pr-4">商品類型</th>
                        <th className="py-3 pr-4">Grade</th>
                        <th className="py-3 pr-4">系列</th>
                        <th className="py-3 pr-4">稀有度</th>
                        <th className="py-3 pr-4">卡況</th>
                        <th className="py-3 pr-4">單位</th>
                        <th className="py-3 pr-4">包裝規格</th>
                        <th className="py-3 pr-4">成本</th>
                        <th className="py-3 pr-4">售價</th>
                        <th className="py-3 pr-4">庫存</th>
                        <th className="py-3">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {visibleProducts.map((product) => (
                        <tr key={product.id}>
                          <td className="py-3 pr-4 font-medium">
                            <div className="flex flex-wrap items-center gap-2">
                              <span>{product.name}</span>
                              {product.productType === "graded" && (
                                <span className="rounded bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700">
                                  {productBadgeLabel(product)}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-500">{product.notes}</p>
                          </td>
                          <td className="py-3 pr-4">
                            <span className={`rounded px-2 py-1 text-xs font-medium ${productTypeTone(product.productType)}`}>
                              {productTypeLabel(product.productType)}
                            </span>
                          </td>
                          <td className="py-3 pr-4 font-medium text-slate-900">{product.productType === "graded" ? product.grade : "-"}</td>
                          <td className="py-3 pr-4">{product.series}</td>
                          <td className="py-3 pr-4">{product.rarity}</td>
                          <td className="py-3 pr-4">{product.condition}</td>
                          <td className="py-3 pr-4">{product.unit}</td>
                          <td className="py-3 pr-4">{product.packageSpec}<p className="text-xs text-slate-500">{product.cardsPerUnit} 張/{product.unit}</p></td>
                          <td className="py-3 pr-4">{currency.format(product.cost)}</td>
                          <td className="py-3 pr-4">{currency.format(product.price)}</td>
                          <td className="py-3 pr-4">
                            <span className={`rounded px-2 py-1 text-xs font-medium ${product.stock <= product.lowStockThreshold ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
                              {product.stock <= product.lowStockThreshold ? `低庫存 ${formatStock(product)}` : formatStock(product)}
                            </span>
                          </td>
                          <td className="py-3">
                            <div className="flex gap-2">
                              <Button variant="secondary" disabled={!isAdmin} onClick={() => editProduct(product)} title="編輯">
                                <Edit3 className="h-4 w-4" />
                              </Button>
                              <Button variant="danger" disabled={!isAdmin} onClick={() => deleteProduct(product)} title="刪除">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {visibleProducts.length === 0 && (
                        <tr>
                          <td className="py-6 text-center text-slate-500" colSpan="12">沒有符合條件的商品</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="grid gap-3 lg:hidden">
                  {visibleProducts.map((product) => (
                    <article key={product.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate font-semibold text-slate-950">{product.name}</h3>
                            {product.productType === "graded" && (
                              <span className="rounded bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700">
                                {productBadgeLabel(product)}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-sm text-slate-500">{productTypeLabel(product.productType)}</p>
                          <p className="mt-1 text-sm text-slate-500">{product.series} · {product.rarity} · {product.condition}</p>
                          <p className="mt-1 text-sm text-slate-500">{product.packageSpec}</p>
                          {product.productType === "graded" && <p className="mt-1 text-sm text-slate-500">{product.gradingCompany} · {product.certNumber}</p>}
                        </div>
                        <span className={`shrink-0 rounded px-2 py-1 text-xs font-medium ${product.stock <= product.lowStockThreshold ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
                          {formatStock(product)}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs text-slate-500">售價</p>
                          <p className="font-semibold">{currency.format(product.price)}</p>
                        </div>
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button type="button" variant="secondary" onClick={() => openMobileProductDrawer(product)}>
                            <ChevronDown className="h-4 w-4 rotate-[-90deg]" />
                            詳情
                          </Button>
                          <Button type="button" variant="secondary" onClick={() => addOrderItem(product)}>
                            <Plus className="h-4 w-4" />
                            加到訂單
                          </Button>
                          <Button variant="secondary" disabled={!isAdmin} onClick={() => editProduct(product)} title="編輯">
                            <Edit3 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </article>
                  ))}
                  {visibleProducts.length === 0 && <p className="py-6 text-center text-slate-500">沒有符合條件的商品</p>}
                </div>
                <PaginationFooter
                  page={currentProductPage}
                  pageCount={productPageCount}
                  onPageChange={setProductPage}
                  summary={`每頁 ${LIST_PAGE_SIZE} 筆，目前顯示 ${number.format(visibleProducts.length)} 筆，第 ${number.format(currentProductPage)} / ${number.format(productPageCount)} 頁`}
                />
              </div>
            </div>

          </section>

          <section id="庫存異動紀錄" className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <button
              type="button"
              onClick={() => setInventoryOpen((current) => !current)}
              aria-expanded={inventoryOpen}
              className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition hover:bg-slate-50"
            >
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold text-slate-950">庫存異動紀錄</h2>
                <p className="mt-1 text-sm text-slate-500">
                  今日異動筆數 {number.format(todayInventoryLogCount)} 筆 · 最近異動時間 {latestInventoryLogTime}
                </p>
              </div>
              <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform duration-300 ${inventoryOpen ? "rotate-180" : ""}`} />
            </button>

            <div
              className="overflow-hidden transition-[max-height,opacity] duration-300 ease-out"
              style={{ maxHeight: inventoryOpen ? "5000px" : "0px", opacity: inventoryOpen ? 1 : 0 }}
              aria-hidden={!inventoryOpen}
            >
              <div className="border-t border-slate-200 px-4 py-4">
                <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(220px,1fr)_180px_180px_180px]">
                  <div className="relative min-w-0">
                    <Search className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
                    <input
                      value={inventoryFilters.product}
                      onChange={(event) => setInventoryFilters((current) => ({ ...current, product: event.target.value }))}
                      placeholder="搜尋商品名稱"
                      className="h-12 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-base outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 sm:h-10 sm:text-sm"
                    />
                  </div>
                  <TextInput
                    type="date"
                    value={inventoryFilters.from}
                    onChange={(event) => setInventoryFilters((current) => ({ ...current, from: event.target.value }))}
                  />
                  <TextInput
                    type="date"
                    value={inventoryFilters.to}
                    onChange={(event) => setInventoryFilters((current) => ({ ...current, to: event.target.value }))}
                  />
                  <SelectInput value={inventoryFilters.type} onChange={(event) => setInventoryFilters((current) => ({ ...current, type: event.target.value }))}>
                    {INVENTORY_LOG_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </SelectInput>
                </div>

                <div className="mb-4 flex flex-col gap-2 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                  <p>共 {number.format(filteredInventoryLogs.length)} 筆異動紀錄</p>
                  <button
                    type="button"
                    className="self-start text-teal-700 hover:text-teal-800"
                    onClick={() => setInventoryFilters({ product: "", from: "", to: "", type: "全部" })}
                  >
                    清除篩選
                  </button>
                </div>

                <div className="hidden overflow-x-auto lg:block">
                  <table className="min-w-full table-auto text-left text-sm">
                    <thead className="border-b border-slate-200 text-xs text-slate-500">
                      <tr>
                        <th className="py-3 pr-4">時間</th>
                        <th className="py-3 pr-4">商品名稱</th>
                        <th className="py-3 pr-4">異動類型</th>
                        <th className="py-3 pr-4">數量變化</th>
                        <th className="py-3 pr-4">異動前</th>
                        <th className="py-3 pr-4">異動後</th>
                        <th className="py-3 pr-4">操作人</th>
                        <th className="py-3 pr-4">備註</th>
                        <th className="py-3">詳細</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredInventoryLogs.map((log) => {
                        const normalizedType = normalizeInventoryLogType(log.type);
                        const expanded = expandedInventoryLogId === log.id;
                        const delta = Number(log.quantityChange ?? 0);
                        const deltaClass = delta > 0 ? "text-emerald-700" : delta < 0 ? "text-rose-700" : "text-slate-600";
                        return (
                          <React.Fragment key={log.id}>
                            <tr className={expanded ? "bg-slate-50/60" : ""}>
                              <td className="py-3 pr-4 whitespace-nowrap">{new Date(log.createdAt).toLocaleString("zh-TW")}</td>
                              <td className="py-3 pr-4 font-medium">{log.productName ?? "-"}</td>
                              <td className="py-3 pr-4">
                                <span className={`rounded px-2 py-1 text-xs font-medium ${inventoryLogTypeTone(normalizedType)}`}>
                                  {inventoryLogTypeLabel(normalizedType)}
                                </span>
                              </td>
                              <td className={`py-3 pr-4 font-semibold ${deltaClass}`}>{delta > 0 ? `+${number.format(delta)}` : number.format(delta)}</td>
                              <td className="py-3 pr-4">{number.format(Number(log.beforeQuantity ?? 0))}</td>
                              <td className="py-3 pr-4">{number.format(Number(log.afterQuantity ?? 0))}</td>
                              <td className="py-3 pr-4">{log.username ?? "-"}</td>
                              <td className="py-3 pr-4">{log.note || "-"}</td>
                              <td className="py-3">
                                <Button type="button" variant="secondary" onClick={() => setExpandedInventoryLogId(expanded ? null : log.id)}>
                                  <ChevronDown className={`h-4 w-4 transition-transform duration-300 ${expanded ? "rotate-180" : ""}`} />
                                </Button>
                              </td>
                            </tr>
                            {expanded && (
                              <tr className="bg-slate-50/70">
                                <td className="px-4 pb-4 pt-0" colSpan="9">
                                  <div className="grid gap-2 rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-600 sm:grid-cols-2 xl:grid-cols-4">
                                    <div><span className="font-medium text-slate-900">時間：</span>{new Date(log.createdAt).toLocaleString("zh-TW")}</div>
                                    <div><span className="font-medium text-slate-900">原始類型：</span>{log.type}</div>
                                    <div><span className="font-medium text-slate-900">關聯類型：</span>{log.referenceType ?? "-"}</div>
                                    <div><span className="font-medium text-slate-900">關聯編號：</span>{log.referenceId ?? "-"}</div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                      {filteredInventoryLogs.length === 0 && (
                        <tr>
                          <td className="py-6 text-center text-slate-500" colSpan="9">沒有符合條件的庫存異動紀錄</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="grid gap-3 lg:hidden">
                  {filteredInventoryLogs.map((log) => {
                    const normalizedType = normalizeInventoryLogType(log.type);
                    const expanded = expandedInventoryLogId === log.id;
                    const delta = Number(log.quantityChange ?? 0);
                    const deltaClass = delta > 0 ? "text-emerald-700" : delta < 0 ? "text-rose-700" : "text-slate-600";
                    return (
                      <article key={log.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-slate-950">{log.productName ?? "-"}</p>
                            <p className="mt-1 text-sm text-slate-500">{new Date(log.createdAt).toLocaleString("zh-TW")}</p>
                          </div>
                          <span className={`rounded px-2 py-1 text-xs font-medium ${inventoryLogTypeTone(normalizedType)}`}>
                            {inventoryLogTypeLabel(normalizedType)}
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <p className="text-xs text-slate-500">數量變化</p>
                            <p className={`font-semibold ${deltaClass}`}>{delta > 0 ? `+${number.format(delta)}` : number.format(delta)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-500">操作人</p>
                            <p className="font-medium">{log.username ?? "-"}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-500">異動前</p>
                            <p>{number.format(Number(log.beforeQuantity ?? 0))}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-500">異動後</p>
                            <p>{number.format(Number(log.afterQuantity ?? 0))}</p>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-3">
                          <p className="min-w-0 truncate text-sm text-slate-500">{log.note || "無備註"}</p>
                          <Button type="button" variant="secondary" className="shrink-0" onClick={() => setExpandedInventoryLogId(expanded ? null : log.id)}>
                            <ChevronDown className={`h-4 w-4 transition-transform duration-300 ${expanded ? "rotate-180" : ""}`} />
                          </Button>
                        </div>
                        {expanded && (
                          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                            <p><span className="font-medium text-slate-900">原始類型：</span>{log.type}</p>
                            <p className="mt-1"><span className="font-medium text-slate-900">關聯類型：</span>{log.referenceType ?? "-"}</p>
                            <p className="mt-1"><span className="font-medium text-slate-900">關聯編號：</span>{log.referenceId ?? "-"}</p>
                          </div>
                        )}
                      </article>
                    );
                  })}
                  {filteredInventoryLogs.length === 0 && <p className="py-6 text-center text-slate-500">沒有符合條件的庫存異動紀錄</p>}
                </div>
              </div>
            </div>
          </section>

          <section id="進貨管理" className="grid min-w-0 gap-6 xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)]">
            <form ref={purchaseFormRef} onSubmit={submitPurchase} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <PackagePlus className="h-5 w-5 text-slate-700" />
                <h2 className="text-lg font-semibold">{editingPurchaseId ? "編輯進貨單" : "新增進貨單"}</h2>
              </div>
              {!isAdmin && <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">店員只能查看進貨紀錄，不能新增、編輯或作廢進貨單。</p>}
              <div className="grid gap-3">
                <TextInput disabled={!isAdmin} required placeholder="供應商" value={purchaseForm.supplier} onChange={(e) => setPurchaseForm({ ...purchaseForm, supplier: e.target.value })} />
                <TextInput disabled={!isAdmin} required type="date" value={purchaseForm.purchaseDate} onChange={(e) => setPurchaseForm({ ...purchaseForm, purchaseDate: e.target.value })} />
                <SelectInput disabled={!isAdmin} value={purchaseForm.productId} onChange={(e) => {
                  const product = products.find((item) => item.id === Number(e.target.value));
                  setPurchaseForm({
                    ...purchaseForm,
                    productId: e.target.value,
                    unit: product?.unit ?? purchaseForm.unit
                  });
                }}>
                  {products.map((product) => <option key={product.id} value={product.id}>{product.name}（目前 {formatStock(product)}）</option>)}
                </SelectInput>
                {selectedPurchaseProduct && <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">{selectedPurchaseProduct.series} · {selectedPurchaseProduct.rarity} · {selectedPurchaseProduct.packageSpec}</p>}
                <div className="grid grid-cols-2 gap-3">
                  <TextInput disabled={!isAdmin} required min="1" type="number" placeholder="數量" value={purchaseForm.quantity} onChange={(e) => setPurchaseForm({ ...purchaseForm, quantity: e.target.value })} />
                  <SelectInput disabled={!isAdmin} value={purchaseForm.unit} onChange={(e) => setPurchaseForm({ ...purchaseForm, unit: e.target.value })}>
                    {UNIT_OPTIONS.map((unit) => <option key={unit}>{unit}</option>)}
                  </SelectInput>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <TextInput disabled={!isAdmin} required min="0" type="number" placeholder="單位成本" value={purchaseForm.unitCost} onChange={(e) => setPurchaseForm({ ...purchaseForm, unitCost: e.target.value })} />
                  <SelectInput disabled={!isAdmin} value={purchaseForm.paymentStatus} onChange={(e) => setPurchaseForm({ ...purchaseForm, paymentStatus: e.target.value })}>
                    <option>未付款</option>
                    <option>已付款</option>
                    <option>部分付款</option>
                  </SelectInput>
                </div>
                <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">總成本：{currency.format(purchaseTotalCost)}</p>
                <TextArea disabled={!isAdmin} placeholder="備註" value={purchaseForm.notes} onChange={(e) => setPurchaseForm({ ...purchaseForm, notes: e.target.value })} />
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button disabled={!isAdmin} type="submit" className="w-full">
                    <PackagePlus className="h-4 w-4" />
                    {editingPurchaseId ? "儲存進貨單" : "建立進貨單"}
                  </Button>
                  {editingPurchaseId && <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={cancelPurchaseEdit}>取消</Button>}
                </div>
              </div>
            </form>

            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-2">
                  <PackagePlus className="h-5 w-5 text-slate-700" />
                  <h2 className="text-lg font-semibold">進貨紀錄</h2>
                </div>
                <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{purchases.length} 筆</span>
              </div>
              <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <TextInput type="date" value={purchaseFilters.from} onChange={(e) => setPurchaseFilters({ ...purchaseFilters, from: e.target.value })} />
                <TextInput type="date" value={purchaseFilters.to} onChange={(e) => setPurchaseFilters({ ...purchaseFilters, to: e.target.value })} />
                <TextInput placeholder="供應商" value={purchaseFilters.supplier} onChange={(e) => setPurchaseFilters({ ...purchaseFilters, supplier: e.target.value })} />
                <TextInput placeholder="商品名稱" value={purchaseFilters.product} onChange={(e) => setPurchaseFilters({ ...purchaseFilters, product: e.target.value })} />
                <SelectInput value={purchaseFilters.paymentStatus} onChange={(e) => setPurchaseFilters({ ...purchaseFilters, paymentStatus: e.target.value })}>
                  <option value="">全部付款狀態</option>
                  <option>未付款</option>
                  <option>已付款</option>
                  <option>部分付款</option>
                </SelectInput>
              </div>
              <div className="hidden overflow-x-auto lg:block">
                <table className="min-w-full table-auto text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs text-slate-500">
                    <tr>
                      <th className="py-3 pr-4">日期</th>
                      <th className="py-3 pr-4">供應商</th>
                      <th className="py-3 pr-4">商品</th>
                      <th className="py-3 pr-4">數量</th>
                      <th className="py-3 pr-4">成本</th>
                      <th className="py-3 pr-4">付款狀態</th>
                      <th className="py-3 pr-4">建立者</th>
                      <th className="py-3">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visiblePurchases.map((purchase) => (
                      <tr key={purchase.id}>
                        <td className="py-3 pr-4">{purchase.purchaseDate}</td>
                        <td className="py-3 pr-4">{purchase.supplier}</td>
                        <td className="py-3 pr-4 font-medium">{purchase.productName}<p className="text-xs text-slate-500">{purchase.productSeries}</p></td>
                        <td className="py-3 pr-4">{number.format(purchase.quantity)} {purchase.unit}</td>
                        <td className="py-3 pr-4">{currency.format(purchase.totalCost)}<p className="text-xs text-slate-500">{currency.format(purchase.unitCost)} / {purchase.unit}</p></td>
                        <td className="py-3 pr-4">
                          <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{purchase.paymentStatus}</span>
                        </td>
                        <td className="py-3 pr-4">{purchase.createdByName ?? "-"}</td>
                        <td className="py-3">
                          <div className="flex gap-2">
                            <Button type="button" variant="secondary" disabled={!isAdmin} onClick={() => editPurchase(purchase)}>
                              <Edit3 className="h-4 w-4" />
                            </Button>
                            <Button type="button" variant="danger" disabled={!isAdmin} onClick={() => voidPurchase(purchase)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {visiblePurchases.length === 0 && (
                      <tr>
                        <td className="py-6 text-center text-slate-500" colSpan="8">尚無進貨紀錄</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-3 lg:hidden">
                {visiblePurchases.map((purchase) => (
                  <article key={purchase.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold">{purchase.productName}</p>
                        <p className="mt-1 text-sm text-slate-500">{purchase.supplier} · {purchase.purchaseDate}</p>
                        <p className="mt-1 text-sm text-slate-500">{number.format(purchase.quantity)} {purchase.unit} · {purchase.paymentStatus}</p>
                      </div>
                      <p className="font-semibold">{currency.format(purchase.totalCost)}</p>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <p className="text-sm text-slate-500">{purchase.createdByName ?? "-"}</p>
                      <div className="flex gap-2">
                        <Button type="button" variant="secondary" disabled={!isAdmin} onClick={() => editPurchase(purchase)}>
                          <Edit3 className="h-4 w-4" />
                        </Button>
                        <Button type="button" variant="danger" disabled={!isAdmin} onClick={() => voidPurchase(purchase)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </article>
                ))}
                {visiblePurchases.length === 0 && <p className="py-6 text-center text-slate-500">尚無進貨紀錄</p>}
              </div>
              <PaginationFooter
                page={currentPurchasePage}
                pageCount={purchasePageCount}
                onPageChange={setPurchasePage}
                summary={`每頁 ${LIST_PAGE_SIZE} 筆，目前顯示 ${number.format(visiblePurchases.length)} 筆，第 ${number.format(currentPurchasePage)} / ${number.format(purchasePageCount)} 頁`}
              />
            </div>
          </section>

          <section id="快速下單" className="space-y-6">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-slate-700" />
              <h2 className="text-lg font-semibold">快速下單</h2>
            </div>

            <div className="grid gap-4 lg:hidden">
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold">商品面板</h3>
                    <p className="mt-1 text-sm text-slate-500">先選商品，再加入訂單。</p>
                  </div>
                  <p className="text-sm font-semibold text-slate-700">{number.format(orderProducts.length)} 筆</p>
                </div>
                <div className="relative min-w-0">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
                  <input
                    value={orderProductSearch}
                    onChange={(event) => setOrderProductSearch(event.target.value)}
                    placeholder="搜尋商品名稱、系列、Grade"
                    className="h-12 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-base outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
                  />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  {orderProducts.map((product) => {
                    const isSelected = selectedOrderProductId === product.id;
                    return (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => openMobileOrderProductDrawer(product)}
                        className={`rounded-lg border p-3 text-left shadow-sm transition active:scale-[0.99] ${isSelected ? "border-teal-300 bg-teal-50" : "border-slate-200 bg-white hover:border-teal-300 hover:bg-teal-50"}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-950">{product.name}</p>
                            <p className="mt-1 text-sm text-slate-500">{product.series}</p>
                          </div>
                          {product.productType === "graded" && <span className="rounded bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-700">{productBadgeLabel(product)}</span>}
                        </div>
                        <div className="mt-2 flex items-center justify-between text-sm">
                          <span className="font-semibold text-slate-950">{currency.format(product.price)}</span>
                          <span className={`rounded px-2 py-1 text-xs font-medium ${product.stock <= product.lowStockThreshold ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
                            {formatStock(product)}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                  {orderProducts.length === 0 && <p className="col-span-2 py-6 text-center text-slate-500">沒有可選商品</p>}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold">訂單資訊</h3>
                    <p className="mt-1 text-sm text-slate-500">加入商品後填寫客戶資料並建立訂單。</p>
                  </div>
                  <p className="font-semibold">{currency.format(orderTotal)}</p>
                </div>
                {orderItems.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                    先從上方加入商品
                  </div>
                ) : (
                  <div className="grid gap-4">
                    <div className="grid gap-3">
                      <label className="grid gap-1 text-sm font-medium text-slate-600">
                        客戶名稱
                        <TextInput value={orderForm.customerName} onChange={(e) => setOrderForm({ ...orderForm, customerName: e.target.value })} placeholder="客戶姓名" />
                      </label>
                      <label className="grid gap-1 text-sm font-medium text-slate-600">
                        電話
                        <TextInput value={orderForm.phone} onChange={(e) => setOrderForm({ ...orderForm, phone: e.target.value })} placeholder="聯絡電話" />
                      </label>
                      <label className="grid gap-1 text-sm font-medium text-slate-600">
                        寄件資料（7-11 門市）
                        <TextArea value={orderForm.shippingInfo} onChange={(e) => setOrderForm({ ...orderForm, shippingInfo: e.target.value })} placeholder="門市名稱 / 代碼 / 收件資訊" />
                      </label>
                      <label className="grid gap-1 text-sm font-medium text-slate-600">
                        LINE 名稱
                        <TextInput value={orderForm.lineName} onChange={(e) => setOrderForm({ ...orderForm, lineName: e.target.value })} placeholder="LINE 顯示名稱" />
                      </label>
                    </div>
                    <div className="grid gap-2 border-t border-slate-200 pt-4">
                      {orderItems.map((item) => (
                        <div key={item.product.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate font-medium">{item.product.name}</p>
                              <p className="mt-1 text-sm text-slate-500">{currency.format(item.product.price)} · 小計 {currency.format(item.quantity * Number(item.product.price || 0))}</p>
                            </div>
                            <Button type="button" variant="danger" className="h-10 w-10 px-0" onClick={() => setOrderItems((current) => current.filter((currentItem) => currentItem.product.id !== item.product.id))}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                          <div className="mt-3 flex items-center gap-2">
                            <Button type="button" variant="secondary" className="h-10 w-10 px-0" onClick={() => updateOrderQuantity(item.product.id, -1)}>
                              <Minus className="h-4 w-4" />
                            </Button>
                            <input
                              type="number"
                              min="1"
                              max={item.product.stock}
                              value={item.quantity}
                              onChange={(event) => {
                                const nextQuantity = Math.max(1, Math.min(item.product.stock, Number(event.target.value) || 1));
                                setOrderItems((current) =>
                                  current.map((currentItem) =>
                                    currentItem.product.id === item.product.id
                                      ? { ...currentItem, quantity: nextQuantity }
                                      : currentItem
                                  )
                                );
                              }}
                              className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-center text-base outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 sm:text-sm"
                            />
                            <Button type="button" variant="secondary" className="h-10 w-10 px-0" onClick={() => updateOrderQuantity(item.product.id, 1)}>
                              <Plus className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">總金額：{currency.format(orderTotal)}</p>
                    <Button type="button" disabled={creatingOrder || orderItems.length === 0} onClick={createOrder}>
                      <ShoppingCart className="h-4 w-4" />
                      {creatingOrder ? "建立中..." : "建立訂單"}
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <div className="hidden min-w-0 gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:grid">
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-base font-semibold">商品面板</h3>
                    <p className="mt-1 text-sm text-slate-500">先選商品，再加入訂單。</p>
                  </div>
                  <p className="text-sm font-semibold text-slate-700">可選商品 {number.format(orderProducts.length)} 筆</p>
                </div>
                <div className="mb-4">
                  <div className="relative min-w-0">
                    <Search className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
                    <input
                      value={orderProductSearch}
                      onChange={(event) => setOrderProductSearch(event.target.value)}
                      placeholder="搜尋商品名稱、系列、Grade"
                      className="h-12 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-base outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 sm:h-10 sm:text-sm"
                    />
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {orderProducts.map((product) => {
                    const isSelected = selectedOrderProductId === product.id;
                    return (
                      <article
                        key={product.id}
                        className={`rounded-lg border p-3 text-left shadow-sm transition ${isSelected ? "border-teal-300 bg-teal-50" : "border-slate-200 hover:border-teal-300 hover:bg-teal-50"}`}
                      >
                        <button
                          type="button"
                          className="w-full text-left"
                          onClick={() => {
                            setSelectedOrderProductId(product.id);
                            setSelectedOrderQuantity(1);
                          }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate font-medium">{product.name}</p>
                              <p className="mt-1 text-sm text-slate-500">{product.series}</p>
                            </div>
                            {product.productType === "graded" && <span className="rounded bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700">{productBadgeLabel(product)}</span>}
                          </div>
                          <div className="mt-2 flex items-center justify-between text-sm text-slate-600">
                            <span>{currency.format(product.price)}</span>
                            <span>{formatStock(product)}</span>
                          </div>
                        </button>
                        {isSelected && (
                          <div className="mt-3 grid gap-2 border-t border-slate-200 pt-3">
                            <div className="flex items-center gap-2">
                              <Button type="button" variant="secondary" className="h-10 w-10 px-0" onClick={(event) => { event.stopPropagation(); setSelectedOrderQuantity((current) => Math.max(1, current - 1)); }}>
                                <Minus className="h-4 w-4" />
                              </Button>
                              <input
                                type="number"
                                min="1"
                                max={product.stock}
                                value={selectedOrderQuantity}
                                onChange={(event) => setSelectedOrderQuantity(Math.max(1, Math.min(product.stock, Number(event.target.value) || 1)))}
                                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-center text-base outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 sm:text-sm"
                              />
                              <Button type="button" variant="secondary" className="h-10 w-10 px-0" onClick={(event) => { event.stopPropagation(); setSelectedOrderQuantity((current) => Math.min(product.stock, current + 1)); }}>
                                <Plus className="h-4 w-4" />
                              </Button>
                            </div>
                            <Button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                addOrderItem(product, selectedOrderQuantity);
                              }}
                            >
                              加入訂單
                            </Button>
                          </div>
                        )}
                      </article>
                    );
                  })}
                  {orderProducts.length === 0 && <p className="py-6 text-center text-slate-500 md:col-span-2 xl:col-span-3">沒有可選商品</p>}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold">訂單資訊</h3>
                    <p className="mt-1 text-sm text-slate-500">加入商品後填寫客戶資料並建立訂單。</p>
                  </div>
                  <p className="font-semibold">{currency.format(orderTotal)}</p>
                </div>
                {orderItems.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                    先從左側加入商品
                  </div>
                ) : (
                  <div className="grid gap-4">
                    <div className="grid gap-3">
                      <label className="grid gap-1 text-sm font-medium text-slate-600">
                        客戶名稱
                        <TextInput value={orderForm.customerName} onChange={(e) => setOrderForm({ ...orderForm, customerName: e.target.value })} placeholder="客戶姓名" />
                      </label>
                      <label className="grid gap-1 text-sm font-medium text-slate-600">
                        電話
                        <TextInput value={orderForm.phone} onChange={(e) => setOrderForm({ ...orderForm, phone: e.target.value })} placeholder="聯絡電話" />
                      </label>
                      <label className="grid gap-1 text-sm font-medium text-slate-600">
                        寄件資料（7-11 門市）
                        <TextArea value={orderForm.shippingInfo} onChange={(e) => setOrderForm({ ...orderForm, shippingInfo: e.target.value })} placeholder="門市名稱 / 代碼 / 收件資訊" />
                      </label>
                      <label className="grid gap-1 text-sm font-medium text-slate-600">
                        LINE 名稱
                        <TextInput value={orderForm.lineName} onChange={(e) => setOrderForm({ ...orderForm, lineName: e.target.value })} placeholder="LINE 顯示名稱" />
                      </label>
                    </div>
                    <div className="grid gap-2 border-t border-slate-200 pt-4">
                      {orderItems.map((item) => (
                        <div key={item.product.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate font-medium">{item.product.name}</p>
                              <p className="mt-1 text-sm text-slate-500">{currency.format(item.product.price)} · 小計 {currency.format(item.quantity * Number(item.product.price || 0))}</p>
                            </div>
                            <Button type="button" variant="danger" className="h-10 w-10 px-0" onClick={() => setOrderItems((current) => current.filter((currentItem) => currentItem.product.id !== item.product.id))}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                          <div className="mt-3 flex items-center gap-2">
                            <Button type="button" variant="secondary" className="h-10 w-10 px-0" onClick={() => updateOrderQuantity(item.product.id, -1)}>
                              <Minus className="h-4 w-4" />
                            </Button>
                            <input
                              type="number"
                              min="1"
                              max={item.product.stock}
                              value={item.quantity}
                              onChange={(event) => {
                                const nextQuantity = Math.max(1, Math.min(item.product.stock, Number(event.target.value) || 1));
                                setOrderItems((current) =>
                                  current.map((currentItem) =>
                                    currentItem.product.id === item.product.id
                                      ? { ...currentItem, quantity: nextQuantity }
                                      : currentItem
                                  )
                                );
                              }}
                              className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-center text-base outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 sm:text-sm"
                            />
                            <Button type="button" variant="secondary" className="h-10 w-10 px-0" onClick={() => updateOrderQuantity(item.product.id, 1)}>
                              <Plus className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <Button type="button" disabled={creatingOrder || orderItems.length === 0} onClick={createOrder}>
                      <ShoppingCart className="h-4 w-4" />
                      {creatingOrder ? "建立中..." : "建立訂單"}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section id="訂單管理區" className="hidden">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-base font-semibold">訂單管理區</h3>
                  <p className="mt-1 text-sm text-slate-500">桌機版以三欄 Kanban 橫向佔滿主畫面。</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_180px]">
                  <div className="relative min-w-0">
                    <Search className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
                    <input
                      value={orderCustomerSearch}
                      onChange={(event) => setOrderCustomerSearch(event.target.value)}
                      placeholder="搜尋客戶 / 訂單編號 / LINE"
                      className="h-12 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-base outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 sm:h-10 sm:text-sm"
                    />
                  </div>
                  <SelectInput className="hidden lg:block" value={orderStatusFilter} onChange={(event) => setOrderStatusFilter(event.target.value)}>
                    <option value="全部">全部狀態</option>
                    {ORDER_STATUS_OPTIONS.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
                  </SelectInput>
                </div>
              </div>

              <div className="grid gap-4 lg:hidden">
                <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-100 p-1 text-sm font-medium">
                  {[
                    { key: "待處理", count: pendingOrders.length },
                    { key: "已完成", count: completedOrders.length },
                    { key: "已取消", count: cancelledOrders.length }
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setMobileOrderTab(tab.key)}
                      className={`rounded-md px-3 py-2 transition ${mobileOrderTab === tab.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
                    >
                      {tab.key}
                      <span className="ml-2 text-xs text-slate-500">{number.format(tab.count)}</span>
                    </button>
                  ))}
                </div>

                <div className="h-[68vh] overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3">
                {[
                  { key: "待處理", orders: pendingOrders, empty: "尚無待處理訂單", allowActions: true },
                  { key: "已完成", orders: completedOrders, empty: "尚無已完成訂單", allowActions: false },
                  { key: "已取消", orders: cancelledOrders, empty: "尚無已取消訂單", allowActions: false }
                ].filter((tab) => tab.key === mobileOrderTab).map((tab) => (
                  <div key={tab.key} className="grid gap-3">
                    {tab.orders.map((order) => (
                      <article key={order.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-950">{order.orderNumber}</p>
                            <p className="mt-1 text-sm text-slate-500">{order.customerName || "-"}</p>
                            <p className="mt-1 text-sm text-slate-500">{order.lineName || "-"} · {order.phone || "-"}</p>
                            <p className="mt-1 text-sm text-slate-500 whitespace-pre-line">{order.shippingInfo || "-"}</p>
                          </div>
                          <span className={`rounded px-2 py-1 text-xs font-medium ${orderStatusTone(order.status)}`}>{orderStatusLabel(order.status)}</span>
                        </div>
                        <div className="mt-3 grid gap-2 text-sm text-slate-600">
                          <p>商品摘要 {orderSummaryText(order)}</p>
                          <p>訂單金額 {currency.format(order.totalAmount)}</p>
                          <p>建立時間 {new Date(order.createdAt).toLocaleString("zh-TW")}</p>
                        </div>
                        <div className="mt-3 grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
                          {order.items.map((item) => (
                            <div key={item.id} className="flex items-center justify-between gap-3 py-1 text-sm">
                              <span className="min-w-0 truncate">{item.productName}</span>
                              <span className="shrink-0">x{item.quantity} · {currency.format(item.subtotal)}</span>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <Button type="button" variant="secondary" className="w-full" onClick={() => openMobileOrderDrawer(order)}>
                            <ChevronDown className="h-4 w-4 rotate-[-90deg]" />
                            詳情
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            className="w-full"
                            onClick={() => setShippingAssistantOrderId((current) => (current === order.id ? null : order.id))}
                          >
                            <Copy className="h-4 w-4" />
                            寄件助手
                          </Button>
                          {tab.allowActions && (
                            <Button type="button" className="w-full" onClick={() => updateOrderStatus(order.id, "completed")}>
                              已完成
                            </Button>
                          )}
                          {tab.allowActions && (
                            <Button type="button" variant="danger" className="w-full" onClick={() => updateOrderStatus(order.id, "cancelled")}>
                              已取消
                            </Button>
                          )}
                        </div>
                        {shippingAssistantOrderId === order.id && (
                          <ShippingAssistantPanel
                            order={order}
                            onCopyText={copyShippingText}
                            onOpen711={open711Delivery}
                          />
                        )}
                      </article>
                    ))}
                    {tab.orders.length === 0 && <p className="py-6 text-center text-slate-500">{tab.empty}</p>}
                  </div>
                ))}
                </div>
              </div>

              <div className="hidden lg:block">
                <div className="grid h-[68vh] gap-4 lg:grid-cols-3">
                {[
                  { title: "待處理", orders: pendingOrders, empty: "尚無待處理訂單", showActions: true },
                  { title: "已完成", orders: completedOrders, empty: "尚無已完成訂單", showActions: false },
                  { title: "已取消", orders: cancelledOrders, empty: "尚無已取消訂單", showActions: false }
                ].map((column) => (
                  <section key={column.title} className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-slate-50 shadow-sm">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
                      <h4 className="text-sm font-semibold text-slate-700">{column.title} {number.format(column.orders.length)}</h4>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{number.format(column.orders.length)} 筆</span>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto p-4">
                      <div className="grid gap-3">
                      {column.orders.map((order) => (
                        <article key={order.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-950">{order.orderNumber}</p>
                              <p className="mt-1 text-sm text-slate-500">{order.customerName || "-"}</p>
                              <p className="mt-1 text-sm text-slate-500">{order.lineName || "-"} · {order.phone || "-"}</p>
                              <p className="mt-1 whitespace-pre-line text-sm text-slate-500">{order.shippingInfo || "-"}</p>
                            </div>
                            <span className={`rounded px-2 py-1 text-xs font-medium ${orderStatusTone(order.status)}`}>{orderStatusLabel(order.status)}</span>
                          </div>
                          <div className="mt-3 grid gap-2 text-sm text-slate-600">
                            <p>商品摘要 {orderSummaryText(order)}</p>
                            <p>訂單金額 {currency.format(order.totalAmount)}</p>
                            <p>建立時間 {new Date(order.createdAt).toLocaleString("zh-TW")}</p>
                            <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
                              {order.items.map((item) => (
                                <div key={item.id} className="flex items-center justify-between gap-3">
                                  <span className="min-w-0 truncate">{item.productName}</span>
                                  <span className="shrink-0">x{item.quantity} · {currency.format(item.subtotal)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                          {column.showActions && (
                            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                              <Button type="button" onClick={() => updateOrderStatus(order.id, "completed")} className="w-full">
                                已完成
                              </Button>
                              <Button type="button" variant="danger" onClick={() => updateOrderStatus(order.id, "cancelled")} className="w-full">
                                已取消
                              </Button>
                            </div>
                          )}
                          <div className="mt-3">
                            <Button
                              type="button"
                              variant="secondary"
                              className="w-full"
                              onClick={() => setShippingAssistantOrderId((current) => (current === order.id ? null : order.id))}
                            >
                              <Copy className="h-4 w-4" />
                              寄件助手
                            </Button>
                            {shippingAssistantOrderId === order.id && (
                              <ShippingAssistantPanel
                                order={order}
                                onCopyText={copyShippingText}
                                onOpen711={open711Delivery}
                              />
                            )}
                          </div>
                        </article>
                      ))}
                      {column.orders.length === 0 && <p className="py-6 text-center text-slate-500">{column.empty}</p>}
                      </div>
                    </div>
                  </section>
                ))}
              </div>
              </div>
            </div>
          </section>

          <section id="訂單管理" className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">訂單管理</h2>
                <p className="mt-1 text-sm text-slate-500">
                  以狀態分成待處理、已完成、已取消三區顯示，使用橫列表格管理訂單。
                </p>
              </div>
              <div className="grid gap-2 sm:min-w-[320px]">
                <div className="relative min-w-0">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
                  <input
                    value={orderCustomerSearch}
                    onChange={(event) => setOrderCustomerSearch(event.target.value)}
                    placeholder="搜尋訂單編號 / 客戶 / LINE / 電話 / 商品"
                    className="h-12 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-base outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 sm:h-10 sm:text-sm"
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:hidden">
              <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-100 p-1 text-sm font-medium">
                {[
                  { key: "待處理", count: pendingOrders.length },
                  { key: "已完成", count: completedOrders.length },
                  { key: "已取消", count: cancelledOrders.length }
                ].map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setMobileOrderTab(tab.key)}
                    className={`rounded-md px-3 py-2 transition ${mobileOrderTab === tab.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
                  >
                    {tab.key}
                    <span className="ml-2 text-xs text-slate-500">{number.format(tab.count)}</span>
                  </button>
                ))}
              </div>

              <div className="h-[68vh] overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3">
                {(mobileOrderTab === "待處理" ? visiblePendingOrders : mobileOrderTab === "已完成" ? visibleCompletedOrders : visibleCancelledOrders).length === 0 ? (
                  <p className="py-6 text-center text-slate-500">
                    {mobileOrderTab === "待處理" ? "尚無待處理訂單" : mobileOrderTab === "已完成" ? "尚無已完成訂單" : "尚無已取消訂單"}
                  </p>
                ) : (
                  <div className="grid gap-3">
                    {(mobileOrderTab === "待處理" ? visiblePendingOrders : mobileOrderTab === "已完成" ? visibleCompletedOrders : visibleCancelledOrders).map((order) => (
                      <article key={order.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-950">{order.customerName || "-"}</p>
                            <p className="mt-1 text-sm text-slate-500">{order.orderNumber}</p>
                            <p className="mt-1 text-sm text-slate-500">{order.lineName || "-"} · {order.phone || "-"}</p>
                          </div>
                          <span className={`rounded px-2 py-1 text-xs font-medium ${orderStatusTone(order.status)}`}>{orderStatusLabel(order.status)}</span>
                        </div>
                        <div className="mt-3 grid gap-2 text-sm text-slate-600">
                          <p>商品摘要 {orderSummaryText(order)}</p>
                          <p>金額 {currency.format(order.totalAmount)}</p>
                          <p>寄件資料 {orderShippingSummary(order)}</p>
                          <p>建立時間 {new Date(order.createdAt).toLocaleString("zh-TW")}</p>
                        </div>
                        <div className="mt-3 grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <SelectInput
                            value={orderStatusDrafts[order.id] ?? order.status ?? "pending"}
                            onChange={(event) => setOrderStatusDrafts((current) => ({ ...current, [order.id]: event.target.value }))}
                          >
                            {ORDER_STATUS_OPTIONS.map((status) => (
                              <option key={status.value} value={status.value}>{status.label}</option>
                            ))}
                          </SelectInput>
                          <div className="grid grid-cols-2 gap-2">
                            <Button type="button" className="h-11 w-full" onClick={() => updateOrderStatus(order.id, orderStatusDrafts[order.id] ?? order.status ?? "pending")}>
                              調整狀態
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              className="h-11 w-full"
                              onClick={() => setShippingAssistantOrderId((current) => (current === order.id ? null : order.id))}
                            >
                              寄件助手
                            </Button>
                          </div>
                          {shippingAssistantOrderId === order.id && (
                            <ShippingAssistantPanel
                              order={order}
                              onCopyText={copyShippingText}
                              onOpen711={open711Delivery}
                            />
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="hidden gap-4 lg:grid">
              {[
                { title: "待處理", orders: visiblePendingOrders, allOrders: pendingOrders, page: currentPendingOrderPage, pageCount: pendingOrderPageCount, onPageChange: setPendingOrderPage, empty: "尚無待處理訂單" },
                { title: "已完成", orders: visibleCompletedOrders, allOrders: completedOrders, page: currentCompletedOrderPage, pageCount: completedOrderPageCount, onPageChange: setCompletedOrderPage, empty: "尚無已完成訂單" },
                { title: "已取消", orders: visibleCancelledOrders, allOrders: cancelledOrders, page: currentCancelledOrderPage, pageCount: cancelledOrderPageCount, onPageChange: setCancelledOrderPage, empty: "尚無已取消訂單" }
              ].map((block) => (
                <section key={block.title} className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50 shadow-sm">
                  <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-slate-700">{block.title}（{number.format(block.allOrders.length)}）</h3>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{number.format(block.allOrders.length)} 筆</span>
                  </div>
                  <div className="max-h-[22rem] overflow-auto p-4">
                    {block.orders.length === 0 ? (
                      <p className="py-6 text-center text-slate-500">{block.empty}</p>
                    ) : (
                      <table className="min-w-full table-auto text-left text-sm">
                        <thead className="border-b border-slate-200 text-xs text-slate-500">
                          <tr>
                            <th className="py-3 pr-4">日期</th>
                            <th className="py-3 pr-4">訂單編號</th>
                            <th className="py-3 pr-4">客戶名稱</th>
                            <th className="py-3 pr-4">LINE 名稱</th>
                            <th className="py-3 pr-4">電話</th>
                            <th className="py-3 pr-4">商品摘要</th>
                            <th className="py-3 pr-4">數量</th>
                            <th className="py-3 pr-4">金額</th>
                            <th className="py-3 pr-4">訂單狀態</th>
                            <th className="py-3 pr-4">寄件資料</th>
                            <th className="py-3 pr-4">操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {block.orders.map((order) => (
                            <React.Fragment key={order.id}>
                              <tr>
                                <td className="py-3 pr-4 whitespace-nowrap">{new Date(order.createdAt).toLocaleDateString("zh-TW")}</td>
                                <td className="py-3 pr-4 font-medium whitespace-nowrap">{order.orderNumber}</td>
                                <td className="py-3 pr-4 whitespace-nowrap">{order.customerName || "-"}</td>
                                <td className="py-3 pr-4 whitespace-nowrap">{order.lineName || "-"}</td>
                                <td className="py-3 pr-4 whitespace-nowrap">{order.phone || "-"}</td>
                                <td className="py-3 pr-4 font-medium">{orderSummaryText(order)}</td>
                                <td className="py-3 pr-4 whitespace-nowrap">{number.format(order.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0))}</td>
                                <td className="py-3 pr-4 font-semibold whitespace-nowrap">{currency.format(order.totalAmount)}</td>
                                <td className="py-3 pr-4">
                                  <span className={`rounded px-2 py-1 text-xs font-medium ${orderStatusTone(order.status)}`}>
                                    {orderStatusLabel(order.status)}
                                  </span>
                                </td>
                                <td className="py-3 pr-4">
                                  <div className="max-w-[18rem] truncate text-slate-600" title={buildShippingAssistantText(order)}>
                                    {orderShippingSummary(order)}
                                  </div>
                                </td>
                                <td className="py-3 pr-4 align-top">
                                  <div className="grid min-w-44 gap-2">
                                    <SelectInput
                                      value={orderStatusDrafts[order.id] ?? order.status ?? "pending"}
                                      onChange={(event) => setOrderStatusDrafts((current) => ({ ...current, [order.id]: event.target.value }))}
                                    >
                                      {ORDER_STATUS_OPTIONS.map((status) => (
                                        <option key={status.value} value={status.value}>{status.label}</option>
                                      ))}
                                    </SelectInput>
                                    <div className="grid gap-2">
                                      <Button type="button" className="h-10 w-full" onClick={() => updateOrderStatus(order.id, orderStatusDrafts[order.id] ?? order.status ?? "pending")}>
                                        調整狀態
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="secondary"
                                        className="h-10 w-full"
                                        onClick={() => setShippingAssistantOrderId((current) => (current === order.id ? null : order.id))}
                                      >
                                        寄件助手
                                      </Button>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                              {shippingAssistantOrderId === order.id && (
                                <tr>
                                  <td colSpan={11} className="bg-slate-50 px-4 pb-4">
                                    <ShippingAssistantPanel
                                      order={order}
                                      onCopyText={copyShippingText}
                                      onOpen711={open711Delivery}
                                    />
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                  <PaginationFooter
                    page={block.page}
                    pageCount={block.pageCount}
                    onPageChange={block.onPageChange}
                    summary={`每頁 ${LIST_PAGE_SIZE} 筆，目前顯示 ${number.format(block.orders.length)} 筆，第 ${number.format(block.page)} / ${number.format(block.pageCount)} 頁`}
                  />
                </section>
              ))}
            </div>
          </section>

          {isAdmin && (
            <section id="員工管理" className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              <button
                type="button"
                onClick={() => setEmployeeOpen((current) => !current)}
                aria-expanded={employeeOpen}
                className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold text-slate-950">員工管理</h2>
                  <p className="mt-1 text-sm text-slate-500">員工總數 {number.format(employees.length)} 筆</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{number.format(employees.length)} 筆</span>
                  <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform duration-300 ${employeeOpen ? "rotate-180" : ""}`} />
                </div>
              </button>
              <div
                className="overflow-hidden transition-[max-height,opacity] duration-300 ease-out"
                style={{ maxHeight: employeeOpen ? "3000px" : "0px", opacity: employeeOpen ? 1 : 0 }}
                aria-hidden={!employeeOpen}
              >
                <div className="border-t border-slate-200 px-4 py-4">
                  <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(280px,0.75fr)_minmax(0,1.25fr)]">
                    <form onSubmit={submitEmployee} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="mb-4 flex items-center gap-2">
                        <UserRound className="h-5 w-5 text-slate-700" />
                        <h2 className="text-lg font-semibold">新增員工</h2>
                      </div>
                      <div className="grid gap-3">
                        <TextInput
                          required
                          placeholder="username"
                          value={employeeForm.username}
                          onChange={(e) => setEmployeeForm({ ...employeeForm, username: e.target.value })}
                        />
                        <TextInput
                          required
                          placeholder="員工名稱"
                          value={employeeForm.name}
                          onChange={(e) => setEmployeeForm({ ...employeeForm, name: e.target.value })}
                        />
                        <TextInput
                          required
                          placeholder="顯示名稱"
                          value={employeeForm.displayName}
                          onChange={(e) => setEmployeeForm({ ...employeeForm, displayName: e.target.value })}
                        />
                        <SelectInput value={employeeForm.role} onChange={(e) => setEmployeeForm({ ...employeeForm, role: e.target.value })}>
                          <option value="admin">admin</option>
                          <option value="clerk">clerk</option>
                        </SelectInput>
                        <TextInput
                          required
                          type="password"
                          minLength="6"
                          placeholder="初始密碼，至少 6 碼"
                          value={employeeForm.password}
                          onChange={(e) => setEmployeeForm({ ...employeeForm, password: e.target.value })}
                        />
                        <label className="flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={employeeForm.isActive}
                            onChange={(e) => setEmployeeForm({ ...employeeForm, isActive: e.target.checked })}
                          />
                          啟用帳號
                        </label>
                        <div className="flex gap-2">
                          <Button type="submit">建立員工</Button>
                        </div>
                      </div>
                    </form>

                    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="mb-4 flex items-center gap-2">
                        <UserRound className="h-5 w-5 text-slate-700" />
                        <h2 className="text-lg font-semibold">所有員工</h2>
                      </div>
                      <div className="hidden overflow-x-auto lg:block">
                        <table className="min-w-full table-auto text-left text-sm">
                          <thead className="border-b border-slate-200 text-xs text-slate-500">
                            <tr>
                              <th className="py-3 pr-4">username</th>
                              <th className="py-3 pr-4">name</th>
                              <th className="py-3 pr-4">displayName</th>
                              <th className="py-3 pr-4">role</th>
                              <th className="py-3 pr-4">狀態</th>
                              <th className="py-3 pr-4">createdAt</th>
                              <th className="py-3 pr-4">updatedAt</th>
                              <th className="py-3">操作</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {employees.map((employee) => {
                              const isEditingEmployee = editingEmployeeId === employee.id;
                              return (
                                <tr key={employee.id}>
                                  <td className="py-3 pr-4 font-mono text-xs">{employee.username}</td>
                                  <td className="py-3 pr-4">
                                    {isEditingEmployee ? (
                                      <TextInput
                                        required
                                        value={employeeDraft?.name ?? ""}
                                        onChange={(e) => setEmployeeDraft((current) => ({ ...current, name: e.target.value }))}
                                      />
                                    ) : (
                                      employee.name
                                    )}
                                  </td>
                                  <td className="py-3 pr-4">
                                    {isEditingEmployee ? (
                                      <TextInput
                                        required
                                        value={employeeDraft?.displayName ?? ""}
                                        onChange={(e) => setEmployeeDraft((current) => ({ ...current, displayName: e.target.value }))}
                                      />
                                    ) : (
                                      employee.displayName
                                    )}
                                  </td>
                                  <td className="py-3 pr-4">
                                    {isEditingEmployee ? (
                                      <SelectInput
                                        value={employeeDraft?.role ?? "clerk"}
                                        onChange={(e) => setEmployeeDraft((current) => ({ ...current, role: e.target.value }))}
                                      >
                                        <option value="admin">admin</option>
                                        <option value="clerk">clerk</option>
                                      </SelectInput>
                                    ) : (
                                      <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{employee.role}</span>
                                    )}
                                  </td>
                                  <td className="py-3 pr-4">
                                    <span className={`rounded px-2 py-1 text-xs font-medium ${employee.isActive ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                                      {employee.isActive ? "啟用" : "停用"}
                                    </span>
                                  </td>
                                  <td className="py-3 pr-4">{new Date(employee.createdAt).toLocaleDateString("zh-TW")}</td>
                                  <td className="py-3 pr-4">{new Date(employee.updatedAt).toLocaleDateString("zh-TW")}</td>
                                  <td className="py-3">
                                    {isEditingEmployee ? (
                                      <div className="flex flex-wrap gap-2">
                                        <Button type="button" onClick={() => saveEmployeeEdit(employee)}>
                                          儲存
                                        </Button>
                                        <Button type="button" variant="secondary" onClick={cancelEmployeeEdit}>
                                          取消
                                        </Button>
                                      </div>
                                    ) : (
                                      <>
                                        <div className="flex flex-wrap gap-2">
                                          <Button type="button" variant="secondary" onClick={() => editEmployee(employee)}>
                                            <Edit3 className="h-4 w-4" />
                                          </Button>
                                          <Button type="button" variant="secondary" onClick={() => toggleEmployeeStatus(employee)}>
                                            {employee.isActive ? "停用" : "啟用"}
                                          </Button>
                                          <Button type="button" variant="danger" disabled={employee.id === auth.user.id} onClick={() => deleteEmployee(employee)}>
                                            <Trash2 className="h-4 w-4" />
                                          </Button>
                                        </div>
                                        <div className="mt-2 flex gap-2">
                                          <TextInput
                                            type="password"
                                            minLength="6"
                                            placeholder="新密碼"
                                            value={passwordByUser[employee.id] ?? ""}
                                            onChange={(e) => setPasswordByUser((current) => ({ ...current, [employee.id]: e.target.value }))}
                                          />
                                          <Button type="button" variant="secondary" onClick={() => updateEmployeePassword(employee)}>
                                            改密碼
                                          </Button>
                                        </div>
                                      </>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div className="grid gap-3 lg:hidden">
                        {employees.map((employee) => (
                          <article key={employee.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-semibold">{employee.displayName || employee.name}</p>
                                <p className="mt-1 text-sm text-slate-500">{employee.username} · {employee.role}</p>
                              </div>
                              <span className={`rounded px-2 py-1 text-xs font-medium ${employee.isActive ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                                {employee.isActive ? "啟用" : "停用"}
                              </span>
                            </div>
                            <div className="mt-3 grid grid-cols-3 gap-2">
                              <Button type="button" variant="secondary" onClick={() => editEmployee(employee)}>
                                <Edit3 className="h-4 w-4" />
                              </Button>
                              <Button type="button" variant="secondary" onClick={() => toggleEmployeeStatus(employee)}>
                                {employee.isActive ? "停用" : "啟用"}
                              </Button>
                              <Button type="button" variant="danger" disabled={employee.id === auth.user.id} onClick={() => deleteEmployee(employee)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </article>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {isAdmin && (
            <section id="系統備份" className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              <button
                type="button"
                className="flex w-full flex-col gap-3 px-4 py-4 text-left transition hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between"
                aria-expanded={backupOpen}
                onClick={() => setBackupOpen((open) => !open)}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-700">
                    <Database className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-slate-950">系統備份</h2>
                    <p className="mt-1 text-sm text-slate-500">最近一次備份時間：{latestBackupTime}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                  <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">備份總數：{backups.length} 筆</span>
                  <span className="grid h-10 w-10 place-items-center rounded-md border border-slate-200 text-slate-600">
                    {backupOpen ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                  </span>
                </div>
              </button>

              {backupOpen && (
                <div className="border-t border-slate-200 p-4">
                  <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button type="button" variant="danger" disabled={clearingDemoData} onClick={clearDemoData}>
                    <AlertTriangle className="h-4 w-4" />
                    {clearingDemoData ? "清除中..." : "清除測試資料"}
                  </Button>
                  <Button type="button" onClick={createBackup}>
                    <Database className="h-4 w-4" />
                    立即備份
                  </Button>
                </div>

                  <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    還原會覆蓋目前 PostgreSQL 資料庫中的員工、商品與銷售資料。備份檔只可透過管理員 API 操作，不提供公開下載。
                  </div>
                  <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                    清除測試資料會先自動建立備份，接著移除預設商品、庫存、銷售紀錄、報表資料與測試操作紀錄；不會清空 users 表或刪除 admin、clerk、員工帳號。
                  </div>

                  <div className="mb-4 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-slate-100"
                      aria-expanded={deletedProductsOpen}
                      onClick={() => setDeletedProductsOpen((open) => !open)}
                    >
                      <div className="min-w-0">
                        <h3 className="text-base font-semibold text-slate-900">已刪除商品列表</h3>
                        <p className="mt-1 text-sm text-slate-500">包含 soft delete 的商品，預設收起，不佔用主要版面。</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="rounded bg-white px-2 py-1 text-xs font-medium text-slate-600">{filteredDeletedProducts.length} 筆</span>
                        <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform duration-300 ${deletedProductsOpen ? "rotate-180" : ""}`} />
                      </div>
                    </button>
                    <div
                      className="overflow-hidden transition-[max-height,opacity] duration-300 ease-out"
                      style={{ maxHeight: deletedProductsOpen ? "3000px" : "0px", opacity: deletedProductsOpen ? 1 : 0 }}
                      aria-hidden={!deletedProductsOpen}
                    >
                      <div className="border-t border-slate-200 px-4 py-4">
                        <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(220px,1fr)_180px]">
                          <div className="relative min-w-0">
                            <Search className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
                            <input
                              value={deletedProductSearch}
                              onChange={(event) => setDeletedProductSearch(event.target.value)}
                              placeholder="搜尋已刪除商品"
                              className="h-12 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-base outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 sm:h-10 sm:text-sm"
                            />
                          </div>
                          <div className="flex items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500">
                            顯示 {number.format(filteredDeletedProducts.length)} 筆已刪除商品
                          </div>
                        </div>

                        <div className="hidden overflow-x-auto lg:block">
                          <table className="min-w-full table-auto text-left text-sm">
                            <thead className="border-b border-slate-200 text-xs text-slate-500">
                              <tr>
                                <th className="py-3 pr-4">商品名稱</th>
                                <th className="py-3 pr-4">商品類型</th>
                                <th className="py-3 pr-4">刪除時間</th>
                                <th className="py-3 pr-4">刪除人</th>
                                <th className="py-3">操作</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {filteredDeletedProducts.map((product) => (
                                <tr key={product.id}>
                                  <td className="py-3 pr-4 font-medium">{product.name}</td>
                                  <td className="py-3 pr-4">
                                    <span className={`rounded px-2 py-1 text-xs font-medium ${productTypeTone(product.productType)}`}>
                                      {productTypeLabel(product.productType)}
                                    </span>
                                  </td>
                                  <td className="py-3 pr-4">{product.deletedAt ? new Date(product.deletedAt).toLocaleString("zh-TW") : "-"}</td>
                                  <td className="py-3 pr-4">{product.deletedByName ?? "-"}</td>
                                  <td className="py-3">
                                    <Button type="button" variant="secondary" onClick={() => restoreProduct(product)}>
                                      <RotateCcw className="h-4 w-4" />
                                      還原
                                    </Button>
                                  </td>
                                </tr>
                              ))}
                              {filteredDeletedProducts.length === 0 && (
                                <tr>
                                  <td className="py-6 text-center text-slate-500" colSpan="5">尚無已刪除商品</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>

                        <div className="grid gap-3 lg:hidden">
                          {filteredDeletedProducts.map((product) => (
                            <article key={product.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate font-semibold">{product.name}</p>
                                  <p className="mt-1 text-sm text-slate-500">{productTypeLabel(product.productType)}</p>
                                  <p className="mt-1 text-sm text-slate-500">{product.deletedAt ? new Date(product.deletedAt).toLocaleString("zh-TW") : "-"}</p>
                                  <p className="mt-1 text-xs text-slate-500">{product.deletedByName ?? "-"}</p>
                                </div>
                                <Button type="button" variant="secondary" onClick={() => restoreProduct(product)}>
                                  <RotateCcw className="h-4 w-4" />
                                  還原
                                </Button>
                              </div>
                            </article>
                          ))}
                          {filteredDeletedProducts.length === 0 && <p className="py-6 text-center text-slate-500">尚無已刪除商品</p>}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="hidden overflow-x-auto lg:block">
                <table className="min-w-full table-auto text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs text-slate-500">
                    <tr>
                      <th className="py-3 pr-4">檔名</th>
                      <th className="py-3 pr-4">建立時間</th>
                      <th className="py-3 pr-4">檔案大小</th>
                      <th className="py-3 pr-4">備份類型</th>
                      <th className="py-3">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {backups.map((backup) => (
                      <tr key={backup.filename}>
                        <td className="py-3 pr-4 font-mono text-xs">{backup.filename}</td>
                        <td className="py-3 pr-4">{new Date(backup.createdAt).toLocaleString("zh-TW")}</td>
                        <td className="py-3 pr-4">{formatBytes(backup.size)}</td>
                        <td className="py-3 pr-4">
                          <span className={`rounded px-2 py-1 text-xs font-medium ${backup.type === "auto" ? "bg-indigo-50 text-indigo-700" : "bg-teal-50 text-teal-700"}`}>
                            {backup.type}
                          </span>
                        </td>
                        <td className="py-3">
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" variant="secondary" onClick={() => restoreBackup(backup)}>
                              <RotateCcw className="h-4 w-4" />
                              還原
                            </Button>
                            <Button type="button" variant="danger" onClick={() => deleteBackup(backup)}>
                              <Trash2 className="h-4 w-4" />
                              刪除
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {backups.length === 0 && (
                      <tr>
                        <td className="py-6 text-center text-slate-500" colSpan="5">尚無備份紀錄</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
                  <div className="grid gap-3 lg:hidden">
                {backups.map((backup) => (
                  <article key={backup.filename} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-xs">{backup.filename}</p>
                        <p className="mt-1 text-sm text-slate-500">{new Date(backup.createdAt).toLocaleString("zh-TW")} · {formatBytes(backup.size)}</p>
                      </div>
                      <span className={`rounded px-2 py-1 text-xs font-medium ${backup.type === "auto" ? "bg-indigo-50 text-indigo-700" : "bg-teal-50 text-teal-700"}`}>
                        {backup.type}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Button type="button" variant="secondary" onClick={() => restoreBackup(backup)}>
                        <RotateCcw className="h-4 w-4" />
                        還原
                      </Button>
                      <Button type="button" variant="danger" onClick={() => deleteBackup(backup)}>
                        <Trash2 className="h-4 w-4" />
                        刪除
                      </Button>
                    </div>
                  </article>
                ))}
                {backups.length === 0 && <p className="py-6 text-center text-slate-500">尚無備份紀錄</p>}
              </div>
                </div>
              )}
            </section>
          )}

          <section id="操作紀錄" className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <button
              type="button"
              className="flex w-full flex-col gap-3 px-4 py-4 text-left transition hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between"
              aria-expanded={auditOpen}
              onClick={toggleAuditLogs}
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-700">
                  <History className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-slate-950">操作紀錄</h2>
                  <p className="mt-1 text-sm text-slate-500">最新操作時間：{latestAuditTime}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">操作筆數：{auditLoaded ? `${auditLogs.length} 筆` : "尚未載入"}</span>
                <span className="grid h-10 w-10 place-items-center rounded-md border border-slate-200 text-slate-600">
                  {auditOpen ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                </span>
              </div>
            </button>

            {auditOpen && (
              <div className="border-t border-slate-200 p-4">
                {auditLoading ? (
                  <p className="py-6 text-center text-slate-500">載入操作紀錄中...</p>
                ) : (
                  <>
                    <div className="hidden overflow-x-auto lg:block">
                      <table className="min-w-full table-auto text-left text-sm">
                        <thead className="border-b border-slate-200 text-xs text-slate-500">
                          <tr>
                            <th className="py-3 pr-4">時間</th>
                            <th className="py-3 pr-4">操作者</th>
                            <th className="py-3 pr-4">操作</th>
                            <th className="py-3 pr-4">資料類型</th>
                            <th className="py-3 pr-4">狀態</th>
                            <th className="py-3">摘要</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {auditLogs.map((log) => {
                            const beforeName = log.beforeData?.name || log.beforeData?.sale?.id || log.beforeData?.username || log.beforeData?.product?.name;
                            const afterName = log.afterData?.name || log.afterData?.sale?.id || log.afterData?.username || log.afterData?.product?.name;
                            return (
                              <tr key={log.id}>
                                <td className="py-3 pr-4">{new Date(log.createdAt).toLocaleString("zh-TW")}</td>
                                <td className="py-3 pr-4">{log.username}</td>
                                <td className="py-3 pr-4">{actionLabels[log.actionType] ?? log.actionType}</td>
                                <td className="py-3 pr-4">{entityLabels[log.entityType] ?? log.entityType}</td>
                                <td className="py-3 pr-4">
                                  <span className={`rounded px-2 py-1 text-xs font-medium ${log.undoneAt ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700"}`}>
                                    {log.undoneAt ? "已還原" : "可還原"}
                                  </span>
                                </td>
                                <td className="py-3 text-slate-600">{beforeName || afterName || `#${log.id}`}</td>
                              </tr>
                            );
                          })}
                          {auditLogs.length === 0 && (
                            <tr>
                              <td className="py-6 text-center text-slate-500" colSpan="6">尚無操作紀錄</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <div className="grid gap-3 lg:hidden">
                      {auditLogs.map((log) => {
                        const beforeName = log.beforeData?.name || log.beforeData?.sale?.id || log.beforeData?.username || log.beforeData?.product?.name;
                        const afterName = log.afterData?.name || log.afterData?.sale?.id || log.afterData?.username || log.afterData?.product?.name;
                        return (
                          <article key={log.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-semibold">{actionLabels[log.actionType] ?? log.actionType} {entityLabels[log.entityType] ?? log.entityType}</p>
                                <p className="mt-1 text-sm text-slate-500">{log.username} · {new Date(log.createdAt).toLocaleString("zh-TW")}</p>
                              </div>
                              <span className={`rounded px-2 py-1 text-xs font-medium ${log.undoneAt ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700"}`}>
                                {log.undoneAt ? "已還原" : "可還原"}
                              </span>
                            </div>
                            <p className="mt-2 text-sm text-slate-600">{beforeName || afterName || `#${log.id}`}</p>
                          </article>
                        );
                      })}
                      {auditLogs.length === 0 && <p className="py-6 text-center text-slate-500">尚無操作紀錄</p>}
                    </div>
                  </>
                )}
              </div>
            )}
          </section>

          {mobileDrawer && (
            <BottomDrawer
              open={Boolean(mobileDrawer)}
              title={mobileDrawer.type === "order" ? `訂單 ${mobileDrawer.order.orderNumber}` : mobileDrawer.product?.name ?? "商品"}
              onClose={() => setMobileDrawer(null)}
              footer={
                mobileDrawer.type === "order-product" ? (
                  <Button
                    type="button"
                    className="w-full"
                    onClick={() => {
                      addOrderItem(mobileDrawer.product, selectedOrderQuantity);
                      setMobileDrawer(null);
                    }}
                  >
                    加入訂單
                  </Button>
                ) : mobileDrawer.type === "product" ? (
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Button
                      type="button"
                      className="w-full"
                      disabled={mobileDrawer.product.stock <= 0}
                      onClick={() => {
                        addOrderItem(mobileDrawer.product, 1);
                        setMobileDrawer(null);
                      }}
                    >
                      加到訂單
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={!isAdmin}
                      className="w-full"
                      onClick={() => {
                        editProduct(mobileDrawer.product);
                        setMobileDrawer(null);
                        scrollToSection("商品庫存");
                      }}
                    >
                      編輯
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      disabled={!isAdmin}
                      className="w-full"
                      onClick={() => {
                        deleteProduct(mobileDrawer.product);
                        setMobileDrawer(null);
                      }}
                    >
                      刪除
                    </Button>
                  </div>
                ) : mobileDrawer.type === "order" && orderStatusKey(mobileDrawer.order.status) === "pending" ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button
                      type="button"
                      className="w-full"
                      onClick={() => {
                        updateOrderStatus(mobileDrawer.order.id, "completed");
                        setMobileDrawer(null);
                      }}
                    >
                      已完成
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      className="w-full"
                      onClick={() => {
                        updateOrderStatus(mobileDrawer.order.id, "cancelled");
                        setMobileDrawer(null);
                      }}
                    >
                      已取消
                    </Button>
                  </div>
                ) : null
              }
            >
              {mobileDrawer.type === "order-product" && (
                <div className="grid gap-4">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-950">{mobileDrawer.product.name}</p>
                        <p className="mt-1 text-sm text-slate-500">{mobileDrawer.product.series}</p>
                      </div>
                      {mobileDrawer.product.productType === "graded" && <span className="rounded bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700">{productBadgeLabel(mobileDrawer.product)}</span>}
                    </div>
                    <div className="mt-3 grid gap-2 text-sm text-slate-600">
                      <p>售價：{currency.format(mobileDrawer.product.price)}</p>
                      <p>庫存：{formatStock(mobileDrawer.product)}</p>
                    </div>
                  </div>
                  <label className="grid gap-1 text-sm font-medium text-slate-600">
                    數量
                    <div className="grid grid-cols-[48px_minmax(0,1fr)_48px] gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-12 w-full px-0"
                        onClick={() => setSelectedOrderQuantity((current) => Math.max(1, current - 1))}
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                      <input
                        type="number"
                        min="1"
                        max={mobileDrawer.product.stock}
                        value={selectedOrderQuantity}
                        onChange={(event) => setSelectedOrderQuantity(Math.max(1, Math.min(mobileDrawer.product.stock, Number(event.target.value) || 1)))}
                        className="h-12 w-full rounded-md border border-slate-300 bg-white px-3 text-center text-base outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-12 w-full px-0"
                        onClick={() => setSelectedOrderQuantity((current) => Math.min(mobileDrawer.product.stock, current + 1))}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </label>
                </div>
              )}

              {mobileDrawer.type === "product" && (
                <div className="grid gap-4">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-950">{mobileDrawer.product.name}</p>
                        <p className="mt-1 text-sm text-slate-500">{mobileDrawer.product.series}</p>
                      </div>
                      {mobileDrawer.product.productType === "graded" && <span className="rounded bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700">{productBadgeLabel(mobileDrawer.product)}</span>}
                    </div>
                    <div className="mt-3 grid gap-2 text-sm text-slate-600">
                      <p>商品類型：{productTypeLabel(mobileDrawer.product.productType)}</p>
                      <p>Grade：{mobileDrawer.product.productType === "graded" ? mobileDrawer.product.grade : "-"}</p>
                      <p>售價：{currency.format(mobileDrawer.product.price)}</p>
                      <p>庫存：{formatStock(mobileDrawer.product)}</p>
                      <p>包裝規格：{mobileDrawer.product.packageSpec}</p>
                      {mobileDrawer.product.notes && <p>備註：{mobileDrawer.product.notes}</p>}
                    </div>
                  </div>
                </div>
              )}

              {mobileDrawer.type === "order" && (
                <div className="grid gap-4">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-950">{mobileDrawer.order.orderNumber}</p>
                        <p className="mt-1 text-sm text-slate-500">{mobileDrawer.order.customerName || "-"}</p>
                      </div>
                      <span className={`rounded px-2 py-1 text-xs font-medium ${orderStatusTone(mobileDrawer.order.status)}`}>{orderStatusLabel(mobileDrawer.order.status)}</span>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm text-slate-600">
                      <p>LINE 名稱：{mobileDrawer.order.lineName || "-"}</p>
                      <p>電話：{mobileDrawer.order.phone || "-"}</p>
                      <p>7-11 門市：{mobileDrawer.order.shippingInfo || "-"}</p>
                      <p>訂單總額：{currency.format(mobileDrawer.order.totalAmount)}</p>
                      <p>建立時間：{new Date(mobileDrawer.order.createdAt).toLocaleString("zh-TW")}</p>
                    </div>
                  </div>
                  <div className="grid gap-2">
                    {mobileDrawer.order.items.map((item) => (
                      <div key={item.id} className="rounded-lg border border-slate-200 bg-white p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="min-w-0 truncate font-medium">{item.productName}</span>
                          <span className="shrink-0 text-sm text-slate-600">x{item.quantity}</span>
                        </div>
                        <p className="mt-1 text-sm text-slate-500">{currency.format(item.subtotal)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </BottomDrawer>
          )}

          <div
            className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-3 pt-2 backdrop-blur lg:hidden"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
          >
            <div className="mx-auto grid w-full max-w-4xl gap-2">
              <div className="grid grid-cols-4 gap-2">
                <Button type="button" variant="secondary" className="h-14 flex-col px-2 text-[11px]" onClick={() => scrollToSection("商品庫存")}>
                  <Boxes className="h-4 w-4" />
                  商品庫存
                </Button>
                <Button type="button" variant="secondary" className="h-14 flex-col px-2 text-[11px]" onClick={() => scrollToSection("快速下單")}>
                  <ShoppingCart className="h-4 w-4" />
                  快速下單
                </Button>
                <Button type="button" variant="secondary" className="h-14 flex-col px-2 text-[11px]" onClick={() => scrollToSection("進貨管理")}>
                  <PackagePlus className="h-4 w-4" />
                  進貨管理
                </Button>
                <Button type="button" variant="secondary" className="h-14 flex-col px-2 text-[11px]" onClick={() => scrollToSection("訂單管理")}>
                  <History className="h-4 w-4" />
                  訂單管理
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Button
                  type="button"
                  className="h-14 px-2 text-[11px]"
                  disabled={!isAdmin || (productCreateTab === "import" ? !importCsv.trim() : false)}
                  onClick={() => {
                    if (productCreateTab === "import") {
                      importProducts();
                      return;
                    }
                    productFormRef.current?.requestSubmit();
                  }}
                >
                  <PackagePlus className="h-4 w-4" />
                  {productCreateTab === "import" ? "匯入商品" : editingId ? "儲存商品" : "建立商品"}
                </Button>
                <Button type="button" className="h-14 px-2 text-[11px]" disabled={creatingOrder || orderItems.length === 0} onClick={createOrder}>
                  <ShoppingCart className="h-4 w-4" />
                  {creatingOrder ? "建立中..." : "建立訂單"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-14 px-2 text-[11px]"
                  disabled={!isAdmin}
                  onClick={() => purchaseFormRef.current?.requestSubmit()}
                >
                  <PackagePlus className="h-4 w-4" />
                  {editingPurchaseId ? "儲存進貨單" : "建立進貨單"}
                </Button>
              </div>
            </div>
          </div>

        </div>
      </main>

    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
