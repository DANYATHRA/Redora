(() => {
  "use strict";

  /* ================= helpers ================= */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const state = { user: null, categories: [], warnDays: 90, stores: [] };
  let routeToken = 0;

  const ICONS = {
    dashboard: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>',
    items: '<svg viewBox="0 0 24 24"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>',
    in: '<svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 21h16"/></svg>',
    out: '<svg viewBox="0 0 24 24"><path d="M12 15V3"/><path d="M7 8l5-5 5 5"/><path d="M4 21h16"/></svg>',
    transfers: '<svg viewBox="0 0 24 24"><path d="M7 16V4m0 0L3 8m4-4l4 4m6 4v12m0 0l4-4m-4 4l-4-4"/></svg>',
    po: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
    reports: '<svg viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="M7 16l4-4 4 2 5-6"/></svg>',
    stocktake: '<svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    history: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    suppliers: '<svg viewBox="0 0 24 24"><path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7"/><circle cx="7.5" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/></svg>',
    settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    barcode: '<svg viewBox="0 0 24 24"><path d="M3 5v14M7 5v14M11 5v14M15 5v14M17 5v14M21 5v14"/></svg>',
    camera: '<svg viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
    print: '<svg viewBox="0 0 24 24"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
  };
  const LOGO = '<span class="logo"><svg viewBox="0 0 24 24"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" fill="#fff"/></svg></span>';

  const fmtDay = (d) =>
    d ? new Date(d + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";
  const fmtTime = (s) =>
    s ? new Date(s.replace(" ", "T") + "Z").toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
  const daysUntil = (d) => Math.round((new Date(d + "T00:00:00") - new Date(new Date().toDateString())) / 864e5);
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const fmtMoney = (n) => (n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function statusBadge(s) {
    const label = { ok: "In stock", low: "Low stock", out: "Out of stock" }[s] || s;
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
    const m = {
      in: ["in", "Received"],
      out: ["outmv", "Issued"],
      adjust: ["adjust", "Adjusted"],
      writeoff: ["writeoff", "Written off"],
      transfer: ["transfer", "Transferred"],
    }[t] || ["adjust", t];
    return `<span class="badge ${m[0]}">${m[1]}</span>`;
  }
  function poBadge(s) {
    const label = { draft: "Draft", ordered: "Ordered", partially_received: "Partially received", received: "Received", cancelled: "Cancelled" }[s] || s;
    return `<span class="badge ${s}">${label}</span>`;
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
    if (m) {
      // Stop any camera stream attached to modal
      if (m._stream) m._stream.getTracks().forEach((t) => t.stop());
      m.remove();
    }
  }
  function openModal(title, body, onSubmit, submitLabel = "Save", isLarge = false) {
    closeModal();
    const el = document.createElement("div");
    el.className = "backdrop";
    el.id = "modal";
    el.innerHTML = `<div class="modal ${isLarge ? "large" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h2>${esc(title)}</h2><button type="button" data-action="close-modal" aria-label="Close">×</button></div>
      <form novalidate><div class="form-error" role="alert"></div>${body}
        <div class="modal-foot">
          <button type="button" class="btn ghost" data-action="close-modal">Cancel</button>
          ${onSubmit ? `<button class="btn" type="submit">${esc(submitLabel)}</button>` : ""}
        </div></form></div>`;
    document.body.appendChild(el);
    const form = $("form", el);
    if (onSubmit) {
      bindForm(form, async (data, f) => {
        await onSubmit(data, f);
        closeModal();
      });
    }
    const first = $("input:not([type=checkbox]), select, textarea", form);
    if (first) first.focus();
    return el;
  }

  /* ================= barcode & QR scanner ================= */
  function openBarcodeScanner(onScanned) {
    const body = `
      <div class="scanner-box" id="scanner-viewport">
        <video id="scanner-video" playsinline autoplay muted></video>
        <div class="scanner-overlay"></div>
        <div class="scanner-scanline"></div>
      </div>
      <label class="field">Or scan / type with handheld barcode scanner
        <div style="display:flex;gap:8px;margin-top:6px">
          <input type="text" id="manual-barcode-input" placeholder="Point barcode scanner or enter code…" autofocus>
          <button type="button" class="btn" id="manual-barcode-btn">Lookup</button>
        </div>
      </label>
      <p class="muted small">Supports camera detection on mobile/laptop or standard USB/Bluetooth handheld barcode guns.</p>
    `;
    const modal = openModal("Scan Barcode or QR Code", body, null, "", false);
    const video = $("#scanner-video", modal);
    const manualInput = $("#manual-barcode-input", modal);
    const manualBtn = $("#manual-barcode-btn", modal);

    const finishScan = (code) => {
      if (!code) return;
      closeModal();
      onScanned(code.trim());
    };

    manualBtn.addEventListener("click", () => finishScan(manualInput.value));
    manualInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finishScan(manualInput.value);
      }
    });

    // Attempt camera detection using BarcodeDetector if available
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
        .then((stream) => {
          modal._stream = stream;
          video.srcObject = stream;
          video.play();

          if ("BarcodeDetector" in window) {
            const detector = new window.BarcodeDetector();
            const scanInterval = setInterval(async () => {
              if (!document.getElementById("modal")) {
                clearInterval(scanInterval);
                return;
              }
              try {
                const barcodes = await detector.detect(video);
                if (barcodes.length > 0) {
                  clearInterval(scanInterval);
                  finishScan(barcodes[0].rawValue);
                }
              } catch {}
            }, 300);
          }
        })
        .catch(() => {
          // Camera permission denied or not available; fallback to manual input field
          const viewport = $("#scanner-viewport");
          if (viewport) viewport.innerHTML = '<div class="empty" style="padding:20px;color:#fff">Camera inactive. Use barcode gun or type code below.</div>';
        });
    }
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
      <button class="btn block" type="submit">Sign in</button>
      <div class="login-extra">
        <a href="#/forgot-password" class="muted small" data-action="forgot-password">Forgot password?</a>
        <span class="muted small">v1.2 MongoDB Multi-Store</span>
      </div></form></div>`;
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
      ["transfers", "Stock transfers", "transfers"],
      ["purchase-orders", "Purchase orders", "po"],
      ["reports", "Reports & valuation", "reports"],
      ["stock-take", "Cycle counts", "stocktake"],
      ["history", "History", "history"],
      ["suppliers", "Suppliers", "suppliers"],
      ["settings", "Settings", "settings"],
    ];
    $("#app").innerHTML = `<div class="shell">
      <aside class="sidebar">
        <div class="brand">${LOGO}Redora</div>
        <div class="nav-heading">Main</div>
        <nav class="nav" aria-label="Main">${links.slice(0, 4)
          .map(([h, label, icon]) => `<a href="#/${h}" data-nav="${h}">${ICONS[icon]}<span>${label}</span></a>`)
          .join("")}</nav>
        <div class="nav-heading">Operations</div>
        <nav class="nav" aria-label="Operations">${links.slice(4, 8)
          .map(([h, label, icon]) => `<a href="#/${h}" data-nav="${h}">${ICONS[icon]}<span>${label}</span></a>`)
          .join("")}</nav>
        <div class="nav-heading">System</div>
        <nav class="nav" aria-label="System">${links.slice(8)
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
      state.stores = me.stores || [];
    } catch {
      return;
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
    transfers: viewTransfers,
    "purchase-orders": (arg, p) => (arg ? viewPurchaseOrderDetail(Number(arg)) : viewPurchaseOrders(p)),
    reports: (_a, p) => viewReports(p),
    "stock-take": viewStockTake,
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
          : m.type === "transfer" ? (m.store && m.to_store ? `${esc(m.store)} → ${esc(m.to_store)}` : "")
          : "";
        const extra = [m.reference ? "Ref: " + esc(m.reference) : "", m.notes ? esc(m.notes) : ""].filter(Boolean).join(" · ");
        return `<tr><td class="small muted" style="white-space:nowrap">${fmtTime(m.created_at)}</td><td>${typeBadge(m.type)}</td>
          ${showItem ? `<td><a class="link" href="#/items/${m.item_id}">${esc(m.item_name)}</a></td>` : ""}
          <td>${esc(m.batch_no || "—")}${m.expiry_date ? `<span class="sub">exp ${fmtDay(m.expiry_date)}</span>` : ""}</td>
          <td class="right num"><span class="${m.quantity > 0 ? "pos" : "neg"}">${m.quantity > 0 ? "+" : ""}${m.quantity}</span> <span class="muted small">${esc(m.unit || "")}</span></td>
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

    const alertBanner = (t.low > 0 || t.expiring > 0)
      ? `<div class="alert-banner warn">
          <span>⚠️ <strong>Stock Alert:</strong> ${t.low} item(s) running low, ${t.expiring} batch(es) expiring within ${d.expiryWarnDays} days.</span>
          <button class="btn sm ghost" data-action="dispatch-alerts">Send Alert Notification</button>
        </div>`
      : "";

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

    return `${pageHead("Dashboard", `Hospital inventory overview · alerts look ${d.expiryWarnDays} days ahead`,
      '<button class="btn ghost" data-action="open-barcode-scan">' + ICONS.barcode + ' Scan item</button><a class="btn" href="#/stock-in">Receive stock</a><a class="btn ghost" href="#/stock-out">Issue stock</a>')}
      ${alertBanner}
      <div class="stats">
        ${stat(t.items, "Active items", "#/items", "s-ok")}
        ${stat(t.low, "Low stock", "#/items?status=low", "s-low")}
        ${stat(t.out, "Out of stock", "#/items?status=out", "s-out")}
        ${stat(t.expiring, "Expiring soon", "#/items?status=expiring", "s-low")}
        ${stat(t.expired, "Expired stock", "#/items?status=expired", "s-exp")}
        ${stat(t.pending_pos || 0, "Active POs", "#/purchase-orders", "s-po")}
      </div>
      <div class="cols2">
        <section class="panel"><div class="panel-head"><h2>Needs reordering</h2><a href="#/purchase-orders" class="small">Create PO</a></div>${reorder}</section>
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
          if (q && !(i.name.toLowerCase().includes(q) || (i.code || "").toLowerCase().includes(q) || (i.barcode || "").toLowerCase().includes(q))) return false;
          if (f.category && i.category !== f.category) return false;
          if (["ok", "low", "out"].includes(f.status) && i.status !== f.status) return false;
          if (f.status === "expiring" && !(i.next_expiry && daysUntil(i.next_expiry) <= state.warnDays)) return false;
          if (f.status === "expired" && !(i.expired_stock > 0)) return false;
          return true;
        });
        table.innerHTML = rows.length
          ? `<div class="table-wrap"><table><thead><tr><th>Item</th><th>Code / Barcode</th><th>Category</th><th class="right">Available</th><th class="right">Reorder at</th><th>Status</th><th>Next expiry</th><th>Supplier</th></tr></thead><tbody>${rows
              .map(
                (i) => `<tr><td><a class="link" href="#/items/${i.id}">${esc(i.name)}</a><span class="sub">${esc(i.storage_location || "—")}</span></td>
                <td><code>${esc(i.code || "—")}</code>${i.barcode ? `<span class="sub">🏷️ ${esc(i.barcode)}</span>` : ""}</td>
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
    return `${pageHead("Items & stock", "Full catalogue of hospital medicines and supplies",
      `<button class="btn ghost" data-action="open-barcode-scan">${ICONS.barcode} Scan barcode</button><a class="btn ghost" href="/api/export/items.csv">Export CSV</a><button class="btn" data-action="new-item">+ Add item</button>`)}
      <section class="panel"><div class="toolbar">
        <input type="search" id="f-q" placeholder="Search by name, code or barcode…" value="${esc(f.q)}" aria-label="Search items">
        <select id="f-cat" aria-label="Category"><option value="">All categories</option>${state.categories.map((c) => `<option${c === f.category ? " selected" : ""}>${esc(c)}</option>`).join("")}</select>
        <select id="f-status" aria-label="Status">${st.map(([v, l]) => `<option value="${v}"${v === f.status ? " selected" : ""}>${l}</option>`).join("")}</select>
        <span class="muted small" id="items-count"></span></div>
        <div id="items-table"></div></section>`;
  }

  function itemFormHtml(it, suppliers) {
    it = it || { tracks_expiry: 1, unit: "units", reorder_level: 0, category: "Medicine" };
    return `<label class="field">Item name<input type="text" name="name" value="${esc(it.name || "")}" maxlength="120" required></label>
      <div class="grid3">
        <label class="field">Item code <span class="hint">(SKU)</span><input type="text" name="code" value="${esc(it.code || "")}" maxlength="40"></label>
        <label class="field">Barcode / EAN <span class="hint">(optional)</span><input type="text" name="barcode" value="${esc(it.barcode || "")}" maxlength="60"></label>
        <label class="field">Category<select name="category">${state.categories.map((c) => `<option${c === it.category ? " selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
      </div>
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

  /* ================= item detail & audit log ================= */
  async function viewItem(id) {
    const { item, batches, movements, audits } = await api("/items/" + id);
    document.title = item.name + " — Redora";
    view()._item = item;
    const isAdmin = state.user.role === "admin";

    const batchRows = batches.length
      ? `<div class="table-wrap"><table><thead><tr><th>Batch</th><th>Store</th><th>Expiry</th><th class="right">In stock</th><th class="right">Unit cost</th><th>Received</th><th></th></tr></thead><tbody>${batches
          .map(
            (b) => `<tr><td><strong>${esc(b.batch_no)}</strong></td><td>Store #${b.store_id || 1}</td><td>${item.tracks_expiry ? expiryBadge(b.expiry_date) : "—"}</td><td class="right num"><strong>${b.quantity}</strong> <span class="muted small">${esc(item.unit)}</span></td>
            <td class="right num">${b.unit_cost != null ? fmtMoney(b.unit_cost) : "—"}</td><td class="small muted">${fmtTime(b.received_at)}</td>
            <td class="right" style="white-space:nowrap">${b.quantity > 0 ? `<button class="btn sm danger" data-action="writeoff" data-batch="${b.id}" data-batchno="${esc(b.batch_no)}" data-qty="${b.quantity}">Write off</button>` : ""}
            ${isAdmin ? ` <button class="btn sm ghost" data-action="adjust" data-batch="${b.id}" data-batchno="${esc(b.batch_no)}" data-qty="${b.quantity}">Correct count</button>` : ""}</td></tr>`
          )
          .join("")}</tbody></table></div>`
      : '<div class="empty">No stock received yet.</div>';

    const auditRows = audits && audits.length
      ? `<div class="table-wrap"><table><thead><tr><th>Date & Time</th><th>User</th><th>Action</th><th>Changes Made</th></tr></thead><tbody>${audits
          .map((a) => {
            const chDesc = (a.changes || []).map((c) => `<strong>${esc(c.field)}</strong>: "${esc(c.old_value)}" → "${esc(c.new_value)}"`).join("; ");
            return `<tr><td class="small muted">${fmtTime(a.created_at)}</td><td>${esc(a.user_name || "System")}</td><td><span class="badge ${a.action === "create" ? "ok" : "adjust"}">${esc(a.action)}</span></td><td class="small">${chDesc}</td></tr>`;
          })
          .join("")}</tbody></table></div>`
      : '<div class="empty">No changes logged yet. Every edit made to item details will be recorded here.</div>';

    after(() => {
      $$(".tab").forEach((tab) => {
        tab.addEventListener("click", () => {
          $$(".tab").forEach((t) => t.classList.remove("active"));
          $$(".tab-content").forEach((c) => c.classList.add("hidden"));
          tab.classList.add("active");
          const target = $("#" + tab.dataset.target);
          if (target) target.classList.remove("hidden");
        });
      });
    });

    return `<a class="back" href="#/items">← All items</a>
      ${pageHead(item.name, [item.code, item.barcode ? `Barcode: ${item.barcode}` : null, item.category].filter(Boolean).join(" · "),
        `<a class="btn" href="#/stock-in?item=${item.id}">Receive stock</a><a class="btn ghost" href="#/stock-out?item=${item.id}">Issue stock</a><button class="btn ghost" data-action="edit-item">Edit</button>${isAdmin ? '<button class="btn danger" data-action="deactivate-item">Deactivate</button>' : ""}`)}
      <div class="facts">
        <div class="fact"><div class="l">Available</div><div class="v">${item.available_stock} ${esc(item.unit)}</div><div>${statusBadge(item.status)}</div></div>
        <div class="fact"><div class="l">Reorder level</div><div class="v">${item.reorder_level}</div></div>
        <div class="fact"><div class="l">Supplier</div><div class="v" style="font-size:1.05rem">${esc(item.supplier_name || "—")}</div></div>
        <div class="fact"><div class="l">Location</div><div class="v" style="font-size:1.05rem">${esc(item.storage_location || "—")}</div></div>
      </div>
      ${item.expired_stock ? `<div class="form-error">${item.expired_stock} ${esc(item.unit)} of expired stock is on hand and can't be issued. Write it off below once it's removed from the shelf.</div>` : ""}
      ${item.notes ? `<p class="muted">${esc(item.notes)}</p>` : ""}

      <div class="tabs">
        <button class="tab active" data-target="tab-batches">Batches on hand (${batches.length})</button>
        <button class="tab" data-target="tab-movements">Stock movements</button>
        <button class="tab" data-target="tab-audit">Change log (${(audits || []).length})</button>
      </div>

      <div id="tab-batches" class="tab-content">
        <section class="panel"><div class="panel-head"><h2>Batch breakdown</h2></div>${batchRows}</section>
      </div>
      <div id="tab-movements" class="tab-content hidden">
        <section class="panel"><div class="panel-head"><h2>Movement history</h2></div>${movementTable(movements, { showItem: false })}</section>
      </div>
      <div id="tab-audit" class="tab-content hidden">
        <section class="panel"><div class="panel-head"><h2>Item change log</h2><span class="muted small">Full audit trail of all detail modifications</span></div>${auditRows}</section>
      </div>`;
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
    const [items, suppliers, stores, recent] = await Promise.all([
      api("/items"),
      api("/suppliers"),
      api("/stores"),
      api("/movements?type=in&limit=8"),
    ]);
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
    return `${pageHead("Receive stock", "Record a delivery from a supplier into a store", `<button class="btn ghost" data-action="open-barcode-scan">${ICONS.barcode} Scan item barcode</button>`)}
      <div class="cols2" style="align-items:start">
        <section class="panel"><div class="panel-body"><form id="in-form" novalidate><div class="form-error" role="alert"></div>
          <div class="grid2">
            <label class="field">Store / Branch<select name="store_id">${options(stores, "id", (s) => s.name, 1)}</select></label>
            <label class="field">Item<select name="item_id" required>${options(items, "id", (i) => i.name + (i.code ? ` (${i.code})` : ""), pre, "Select an item…")}</select></label>
          </div>
          <div class="stock-hint hidden" id="in-hint"></div>
          <div class="grid2"><label class="field">Batch / lot number<input type="text" name="batch_no" maxlength="40"></label>
          <label class="field">Quantity received<input type="number" name="quantity" min="1" step="1" required></label></div>
          <div id="expiry-field"><label class="field">Expiry date<input type="date" name="expiry_date" min="${new Date().toISOString().slice(0, 10)}"></label></div>
          <div class="grid2"><label class="field">Unit cost (₹ / $)<input type="number" name="unit_cost" min="0" step="0.01"></label>
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
    const [items, depts, stores, recent] = await Promise.all([
      api("/items"),
      api("/departments"),
      api("/stores"),
      api("/movements?type=out&limit=8"),
    ]);
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
    return `${pageHead("Issue stock", "Dispense medicine or supplies to a hospital ward or clinic", `<button class="btn ghost" data-action="open-barcode-scan">${ICONS.barcode} Scan item barcode</button>`)}
      <div class="cols2" style="align-items:start">
        <section class="panel"><div class="panel-body"><form id="out-form" novalidate><div class="form-error" role="alert"></div>
          <div class="grid2">
            <label class="field">From store<select name="store_id">${options(stores, "id", (s) => s.name, 1)}</select></label>
            <label class="field">Item<select name="item_id" required>${options(items, "id", (i) => `${i.name}${i.code ? ` (${i.code})` : ""} — ${i.available_stock} ${i.unit}`, pre, "Select an item…")}</select></label>
          </div>
          <div class="stock-hint hidden" id="out-hint"></div>
          <div class="grid2"><label class="field">Quantity<input type="number" name="quantity" min="1" step="1" required></label>
          <label class="field">Issue to department<select name="department_id" required>${options(depts, "id", (d) => d.name, "", "Select…")}</select></label></div>
          <label class="field">Requisition / indent number <span class="hint">(optional)</span><input type="text" name="reference" maxlength="80"></label>
          <label class="field">Notes <span class="hint">(optional)</span><input type="text" name="notes" maxlength="300"></label>
          <button class="btn" type="submit">Issue stock</button></form></div></section>
        <section class="panel"><div class="panel-head"><h2>Recently issued</h2></div>${movementTable(recent)}</section>
      </div>`;
  }

  /* ================= stock transfers between stores ================= */
  async function viewTransfers() {
    document.title = "Stock transfers — Redora";
    const [stores, items, recentTransfers] = await Promise.all([
      api("/stores"),
      api("/items"),
      api("/movements?type=transfer&limit=15"),
    ]);

    after(() => {
      const form = $("#transfer-form");
      const fromSel = $("[name=from_store_id]", form);
      const toSel = $("[name=to_store_id]", form);
      const itemSel = $("[name=item_id]", form);
      const batchSel = $("[name=batch_id]", form);
      const hint = $("#trf-hint");

      const loadBatches = async () => {
        const itemId = itemSel.value;
        const fromId = fromSel.value;
        batchSel.innerHTML = '<option value="">Loading batches…</option>';
        if (!itemId || !fromId) {
          batchSel.innerHTML = '<option value="">Select item & source store first</option>';
          hint.classList.add("hidden");
          return;
        }
        const itemData = await api("/items/" + itemId);
        const valid = (itemData.batches || []).filter((b) => Number(b.store_id || 1) === Number(fromId) && b.quantity > 0);
        batchSel.innerHTML = options(valid, "id", (b) => `Batch ${b.batch_no} (${b.quantity} on hand${b.expiry_date ? `, exp ${fmtDay(b.expiry_date)}` : ""})`, "", "Select a batch…");
      };

      fromSel.addEventListener("change", loadBatches);
      itemSel.addEventListener("change", loadBatches);
      batchSel.addEventListener("change", () => {
        const it = items.find((i) => String(i.id) === itemSel.value);
        hint.classList.remove("hidden");
        hint.textContent = `Transferring within ${it?.unit || "units"}. Ensure stock is physically moved to destination.`;
      });

      bindForm(form, async (data) => {
        if (!data.batch_id) throw new Error("Select a batch to transfer.");
        await api("/stock/transfer", { method: "POST", body: data });
        toast("Stock transferred successfully.");
        reload();
      });
    });

    return `${pageHead("Stock transfers", "Move stock between central stores, satellite pharmacies and surgical stores")}
      <div class="cols2" style="align-items:start">
        <section class="panel"><div class="panel-body"><form id="transfer-form" novalidate><div class="form-error" role="alert"></div>
          <div class="grid2">
            <label class="field">Source store (Transfer from)<select name="from_store_id" required>${options(stores, "id", (s) => s.name, 1)}</select></label>
            <label class="field">Destination store (Transfer to)<select name="to_store_id" required>${options(stores, "id", (s) => s.name, stores[1]?.id || "")}</select></label>
          </div>
          <label class="field">Item to transfer<select name="item_id" required>${options(items, "id", (i) => i.name, "", "Select item…")}</select></label>
          <label class="field">Batch<select name="batch_id" required><option value="">Select source store & item first</option></select></label>
          <div class="stock-hint hidden" id="trf-hint"></div>
          <div class="grid2">
            <label class="field">Quantity to transfer<input type="number" name="quantity" min="1" step="1" required></label>
            <label class="field">Transfer reference <span class="hint">(optional)</span><input type="text" name="reference" placeholder="e.g. TRF-ER-01" maxlength="60"></label>
          </div>
          <label class="field">Notes <span class="hint">(optional)</span><input type="text" name="notes" placeholder="Requested by ER nursing incharge…" maxlength="250"></label>
          <button class="btn" type="submit">Transfer stock</button></form></div></section>
        <section class="panel"><div class="panel-head"><h2>Recent transfers</h2></div>${movementTable(recentTransfers)}</section>
      </div>`;
  }

  /* ================= purchase orders & supplier invoices ================= */
  async function viewPurchaseOrders(params) {
    document.title = "Purchase orders — Redora";
    const status = params.get("status") || "";
    const pos = await api("/purchase-orders" + (status ? "?status=" + status : ""));
    const suppliers = await api("/suppliers");
    view()._suppliers = suppliers;

    const stOptions = [["", "All POs"], ["draft", "Drafts"], ["ordered", "Ordered"], ["partially_received", "Partially received"], ["received", "Received"], ["cancelled", "Cancelled"]];

    return `${pageHead("Purchase orders & supplier invoices", "Track supplier procurement from purchase order to delivery and invoice reconciliation",
      '<button class="btn" data-action="new-po">+ New purchase order</button>')}
      <section class="panel"><div class="toolbar">
        <select id="po-filter-status" aria-label="Status filter">${stOptions.map(([v, l]) => `<option value="${v}"${v === status ? " selected" : ""}>${l}</option>`).join("")}</select>
        <span class="muted small">${pos.length} order${pos.length === 1 ? "" : "s"}</span>
      </div>
      ${pos.length
        ? `<div class="table-wrap"><table><thead><tr><th>PO Number</th><th>Supplier</th><th>Store</th><th>Status</th><th>Invoice #</th><th class="right">Total</th><th>Date</th><th></th></tr></thead><tbody>${pos
            .map(
              (p) => `<tr><td><strong><a class="link" href="#/purchase-orders/${p.id}">${esc(p.po_number)}</a></strong></td>
              <td>${esc(p.supplier_name || "—")}</td><td>${esc(p.store_name || "Main")}</td><td>${poBadge(p.status)}</td>
              <td>${p.invoice_number ? `<code>${esc(p.invoice_number)}</code>` : '<span class="muted">—</span>'}</td>
              <td class="right num"><strong>${fmtMoney(p.total_amount)}</strong></td>
              <td class="small muted">${p.ordered_at || p.created_at.slice(0, 10)}</td>
              <td class="right"><a class="btn sm ghost" href="#/purchase-orders/${p.id}">View order</a></td></tr>`
            )
            .join("")}</tbody></table></div>`
        : '<div class="empty">No purchase orders found.</div>'}</section>`;
  }

  async function viewPurchaseOrderDetail(id) {
    const po = await api("/purchase-orders/" + id);
    document.title = `${po.po_number} — Redora`;
    view()._po = po;
    const isReceived = po.status === "received";

    const itemRows = (po.items || [])
      .map(
        (it) => `<tr>
          <td><strong>${esc(it.item_name)}</strong></td>
          <td class="right num">${it.quantity} ${esc(it.unit)}</td>
          <td class="right num">${fmtMoney(it.unit_cost)}</td>
          <td class="right num"><strong>${fmtMoney(it.quantity * it.unit_cost)}</strong></td>
          <td class="right num"><span class="${it.received_qty >= it.quantity ? "pos" : "neg"}">${it.received_qty || 0}</span> / ${it.quantity}</td>
        </tr>`
      )
      .join("");

    return `<a class="back" href="#/purchase-orders">← All purchase orders</a>
      ${pageHead(po.po_number, `Order status: ${po.status.toUpperCase()} · Destination: ${po.store_name || "Main Central Pharmacy"}`,
        `<button class="btn ghost" onclick="window.print()">${ICONS.print} Print PO</button>
        ${po.status === "draft" ? `<button class="btn" data-action="order-po" data-id="${po.id}">Mark as Ordered</button>` : ""}
        ${!isReceived && po.status !== "cancelled" ? `<button class="btn" data-action="receive-po-modal" data-id="${po.id}">Receive goods & invoice</button>` : ""}
        ${!isReceived && po.status !== "cancelled" ? `<button class="btn danger" data-action="cancel-po" data-id="${po.id}">Cancel</button>` : ""}`)}
      <div class="cols2">
        <section class="panel"><div class="panel-head"><h2>Supplier information</h2></div><div class="panel-body">
          <p><strong>${esc(po.supplier_name)}</strong></p>
          <p class="muted small">${po.supplier_phone ? `Phone: ${esc(po.supplier_phone)} · ` : ""}${po.supplier_email ? `Email: ${esc(po.supplier_email)}` : ""}</p>
          ${po.notes ? `<p class="small"><strong>Notes:</strong> ${esc(po.notes)}</p>` : ""}
        </div></section>
        <section class="panel"><div class="panel-head"><h2>Invoice & Delivery details</h2></div><div class="panel-body">
          <p>Status: ${poBadge(po.status)}</p>
          <p>Invoice number: ${po.invoice_number ? `<code>${esc(po.invoice_number)}</code>` : '<span class="muted">Pending supplier invoice</span>'}</p>
          <p class="muted small">Ordered on: ${po.ordered_at || "Not sent"} · Received on: ${po.received_at || "Pending"}</p>
        </div></section>
      </div>
      <section class="panel"><div class="panel-head"><h2>Line items</h2><span class="muted">Grand total: <strong>${fmtMoney(po.total_amount)}</strong></span></div>
        <div class="table-wrap"><table><thead><tr><th>Item</th><th class="right">Ordered qty</th><th class="right">Unit price</th><th class="right">Total</th><th class="right">Received so far</th></tr></thead><tbody>${itemRows}</tbody></table></div>
      </section>`;
  }

  function openNewPOModal(suppliers, items, stores) {
    const itemOptions = items.map((i) => `<option value="${i.id}">${esc(i.name)} (${esc(i.unit)})</option>`).join("");
    const body = `
      <div class="grid2">
        <label class="field">Supplier<select name="supplier_id" required>${options(suppliers, "id", (s) => s.name, "", "Choose supplier…")}</select></label>
        <label class="field">Deliver to store<select name="store_id">${options(stores, "id", (s) => s.name, 1)}</select></label>
      </div>
      <label class="field">Supplier Invoice / Ref # <span class="hint">(optional if known)</span><input type="text" name="invoice_number" maxlength="60"></label>
      <label class="field">Order notes<textarea name="notes" placeholder="Delivery instructions or urgency details…" maxlength="300"></textarea></label>
      <div class="panel-head" style="padding:10px 0 6px"><h3>Order Items</h3><button type="button" class="btn sm ghost" id="po-add-row">+ Add Item</button></div>
      <div id="po-rows" style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px">
        <div class="grid3 po-item-row">
          <select class="po-item-sel" required><option value="">Select item…</option>${itemOptions}</select>
          <input type="number" class="po-item-qty" placeholder="Quantity" min="1" required>
          <input type="number" class="po-item-cost" placeholder="Unit cost" min="0" step="0.01" required>
        </div>
      </div>
    `;
    const modal = openModal("Create Purchase Order", body, async (data, form) => {
      const rows = $$(".po-item-row", form);
      const poItems = [];
      for (const r of rows) {
        const itemId = $(".po-item-sel", r).value;
        const qty = $(".po-item-qty", r).value;
        const cost = $(".po-item-cost", r).value;
        if (itemId && qty) {
          poItems.push({ item_id: Number(itemId), quantity: Number(qty), unit_cost: Number(cost) || 0 });
        }
      }
      if (!poItems.length) throw new Error("Add at least one item.");
      const payload = { ...data, items: poItems, status: "ordered" };
      const res = await api("/purchase-orders", { method: "POST", body: payload });
      toast(`PO ${res.po_number} created.`);
      location.hash = `#/purchase-orders/${res.id}`;
    }, "Create & Send PO", true);

    $("#po-add-row", modal).addEventListener("click", () => {
      const row = document.createElement("div");
      row.className = "grid3 po-item-row";
      row.innerHTML = `
        <select class="po-item-sel" required><option value="">Select item…</option>${itemOptions}</select>
        <input type="number" class="po-item-qty" placeholder="Quantity" min="1" required>
        <input type="number" class="po-item-cost" placeholder="Unit cost" min="0" step="0.01" required>
      `;
      $("#po-rows", modal).appendChild(row);
    });
  }

  function openReceivePOModal(po) {
    const todayStr = new Date().toISOString().slice(0, 10);
    const itemInputs = po.items
      .map(
        (it) => `
        <div style="border:1px solid var(--line);border-radius:8px;padding:12px;margin-bottom:10px">
          <p style="margin:0 0 6px"><strong>${esc(it.item_name)}</strong> · Ordered: ${it.quantity} ${esc(it.unit)} (Received: ${it.received_qty || 0})</p>
          <div class="grid3">
            <label class="field">Batch number<input type="text" name="batch_${it.item_id}" placeholder="Batch on pack" required></label>
            <label class="field">Expiry date<input type="date" name="expiry_${it.item_id}" min="${todayStr}" required></label>
            <label class="field">Quantity receiving now<input type="number" name="qty_${it.item_id}" value="${Math.max(0, it.quantity - (it.received_qty || 0))}" min="0" max="${it.quantity}"></label>
          </div>
        </div>
      `
      )
      .join("");

    const body = `
      <label class="field">Supplier Invoice Number<input type="text" name="invoice_number" value="${esc(po.invoice_number || "")}" placeholder="e.g. INV-2026-904" required></label>
      <div class="panel-head" style="padding:6px 0"><h3>Batch details received</h3></div>
      ${itemInputs}
    `;

    openModal(`Receive goods for ${po.po_number}`, body, async (data) => {
      const receipts = [];
      for (const it of po.items) {
        const qty = Number(data[`qty_${it.item_id}`]);
        if (qty > 0) {
          receipts.push({
            item_id: it.item_id,
            quantity: qty,
            batch_no: data[`batch_${it.item_id}`],
            expiry_date: data[`expiry_${it.item_id}`],
          });
        }
      }
      if (!receipts.length) throw new Error("Enter quantity and batch for at least one item.");
      await api(`/purchase-orders/${po.id}/receive`, {
        method: "POST",
        body: { invoice_number: data.invoice_number, receipts },
      });
      toast("Stock received into inventory & invoice linked.");
      reload();
    }, "Confirm goods receipt", true);
  }

  /* ================= reports & valuation ================= */
  async function viewReports(params) {
    document.title = "Reports & Valuation — Redora";
    const type = params.get("type") || "valuation";
    const month = params.get("month") || new Date().toISOString().slice(0, 7);

    let contentHtml = "";
    if (type === "valuation") {
      const data = await api("/reports/valuation");
      const rows = data.items
        .map(
          (it) => `<tr>
            <td><strong>${esc(it.name)}</strong><span class="sub">${esc(it.code || "—")}</span></td>
            <td>${esc(it.category)}</td>
            <td class="right num">${it.available_stock} <span class="muted small">${esc(it.unit)}</span></td>
            <td class="right num">${(it.batches || []).map((b) => `${b.batch_no}: ${b.quantity} @ ${fmtMoney(b.unit_cost)}`).join("<br>")}</td>
            <td class="right num"><strong>${fmtMoney(it.total_value)}</strong></td>
          </tr>`
        )
        .join("");

      contentHtml = `
        <div class="facts" style="margin-bottom:16px">
          <div class="fact"><div class="l">Total inventory valuation</div><div class="v" style="color:var(--brand)">${fmtMoney(data.grand_total_value)}</div></div>
          <div class="fact"><div class="l">Total units on hand</div><div class="v">${data.grand_total_items}</div></div>
          <div class="fact"><div class="l">Report date</div><div class="v" style="font-size:1.05rem">${fmtDay(data.date)}</div></div>
        </div>
        <div class="table-wrap"><table><thead><tr><th>Item</th><th>Category</th><th class="right">Total Qty</th><th class="right">Batch breakdown</th><th class="right">Stock Value</th></tr></thead><tbody>${rows}</tbody></table></div>
      `;
    } else {
      const data = await api("/reports/consumption?month=" + month);
      const rows = data.items
        .map((it) => {
          const deptBreakdown = Object.entries(it.departments || {})
            .map(([d, q]) => `${esc(d)}: ${q}`)
            .join(", ") || "—";
          return `<tr>
            <td><strong>${esc(it.name)}</strong></td>
            <td>${esc(it.category)}</td>
            <td class="right num"><strong>${it.issued_qty}</strong> <span class="muted small">${esc(it.unit)}</span></td>
            <td class="right num" style="color:var(--danger)">${it.written_off_qty || 0}</td>
            <td class="small">${deptBreakdown}</td>
            <td class="right num"><strong>${fmtMoney(it.total_cost)}</strong></td>
          </tr>`;
        })
        .join("");

      contentHtml = `
        <div class="toolbar">
          <label class="small muted">Report month: <input type="month" id="rep-month" value="${esc(month)}"></label>
        </div>
        <div class="table-wrap"><table><thead><tr><th>Item</th><th>Category</th><th class="right">Units Issued</th><th class="right">Written Off</th><th>Departments Consumed</th><th class="right">Valuation</th></tr></thead><tbody>${rows.length ? rows : '<tr><td colspan="6" class="empty">No consumption recorded in this month.</td></tr>'}</tbody></table></div>
      `;
    }

    after(() => {
      const mInput = $("#rep-month");
      if (mInput) {
        mInput.addEventListener("change", (e) => {
          location.hash = `#/reports?type=consumption&month=${e.target.value}`;
        });
      }
    });

    return `
      <div class="print-header" style="display:none">
        <h1>Redora Hospital Inventory Report</h1>
        <p>Report type: ${type.toUpperCase()} · Generated: ${new Date().toLocaleString()}</p>
      </div>
      ${pageHead("Audit reports & stock valuation", "Hospital valuation statements and monthly ward consumption audits",
        `<button class="btn ghost" onclick="window.print()">${ICONS.print} Print report</button>`)}
      <div class="tabs">
        <a class="tab ${type === "valuation" ? "active" : ""}" href="#/reports?type=valuation">Stock Valuation Report</a>
        <a class="tab ${type === "consumption" ? "active" : ""}" href="#/reports?type=consumption">Monthly Consumption Report</a>
      </div>
      <section class="panel">${contentHtml}</section>`;
  }

  /* ================= stock-take (cycle count) sheets ================= */
  async function viewStockTake() {
    document.title = "Cycle counts — Redora";
    const sheet = await api("/stock-take/sheet");
    const isAdmin = state.user.role === "admin";

    const rows = sheet.items
      .map(
        (it, idx) => `<tr>
          <td><strong>${esc(it.item_name)}</strong></td>
          <td>${esc(it.storage_location)}</td>
          <td><code>${esc(it.batch_no)}</code>${it.expiry_date ? `<span class="sub">exp ${fmtDay(it.expiry_date)}</span>` : ""}</td>
          <td class="right num"><strong>${it.recorded_qty}</strong> <span class="muted small">${esc(it.unit)}</span></td>
          <td style="max-width:130px"><input type="number" class="st-counted" data-idx="${idx}" data-batch="${it.batch_id || ""}" data-rec="${it.recorded_qty}" min="0" value="${it.recorded_qty}" style="margin:0;padding:5px 8px"></td>
          <td class="num diff-cell" id="diff-${idx}">0</td>
          <td><input type="text" class="st-notes" data-idx="${idx}" placeholder="Optional note…" style="margin:0;padding:5px 8px"></td>
        </tr>`
      )
      .join("");

    after(() => {
      $$(".st-counted").forEach((input) => {
        input.addEventListener("input", (e) => {
          const rec = Number(e.target.dataset.rec);
          const val = Number(e.target.value);
          const diffCell = $("#diff-" + e.target.dataset.idx);
          if (diffCell) {
            const diff = val - rec;
            diffCell.textContent = (diff > 0 ? "+" : "") + diff;
            diffCell.style.color = diff === 0 ? "inherit" : diff > 0 ? "var(--ok)" : "var(--danger)";
            diffCell.style.fontWeight = diff !== 0 ? "bold" : "normal";
          }
        });
      });

      const reconcileBtn = $("#reconcile-btn");
      if (reconcileBtn) {
        reconcileBtn.addEventListener("click", async () => {
          if (!confirm("Reconcile stock count? Discrepancies will automatically create adjusted movement records with an audit trail.")) return;
          reconcileBtn.disabled = true;
          try {
            const counts = [];
            $$(".st-counted").forEach((input) => {
              const batchId = input.dataset.batch;
              if (batchId) {
                const noteInput = $(`.st-notes[data-idx="${input.dataset.idx}"]`);
                counts.push({
                  batch_id: Number(batchId),
                  counted_qty: Number(input.value),
                  notes: noteInput ? noteInput.value : "",
                });
              }
            });
            const res = await api("/stock-take/reconcile", { method: "POST", body: { counts } });
            toast(`Stock reconciled! ${res.discrepancies_count} discrepancy movements logged.`);
            reload();
          } catch (e) {
            toast(e.message, true);
            reconcileBtn.disabled = false;
          }
        });
      }
    });

    return `
      <div class="print-header" style="display:none">
        <h1>Physical Stock-Take Count Sheet</h1>
        <p>Sheet #: ${sheet.sheet_number} · Store: ${sheet.store_name} · Date: ${fmtDay(sheet.date)}</p>
      </div>
      ${pageHead("Physical stock-take count sheets", "Conduct cycle counts and reconcile shelf quantities with the system log",
        `<button class="btn ghost" onclick="window.print()">${ICONS.print} Print count sheet</button>
        ${isAdmin ? '<button class="btn" id="reconcile-btn">Reconcile counts</button>' : ""}`)}
      <section class="panel">
        <div class="panel-head">
          <div><h2>Sheet ${sheet.sheet_number}</h2><span class="muted small">${sheet.store_name} · ${fmtDay(sheet.date)}</span></div>
          <span class="muted small">${sheet.items.length} batches to count</span>
        </div>
        <div class="table-wrap"><table><thead><tr><th>Item</th><th>Location</th><th>Batch / Expiry</th><th class="right">Recorded</th><th style="width:120px">Physical Count</th><th>Difference</th><th>Remarks</th></tr></thead><tbody>${rows}</tbody></table></div>
      </section>`;
  }

  /* ================= history ================= */
  async function viewHistory() {
    document.title = "History — Redora";
    const stores = await api("/stores");
    after(() => {
      let rows = [];
      const q = $("#h-q"), type = $("#h-type"), storeSel = $("#h-store"), from = $("#h-from"), to = $("#h-to"), out = $("#h-table"), exp = $("#h-export");
      const draw = () => {
        const term = q.value.trim().toLowerCase();
        const shown = term ? rows.filter((r) => (r.item_name + " " + (r.batch_no || "") + " " + (r.reference || "") + " " + (r.department || "") + " " + (r.store || "")).toLowerCase().includes(term)) : rows;
        out.innerHTML = movementTable(shown);
        $("#h-count").textContent = `${shown.length} record${shown.length === 1 ? "" : "s"}${rows.length >= 500 ? " (latest 500)" : ""}`;
      };
      const load = async () => {
        const qs = new URLSearchParams({ limit: 500 });
        if (type.value) qs.set("type", type.value);
        if (storeSel && storeSel.value) qs.set("store_id", storeSel.value);
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
      [type, storeSel, from, to].filter(Boolean).forEach((el) => el.addEventListener("change", load));
      q.addEventListener("input", draw);
      load();
    });
    return `${pageHead("Stock history", "Permanent audit log of every receipt, issue, transfer, write-off and correction", '<a class="btn ghost" id="h-export" href="/api/export/movements.csv">Export CSV</a>')}
      <section class="panel"><div class="toolbar">
        <input type="search" id="h-q" placeholder="Search item, batch, reference, department, store…" aria-label="Search history">
        <select id="h-type" aria-label="Type">
          <option value="">All types</option>
          <option value="in">Received</option>
          <option value="out">Issued</option>
          <option value="transfer">Transferred</option>
          <option value="writeoff">Written off</option>
          <option value="adjust">Corrections</option>
        </select>
        <select id="h-store"><option value="">All stores</option>${options(stores, "id", (s) => s.name)}</select>
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
    const [depts, stores, alerts, users] = await Promise.all([
      api("/departments"),
      api("/stores"),
      isAdmin ? api("/alerts/config") : Promise.resolve({}),
      isAdmin ? api("/users") : Promise.resolve([]),
    ]);
    view()._users = users;
    view()._stores = stores;

    after(() => {
      const pw = $("#pw-form");
      bindForm(pw, async (data, f) => {
        await api("/me/password", { method: "POST", body: data });
        f.reset();
        toast("Password changed.");
      });

      const alertForm = $("#alert-config-form");
      if (alertForm) {
        bindForm(alertForm, async (data) => {
          await api("/alerts/config", { method: "PUT", body: data });
          toast("Alert configuration saved.");
        });
      }

      const dep = $("#dept-form");
      if (dep) bindForm(dep, async (data, f) => {
        await api("/departments", { method: "POST", body: { name: data.name } });
        toast("Department added.");
        reload();
      });

      const stForm = $("#store-form");
      if (stForm) bindForm(stForm, async (data, f) => {
        await api("/stores", { method: "POST", body: data });
        toast("Store added.");
        reload();
      });
    });

    return `${pageHead("Settings", `Signed in as ${state.user.name} (${state.user.username})`)}
      <div class="cols2" style="align-items:start">
        <section class="panel"><div class="panel-head"><h2>Change password</h2></div><div class="panel-body"><form id="pw-form" novalidate><div class="form-error" role="alert"></div>
          <label class="field">Current password<input type="password" name="current_password" autocomplete="current-password" required></label>
          <label class="field">New password <span class="hint">(8+ characters)</span><input type="password" name="new_password" autocomplete="new-password" minlength="8" required></label>
          <button class="btn" type="submit">Update password</button></form></div></section>

        ${isAdmin ? `<section class="panel"><div class="panel-head"><h2>Email & SMS Alert Notifications</h2></div><div class="panel-body"><form id="alert-config-form" novalidate><div class="form-error" role="alert"></div>
          <label class="field">Notification Email<input type="email" name="alert_email" value="${esc(alerts.alert_email || "")}" placeholder="pharmacy-alerts@hospital.org" required></label>
          <label class="field">Emergency SMS Number <span class="hint">(optional)</span><input type="text" name="sms_number" value="${esc(alerts.sms_number || "")}" placeholder="+91 98400..."></label>
          <label class="check"><input type="checkbox" name="notify_low_stock"${alerts.notify_low_stock ? " checked" : ""}> Notify on Low Stock</label>
          <label class="check"><input type="checkbox" name="notify_expiring"${alerts.notify_expiring ? " checked" : ""}> Notify on Expiring Batches</label>
          <div style="display:flex;gap:10px;margin-top:14px">
            <button class="btn" type="submit">Save alert settings</button>
            <button type="button" class="btn ghost" data-action="dispatch-alerts">Test Send Alert Now</button>
          </div>
        </form></div></section>` : ""}
      </div>

      <div class="cols2" style="align-items:start">
        <section class="panel"><div class="panel-head"><h2>Hospital stores & branches</h2></div><div class="panel-body">
          <p class="muted small" style="margin-top:0">Stock is received, held and transferred across these store locations.</p>
          <ul style="list-style:none;padding:0;margin:0 0 14px">${stores
            .map((s) => `<li style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--line)">
              <span><strong>${esc(s.name)}</strong> ${s.code ? `<code>${esc(s.code)}</code>` : ""}${s.is_default ? ' <span class="badge ok">Default</span>' : ""}</span>
              ${isAdmin && !s.is_default ? `<button class="btn sm danger" data-action="del-store" data-id="${s.id}">Remove</button>` : ""}
            </li>`)
            .join("")}</ul>
          ${isAdmin ? `<form id="store-form" novalidate><div class="form-error" role="alert"></div>
            <div class="grid2"><input type="text" name="name" placeholder="Store name (e.g. ICU Sub-Store)" maxlength="100" required>
            <input type="text" name="code" placeholder="Code (e.g. ICU)" maxlength="20"></div>
            <button class="btn" type="submit" style="margin-top:8px">+ Add Store</button></form>` : ""}
        </div></section>

        <section class="panel"><div class="panel-head"><h2>Departments</h2></div><div class="panel-body">
          <p class="muted small" style="margin-top:0">Stock is issued to these hospital departments.</p>
          <ul style="list-style:none;padding:0;margin:0 0 14px">${depts
            .map((d) => `<li style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--line)">${esc(d.name)}${isAdmin ? `<button class="btn sm danger" data-action="del-dept" data-id="${d.id}">Remove</button>` : ""}</li>`)
            .join("")}</ul>
          ${isAdmin ? `<form id="dept-form" novalidate><div class="form-error" role="alert"></div><div style="display:flex;gap:8px"><input type="text" name="name" placeholder="New department name" maxlength="80" required style="margin:0"><button class="btn" type="submit">Add</button></div></form>` : ""}</div></section>
      </div>

      ${isAdmin ? `<section class="panel"><div class="panel-head"><h2>Users</h2><button class="btn sm" data-action="new-user">+ Add user</button></div>
        <div class="table-wrap"><table><thead><tr><th>Name</th><th>Username</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>${users
          .map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.username)}</td><td>${esc(u.email || "—")}</td><td>${u.role === "admin" ? "Administrator" : "Staff"}</td><td>${u.active ? '<span class="badge ok">Active</span>' : '<span class="badge adjust">Disabled</span>'}</td>
            <td class="right"><button class="btn sm ghost" data-action="edit-user" data-id="${u.id}">Edit</button></td></tr>`)
          .join("")}</tbody></table></div></section>` : ""}`;
  }

  function openUserModal(u) {
    const body = u
      ? `<p><strong>${esc(u.name)}</strong> <span class="muted">(${esc(u.username)})</span></p>
         <label class="field">Email<input type="email" name="email" value="${esc(u.email || "")}" maxlength="120"></label>
         <label class="field">Role<select name="role"><option value="staff"${u.role === "staff" ? " selected" : ""}>Staff</option><option value="admin"${u.role === "admin" ? " selected" : ""}>Administrator</option></select></label>
         <label class="check"><input type="checkbox" name="active"${u.active ? " checked" : ""}> Account is active</label>
         <label class="field">Reset password <span class="hint">(leave blank to keep current)</span><input type="password" name="password" autocomplete="new-password" minlength="8"></label>`
      : `<div class="grid2"><label class="field">Full name<input type="text" name="name" maxlength="80" required></label>
         <label class="field">Username<input type="text" name="username" maxlength="40" autocapitalize="none" required></label></div>
         <label class="field">Email address<input type="email" name="email" maxlength="120"></label>
         <div class="grid2"><label class="field">Role<select name="role"><option value="staff">Staff</option><option value="admin">Administrator</option></select></label>
         <label class="field">Temporary password <span class="hint">(8+ chars)</span><input type="password" name="password" autocomplete="new-password" minlength="8" required></label></div>`;
    openModal(u ? "Edit user" : "Add user", body, async (data) => {
      if (u) {
        const payload = { role: data.role, active: data.active, email: data.email };
        if (data.password) payload.password = data.password;
        await api("/users/" + u.id, { method: "PUT", body: payload });
      } else {
        await api("/users", { method: "POST", body: data });
      }
      toast(u ? "User updated." : "User added.");
      reload();
    }, u ? "Save changes" : "Add user");
  }

  /* ================= forgot password modal ================= */
  function openForgotPasswordModal() {
    const body = `
      <p class="muted">Enter your registered username or email address. We will generate secure reset credentials.</p>
      <label class="field">Username or email<input type="text" name="identifier" required autofocus></label>
    `;
    openModal("Reset your password", body, async (data) => {
      const res = await api("/forgot-password", { method: "POST", body: { username: data.identifier } });
      if (res.reset_token) {
        // Direct reset step
        openModal("Enter new password", `
          <p class="muted">A reset token was verified for your account.</p>
          <input type="hidden" name="token" value="${esc(res.reset_token)}">
          <label class="field">New password (8+ characters)<input type="password" name="new_password" minlength="8" required autofocus></label>
        `, async (d2) => {
          await api("/reset-password", { method: "POST", body: d2 });
          toast("Password has been reset. Please sign in.");
          showLogin();
        }, "Set new password");
      } else {
        toast(res.message);
      }
    }, "Send reset link");
  }

  /* ================= actions (event delegation) ================= */
  const actions = {
    "close-modal": () => closeModal(),
    logout: async () => {
      try { await api("/logout", { method: "POST" }); } catch {}
      state.user = null;
      location.hash = "";
      showLogin();
    },
    "forgot-password": (el, e) => {
      e.preventDefault();
      openForgotPasswordModal();
    },
    "open-barcode-scan": () => {
      openBarcodeScanner(async (code) => {
        try {
          const item = await api("/items/barcode/" + encodeURIComponent(code));
          toast(`Found item: ${item.name}`);
          location.hash = `#/items/${item.id}`;
        } catch (e) {
          toast(e.message, true);
        }
      });
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
    "del-store": async (el) => {
      if (!confirm("Remove this store branch?")) return;
      try { await api("/stores/" + el.dataset.id, { method: "DELETE" }); toast("Store removed."); reload(); }
      catch (e) { toast(e.message, true); }
    },
    "new-user": () => openUserModal(null),
    "edit-user": (el) => openUserModal(view()._users.find((u) => u.id === Number(el.dataset.id))),
    "new-po": async () => {
      const [suppliers, items, stores] = await Promise.all([api("/suppliers"), api("/items"), api("/stores")]);
      openNewPOModal(suppliers, items, stores);
    },
    "order-po": async (el) => {
      await api(`/purchase-orders/${el.dataset.id}/status`, { method: "POST", body: { status: "ordered" } });
      toast("Purchase order marked as ordered.");
      reload();
    },
    "cancel-po": async (el) => {
      if (!confirm("Cancel this purchase order?")) return;
      await api(`/purchase-orders/${el.dataset.id}/status`, { method: "POST", body: { status: "cancelled" } });
      toast("Purchase order cancelled.");
      reload();
    },
    "receive-po-modal": () => openReceivePOModal(view()._po),
    "dispatch-alerts": async () => {
      try {
        const res = await api("/alerts/trigger", { method: "POST" });
        toast(res.message);
      } catch (e) {
        toast(e.message, true);
      }
    },
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
