const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { db, tx, hashPassword, verifyPassword, ensureAdmin } = require("./db");

const PORT = process.env.PORT || 3000;
const PROD = process.env.NODE_ENV === "production";
const EXPIRY_WARN_DAYS = Number(process.env.EXPIRY_WARN_DAYS) || 90;
const SESSION_MS = 12 * 60 * 60 * 1000;
const CATEGORIES = ["Medicine", "Consumable", "Surgical", "Lab supplies", "PPE", "Equipment", "Other"];

ensureAdmin();

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "50kb" }));
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Content-Security-Policy":
      "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'; frame-ancestors 'none'",
  });
  next();
});
app.use(express.static(path.join(__dirname, "public")));

/* ---------- helpers ---------- */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (msg) => {
  throw new HttpError(400, msg);
};
const notFound = (msg = "Not found.") => {
  throw new HttpError(404, msg);
};
const h = (fn) => (req, res, next) => {
  try {
    fn(req, res);
  } catch (e) {
    next(e);
  }
};
const toInt = (v) => {
  if (v === null || v === undefined || v === "") return NaN;
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
};
const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const today = () => new Date().toISOString().slice(0, 10);

function rateLimiter(max, windowMs, message) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const recent = (hits.get(req.ip) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) return res.status(429).json({ error: message });
    recent.push(now);
    hits.set(req.ip, recent);
    next();
  };
}
const loginLimiter = rateLimiter(10, 15 * 60 * 1000, "Too many sign-in attempts. Try again in a few minutes.");

function getCookie(req, name) {
  for (const part of (req.headers.cookie || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

function auth(req, res, next) {
  const token = getCookie(req, "redora_sid");
  if (!token) return res.status(401).json({ error: "Please sign in." });
  const user = db
    .prepare(
      `SELECT u.id, u.username, u.name, u.role FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`
    )
    .get(sha(token), Date.now());
  if (!user) return res.status(401).json({ error: "Please sign in." });
  req.user = user;
  req.tokenHash = sha(token);
  next();
}
const adminOnly = (req, res, next) =>
  req.user.role === "admin" ? next() : res.status(403).json({ error: "Admin access required." });

setInterval(() => db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now()), 60 * 60 * 1000).unref();

/* ---------- stock queries ---------- */
function itemsWithStock(where = "", params = []) {
  const rows = db
    .prepare(
      `SELECT i.*, s.name AS supplier_name,
        COALESCE((SELECT SUM(quantity) FROM batches b WHERE b.item_id = i.id), 0) AS total_stock,
        COALESCE((SELECT SUM(quantity) FROM batches b WHERE b.item_id = i.id
                  AND (b.expiry_date IS NULL OR b.expiry_date >= date('now'))), 0) AS available_stock,
        COALESCE((SELECT SUM(quantity) FROM batches b WHERE b.item_id = i.id
                  AND b.expiry_date < date('now')), 0) AS expired_stock,
        (SELECT MIN(expiry_date) FROM batches b WHERE b.item_id = i.id AND b.quantity > 0
                  AND b.expiry_date >= date('now')) AS next_expiry
       FROM items i LEFT JOIN suppliers s ON s.id = i.supplier_id
       ${where}
       ORDER BY i.name COLLATE NOCASE`
    )
    .all(...params);
  return rows.map((r) => ({
    ...r,
    status: r.available_stock <= 0 ? "out" : r.available_stock <= r.reorder_level ? "low" : "ok",
  }));
}

function getItem(id) {
  if (!Number.isInteger(id)) bad("Choose an item.");
  const rows = itemsWithStock("WHERE i.id = ?", [id]);
  if (!rows.length) notFound("Item not found.");
  return rows[0];
}

const MOVEMENT_SELECT = `
  SELECT m.id, m.type, m.quantity, m.reference, m.notes, m.created_at,
         i.id AS item_id, i.name AS item_name, i.unit,
         b.batch_no, b.expiry_date,
         d.name AS department, s.name AS supplier, u.name AS user_name
  FROM movements m
  JOIN items i ON i.id = m.item_id
  LEFT JOIN batches b ON b.id = m.batch_id
  LEFT JOIN departments d ON d.id = m.department_id
  LEFT JOIN suppliers s ON s.id = m.supplier_id
  LEFT JOIN users u ON u.id = m.user_id`;

function queryMovements(q, defaultLimit = 200) {
  const where = [];
  const params = [];
  if (q.item_id) {
    where.push("m.item_id = ?");
    params.push(toInt(q.item_id));
  }
  if (["in", "out", "adjust", "writeoff"].includes(q.type)) {
    where.push("m.type = ?");
    params.push(q.type);
  }
  if (q.from && isDate(q.from)) {
    where.push("date(m.created_at) >= ?");
    params.push(q.from);
  }
  if (q.to && isDate(q.to)) {
    where.push("date(m.created_at) <= ?");
    params.push(q.to);
  }
  const limit = Math.min(Math.max(toInt(q.limit) || defaultLimit, 1), 2000);
  return db
    .prepare(`${MOVEMENT_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY m.id DESC LIMIT ?`)
    .all(...params, limit);
}

function addMovement(m) {
  db.prepare(
    `INSERT INTO movements (item_id, batch_id, type, quantity, department_id, supplier_id, reference, notes, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    m.item_id,
    m.batch_id ?? null,
    m.type,
    m.quantity,
    m.department_id ?? null,
    m.supplier_id ?? null,
    m.reference ?? null,
    m.notes ?? null,
    m.user_id
  );
}

/* ---------- public ---------- */
app.get("/api/health", (_req, res) => {
  db.prepare("SELECT 1").get();
  res.json({ status: "ok" });
});

app.post(
  "/api/login",
  loginLimiter,
  h((req, res) => {
    const { username, password } = req.body || {};
    const user = db
      .prepare("SELECT * FROM users WHERE username = ? AND active = 1")
      .get(str(username, 60).toLowerCase());
    if (!user || !verifyPassword(String(password || ""), user.password_hash)) {
      return res.status(401).json({ error: "Incorrect username or password." });
    }
    const token = crypto.randomBytes(32).toString("hex");
    db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(
      sha(token),
      user.id,
      Date.now() + SESSION_MS
    );
    res.cookie("redora_sid", token, { httpOnly: true, sameSite: "lax", secure: PROD, maxAge: SESSION_MS });
    res.json({ user: { id: user.id, username: user.username, name: user.name, role: user.role } });
  })
);

/* ---------- everything below needs a signed-in user ---------- */
app.post("/api/logout", auth, h((req, res) => {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(req.tokenHash);
  res.clearCookie("redora_sid");
  res.json({ ok: true });
}));

app.get("/api/me", auth, (req, res) => res.json({ user: req.user, categories: CATEGORIES, expiryWarnDays: EXPIRY_WARN_DAYS }));

app.post("/api/me/password", auth, h((req, res) => {
  const { current_password, new_password } = req.body || {};
  const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user.id);
  if (!verifyPassword(String(current_password || ""), row.password_hash)) bad("Current password is incorrect.");
  if (String(new_password || "").length < 8) bad("New password must be at least 8 characters.");
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(String(new_password)), req.user.id);
  db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").run(req.user.id, req.tokenHash);
  res.json({ ok: true });
}));

/* ----- dashboard ----- */
app.get("/api/dashboard", auth, h((_req, res) => {
  const items = itemsWithStock("WHERE i.active = 1");
  const lowItems = items.filter((i) => i.status === "low" || i.status === "out");
  const expWhere = `i.active = 1 AND b.quantity > 0 AND b.expiry_date IS NOT NULL`;
  const soonSql = `${expWhere} AND b.expiry_date >= date('now') AND b.expiry_date <= date('now', '+' || ? || ' days')`;
  const expiringSoon = db
    .prepare(
      `SELECT b.id, b.batch_no, b.expiry_date, b.quantity, i.id AS item_id, i.name, i.unit
       FROM batches b JOIN items i ON i.id = b.item_id WHERE ${soonSql} ORDER BY b.expiry_date LIMIT 8`
    )
    .all(EXPIRY_WARN_DAYS);
  const expiringCount = db
    .prepare(`SELECT COUNT(*) AS n FROM batches b JOIN items i ON i.id = b.item_id WHERE ${soonSql}`)
    .get(EXPIRY_WARN_DAYS).n;
  const expiredSql = `${expWhere} AND b.expiry_date < date('now')`;
  const expired = db
    .prepare(
      `SELECT b.id, b.batch_no, b.expiry_date, b.quantity, i.id AS item_id, i.name, i.unit
       FROM batches b JOIN items i ON i.id = b.item_id WHERE ${expiredSql} ORDER BY b.expiry_date LIMIT 8`
    )
    .all();
  const expiredCount = db
    .prepare(`SELECT COUNT(*) AS n FROM batches b JOIN items i ON i.id = b.item_id WHERE ${expiredSql}`)
    .get().n;
  const activity = db
    .prepare(
      `SELECT date(created_at) AS day,
              SUM(CASE WHEN quantity > 0 THEN quantity ELSE 0 END) AS in_qty,
              SUM(CASE WHEN quantity < 0 THEN -quantity ELSE 0 END) AS out_qty
       FROM movements WHERE type IN ('in','out') AND date(created_at) >= date('now', '-13 days')
       GROUP BY date(created_at)`
    )
    .all();
  res.json({
    totals: {
      items: items.length,
      low: items.filter((i) => i.status === "low").length,
      out: items.filter((i) => i.status === "out").length,
      expiring: expiringCount,
      expired: expiredCount,
    },
    needsReorder: lowItems.sort((a, b) => a.available_stock - b.available_stock).slice(0, 8),
    expiringSoon,
    expired,
    activity,
    recent: queryMovements({ limit: 8 }),
    expiryWarnDays: EXPIRY_WARN_DAYS,
  });
}));

/* ----- items ----- */
function parseItem(b) {
  const name = str(b.name, 120);
  if (!name) bad("Item name is required.");
  const category = str(b.category, 40);
  if (!CATEGORIES.includes(category)) bad("Choose a valid category.");
  const reorder = b.reorder_level === "" || b.reorder_level == null ? 0 : toInt(b.reorder_level);
  if (!(reorder >= 0)) bad("Reorder level must be a whole number, 0 or more.");
  let supplier_id = null;
  if (b.supplier_id !== "" && b.supplier_id != null) {
    supplier_id = toInt(b.supplier_id);
    if (!Number.isInteger(supplier_id) || !db.prepare("SELECT 1 FROM suppliers WHERE id = ?").get(supplier_id)) {
      bad("Supplier not found.");
    }
  }
  return {
    name,
    code: str(b.code, 40) || null,
    category,
    unit: str(b.unit, 20) || "units",
    reorder_level: reorder,
    supplier_id,
    storage_location: str(b.storage_location, 80) || null,
    tracks_expiry: b.tracks_expiry ? 1 : 0,
    notes: str(b.notes, 500) || null,
  };
}

app.get("/api/items", auth, h((req, res) => {
  const all = req.query.include_inactive === "1";
  res.json(itemsWithStock(all ? "" : "WHERE i.active = 1"));
}));

app.get("/api/items/:id", auth, h((req, res) => {
  const item = getItem(toInt(req.params.id));
  const batches = db
    .prepare("SELECT * FROM batches WHERE item_id = ? ORDER BY quantity = 0, expiry_date IS NULL, expiry_date, id")
    .all(item.id);
  res.json({ item, batches, movements: queryMovements({ item_id: item.id, limit: 50 }) });
}));

app.post("/api/items", auth, h((req, res) => {
  const v = parseItem(req.body || {});
  const info = db
    .prepare(
      `INSERT INTO items (name, code, category, unit, reorder_level, supplier_id, storage_location, tracks_expiry, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(v.name, v.code, v.category, v.unit, v.reorder_level, v.supplier_id, v.storage_location, v.tracks_expiry, v.notes);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
}));

app.put("/api/items/:id", auth, h((req, res) => {
  const id = toInt(req.params.id);
  getItem(id);
  const v = parseItem(req.body || {});
  db.prepare(
    `UPDATE items SET name=?, code=?, category=?, unit=?, reorder_level=?, supplier_id=?, storage_location=?,
       tracks_expiry=?, notes=? WHERE id=?`
  ).run(v.name, v.code, v.category, v.unit, v.reorder_level, v.supplier_id, v.storage_location, v.tracks_expiry, v.notes, id);
  res.json({ ok: true });
}));

app.delete("/api/items/:id", auth, adminOnly, h((req, res) => {
  const item = getItem(toInt(req.params.id));
  if (item.total_stock > 0) bad("This item still has stock. Issue, write off or adjust it to zero first.");
  db.prepare("UPDATE items SET active = 0 WHERE id = ?").run(item.id);
  res.json({ ok: true });
}));

/* ----- stock movements ----- */
app.post("/api/stock/in", auth, h((req, res) => {
  const b = req.body || {};
  const item = getItem(toInt(b.item_id));
  if (!item.active) bad("This item is deactivated.");
  const qty = toInt(b.quantity);
  if (!(qty > 0)) bad("Quantity must be a whole number greater than 0.");
  const batchNo = str(b.batch_no, 40) || (item.tracks_expiry ? bad("Batch number is required.") : "DEFAULT");
  let expiry = null;
  if (item.tracks_expiry) {
    expiry = str(b.expiry_date, 10);
    if (!isDate(expiry)) bad("A valid expiry date is required for this item.");
    if (expiry < today()) bad("That expiry date has already passed.");
  }
  let unitCost = null;
  if (b.unit_cost !== "" && b.unit_cost != null) {
    unitCost = Number(b.unit_cost);
    if (!(unitCost >= 0)) bad("Unit cost must be 0 or more.");
  }
  let supplierId = item.supplier_id;
  if (b.supplier_id !== undefined) {
    supplierId = b.supplier_id === "" || b.supplier_id == null ? null : toInt(b.supplier_id);
    if (supplierId !== null && !db.prepare("SELECT 1 FROM suppliers WHERE id = ?").get(supplierId)) bad("Supplier not found.");
  }
  const result = tx(() => {
    const existing = db.prepare("SELECT * FROM batches WHERE item_id = ? AND batch_no = ?").get(item.id, batchNo);
    let batchId;
    if (existing) {
      if (item.tracks_expiry && existing.expiry_date !== expiry) {
        bad(`Batch ${batchNo} already exists with a different expiry date (${existing.expiry_date}).`);
      }
      db.prepare("UPDATE batches SET quantity = quantity + ?, unit_cost = COALESCE(?, unit_cost) WHERE id = ?").run(qty, unitCost, existing.id);
      batchId = existing.id;
    } else {
      batchId = Number(
        db.prepare("INSERT INTO batches (item_id, batch_no, expiry_date, quantity, unit_cost) VALUES (?, ?, ?, ?, ?)")
          .run(item.id, batchNo, expiry, qty, unitCost).lastInsertRowid
      );
    }
    addMovement({
      item_id: item.id, batch_id: batchId, type: "in", quantity: qty, supplier_id: supplierId,
      reference: str(b.reference, 80) || null, notes: str(b.notes, 300) || null, user_id: req.user.id,
    });
    return batchId;
  });
  res.status(201).json({ ok: true, batch_id: result });
}));

app.post("/api/stock/out", auth, h((req, res) => {
  const b = req.body || {};
  const item = getItem(toInt(b.item_id));
  const qty = toInt(b.quantity);
  if (!(qty > 0)) bad("Quantity must be a whole number greater than 0.");
  const deptId = toInt(b.department_id);
  if (!Number.isInteger(deptId) || !db.prepare("SELECT 1 FROM departments WHERE id = ?").get(deptId)) {
    bad("Choose the department receiving the stock.");
  }
  const common = {
    item_id: item.id, type: "out", department_id: deptId,
    reference: str(b.reference, 80) || null, notes: str(b.notes, 300) || null, user_id: req.user.id,
  };
  tx(() => {
    // First-expiry-first-out: use the batches that expire soonest, skip expired ones.
    const batches = db
      .prepare(
        `SELECT * FROM batches WHERE item_id = ? AND quantity > 0 AND (expiry_date IS NULL OR expiry_date >= date('now'))
         ORDER BY expiry_date IS NULL, expiry_date, id`
      )
      .all(item.id);
    const available = batches.reduce((s, x) => s + x.quantity, 0);
    if (available < qty) bad(`Only ${available} ${item.unit} available (expired stock can't be issued).`);
    let remaining = qty;
    for (const batch of batches) {
      if (remaining === 0) break;
      const take = Math.min(batch.quantity, remaining);
      db.prepare("UPDATE batches SET quantity = quantity - ? WHERE id = ?").run(take, batch.id);
      addMovement({ ...common, batch_id: batch.id, quantity: -take });
      remaining -= take;
    }
  });
  res.status(201).json({ ok: true });
}));

app.post("/api/stock/writeoff", auth, h((req, res) => {
  const b = req.body || {};
  const batch = db.prepare("SELECT * FROM batches WHERE id = ?").get(toInt(b.batch_id));
  if (!batch) bad("Batch not found.");
  const qty = b.quantity === undefined || b.quantity === "" ? batch.quantity : toInt(b.quantity);
  if (!(qty > 0) || qty > batch.quantity) bad(`Quantity must be between 1 and ${batch.quantity}.`);
  const reason = str(b.reason, 200);
  if (!reason) bad("Give a reason (expired, damaged, contaminated…).");
  tx(() => {
    db.prepare("UPDATE batches SET quantity = quantity - ? WHERE id = ?").run(qty, batch.id);
    addMovement({ item_id: batch.item_id, batch_id: batch.id, type: "writeoff", quantity: -qty, notes: reason, user_id: req.user.id });
  });
  res.status(201).json({ ok: true });
}));

app.post("/api/stock/adjust", auth, adminOnly, h((req, res) => {
  const b = req.body || {};
  const batch = db.prepare("SELECT * FROM batches WHERE id = ?").get(toInt(b.batch_id));
  if (!batch) bad("Batch not found.");
  const newQty = toInt(b.new_quantity);
  if (!(newQty >= 0)) bad("New quantity must be a whole number, 0 or more.");
  const reason = str(b.reason, 200);
  if (!reason) bad("Give a reason for the correction (e.g. stock count).");
  if (newQty === batch.quantity) bad("That is already the recorded quantity.");
  tx(() => {
    db.prepare("UPDATE batches SET quantity = ? WHERE id = ?").run(newQty, batch.id);
    addMovement({ item_id: batch.item_id, batch_id: batch.id, type: "adjust", quantity: newQty - batch.quantity, notes: reason, user_id: req.user.id });
  });
  res.status(201).json({ ok: true });
}));

app.get("/api/movements", auth, h((req, res) => res.json(queryMovements(req.query))));

/* ----- suppliers ----- */
function parseSupplier(b) {
  const name = str(b.name, 120);
  if (!name) bad("Supplier name is required.");
  const email = str(b.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad("Enter a valid email address.");
  return { name, contact_person: str(b.contact_person, 100) || null, phone: str(b.phone, 40) || null, email: email || null, address: str(b.address, 250) || null };
}

app.get("/api/suppliers", auth, h((_req, res) => {
  res.json(
    db.prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM items i WHERE i.supplier_id = s.id AND i.active = 1) AS item_count
       FROM suppliers s WHERE s.active = 1 ORDER BY s.name COLLATE NOCASE`
    ).all()
  );
}));

app.post("/api/suppliers", auth, h((req, res) => {
  const v = parseSupplier(req.body || {});
  const info = db.prepare("INSERT INTO suppliers (name, contact_person, phone, email, address) VALUES (?, ?, ?, ?, ?)")
    .run(v.name, v.contact_person, v.phone, v.email, v.address);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
}));

app.put("/api/suppliers/:id", auth, h((req, res) => {
  const v = parseSupplier(req.body || {});
  const info = db.prepare("UPDATE suppliers SET name=?, contact_person=?, phone=?, email=?, address=? WHERE id=?")
    .run(v.name, v.contact_person, v.phone, v.email, v.address, toInt(req.params.id));
  if (!info.changes) notFound("Supplier not found.");
  res.json({ ok: true });
}));

app.delete("/api/suppliers/:id", auth, adminOnly, h((req, res) => {
  const id = toInt(req.params.id);
  const info = db.prepare("UPDATE suppliers SET active = 0 WHERE id = ?").run(id);
  if (!info.changes) notFound("Supplier not found.");
  db.prepare("UPDATE items SET supplier_id = NULL WHERE supplier_id = ?").run(id);
  res.json({ ok: true });
}));

/* ----- departments ----- */
app.get("/api/departments", auth, h((_req, res) => {
  res.json(db.prepare("SELECT id, name FROM departments ORDER BY name COLLATE NOCASE").all());
}));

app.post("/api/departments", auth, adminOnly, h((req, res) => {
  const name = str(req.body?.name, 80);
  if (!name) bad("Department name is required.");
  const info = db.prepare("INSERT INTO departments (name) VALUES (?)").run(name);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
}));

app.delete("/api/departments/:id", auth, adminOnly, h((req, res) => {
  const id = toInt(req.params.id);
  if (db.prepare("SELECT 1 FROM movements WHERE department_id = ? LIMIT 1").get(id)) {
    bad("This department has stock history, so it can't be removed.");
  }
  db.prepare("DELETE FROM departments WHERE id = ?").run(id);
  res.json({ ok: true });
}));

/* ----- users (admin) ----- */
app.get("/api/users", auth, adminOnly, h((_req, res) => {
  res.json(db.prepare("SELECT id, username, name, role, active, created_at FROM users ORDER BY username").all());
}));

app.post("/api/users", auth, adminOnly, h((req, res) => {
  const b = req.body || {};
  const username = str(b.username, 40).toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) bad("Username: 3–40 letters, numbers, dot, dash or underscore.");
  const name = str(b.name, 80);
  if (!name) bad("Full name is required.");
  const role = b.role === "admin" ? "admin" : "staff";
  const password = String(b.password || "");
  if (password.length < 8) bad("Password must be at least 8 characters.");
  const info = db.prepare("INSERT INTO users (username, name, role, password_hash) VALUES (?, ?, ?, ?)")
    .run(username, name, role, hashPassword(password));
  res.status(201).json({ id: Number(info.lastInsertRowid) });
}));

app.put("/api/users/:id", auth, adminOnly, h((req, res) => {
  const id = toInt(req.params.id);
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!user) notFound("User not found.");
  const b = req.body || {};
  const role = b.role === "admin" || b.role === "staff" ? b.role : user.role;
  const active = b.active === undefined ? user.active : b.active ? 1 : 0;
  const losingAdmin = user.role === "admin" && user.active && (role !== "admin" || !active);
  if (losingAdmin && db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND active=1").get().n <= 1) {
    bad("There must be at least one active admin.");
  }
  tx(() => {
    db.prepare("UPDATE users SET role = ?, active = ? WHERE id = ?").run(role, active, id);
    if (b.password) {
      if (String(b.password).length < 8) bad("Password must be at least 8 characters.");
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(String(b.password)), id);
    }
    if (!active || b.password) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
  });
  res.json({ ok: true });
}));

/* ----- CSV export ----- */
function csvCell(v) {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function sendCsv(res, filename, columns, rows) {
  const lines = [columns.map((c) => csvCell(c[1])).join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvCell(r[c[0]])).join(","));
  res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"` });
  res.send("﻿" + lines.join("\r\n"));
}

app.get("/api/export/items.csv", auth, h((_req, res) => {
  sendCsv(res, `redora-stock-${today()}.csv`, [
    ["name", "Item"], ["code", "Code"], ["category", "Category"], ["unit", "Unit"],
    ["available_stock", "Available stock"], ["expired_stock", "Expired stock"], ["reorder_level", "Reorder level"],
    ["status", "Status"], ["next_expiry", "Next expiry"], ["supplier_name", "Supplier"], ["storage_location", "Location"],
  ], itemsWithStock("WHERE i.active = 1"));
}));

app.get("/api/export/movements.csv", auth, h((req, res) => {
  sendCsv(res, `redora-history-${today()}.csv`, [
    ["created_at", "Date (UTC)"], ["type", "Type"], ["item_name", "Item"], ["batch_no", "Batch"], ["expiry_date", "Expiry"],
    ["quantity", "Quantity change"], ["unit", "Unit"], ["department", "Department"], ["supplier", "Supplier"],
    ["reference", "Reference"], ["notes", "Notes"], ["user_name", "Recorded by"],
  ], queryMovements({ ...req.query, limit: 2000 }));
}));

/* ---------- errors ---------- */
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));

app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  const msg = String(err.message || "");
  if (msg.includes("UNIQUE constraint failed")) {
    const map = {
      "items.code": "That item code is already in use.",
      "users.username": "That username is already taken.",
      "suppliers.name": "A supplier with that name already exists.",
      "departments.name": "That department already exists.",
    };
    const key = Object.keys(map).find((k) => msg.includes(k));
    return res.status(409).json({ error: map[key] || "That already exists." });
  }
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid request." });
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

app.listen(PORT, () => console.log(`Redora running on http://localhost:${PORT}`));
