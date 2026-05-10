import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BarChart3,
  Boxes,
  CalendarDays,
  Edit3,
  LogOut,
  PackagePlus,
  Search,
  ShieldCheck,
  ShoppingCart,
  Trash2,
  TrendingUp,
  UserRound,
  Warehouse
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
      className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
    />
  );
}

function SelectInput(props) {
  return (
    <select
      {...props}
      className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
    />
  );
}

function TextArea(props) {
  return (
    <textarea
      {...props}
      className="min-h-20 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
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
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
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

const emptyProduct = {
  name: "",
  series: "",
  rarity: "RR",
  condition: "近全新",
  cost: "",
  price: "",
  stock: "",
  lowStockThreshold: "3",
  notes: ""
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
  const [sales, setSales] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [productForm, setProductForm] = useState(emptyProduct);
  const [editingId, setEditingId] = useState(null);
  const [saleForm, setSaleForm] = useState({ productId: "", quantity: 1, unitPrice: "", soldAt: new Date().toISOString().slice(0, 10) });
  const [dateRange, setDateRange] = useState({ from: new Date().toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) });

  const isAdmin = auth?.user?.role === "admin";

  const load = async () => {
    if (!auth?.token) return;
    const saleQuery = `?from=${dateRange.from}&to=${dateRange.to}`;
    const [productRows, saleRows, dashboardRow] = await Promise.all([
      api(`/products?q=${encodeURIComponent(query)}`),
      api(`/sales${saleQuery}`),
      api("/dashboard")
    ]);
    setProducts(productRows);
    setSales(saleRows);
    setDashboard(dashboardRow);
  };

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [auth, query, dateRange.from, dateRange.to]);

  useEffect(() => {
    if (!saleForm.productId && products[0]) {
      setSaleForm((current) => ({ ...current, productId: String(products[0].id), unitPrice: String(products[0].price) }));
    }
  }, [products, saleForm.productId]);

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === Number(saleForm.productId)),
    [products, saleForm.productId]
  );

  const submitProduct = async (event) => {
    event.preventDefault();
    setError("");
    const payload = {
      ...productForm,
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
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const editProduct = (product) => {
    setEditingId(product.id);
    setProductForm({
      name: product.name,
      series: product.series,
      rarity: product.rarity,
      condition: product.condition,
      cost: String(product.cost),
      price: String(product.price),
      stock: String(product.stock),
      lowStockThreshold: String(product.lowStockThreshold),
      notes: product.notes
    });
  };

  const deleteProduct = async (product) => {
    if (!window.confirm(`確定刪除「${product.name}」？`)) return;
    try {
      await api(`/products/${product.id}`, { method: "DELETE" });
      await load();
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
          unitPrice: Number(saleForm.unitPrice),
          soldAt: saleForm.soldAt
        })
      });
      setSaleForm((current) => ({ ...current, quantity: 1 }));
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const deleteSale = async (sale) => {
    if (!window.confirm(`確定刪除銷售紀錄 #${sale.id}？庫存會自動回補。`)) return;
    try {
      await api(`/sales/${sale.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const logout = () => {
    localStorage.removeItem("pokemon-erp-auth");
    setAuth(null);
  };

  if (!auth?.token) return <Login onLogin={setAuth} />;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
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
          {[
            [BarChart3, "營業額儀表板"],
            [Boxes, "商品庫存"],
            [ShoppingCart, "銷售管理"]
          ].map(([Icon, label]) => (
            <a key={label} href={`#${label}`} className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-slate-100">
              <Icon className="h-4 w-4" />
              {label}
            </a>
          ))}
        </nav>
      </aside>

      <main className="lg:pl-64">
        <header className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-7xl flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm text-slate-500">繁體中文卡牌店管理系統</p>
              <h1 className="text-2xl font-semibold text-slate-950">{APP_NAME}</h1>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
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

        <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          <section id="營業額儀表板" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={CalendarDays} label="今日營業額" value={currency.format(dashboard?.todayRevenue ?? 0)} detail="依銷售日期統計" tone="bg-teal-50 text-teal-700" />
            <StatCard icon={BarChart3} label="本月營業額" value={currency.format(dashboard?.monthRevenue ?? 0)} detail="當月銷售總額" tone="bg-indigo-50 text-indigo-700" />
            <StatCard icon={ShoppingCart} label="總銷售量" value={`${number.format(dashboard?.totalSalesQuantity ?? 0)} 張`} detail="所有銷售紀錄累計" tone="bg-amber-50 text-amber-700" />
            <StatCard icon={Boxes} label="低庫存商品數" value={number.format(dashboard?.lowStockCount ?? 0)} detail={`庫存總量 ${number.format(dashboard?.totalStock ?? 0)} 張`} tone="bg-rose-50 text-rose-700" />
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
                      <p className="font-semibold">{number.format(product.soldQuantity)} 張</p>
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
                        {product.stock} 張
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{product.series} · {product.rarity}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section id="商品庫存" className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <Boxes className="h-5 w-5 text-slate-700" />
                  <h2 className="text-lg font-semibold">商品庫存管理</h2>
                </div>
                <div className="relative w-full sm:w-80">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜尋商品、系列、稀有度、卡況"
                    className="h-10 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
                  />
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs text-slate-500">
                    <tr>
                      <th className="py-3 pr-4">商品名稱</th>
                      <th className="py-3 pr-4">系列</th>
                      <th className="py-3 pr-4">稀有度</th>
                      <th className="py-3 pr-4">卡況</th>
                      <th className="py-3 pr-4">成本</th>
                      <th className="py-3 pr-4">售價</th>
                      <th className="py-3 pr-4">庫存</th>
                      <th className="py-3">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {products.map((product) => (
                      <tr key={product.id}>
                        <td className="py-3 pr-4 font-medium">{product.name}<p className="text-xs text-slate-500">{product.notes}</p></td>
                        <td className="py-3 pr-4">{product.series}</td>
                        <td className="py-3 pr-4">{product.rarity}</td>
                        <td className="py-3 pr-4">{product.condition}</td>
                        <td className="py-3 pr-4">{currency.format(product.cost)}</td>
                        <td className="py-3 pr-4">{currency.format(product.price)}</td>
                        <td className="py-3 pr-4">
                          <span className={`rounded px-2 py-1 text-xs font-medium ${product.stock <= product.lowStockThreshold ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
                            {product.stock <= product.lowStockThreshold ? `低庫存 ${product.stock}` : product.stock}
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
            </div>

            <form onSubmit={submitProduct} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <PackagePlus className="h-5 w-5 text-slate-700" />
                <h2 className="text-lg font-semibold">{editingId ? "編輯商品" : "新增商品"}</h2>
              </div>
              {!isAdmin && <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">店員可查看庫存與新增銷售，但不能新增、編輯或刪除商品。</p>}
              <div className="grid gap-3">
                <TextInput disabled={!isAdmin} required placeholder="商品名稱" value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} />
                <TextInput disabled={!isAdmin} required placeholder="卡牌系列" value={productForm.series} onChange={(e) => setProductForm({ ...productForm, series: e.target.value })} />
                <div className="grid grid-cols-2 gap-3">
                  <SelectInput disabled={!isAdmin} value={productForm.rarity} onChange={(e) => setProductForm({ ...productForm, rarity: e.target.value })}>
                    {["C", "U", "R", "RR", "RRR", "SR", "SAR", "UR", "HR", "PROMO"].map((rarity) => <option key={rarity}>{rarity}</option>)}
                  </SelectInput>
                  <SelectInput disabled={!isAdmin} value={productForm.condition} onChange={(e) => setProductForm({ ...productForm, condition: e.target.value })}>
                    {["全新", "近全新", "良好", "輕微白邊", "明顯傷痕"].map((condition) => <option key={condition}>{condition}</option>)}
                  </SelectInput>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <TextInput disabled={!isAdmin} required min="0" type="number" placeholder="進貨成本" value={productForm.cost} onChange={(e) => setProductForm({ ...productForm, cost: e.target.value })} />
                  <TextInput disabled={!isAdmin} required min="0" type="number" placeholder="售價" value={productForm.price} onChange={(e) => setProductForm({ ...productForm, price: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <TextInput disabled={!isAdmin} required min="0" type="number" placeholder="庫存數量" value={productForm.stock} onChange={(e) => setProductForm({ ...productForm, stock: e.target.value })} />
                  <TextInput disabled={!isAdmin} required min="0" type="number" placeholder="低庫存門檻" value={productForm.lowStockThreshold} onChange={(e) => setProductForm({ ...productForm, lowStockThreshold: e.target.value })} />
                </div>
                <TextArea disabled={!isAdmin} placeholder="備註" value={productForm.notes} onChange={(e) => setProductForm({ ...productForm, notes: e.target.value })} />
                <div className="flex gap-2">
                  <Button disabled={!isAdmin} type="submit">{editingId ? "儲存變更" : "建立商品"}</Button>
                  {editingId && <Button variant="secondary" type="button" onClick={() => { setEditingId(null); setProductForm(emptyProduct); }}>取消</Button>}
                </div>
              </div>
            </form>
          </section>

          <section id="銷售管理" className="grid gap-6 xl:grid-cols-[0.75fr_1.25fr]">
            <form onSubmit={submitSale} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <ShoppingCart className="h-5 w-5 text-slate-700" />
                <h2 className="text-lg font-semibold">新增銷售紀錄</h2>
              </div>
              <div className="grid gap-3">
                <SelectInput value={saleForm.productId} onChange={(e) => {
                  const product = products.find((item) => item.id === Number(e.target.value));
                  setSaleForm({ ...saleForm, productId: e.target.value, unitPrice: product ? String(product.price) : "" });
                }}>
                  {products.map((product) => <option key={product.id} value={product.id}>{product.name}（庫存 {product.stock}）</option>)}
                </SelectInput>
                {selectedProduct && <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">{selectedProduct.series} · {selectedProduct.rarity} · {selectedProduct.condition}</p>}
                <div className="grid grid-cols-2 gap-3">
                  <TextInput required min="1" type="number" placeholder="銷售數量" value={saleForm.quantity} onChange={(e) => setSaleForm({ ...saleForm, quantity: e.target.value })} />
                  <TextInput required min="0" type="number" placeholder="單價" value={saleForm.unitPrice} onChange={(e) => setSaleForm({ ...saleForm, unitPrice: e.target.value })} />
                </div>
                <TextInput required type="date" value={saleForm.soldAt} onChange={(e) => setSaleForm({ ...saleForm, soldAt: e.target.value })} />
                <p className="text-sm text-slate-500">總金額：{currency.format(Number(saleForm.quantity || 0) * Number(saleForm.unitPrice || 0))}</p>
                <Button type="submit">新增銷售並扣庫存</Button>
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
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs text-slate-500">
                    <tr>
                      <th className="py-3 pr-4">日期</th>
                      <th className="py-3 pr-4">商品</th>
                      <th className="py-3 pr-4">數量</th>
                      <th className="py-3 pr-4">單價</th>
                      <th className="py-3 pr-4">總金額</th>
                      <th className="py-3 pr-4">店員</th>
                      <th className="py-3">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sales.map((sale) => (
                      <tr key={sale.id}>
                        <td className="py-3 pr-4">{sale.soldAt}</td>
                        <td className="py-3 pr-4 font-medium">{sale.productName}<p className="text-xs text-slate-500">{sale.productSeries}</p></td>
                        <td className="py-3 pr-4">{sale.quantity}</td>
                        <td className="py-3 pr-4">{currency.format(sale.unitPrice)}</td>
                        <td className="py-3 pr-4 font-semibold">{currency.format(sale.total)}</td>
                        <td className="py-3 pr-4">{sale.staffName}</td>
                        <td className="py-3">
                          <Button variant="danger" disabled={!isAdmin} onClick={() => deleteSale(sale)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
