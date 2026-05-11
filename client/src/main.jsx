import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  CalendarDays,
  Database,
  Edit3,
  LogOut,
  ExternalLink,
  History,
  Menu,
  Minus,
  PackagePlus,
  Plus,
  Search,
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

function formatStock(product) {
  return `${number.format(product.stock ?? 0)} ${product.unit ?? "單張"}`;
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
  user: "員工",
  inventory: "庫存"
};

async function api(path, options = {}) {
  const auth = authFromStorage();
  const response = await fetch(`${API_BASE_URL}/api${path}`, {
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

const emptyProduct = {
  name: "",
  series: "",
  rarity: "RR",
  condition: "近全新",
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

function Login({ onLogin }) {
  const [form, setForm] = useState({ username: "admin", password: "admin123" });
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    try {
      const result = await fetch(`${API_BASE_URL}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      }).then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).message);
        return response.json();
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
  const [products, setProducts] = useState([]);
  const [deletedProducts, setDeletedProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [backups, setBackups] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [profitReport, setProfitReport] = useState(null);
  const [syncingSheet, setSyncingSheet] = useState(false);
  const [clearingDemoData, setClearingDemoData] = useState(false);
  const [loading, setLoading] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState("");
  const [undoing, setUndoing] = useState(false);
  const [query, setQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [quickSaleItems, setQuickSaleItems] = useState([]);
  const [error, setError] = useState("");
  const [productForm, setProductForm] = useState(emptyProduct);
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
    [ShoppingCart, "銷售管理"],
    [History, "操作紀錄"],
    ...(isAdmin ? [[UserRound, "員工管理"], [Database, "系統備份"]] : [])
  ]), [isAdmin]);

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

  const load = async () => {
    if (!auth?.token) return;
    setLoading(true);
    const saleQuery = `?from=${dateRange.from}&to=${dateRange.to}`;
    try {
      const [productRows, deletedProductRows, saleRows, dashboardRow, profitRow, employeeRows, backupRows, auditRows] = await Promise.all([
        api(`/products?q=${encodeURIComponent(query)}`),
        isAdmin ? api("/products/deleted").catch(() => []) : Promise.resolve([]),
        api(`/sales${saleQuery}`),
        api("/dashboard"),
        api("/profit-report"),
        isAdmin ? api("/users") : Promise.resolve([]),
        isAdmin ? api("/backups").catch(() => []) : Promise.resolve([]),
        api("/audit-logs").catch(() => [])
      ]);
      setProducts(productRows);
      setDeletedProducts(deletedProductRows);
      setSales(saleRows);
      setDashboard(dashboardRow);
      setProfitReport(profitRow);
      setEmployees(employeeRows);
      setBackups(backupRows);
      setAuditLogs(auditRows);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [auth, query, dateRange.from, dateRange.to]);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(searchInput), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

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

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === Number(saleForm.productId)),
    [products, saleForm.productId]
  );
  const visibleProducts = useMemo(() => products.slice(0, 80), [products]);
  const quickSaleProducts = useMemo(() => products.filter((product) => product.stock > 0).slice(0, 12), [products]);
  const quickSaleTotal = useMemo(
    () => quickSaleItems.reduce((sum, item) => sum + item.quantity * Number(item.product.price || 0), 0),
    [quickSaleItems]
  );

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
        await load();
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
        await load();
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
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const editProduct = (product) => {
    setEditingId(product.id);
    productAutosaveReady.current = false;
    setProductForm({
      name: product.name,
      series: product.series,
      rarity: product.rarity,
      condition: product.condition,
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
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const restoreProduct = async (product) => {
    if (!window.confirm(`確定還原「${product.name}」？`)) return;
    try {
      await api(`/products/${product.id}/restore`, { method: "PATCH", body: JSON.stringify({}) });
      setAutoSaveStatus("已還原商品");
      await load();
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
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const addQuickSaleItem = (product) => {
    setQuickSaleItems((current) => {
      const existing = current.find((item) => item.product.id === product.id);
      if (existing) {
        return current.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: Math.min(item.quantity + 1, product.stock) }
            : item
        );
      }
      return [...current, { product, quantity: 1 }];
    });
  };

  const updateQuickSaleQuantity = (productId, delta) => {
    setQuickSaleItems((current) =>
      current
        .map((item) =>
          item.product.id === productId
            ? { ...item, quantity: Math.max(0, Math.min(item.quantity + delta, item.product.stock)) }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const checkoutQuickSale = async () => {
    if (quickSaleItems.length === 0) return;
    setError("");
    try {
      for (const item of quickSaleItems) {
        await api("/sales", {
          method: "POST",
          body: JSON.stringify({
            productId: item.product.id,
            quantity: item.quantity,
            saleUnit: item.product.unit,
            cardsPerUnit: item.product.cardsPerUnit,
            unitPrice: item.product.price,
            soldAt: new Date().toISOString().slice(0, 10)
          })
        });
      }
      setQuickSaleItems([]);
      setAutoSaveStatus("已自動儲存");
      await load();
    } catch (err) {
      setError(err.message);
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
      await load();
      window.alert(`已匯入 ${result.imported} 筆商品`);
    } catch (err) {
      setError(err.message);
    }
  };

  const voidSale = async (sale) => {
    if (!window.confirm(`確定作廢銷售紀錄 #${sale.id}？作廢後會自動補回庫存，銷售紀錄仍會保留。`)) return;
    try {
      await api(`/sales/${sale.id}/void`, { method: "POST", body: JSON.stringify({}) });
      setAutoSaveStatus("已自動儲存");
      await load();
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
      await load();
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
      await load();
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
      await load();
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
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const syncGoogleSheet = async () => {
    setError("");
    setSyncingSheet(true);
    try {
      const result = await api("/reports/google-sync", { method: "POST", body: JSON.stringify({}) });
      await load();
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
      await load();
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
      await load();
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
      setQuickSaleItems([]);
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

  if (!auth?.token) return <Login onLogin={setAuth} />;

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-100 pb-44 text-slate-900 lg:pb-0">
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
                <StatCard icon={BarChart3} label="本月營業額" value={currency.format(dashboard?.monthRevenue ?? 0)} detail="當月銷售總額" tone="bg-indigo-50 text-indigo-700" />
                <StatCard icon={ShoppingCart} label="總銷售量" value={`${number.format(dashboard?.totalSalesQuantity ?? 0)} 單位`} detail="所有銷售紀錄累計" tone="bg-amber-50 text-amber-700" />
                <StatCard icon={Boxes} label="低庫存商品數" value={number.format(dashboard?.lowStockCount ?? 0)} detail={`庫存總量 ${number.format(dashboard?.totalStock ?? 0)} 單位`} tone="bg-rose-50 text-rose-700" />
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

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard icon={CalendarDays} label="今日成本" value={currency.format(profitReport?.summary?.todayCost ?? 0)} detail="依今日銷售成本計算" tone="bg-slate-50 text-slate-700" />
              <StatCard icon={TrendingUp} label="今日毛利" value={currency.format(profitReport?.summary?.todayProfit ?? 0)} detail="今日營業額扣除成本" tone="bg-emerald-50 text-emerald-700" />
              <StatCard icon={BarChart3} label="今日毛利率" value={`${number.format(profitReport?.summary?.todayMarginRate ?? 0)}%`} detail="毛利 / 營業額" tone="bg-cyan-50 text-cyan-700" />
              <StatCard icon={TrendingUp} label="本月毛利" value={currency.format(profitReport?.summary?.monthProfit ?? 0)} detail={`本月營業額 ${currency.format(profitReport?.summary?.monthRevenue ?? 0)}`} tone="bg-indigo-50 text-indigo-700" />
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <div>
                <h3 className="mb-3 font-semibold text-slate-900">熱銷商品排行</h3>
                <div className="space-y-3">
                  {(profitReport?.hotRankingRows ?? []).slice(0, 5).map((item) => (
                    <div key={`${item.rank}-${item.productName}`} className="flex items-center justify-between rounded-md border border-slate-200 p-3">
                      <div>
                        <p className="font-medium">{item.rank}. {item.productName}</p>
                        <p className="text-sm text-slate-500">毛利率 {number.format(item.marginRate)}%</p>
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
              <div className="mb-4 flex items-center gap-2">
                <Warehouse className="h-5 w-5 text-slate-700" />
                <h2 className="text-lg font-semibold">商品庫存總覽</h2>
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

            <div className="grid min-w-0 max-w-full gap-6 md:grid-cols-[minmax(280px,40%)_minmax(0,60%)] lg:grid-cols-[minmax(300px,35%)_minmax(0,65%)] xl:grid-cols-[minmax(340px,35%)_minmax(0,65%)]">
              <form onSubmit={submitProduct} className="min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm lg:sticky lg:top-24 lg:max-h-[calc(100vh-8rem)] lg:overflow-hidden">
                <div className="border-b border-slate-200 px-4 py-4">
                  <div className="flex items-center gap-2">
                    <PackagePlus className="h-5 w-5 text-slate-700" />
                    <h3 className="text-base font-semibold">{editingId ? "編輯商品" : "新增商品"}</h3>
                  </div>
                  {!isAdmin && <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">店員可查看庫存與新增銷售，但不能新增、編輯或刪除商品。</p>}
                </div>

                <div className="grid gap-5 px-4 py-4 lg:max-h-[calc(100vh-16rem)] lg:overflow-y-auto">
                  <section>
                    <h4 className="mb-3 text-sm font-semibold text-slate-700">基本資訊</h4>
                    <div className="grid gap-3 sm:grid-cols-2 sm:[grid-template-columns:repeat(2,minmax(0,1fr))]">
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
                    </div>
                  </section>

                  <section>
                    <h4 className="mb-3 text-sm font-semibold text-slate-700">價格資訊</h4>
                    <div className="grid gap-3 sm:grid-cols-2 sm:[grid-template-columns:repeat(2,minmax(0,1fr))]">
                      <label className="grid gap-1 text-sm font-medium text-slate-600">
                        成本
                        <TextInput disabled={!isAdmin} required min="0" type="number" value={productForm.cost} onChange={(e) => setProductForm({ ...productForm, cost: e.target.value })} />
                      </label>
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
                        庫存數量
                        <TextInput disabled={!isAdmin} required min="0" type="number" value={productForm.stock} onChange={(e) => setProductForm({ ...productForm, stock: e.target.value })} />
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
                </div>

                <div className="sticky bottom-0 flex flex-col gap-3 border-t border-slate-200 bg-white px-4 py-4 sm:flex-row sm:gap-2">
                  <Button disabled={!isAdmin} type="submit" className="w-full">
                    <PackagePlus className="h-4 w-4" />
                    {editingId ? "儲存變更" : "建立商品"}
                  </Button>
                  {editingId && <Button variant="secondary" type="button" className="w-full sm:w-auto" onClick={() => { setEditingId(null); setProductForm(emptyProduct); }}>取消</Button>}
                </div>
              </form>

              <div className="min-w-0 max-w-full overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="font-semibold text-slate-900">商品列表</h3>
                  <div className="sticky top-[92px] z-20 w-full min-w-0 bg-white py-1 sm:static sm:max-w-sm sm:flex-1 sm:bg-transparent sm:py-0">
                    <Search className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
                    <input
                      value={searchInput}
                      onChange={(event) => setSearchInput(event.target.value)}
                      placeholder="搜尋商品、系列、稀有度、編號"
                      className="h-12 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-base outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 sm:h-10 sm:text-sm"
                    />
                  </div>
                </div>

                <div className="hidden overflow-x-auto lg:block">
                  <table className="min-w-full table-auto text-left text-sm">
                    <thead className="border-b border-slate-200 text-xs text-slate-500">
                      <tr>
                        <th className="py-3 pr-4">商品名稱</th>
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
                          <td className="py-3 pr-4 font-medium">{product.name}<p className="text-xs text-slate-500">{product.notes}</p></td>
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
                    </tbody>
                  </table>
                </div>

                <div className="grid gap-3 lg:hidden">
                  {visibleProducts.map((product) => (
                    <article key={product.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate font-semibold text-slate-950">{product.name}</h3>
                          <p className="mt-1 text-sm text-slate-500">{product.series} · {product.rarity} · {product.condition}</p>
                          <p className="mt-1 text-sm text-slate-500">{product.packageSpec}</p>
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
                        <div className="flex gap-2">
                          <Button type="button" variant="secondary" onClick={() => addQuickSaleItem(product)}>
                            <Plus className="h-4 w-4" />
                            銷售
                          </Button>
                          <Button variant="secondary" disabled={!isAdmin} onClick={() => editProduct(product)} title="編輯">
                            <Edit3 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </div>

            {isAdmin && (
              <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Trash2 className="h-5 w-5 text-slate-700" />
                    <h3 className="font-semibold text-slate-900">已刪除商品列表</h3>
                  </div>
                  <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{deletedProducts.length} 筆</span>
                </div>

                <div className="hidden overflow-x-auto lg:block">
                  <table className="min-w-full table-auto text-left text-sm">
                    <thead className="border-b border-slate-200 text-xs text-slate-500">
                      <tr>
                        <th className="py-3 pr-4">商品名稱</th>
                        <th className="py-3 pr-4">系列</th>
                        <th className="py-3 pr-4">庫存</th>
                        <th className="py-3 pr-4">刪除時間</th>
                        <th className="py-3 pr-4">執行人</th>
                        <th className="py-3">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {deletedProducts.map((product) => (
                        <tr key={product.id}>
                          <td className="py-3 pr-4 font-medium">{product.name}</td>
                          <td className="py-3 pr-4">{product.series} · {product.rarity}</td>
                          <td className="py-3 pr-4">{formatStock(product)}</td>
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
                      {deletedProducts.length === 0 && (
                        <tr>
                          <td className="py-6 text-center text-slate-500" colSpan="6">尚無已刪除商品</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="grid gap-3 lg:hidden">
                  {deletedProducts.map((product) => (
                    <article key={product.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{product.name}</p>
                          <p className="mt-1 text-sm text-slate-500">{product.series} · {formatStock(product)}</p>
                          <p className="mt-1 text-xs text-slate-500">{product.deletedAt ? new Date(product.deletedAt).toLocaleString("zh-TW") : "-"}</p>
                        </div>
                        <Button type="button" variant="secondary" onClick={() => restoreProduct(product)}>
                          <RotateCcw className="h-4 w-4" />
                          還原
                        </Button>
                      </div>
                    </article>
                  ))}
                  {deletedProducts.length === 0 && <p className="py-6 text-center text-slate-500">尚無已刪除商品</p>}
                </div>
              </div>
            )}
          </section>

          {isAdmin && (
            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <PackagePlus className="h-5 w-5 text-slate-700" />
                <h2 className="text-lg font-semibold">Excel / CSV 商品匯入</h2>
              </div>
              <TextArea
                placeholder={"貼上 CSV 內容，欄位：商品名稱,卡牌系列,單位,每單位張數,包裝規格,進貨成本,售價,庫存數量"}
                value={importCsv}
                onChange={(e) => setImportCsv(e.target.value)}
              />
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-500">支援 Excel 匯出的 CSV。未填稀有度/卡況時會自動補預設值。</p>
                <Button type="button" className="w-full sm:w-auto" onClick={importProducts}>
                  <PackagePlus className="h-4 w-4" />
                  匯入商品
                </Button>
              </div>
            </section>
          )}

          <section className="hidden rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:block">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5 text-slate-700" />
                <h2 className="text-lg font-semibold">快速銷售面板</h2>
              </div>
              <p className="font-semibold">{currency.format(quickSaleTotal)}</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {quickSaleProducts.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  className="rounded-lg border border-slate-200 p-3 text-left shadow-sm transition hover:border-teal-300 hover:bg-teal-50 active:scale-[0.99]"
                  onClick={() => addQuickSaleItem(product)}
                >
                  <p className="font-medium">{product.name}</p>
                  <p className="mt-1 text-sm text-slate-500">{formatStock(product)} · {currency.format(product.price)}</p>
                </button>
              ))}
            </div>
            {quickSaleItems.length > 0 && (
              <div className="mt-4 grid gap-2">
                {quickSaleItems.map((item) => (
                  <div key={item.product.id} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
                    <span>{item.product.name}</span>
                    <div className="flex items-center gap-2">
                      <Button type="button" variant="secondary" className="h-10 w-10 px-0" onClick={() => updateQuickSaleQuantity(item.product.id, -1)}><Minus className="h-4 w-4" /></Button>
                      <span className="w-8 text-center">{item.quantity}</span>
                      <Button type="button" variant="secondary" className="h-10 w-10 px-0" onClick={() => updateQuickSaleQuantity(item.product.id, 1)}><Plus className="h-4 w-4" /></Button>
                    </div>
                  </div>
                ))}
                <Button type="button" onClick={checkoutQuickSale}>
                  <ShoppingCart className="h-4 w-4" />
                  快速結帳
                </Button>
              </div>
            )}
          </section>

          <section id="銷售管理" className="grid min-w-0 gap-6 xl:grid-cols-[minmax(280px,0.75fr)_minmax(0,1.25fr)]">
            <form onSubmit={submitSale} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <ShoppingCart className="h-5 w-5 text-slate-700" />
                <h2 className="text-lg font-semibold">新增銷售紀錄</h2>
              </div>
              <div className="grid gap-3">
                <SelectInput value={saleForm.productId} onChange={(e) => {
                  const product = products.find((item) => item.id === Number(e.target.value));
                  setSaleForm({
                    ...saleForm,
                    productId: e.target.value,
                    saleUnit: product?.unit ?? "單張",
                    cardsPerUnit: product ? String(product.cardsPerUnit) : "1",
                    unitPrice: product ? String(product.price) : ""
                  });
                }}>
                  {products.map((product) => <option key={product.id} value={product.id}>{product.name}（庫存 {formatStock(product)}）</option>)}
                </SelectInput>
                {selectedProduct && <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">{selectedProduct.series} · {selectedProduct.rarity} · {selectedProduct.condition} · {selectedProduct.packageSpec}</p>}
                <div className="grid grid-cols-2 gap-3">
                  <TextInput required min="1" type="number" placeholder="銷售數量" value={saleForm.quantity} onChange={(e) => setSaleForm({ ...saleForm, quantity: e.target.value })} />
                  <SelectInput value={saleForm.saleUnit} onChange={(e) => setSaleForm({ ...saleForm, saleUnit: e.target.value })}>
                    {UNIT_OPTIONS.map((unit) => <option key={unit}>{unit}</option>)}
                  </SelectInput>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <TextInput required min="1" type="number" placeholder="每單位張數" value={saleForm.cardsPerUnit} onChange={(e) => setSaleForm({ ...saleForm, cardsPerUnit: e.target.value })} />
                  <TextInput required min="0" type="number" placeholder="單價" value={saleForm.unitPrice} onChange={(e) => setSaleForm({ ...saleForm, unitPrice: e.target.value })} />
                </div>
                <TextInput required type="date" value={saleForm.soldAt} onChange={(e) => setSaleForm({ ...saleForm, soldAt: e.target.value })} />
                <p className="text-sm text-slate-500">總金額：{currency.format(Number(saleForm.quantity || 0) * Number(saleForm.unitPrice || 0))}，銷售 {number.format(Number(saleForm.quantity || 0))} {saleForm.saleUnit}</p>
                <Button type="submit" className="w-full">
                  <ShoppingCart className="h-4 w-4" />
                  新增銷售並扣庫存
                </Button>
              </div>
            </form>

            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-5 w-5 text-slate-700" />
                  <h2 className="text-lg font-semibold">銷售紀錄查詢</h2>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <TextInput type="date" value={dateRange.from} onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })} />
                  <TextInput type="date" value={dateRange.to} onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })} />
                </div>
              </div>
              <div className="hidden overflow-x-auto lg:block">
                <table className="min-w-full table-auto text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs text-slate-500">
                    <tr>
                      <th className="py-3 pr-4">日期</th>
                      <th className="py-3 pr-4">商品</th>
                      <th className="py-3 pr-4">數量/單位</th>
                      <th className="py-3 pr-4">規格</th>
                      <th className="py-3 pr-4">單價</th>
                      <th className="py-3 pr-4">總金額</th>
                      <th className="py-3 pr-4">店員</th>
                      <th className="py-3 pr-4">狀態</th>
                      <th className="py-3">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sales.map((sale) => (
                      <tr key={sale.id}>
                        <td className="py-3 pr-4">{sale.soldAt}</td>
                        <td className="py-3 pr-4 font-medium">{sale.productName}<p className="text-xs text-slate-500">{sale.productSeries}</p></td>
                        <td className="py-3 pr-4">{sale.quantity} {sale.saleUnit}</td>
                        <td className="py-3 pr-4">{sale.cardsPerUnit} 張/{sale.saleUnit}</td>
                        <td className="py-3 pr-4">{currency.format(sale.unitPrice)}</td>
                        <td className={`py-3 pr-4 font-semibold ${sale.voidedAt ? "text-slate-400 line-through" : ""}`}>{currency.format(sale.total)}</td>
                        <td className="py-3 pr-4">{sale.staffName}</td>
                        <td className="py-3 pr-4">
                          <span className={`rounded px-2 py-1 text-xs font-medium ${sale.voidedAt ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
                            {sale.voidedAt ? "已作廢" : "有效"}
                          </span>
                        </td>
                        <td className="py-3">
                          <Button variant="danger" disabled={!isAdmin || sale.voidedAt} onClick={() => voidSale(sale)}>
                            <X className="h-4 w-4" />
                            {sale.voidedAt ? "已作廢" : "作廢"}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-3 lg:hidden">
                {sales.map((sale) => (
                  <article key={sale.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{sale.productName}</p>
                        <p className="text-sm text-slate-500">{sale.productSeries} · {sale.soldAt}</p>
                      </div>
                      <div className="text-right">
                        <p className={`font-semibold ${sale.voidedAt ? "text-slate-400 line-through" : ""}`}>{currency.format(sale.total)}</p>
                        {sale.voidedAt && <p className="mt-1 text-xs text-rose-600">已作廢</p>}
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <p className="text-sm text-slate-600">{sale.quantity} {sale.saleUnit} · {currency.format(sale.unitPrice)}</p>
                      <Button variant="danger" disabled={!isAdmin || sale.voidedAt} onClick={() => voidSale(sale)}>
                        <X className="h-4 w-4" />
                        {sale.voidedAt ? "已作廢" : "作廢"}
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section id="操作紀錄" className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <History className="h-5 w-5 text-slate-700" />
              <h2 className="text-lg font-semibold">操作紀錄</h2>
            </div>
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
          </section>

          {isAdmin && (
            <section id="員工管理" className="grid min-w-0 gap-6 xl:grid-cols-[minmax(280px,0.75fr)_minmax(0,1.25fr)]">
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
            </section>
          )}

          {isAdmin && (
            <section id="系統備份" className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-2">
                  <Database className="h-5 w-5 text-slate-700" />
                  <h2 className="text-lg font-semibold">系統備份</h2>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button type="button" variant="danger" disabled={clearingDemoData} onClick={clearDemoData}>
                    <AlertTriangle className="h-4 w-4" />
                    {clearingDemoData ? "清除中..." : "清除測試資料"}
                  </Button>
                  <Button type="button" onClick={createBackup}>
                    <Database className="h-4 w-4" />
                    立即備份
                  </Button>
                </div>
              </div>

              <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                還原會覆蓋目前 PostgreSQL 資料庫中的員工、商品與銷售資料。備份檔只可透過管理員 API 操作，不提供公開下載。
              </div>
              <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                清除測試資料會先自動建立備份，接著移除預設商品、庫存、銷售紀錄、報表資料與測試操作紀錄；不會清空 users 表或刪除 admin、clerk、員工帳號。
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
            </section>
          )}
        </div>
      </main>

      <section className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white p-3 shadow-[0_-12px_30px_rgba(15,23,42,0.12)] lg:hidden">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-teal-700" />
            <h2 className="font-semibold">快速銷售</h2>
          </div>
          <p className="font-semibold">{currency.format(quickSaleTotal)}</p>
        </div>
        <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
          {quickSaleProducts.map((product) => (
            <button
              key={product.id}
              type="button"
              className="min-w-40 rounded-lg border border-slate-200 bg-slate-50 p-3 text-left active:bg-teal-50"
              onClick={() => addQuickSaleItem(product)}
            >
              <p className="truncate text-sm font-medium">{product.name}</p>
              <p className="mt-1 text-xs text-slate-500">{currency.format(product.price)} · {formatStock(product)}</p>
            </button>
          ))}
        </div>
        {quickSaleItems.length > 0 && (
          <div className="mb-2 max-h-28 space-y-2 overflow-y-auto">
            {quickSaleItems.map((item) => (
              <div key={item.product.id} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2 py-2">
                <p className="min-w-0 truncate text-sm">{item.product.name}</p>
                <div className="flex shrink-0 items-center gap-2">
                  <Button type="button" variant="secondary" className="h-10 w-10 px-0" onClick={() => updateQuickSaleQuantity(item.product.id, -1)}><Minus className="h-4 w-4" /></Button>
                  <span className="w-6 text-center text-sm">{item.quantity}</span>
                  <Button type="button" variant="secondary" className="h-10 w-10 px-0" onClick={() => updateQuickSaleQuantity(item.product.id, 1)}><Plus className="h-4 w-4" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <Button type="button" className="w-full" disabled={quickSaleItems.length === 0} onClick={checkoutQuickSale}>
          <ShoppingCart className="h-4 w-4" />
          快速結帳
        </Button>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
