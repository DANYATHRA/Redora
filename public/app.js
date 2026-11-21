(() => {
  "use strict";

  /* ================= helpers ================= */
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const state = { user: null, categories: [], warnDays: 90 };
  let routeToken = 0;

  const ICONS = {
    dashboard: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>',
    items: '<svg viewBox="0 0 24 24"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>',
    in: '<svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 21h16"/></svg>',
    out: '<svg viewBox="0 0 24 24"><path d="M12 15V3"/><path d="M7 8l5-5 5 5"/><path d="M4 21h16"/></svg>',
    history: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    suppliers: '<svg viewBox="0 0 24 24"><path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7"/><circle cx="7.5" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/></svg>',
    settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  };
  const LOGO = '<span class="logo"><svg viewBox="0 0 24 24"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" fill="#fff"/></svg></span>';

  const fmtDay = (d) =>
    d ? new Date(d + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";
  const fmtTime = (s) =>
    new Date(s.replace(" ", "T") + "Z").toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const daysUntil = (d) => Math.round((new Date(d + "T00:00:00") - new Date(new Date().toDateString())) / 864e5);
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

  function statusBadge(s) {
    const label = { ok: "In stock", low: "Low stock", out: "Out of stock" }[s];
    return `<span class="badge ${s}">${label}</span>`;
  }
  function expiryBadge(d) {
    if (!d) return '<span class="muted">—</span>';
    const n = daysUntil(d);
    if (n < 0) return `<span class="badge expired">Expired ${fmtDay(d)}</span>`;
    if (n <= state.warnDays) return `<span class="badge soon" title="${fmtDay(d)}">${n === 0 ? "Expires today" : "In " + plural(n, "day")} · ${fmtDay(d)}</span>`;
    return fmtDay(d);
  }
  function typeBadge(t) {
    const m = { in: ["in", "Received"], out: ["outmv", "Issued"], adjust: ["adjust", "Adjusted"], writeoff: ["writeoff", "Written off"] }[t];
    return `<span class="badge ${m[0]}">${m[1]}</span>`;
  }

  async function api(path, opts = {}) {
    const res = await fetch("/api" + path, {
      method: opts.method || "GET",
      headers: opts.body ? { "Content-Type": "application/json" } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
    });
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    if (res.status === 401 && path !== "/login") {
      state.user = null;
      showLogin();
      throw new Error("Please sign in.");
    }
    if (!res.ok) throw new Error((data && data.error) || "Request failed.");
    return data;
  }

  function toast(msg, isError) {
    const el = document.createElement("div");
    el.className = "toast" + (isError ? " err" : "");
    el.textContent = msg;
    $("#toasts").appendChild(el);
    setTimeout(() => el.remove(), isError ? 5000 : 3000);
  }

  const formData = (form) => {
    const o = {};
    for (const el of form.elements) {
      if (!el.name) continue;
      o[el.name] = el.type === "checkbox" ? el.checked : el.value;
    }
    return o;
  };

  // Shared submit handling: disables the button, shows errors inline.
  function bindForm(form, handler) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("button[type=submit]", form);
      const err = $(".form-error", form);
      if (err) err.textContent = "";
      btn.disabled = true;
      try {
        await handler(formData(form), form);
      } catch (ex) {
        if (err) err.textContent = ex.message;
        else toast(ex.message, true);
      } finally {
        btn.disabled = false;
      }
    });
  }

  /* ================= modal ================= */
  function closeModal() {
    const m = $("#modal");
    if (m) m.remove();
  }
  function openModal(title, body, onSubmit, submitLabel = "Save") {
    closeModal();
    const el = document.createElement("div");
    el.className = "backdrop";
    el.id = "modal";
    el.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h2>${esc(title)}</h2><button type="button" data-action="close-modal" aria-label="Close">×</button></div>
      <form novalidate><div class="form-error" role="alert"></div>${body}
        <div class="modal-foot"><button type="button" class="btn ghost" data-action="close-modal">Cancel</button>
        <button class="btn" type="submit">${esc(submitLabel)}</button></div></form></div>`;
    document.body.appendChild(el);
    const form = $("form", el);
    bindForm(form, async (data, f) => {
      await onSubmit(data, f);
      closeModal();
    });
    const first = $("input:not([type=checkbox]), select, textarea", form);
    if (first) first.focus();
  }

  /* ================= login & shell ================= */
  function showLogin() {
    document.title = "Sign in — Redora";
    $("#app").innerHTML = `<div class="login-wrap"><form class="login-card" id="login-form" novalidate>
      <div class="brand">${LOGO}Redora</div>
      <p class="tag">Hospital inventory management</p>
      <div class="form-error" role="alert"></div>
      <label class="field">Username<input type="text" name="username" autocomplete="username" autocapitalize="none" required></label>
      <label class="field">Password<input type="password" name="password" autocomplete="current-password" required></label>
      <button class="btn block" type="submit">Sign in</button></form></div>`;
    const form = $("#login-form");
    $("input", form).focus();
    bindForm(form, async (data) => {
      const res = await api("/login", { method: "POST", body: data });
      state.user = res.user;
      await bootstrap();
    });
  }

  function renderShell() {
    const u = state.user;
    const links = [
      ["dashboard", "Dashboard", "dashboard"],
      ["items", "Items & stock", "items"],
      ["stock-in", "Receive stock", "in"],
      ["stock-out", "Issue stock", "out"],
      ["history", "History", "history"],
      ["suppliers", "Suppliers", "suppliers"],
      ["settings", "Settings", "settings"],
    ];
    $("#app").innerHTML = `<div class="shell">
      <aside class="sidebar">
        <div class="brand">${LOGO}Redora</div>
        <nav class="nav" aria-label="Main">${links
          .map(([h, label, icon]) => `<a href="#/${h}" data-nav="${h}">${ICONS[icon]}<span>${label}</span></a>`)
          .join("")}</nav>
        <div class="userbox"><strong>${esc(u.name)}</strong><span class="role">${u.role === "admin" ? "Administrator" : "Staff"}</span>
          <button type="button" data-action="logout">Sign out</button></div>
      </aside><main id="view" tabindex="-1"></main></div>`;
  }

  async function bootstrap() {
    try {
      const me = await api("/me");
      state.user = me.user;
      state.categories = me.categories;
      state.warnDays = me.expiryWarnDays;
    } catch {
      return; // api() already showed the login screen
    }
    renderShell();
    if (!location.hash) location.hash = "#/dashboard";
    route();
  }

  /* ================= router ================= */
  const ROUTES = {
    dashboard: viewDashboard,
    items: (arg, p) => (arg ? viewItem(Number(arg)) : viewItems(p)),
    "stock-in": (_a, p) => viewStockIn(p),
    "stock-out": (_a, p) => viewStockOut(p),
    history: (_a, p) => viewHistory(p),
    suppliers: viewSuppliers,
    settings: viewSettings,
  };

  async function route() {
    if (!state.user) return;
    const raw = location.hash.replace(/^#\/?/, "") || "dashboard";
    const [path, qs] = raw.split("?");
    const [name, arg] = path.split("/");
    const params = new URLSearchParams(qs || "");
    const fn = ROUTES[name] || viewDashboard;
    const token = ++routeToken;
    document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === name));
    const view = $("#view");
    view.innerHTML = '<p class="muted">Loading…</p>';
    try {
      const html = await fn(arg, params, token);
      if (token !== routeToken) return;
      if (typeof html === "string") view.innerHTML = html;
      window.scrollTo(0, 0);
      view._after && view._after();
      view._after = null;
    } catch (e) {
      if (token === routeToken) view.innerHTML = `<div class="form-error">${esc(e.message)}</div>`;
    }
  }
  const view = () => $("#view");
  const after = (fn) => { view()._after = fn; };
  const reload = () => route();

  window.addEventListener("hashchange", route);

  /* ================= shared fragments ================= */
  function movementTable(rows, { showItem = true } = {}) {
    if (!rows.length) return '<div class="empty">No stock movements yet.</div>';
    return `<div class="table-wrap"><table><thead><tr><th>When</th><th>Type</th>${showItem ? "<th>Item</th>" : ""}<th>Batch</th><th class="right">Change</th><th>Details</th><th>By</th></tr></thead><tbody>${rows
      .map((m) => {
        const who =
          m.type === "out" ? (m.department ? "to " + esc(m.department) : "")
          : m.type === "in" ? (m.supplier ? "from " + esc(m.supplier) : "")
          : "";
        const extra = [m.reference ? "Ref: " + esc(m.reference) : "", m.notes ? esc(m.notes) : ""].filter(Boolean).join(" · ");
        return `<tr><td class="small muted" style="white-space:nowrap">${fmtTime(m.created_at)}</td><td>${typeBadge(m.type)}</td>
          ${showItem ? `<td><a class="link" href="#/items/${m.item_id}">${esc(m.item_name)}</a></td>` : ""}
          <td>${esc(m.batch_no || "—")}${m.expiry_date ? `<span class="sub">exp ${fmtDay(m.expiry_date)}</span>` : ""}</td>
          <td class="right num"><span class="${m.quantity > 0 ? "pos" : "neg"}">${m.quantity > 0 ? "+" : ""}${m.quantity}</span> <span class="muted small">${esc(m.unit)}</span></td>
          <td>${who}${extra ? `<span class="sub">${extra}</span>` : ""}</td><td class="small">${esc(m.user_name || "")}</td></tr>`;
      })
      .join("")}</tbody></table></div>`;
  }

  const options = (rows, valueKey, labelFn, selected, placeholder) =>
    (placeholder !== undefined ? `<option value="">${esc(placeholder)}</option>` : "") +
    rows.map((r) => `<option value="${esc(r[valueKey])}"${String(r[valueKey]) === String(selected) ? " selected" : ""}>${esc(labelFn(r))}</option>`).join("");

  function pageHead(title, subtitle, actions = "") {
    return `<div class="page-head"><div><h1>${esc(title)}</h1>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div><div class="actions">${actions}</div></div>`;
  }

  /* ================= dashboard ================= */
  function activityChart(rows) {
    const days = [];
    for (let i = 13; i >= 0; i--) days.push(new Date(Date.now() - i * 864e5).toISOString().slice(0, 10));
    const by = Object.fromEntries(rows.map((r) => [r.day, r]));
    const max = Math.max(1, ...days.map((d) => Math.max(by[d]?.in_qty || 0, by[d]?.out_qty || 0)));
    const W = 560, H = 190, padB = 26, padT = 8, bw = 13, gap = (W - 14 * bw * 2) / 15;
    let bars = "";
    days.forEach((d, i) => {
      const x = gap + i * (bw * 2 + gap);
      const hi = ((by[d]?.in_qty || 0) / max) * (H - padB - padT);
      const ho = ((by[d]?.out_qty || 0) / max) * (H - padB - padT);
      bars += `<rect x="${x}" y="${H - padB - hi}" width="${bw}" height="${hi}" rx="3" fill="#0f766e"><title>${d}: ${by[d]?.in_qty || 0} received</title></rect>`;
      bars += `<rect x="${x + bw + 1}" y="${H - padB - ho}" width="${bw}" height="${ho}" rx="3" fill="#e11d48"><title>${d}: ${by[d]?.out_qty || 0} issued</title></rect>`;
      if (i % 2 === 0) bars += `<text x="${x + bw}" y="${H - 8}" font-size="10" text-anchor="middle" fill="#62727c">${d.slice(8)}/${d.slice(5, 7)}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Units received and issued in the last 14 days"><line x1="0" x2="${W}" y1="${H - padB}" y2="${H - padB}" stroke="#e1e8eb"/>${bars}</svg>`;
  }

  async function viewDashboard() {
    document.title = "Dashboard — Redora";
    const d = await api("/dashboard");
    const t = d.totals;
    const stat = (n, label, href, cls) => `<a class="stat ${cls}" href="${href}"><div class="n">${n}</div><div class="l">${label}</div></a>`;
    const reorder = d.needsReorder.length
      ? `<div class="table-wrap"><table><thead><tr><th>Item</th><th class="right">Available</th><th class="right">Reorder at</th><th>Status</th></tr></thead><tbody>${d.needsReorder
          .map((i) => `<tr><td><a class="link" href="#/items/${i.id}">${esc(i.name)}</a><span class="sub">${esc(i.supplier_name || "No supplier set")}</span></td><td class="right num">${i.available_stock} <span class="muted small">${esc(i.unit)}</span></td><td class="right num">${i.reorder_level}</td><td>${statusBadge(i.status)}</td></tr>`)
          .join("")}</tbody></table></div>`
      : '<div class="empty">Nothing is running low. 🎉</div>';
    const batchList = (rows, empty) =>
      rows.length
        ? `<div class="table-wrap"><table><thead><tr><th>Item</th><th>Batch</th><th class="right">Qty</th><th>Expiry</th></tr></thead><tbody>${rows
            .map((b) => `<tr><td><a class="link" href="#/items/${b.item_id}">${esc(b.name)}</a></td><td>${esc(b.batch_no)}</td><td class="right num">${b.quantity} <span class="muted small">${esc(b.unit)}</span></td><td>${expiryBadge(b.expiry_date)}</td></tr>`)
            .join("")}</tbody></table></div>`
        : `<div class="empty">${empty}</div>`;
    return `${pageHead("Dashboard", `Stock overview · expiry alerts look ${d.expiryWarnDays} days ahead`, '<a class="btn" href="#/stock-in">Receive stock</a><a class="btn ghost" href="#/stock-out">Issue stock</a>')}
      <div class="stats">
        ${stat(t.items, "Active items", "#/items", "s-ok")}
        ${stat(t.low, "Low stock", "#/items?status=low", "s-low")}
        ${stat(t.out, "Out of stock", "#/items?status=out", "s-out")}
        ${stat(t.expiring, "Batches expiring soon", "#/items?status=expiring", "s-low")}
        ${stat(t.expired, "Expired batches with stock", "#/items?status=expired", "s-exp")}
      </div>
      <div class="cols2">
        <section class="panel"><div class="panel-head"><h2>Needs reordering</h2></div>${reorder}</section>
        <section class="panel"><div class="panel-head"><h2>Expiring within ${d.expiryWarnDays} days</h2></div>${batchList(d.expiringSoon, "No batches expiring soon.")}</section>
      </div>
      <div class="cols2">
        <section class="panel"><div class="panel-head"><h2>Expired — remove from shelves</h2></div>${batchList(d.expired, "No expired stock on hand.")}</section>
        <section class="panel"><div class="panel-head"><h2>Last 14 days</h2><div class="legend"><span><i style="background:#0f766e"></i>Received</span><span><i style="background:#e11d48"></i>Issued</span></div></div><div class="panel-body chart">${activityChart(d.activity)}</div></section>
      </div>
      <section class="panel"><div class="panel-head"><h2>Recent activity</h2><a href="#/history" class="small">View all</a></div>${movementTable(d.recent)}</section>`;
  }

  /* ================= items list ================= */
  async function viewItems(params) {
    document.title = "Items & stock — Redora";
    const [items, suppliers] = await Promise.all([api("/items"), api("/suppliers")]);
    const f = { q: params.get("q") || "", status: params.get("status") || "", category: params.get("category") || "" };
    view()._suppliers = suppliers;
    after(() => {
      const table = $("#items-table");
      const draw = () => {
        const q = f.q.trim().toLowerCase();
        const rows = items.filter((i) => {
          if (q && !(i.name.toLowerCase().includes(q) || (i.code || "").toLowerCase().includes(q))) return false;
          if (f.category && i.category !== f.category) return false;
          if (["ok", "low", "out"].includes(f.status) && i.status !== f.status) return false;
          if (f.status === "expiring" && !(i.next_expiry && daysUntil(i.next_expiry) <= state.warnDays)) return false;
          if (f.status === "expired" && !(i.expired_stock > 0)) return false;
          return true;
        });
        table.innerHTML = rows.length
          ? `<div class="table-wrap"><table><thead><tr><th>Item</th><th>Category</th><th class="right">Available</th><th class="right">Reorder at</th><th>Status</th><th>Next expiry</th><th>Supplier</th></tr></thead><tbody>${rows
              .map(
                (i) => `<tr><td><a class="link" href="#/items/${i.id}">${esc(i.name)}</a><span class="sub">${esc([i.code, i.storage_location].filter(Boolean).join(" · "))}</span></td>
                <td>${esc(i.category)}</td><td class="right num"><strong>${i.available_stock}</strong> <span class="muted small">${esc(i.unit)}</span>${i.expired_stock ? `<span class="sub" style="color:var(--danger)">+${i.expired_stock} expired</span>` : ""}</td>
                <td class="right num">${i.reorder_level}</td><td>${statusBadge(i.status)}</td><td>${i.tracks_expiry ? expiryBadge(i.next_expiry) : '<span class="muted">n/a</span>'}</td><td>${esc(i.supplier_name || "—")}</td></tr>`
              )
              .join("")}</tbody></table></div>`
          : `<div class="empty">${items.length ? "No items match these filters." : "No items yet. Add your first item to get started."}</div>`;
        $("#items-count").textContent = `${rows.length} of ${items.length} items`;
      };
      $("#f-q").addEventListener("input", (e) => { f.q = e.target.value; draw(); });
      $("#f-cat").addEventListener("change", (e) => { f.category = e.target.value; draw(); });
      $("#f-status").addEventListener("change", (e) => { f.status = e.target.value; draw(); });
      draw();
    });
    const st = [["", "All statuses"], ["ok", "In stock"], ["low", "Low stock"], ["out", "Out of stock"], ["expiring", "Expiring soon"], ["expired", "Has expired stock"]];
    return `${pageHead("Items & stock", "Everything on your shelves, with live stock levels", `<a class="btn ghost" href="/api/export/items.csv">Export CSV</a><button class="btn" data-action="new-item">+ Add item</button>`)}
      <section class="panel"><div class="toolbar">
        <input type="search" id="f-q" placeholder="Search by name or code…" value="${esc(f.q)}" aria-label="Search items">
        <select id="f-cat" aria-label="Category"><option value="">All categories</option>${state.categories.map((c) => `<option${c === f.category ? " selected" : ""}>${esc(c)}</option>`).join("")}</select>
        <select id="f-status" aria-label="Status">${st.map(([v, l]) => `<option value="${v}"${v === f.status ? " selected" : ""}>${l}</option>`).join("")}</select>
        <span class="muted small" id="items-count"></span></div>
        <div id="items-table"></div></section>`;
  }

  function itemFormHtml(it, suppliers) {
    it = it || { tracks_expiry: 1, unit: "units", reorder_level: 0, category: "Medicine" };
    return `<label class="field">Item name<input type="text" name="name" value="${esc(it.name || "")}" maxlength="120" required></label>
      <div class="grid2"><label class="field">Item code <span class="hint">(optional, unique)</span><input type="text" name="code" value="${esc(it.code || "")}" maxlength="40"></label>
      <label class="field">Category<select name="category">${state.categories.map((c) => `<option${c === it.category ? " selected" : ""}>${esc(c)}</option>`).join("")}</select></label></div>
      <div class="grid3"><label class="field">Unit<input type="text" name="unit" value="${esc(it.unit)}" maxlength="20" placeholder="strips, vials, pcs"></label>
      <label class="field">Reorder level<input type="number" name="reorder_level" min="0" step="1" value="${esc(it.reorder_level)}"></label>
      <label class="field">Storage location<input type="text" name="storage_location" value="${esc(it.storage_location || "")}" maxlength="80" placeholder="Rack B-2"></label></div>
      <label class="field">Default supplier<select name="supplier_id">${options(suppliers, "id", (s) => s.name, it.supplier_id ?? "", "— None —")}</select></label>
      <label class="check"><input type="checkbox" name="tracks_expiry"${it.tracks_expiry ? " checked" : ""}> Track batch expiry dates (medicines, reagents, sterile items)</label>
      <label class="field">Notes<textarea name="notes" maxlength="500">${esc(it.notes || "")}</textarea></label>`;
  }

  async function openItemModal(item) {
    const suppliers = await api("/suppliers");
    openModal(item ? "Edit item" : "Add item", itemFormHtml(item, suppliers), async (data) => {
      if (item) await api("/items/" + item.id, { method: "PUT", body: data });
      else await api("/items", { method: "POST", body: data });
      toast(item ? "Item updated." : "Item added.");
      reload();
    }, item ? "Save changes" : "Add item");
  }

  /* ================= item detail ================= */
  async function viewItem(id) {
    const { item, batches, movements } = await api("/items/" + id);
    document.title = item.name + " — Redora";
    view()._item = item;
    const isAdmin = state.user.role === "admin";
    const batchRows = batches.length
      ? `<div class="table-wrap"><table><thead><tr><th>Batch</th><th>Expiry</th><th class="right">In stock</th><th class="right">Unit cost</th><th>Received</th><th></th></tr></thead><tbody>${batches
          .map(
            (b) => `<tr><td>${esc(b.batch_no)}</td><td>${item.tracks_expiry ? expiryBadge(b.expiry_date) : "—"}</td><td class="right num"><strong>${b.quantity}</strong> <span class="muted small">${esc(item.unit)}</span></td>
            <td class="right num">${b.unit_cost != null ? b.unit_cost.toFixed(2) : "—"}</td><td class="small muted">${fmtTime(b.received_at)}</td>
            <td class="right" style="white-space:nowrap">${b.quantity > 0 ? `<button class="btn sm danger" data-action="writeoff" data-batch="${b.id}" data-batchno="${esc(b.batch_no)}" data-qty="${b.quantity}">Write off</button>` : ""}
            ${isAdmin ? ` <button class="btn sm ghost" data-action="adjust" data-batch="${b.id}" data-batchno="${esc(b.batch_no)}" data-qty="${b.quantity}">Correct count</button>` : ""}</td></tr>`
          )
          .join("")}</tbody></table></div>`
      : '<div class="empty">No stock received yet.</div>';
    return `<a class="back" href="#/items">← All items</a>
      ${pageHead(item.name, [item.code, item.category].filter(Boolean).join(" · "),
        `<a class="btn" href="#/stock-in?item=${item.id}">Receive stock</a><a class="btn ghost" href="#/stock-out?item=${item.id}">Issue stock</a><button class="btn ghost" data-action="edit-item">Edit</button>${isAdmin ? '<button class="btn danger" data-action="deactivate-item">Deactivate</button>' : ""}`)}
      <div class="facts">
        <div class="fact"><div class="l">Available</div><div class="v">${item.available_stock} ${esc(item.unit)}</div><div>${statusBadge(item.status)}</div></div>
        <div class="fact"><div class="l">Reorder level</div><div class="v">${item.reorder_level}</div></div>
        <div class="fact"><div class="l">Supplier</div><div class="v" style="font-size:1.05rem">${esc(item.supplier_name || "—")}</div></div>
        <div class="fact"><div class="l">Location</div><div class="v" style="font-size:1.05rem">${esc(item.storage_location || "—")}</div></div>
      </div>
      ${item.expired_stock ? `<div class="form-error">${item.expired_stock} ${esc(item.unit)} of expired stock is on hand and can't be issued. Write it off below once it's removed from the shelf.</div>` : ""}
      ${item.notes ? `<p class="muted">${esc(item.notes)}</p>` : ""}
      <section class="panel" style="margin-bottom:18px"><div class="panel-head"><h2>Batches</h2></div>${batchRows}</section>
      <section class="panel"><div class="panel-head"><h2>Movement history</h2></div>${movementTable(movements, { showItem: false })}</section>`;
  }

  function writeoffModal(batchId, batchNo, qty) {
    openModal(`Write off batch ${batchNo}`, `<label class="field">Quantity to write off <span class="hint">(up to ${qty})</span><input type="number" name="quantity" min="1" max="${qty}" step="1" value="${qty}" required></label>
      <label class="field">Reason<input type="text" name="reason" maxlength="200" placeholder="Expired, damaged, contaminated…" required></label>`,
      async (data) => {
        await api("/stock/writeoff", { method: "POST", body: { batch_id: batchId, quantity: data.quantity, reason: data.reason } });
        toast("Stock written off.");
        reload();
      }, "Write off");
  }
  function adjustModal(batchId, batchNo, qty) {
    openModal(`Correct count — batch ${batchNo}`, `<p class="muted">Recorded quantity: <strong>${qty}</strong>. Use this after a physical stock count. The correction is logged in history.</p>
      <label class="field">Actual quantity counted<input type="number" name="new_quantity" min="0" step="1" value="${qty}" required></label>
      <label class="field">Reason<input type="text" name="reason" maxlength="200" placeholder="Stock count, data entry error…" required></label>`,
      async (data) => {
        await api("/stock/adjust", { method: "POST", body: { batch_id: batchId, new_quantity: data.new_quantity, reason: data.reason } });
        toast("Stock count corrected.");
        reload();
      }, "Save correction");
  }

  /* ================= receive stock ================= */
  async function viewStockIn(params) {
    document.title = "Receive stock — Redora";
    const [items, suppliers, recent] = await Promise.all([api("/items"), api("/suppliers"), api("/movements?type=in&limit=8")]);
    const pre = params.get("item") || "";
    after(() => {
      const form = $("#in-form");
      const sel = $("[name=item_id]", form);
      const hint = $("#in-hint");
      const expiryField = $("#expiry-field");
      const update = () => {
        const it = items.find((i) => String(i.id) === sel.value);
        if (!it) { hint.classList.add("hidden"); return; }
        hint.classList.remove("hidden");
        hint.textContent = `Currently ${it.available_stock} ${it.unit} available${it.reorder_level ? ` · reorder at ${it.reorder_level}` : ""}.`;
        expiryField.classList.toggle("hidden", !it.tracks_expiry);
        $("[name=expiry_date]", form).required = !!it.tracks_expiry;
        if (it.supplier_id) $("[name=supplier_id]", form).value = it.supplier_id;
        $("[name=batch_no]", form).placeholder = it.tracks_expiry ? "From the pack label" : "Optional";
      };
      sel.addEventListener("change", update);
      update();
      bindForm(form, async (data) => {
        if (!data.item_id) throw new Error("Choose an item.");
        await api("/stock/in", { method: "POST", body: data });
        toast("Stock received.");
        reload();
      });
    });
    return `${pageHead("Receive stock", "Record a delivery from a supplier — each batch is tracked with its own expiry date")}
      <div class="cols2" style="align-items:start">
        <section class="panel"><div class="panel-body"><form id="in-form" novalidate><div class="form-error" role="alert"></div>
          <label class="field">Item<select name="item_id" required>${options(items, "id", (i) => i.name + (i.code ? ` (${i.code})` : ""), pre, "Select an item…")}</select></label>
          <div class="stock-hint hidden" id="in-hint"></div>
          <div class="grid2"><label class="field">Batch / lot number<input type="text" name="batch_no" maxlength="40"></label>
          <label class="field">Quantity received<input type="number" name="quantity" min="1" step="1" required></label></div>
          <div id="expiry-field"><label class="field">Expiry date<input type="date" name="expiry_date" min="${new Date().toISOString().slice(0, 10)}"></label></div>
          <div class="grid2"><label class="field">Unit cost <span class="hint">(optional)</span><input type="number" name="unit_cost" min="0" step="0.01"></label>
          <label class="field">Supplier<select name="supplier_id">${options(suppliers, "id", (s) => s.name, "", "— None —")}</select></label></div>
          <label class="field">Invoice / PO number <span class="hint">(optional)</span><input type="text" name="reference" maxlength="80"></label>
          <label class="field">Notes <span class="hint">(optional)</span><input type="text" name="notes" maxlength="300"></label>
          <button class="btn" type="submit">Receive stock</button></form></div></section>
        <section class="panel"><div class="panel-head"><h2>Recently received</h2></div>${movementTable(recent)}</section>
      </div>`;
  }

  /* ================= issue stock ================= */
  async function viewStockOut(params) {
    document.title = "Issue stock — Redora";
    const [items, depts, recent] = await Promise.all([api("/items"), api("/departments"), api("/movements?type=out&limit=8")]);
    const pre = params.get("item") || "";
    after(() => {
      const form = $("#out-form");
      const sel = $("[name=item_id]", form);
      const hint = $("#out-hint");
      const qty = $("[name=quantity]", form);
      const update = () => {
        const it = items.find((i) => String(i.id) === sel.value);
        if (!it) { hint.classList.add("hidden"); qty.removeAttribute("max"); return; }
        hint.classList.remove("hidden");
        hint.classList.toggle("warn", it.available_stock <= 0);
        hint.textContent = it.available_stock <= 0
          ? `None available to issue${it.expired_stock ? ` (${it.expired_stock} ${it.unit} expired)` : ""}.`
          : `${it.available_stock} ${it.unit} available — oldest-expiry batches are issued first.${it.expired_stock ? ` ${it.expired_stock} expired ${it.unit} excluded.` : ""}`;
        qty.max = Math.max(it.available_stock, 1);
      };
      sel.addEventListener("change", update);
      update();
      bindForm(form, async (data) => {
        if (!data.item_id) throw new Error("Choose an item.");
        await api("/stock/out", { method: "POST", body: data });
        toast("Stock issued.");
        reload();
      });
    });
    return `${pageHead("Issue stock", "Record stock leaving the store for a ward or department")}
      <div class="cols2" style="align-items:start">
        <section class="panel"><div class="panel-body"><form id="out-form" novalidate><div class="form-error" role="alert"></div>
          <label class="field">Item<select name="item_id" required>${options(items, "id", (i) => `${i.name}${i.code ? ` (${i.code})` : ""} — ${i.available_stock} ${i.unit}`, pre, "Select an item…")}</select></label>
          <div class="stock-hint hidden" id="out-hint"></div>
          <div class="grid2"><label class="field">Quantity<input type="number" name="quantity" min="1" step="1" required></label>
          <label class="field">Issue to department<select name="department_id" required>${options(depts, "id", (d) => d.name, "", "Select…")}</select></label></div>
          <label class="field">Requisition / indent number <span class="hint">(optional)</span><input type="text" name="reference" maxlength="80"></label>
          <label class="field">Notes <span class="hint">(optional)</span><input type="text" name="notes" maxlength="300"></label>
          <button class="btn" type="submit">Issue stock</button></form></div></section>
        <section class="panel"><div class="panel-head"><h2>Recently issued</h2></div>${movementTable(recent)}</section>
      </div>`;
  }

  /* ================= history ================= */
  async function viewHistory() {
    document.title = "History — Redora";
    after(() => {
      let rows = [];
      const q = $("#h-q"), type = $("#h-type"), from = $("#h-from"), to = $("#h-to"), out = $("#h-table"), exp = $("#h-export");
      const draw = () => {
        const term = q.value.trim().toLowerCase();
        const shown = term ? rows.filter((r) => (r.item_name + " " + (r.batch_no || "") + " " + (r.reference || "") + " " + (r.department || "")).toLowerCase().includes(term)) : rows;
        out.innerHTML = movementTable(shown);
        $("#h-count").textContent = `${shown.length} record${shown.length === 1 ? "" : "s"}${rows.length >= 500 ? " (latest 500)" : ""}`;
      };
      const load = async () => {
        const qs = new URLSearchParams({ limit: 500 });
        if (type.value) qs.set("type", type.value);
        if (from.value) qs.set("from", from.value);
        if (to.value) qs.set("to", to.value);
        out.innerHTML = '<div class="empty">Loading…</div>';
        try {
          rows = await api("/movements?" + qs);
          const ex = new URLSearchParams(qs); ex.delete("limit");
          exp.href = "/api/export/movements.csv?" + ex;
          draw();
        } catch (e) { out.innerHTML = `<div class="form-error">${esc(e.message)}</div>`; }
      };
      [type, from, to].forEach((el) => el.addEventListener("change", load));
      q.addEventListener("input", draw);
      load();
    });
    return `${pageHead("Stock history", "A permanent log of every receipt, issue, write-off and correction", '<a class="btn ghost" id="h-export" href="/api/export/movements.csv">Export CSV</a>')}
      <section class="panel"><div class="toolbar">
        <input type="search" id="h-q" placeholder="Search item, batch, reference, department…" aria-label="Search history">
        <select id="h-type" aria-label="Type"><option value="">All types</option><option value="in">Received</option><option value="out">Issued</option><option value="writeoff">Written off</option><option value="adjust">Corrections</option></select>
        <label class="small muted">From <input type="date" id="h-from"></label><label class="small muted">To <input type="date" id="h-to"></label>
        <span class="muted small" id="h-count"></span></div><div id="h-table"></div></section>`;
  }

  /* ================= suppliers ================= */
  function supplierFormHtml(s = {}) {
    return `<label class="field">Supplier name<input type="text" name="name" value="${esc(s.name || "")}" maxlength="120" required></label>
      <div class="grid2"><label class="field">Contact person<input type="text" name="contact_person" value="${esc(s.contact_person || "")}" maxlength="100"></label>
      <label class="field">Phone<input type="text" name="phone" value="${esc(s.phone || "")}" maxlength="40"></label></div>
      <label class="field">Email<input type="email" name="email" value="${esc(s.email || "")}" maxlength="120"></label>
      <label class="field">Address<textarea name="address" maxlength="250">${esc(s.address || "")}</textarea></label>`;
  }
  async function viewSuppliers() {
    document.title = "Suppliers — Redora";
    const suppliers = await api("/suppliers");
    view()._suppliers = suppliers;
    const isAdmin = state.user.role === "admin";
    return `${pageHead("Suppliers", "Vendors you buy medicines and supplies from", '<button class="btn" data-action="new-supplier">+ Add supplier</button>')}
      <section class="panel">${suppliers.length
        ? `<div class="table-wrap"><table><thead><tr><th>Supplier</th><th>Contact</th><th>Phone</th><th>Email</th><th class="right">Items</th><th></th></tr></thead><tbody>${suppliers
            .map(
              (s) => `<tr><td><strong>${esc(s.name)}</strong>${s.address ? `<span class="sub">${esc(s.address)}</span>` : ""}</td><td>${esc(s.contact_person || "—")}</td>
              <td>${s.phone ? `<a href="tel:${esc(s.phone)}">${esc(s.phone)}</a>` : "—"}</td><td>${s.email ? `<a href="mailto:${esc(s.email)}">${esc(s.email)}</a>` : "—"}</td><td class="right num">${s.item_count}</td>
              <td class="right" style="white-space:nowrap"><button class="btn sm ghost" data-action="edit-supplier" data-id="${s.id}">Edit</button>${isAdmin ? ` <button class="btn sm danger" data-action="delete-supplier" data-id="${s.id}">Remove</button>` : ""}</td></tr>`
            )
            .join("")}</tbody></table></div>`
        : '<div class="empty">No suppliers yet.</div>'}</section>`;
  }
  function openSupplierModal(s) {
    openModal(s ? "Edit supplier" : "Add supplier", supplierFormHtml(s), async (data) => {
      if (s) await api("/suppliers/" + s.id, { method: "PUT", body: data });
      else await api("/suppliers", { method: "POST", body: data });
      toast(s ? "Supplier updated." : "Supplier added.");
      reload();
    }, s ? "Save changes" : "Add supplier");
  }

  /* ================= settings ================= */
  async function viewSettings() {
    document.title = "Settings — Redora";
    const isAdmin = state.user.role === "admin";
    const [depts, users] = await Promise.all([api("/departments"), isAdmin ? api("/users") : Promise.resolve([])]);
    view()._users = users;
    after(() => {
      const pw = $("#pw-form");
      bindForm(pw, async (data, f) => {
        await api("/me/password", { method: "POST", body: data });
        f.reset();
        toast("Password changed.");
      });
      const dep = $("#dept-form");
      if (dep) bindForm(dep, async (data, f) => {
        await api("/departments", { method: "POST", body: { name: data.name } });
        toast("Department added.");
        reload();
      });
    });
    return `${pageHead("Settings", `Signed in as ${state.user.name} (${state.user.username})`)}
      <div class="cols2" style="align-items:start">
        <section class="panel"><div class="panel-head"><h2>Change password</h2></div><div class="panel-body"><form id="pw-form" novalidate><div class="form-error" role="alert"></div>
          <label class="field">Current password<input type="password" name="current_password" autocomplete="current-password" required></label>
          <label class="field">New password <span class="hint">(8+ characters)</span><input type="password" name="new_password" autocomplete="new-password" minlength="8" required></label>
          <button class="btn" type="submit">Update password</button></form></div></section>
        <section class="panel"><div class="panel-head"><h2>Departments</h2></div><div class="panel-body">
          <p class="muted small" style="margin-top:0">Stock is issued to these departments.</p>
          <ul style="list-style:none;padding:0;margin:0 0 14px">${depts
            .map((d) => `<li style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--line)">${esc(d.name)}${isAdmin ? `<button class="btn sm danger" data-action="del-dept" data-id="${d.id}">Remove</button>` : ""}</li>`)
            .join("")}</ul>
          ${isAdmin ? `<form id="dept-form" novalidate><div class="form-error" role="alert"></div><div style="display:flex;gap:8px"><input type="text" name="name" placeholder="New department name" maxlength="80" required style="margin:0"><button class="btn" type="submit">Add</button></div></form>` : ""}</div></section>
      </div>
      ${isAdmin ? `<section class="panel"><div class="panel-head"><h2>Users</h2><button class="btn sm" data-action="new-user">+ Add user</button></div>
        <div class="table-wrap"><table><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>${users
          .map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.username)}</td><td>${u.role === "admin" ? "Administrator" : "Staff"}</td><td>${u.active ? '<span class="badge ok">Active</span>' : '<span class="badge adjust">Disabled</span>'}</td>
            <td class="right"><button class="btn sm ghost" data-action="edit-user" data-id="${u.id}">Edit</button></td></tr>`)
          .join("")}</tbody></table></div></section>` : ""}`;
  }

  function openUserModal(u) {
    const body = u
      ? `<p><strong>${esc(u.name)}</strong> <span class="muted">(${esc(u.username)})</span></p>
         <label class="field">Role<select name="role"><option value="staff"${u.role === "staff" ? " selected" : ""}>Staff</option><option value="admin"${u.role === "admin" ? " selected" : ""}>Administrator</option></select></label>
         <label class="check"><input type="checkbox" name="active"${u.active ? " checked" : ""}> Account is active</label>
         <label class="field">Reset password <span class="hint">(leave blank to keep the current one)</span><input type="password" name="password" autocomplete="new-password" minlength="8"></label>`
      : `<div class="grid2"><label class="field">Full name<input type="text" name="name" maxlength="80" required></label>
         <label class="field">Username<input type="text" name="username" maxlength="40" autocapitalize="none" required></label></div>
         <div class="grid2"><label class="field">Role<select name="role"><option value="staff">Staff</option><option value="admin">Administrator</option></select></label>
         <label class="field">Temporary password <span class="hint">(8+ chars)</span><input type="password" name="password" autocomplete="new-password" minlength="8" required></label></div>
         <p class="muted small">Staff can receive and issue stock and manage items and suppliers. Administrators can also correct counts, remove records and manage users.</p>`;
    openModal(u ? "Edit user" : "Add user", body, async (data) => {
      if (u) {
        const payload = { role: data.role, active: data.active };
        if (data.password) payload.password = data.password;
        await api("/users/" + u.id, { method: "PUT", body: payload });
      } else {
        await api("/users", { method: "POST", body: data });
      }
      toast(u ? "User updated." : "User added.");
      reload();
    }, u ? "Save changes" : "Add user");
  }

  /* ================= actions (event delegation) ================= */
  const actions = {
    "close-modal": () => closeModal(),
    logout: async () => {
      try { await api("/logout", { method: "POST" }); } catch { /* ignore */ }
      state.user = null;
      location.hash = "";
      showLogin();
    },
    "new-item": () => openItemModal(null),
    "edit-item": () => openItemModal(view()._item),
    "deactivate-item": async () => {
      const it = view()._item;
      if (!confirm(`Deactivate "${it.name}"? Its history is kept, but it will be hidden from lists.`)) return;
      try { await api("/items/" + it.id, { method: "DELETE" }); toast("Item deactivated."); location.hash = "#/items"; }
      catch (e) { toast(e.message, true); }
    },
    writeoff: (el) => writeoffModal(Number(el.dataset.batch), el.dataset.batchno, Number(el.dataset.qty)),
    adjust: (el) => adjustModal(Number(el.dataset.batch), el.dataset.batchno, Number(el.dataset.qty)),
    "new-supplier": () => openSupplierModal(null),
    "edit-supplier": (el) => openSupplierModal(view()._suppliers.find((s) => s.id === Number(el.dataset.id))),
    "delete-supplier": async (el) => {
      const s = view()._suppliers.find((x) => x.id === Number(el.dataset.id));
      if (!confirm(`Remove supplier "${s.name}"? Items using it will have no default supplier.`)) return;
      try { await api("/suppliers/" + s.id, { method: "DELETE" }); toast("Supplier removed."); reload(); }
      catch (e) { toast(e.message, true); }
    },
    "del-dept": async (el) => {
      if (!confirm("Remove this department?")) return;
      try { await api("/departments/" + el.dataset.id, { method: "DELETE" }); toast("Department removed."); reload(); }
      catch (e) { toast(e.message, true); }
    },
    "new-user": () => openUserModal(null),
    "edit-user": (el) => openUserModal(view()._users.find((u) => u.id === Number(el.dataset.id))),
  };

  document.addEventListener("click", (e) => {
    if (e.target.id === "modal") return closeModal();
    const el = e.target.closest("[data-action]");
    if (el && actions[el.dataset.action]) actions[el.dataset.action](el, e);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

  /* ================= start ================= */
  bootstrap().then(() => { if (!state.user) showLogin(); });
})();
