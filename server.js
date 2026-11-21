require("dotenv").config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const {
  connectDB, User, Session, Supplier, Department, Item, Batch, Movement,
  hashPassword, verifyPassword, ensureAdmin, seedDepartments,
} = require("./db");

const PORT = process.env.PORT || 3000;
const PROD = process.env.NODE_ENV === "production";
const EXPIRY_WARN_DAYS = Number(process.env.EXPIRY_WARN_DAYS) || 90;
const SESSION_MS = 12 * 60 * 60 * 1000;
const CATEGORIES = ["Medicine", "Consumable", "Surgical", "Lab supplies", "PPE", "Equipment", "Other"];

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
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => { throw new HttpError(400, msg); };
const notFound = (msg = "Not found.") => { throw new HttpError(404, msg); };
const ha = (fn) => (req, res, next) => { fn(req, res).catch(next); };
const toInt = (v) => { if (v === null || v === undefined || v === "") return NaN; const n = Number(v); return Number.isInteger(n) ? n : NaN; };
const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const today = () => new Date().toISOString().slice(0, 10);
const todayDate = () => today();

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

async function authMiddleware(req, res, next) {
  const token = getCookie(req, "redora_sid");
  if (!token) return res.status(401).json({ error: "Please sign in." });
  const session = await Session.findOne({ token_hash: sha(token), expires_at: { $gt: Date.now() } });
  if (!session) return res.status(401).json({ error: "Please sign in." });
  const user = await User.findOne({ id: session.user_id, active: 1 });
  if (!user) return res.status(401).json({ error: "Please sign in." });
  req.user = { id: user.id, username: user.username, name: user.name, role: user.role };
  req.tokenHash = sha(token);
  next();
}
const adminOnly = (req, res, next) =>
  req.user.role === "admin" ? next() : res.status(403).json({ error: "Admin access required." });

// Periodic session cleanup
setInterval(async () => {
  try { await Session.deleteMany({ expires_at: { $lt: Date.now() } }); } catch {}
}, 60 * 60 * 1000).unref();

/* ---------- stock queries ---------- */
async function itemsWithStock(filter = {}) {
  const items = await Item.find(filter).sort({ name: 1 }).lean();
  const todayStr = todayDate();

  const result = [];
  for (const item of items) {
    const batches = await Batch.find({ item_id: item.id }).lean();
    const total_stock = batches.reduce((s, b) => s + b.quantity, 0);
    const available_stock = batches
      .filter((b) => !b.expiry_date || b.expiry_date >= todayStr)
      .reduce((s, b) => s + b.quantity, 0);
    const expired_stock = batches
      .filter((b) => b.expiry_date && b.expiry_date < todayStr)
      .reduce((s, b) => s + b.quantity, 0);

    const validBatches = batches.filter((b) => b.quantity > 0 && (!b.expiry_date || b.expiry_date >= todayStr) && b.expiry_date);
    const next_expiry = validBatches.length
      ? validBatches.sort((a, b) => a.expiry_date.localeCompare(b.expiry_date))[0].expiry_date
      : null;

    let supplier_name = null;
    if (item.supplier_id) {
      const sup = await Supplier.findOne({ id: item.supplier_id }).lean();
      supplier_name = sup ? sup.name : null;
    }

    const status = available_stock <= 0 ? "out" : available_stock <= item.reorder_level ? "low" : "ok";
    result.push({ ...item, total_stock, available_stock, expired_stock, next_expiry, supplier_name, status });
  }
  return result;
}

async function getItem(id) {
  if (!Number.isInteger(id)) bad("Choose an item.");
  const rows = await itemsWithStock({ id });
  if (!rows.length) notFound("Item not found.");
  return rows[0];
}

async function queryMovements(q, defaultLimit = 200) {
  const filter = {};
  if (q.item_id) filter.item_id = toInt(q.item_id);
  if (["in", "out", "adjust", "writeoff"].includes(q.type)) filter.type = q.type;
  if (q.from && isDate(q.from)) filter.created_at = { ...(filter.created_at || {}), $gte: q.from };
  if (q.to && isDate(q.to)) filter.created_at = { ...(filter.created_at || {}), $lte: q.to + " 23:59:59" };

  const limit = Math.min(Math.max(toInt(q.limit) || defaultLimit, 1), 2000);
  const movements = await Movement.find(filter).sort({ id: -1 }).limit(limit).lean();

  const result = [];
  for (const m of movements) {
    const item = await Item.findOne({ id: m.item_id }).lean();
    const batch = m.batch_id ? await Batch.findOne({ id: m.batch_id }).lean() : null;
    const dept = m.department_id ? await Department.findOne({ id: m.department_id }).lean() : null;
    const sup = m.supplier_id ? await Supplier.findOne({ id: m.supplier_id }).lean() : null;
    const user = m.user_id ? await User.findOne({ id: m.user_id }).lean() : null;
    result.push({
      id: m.id, type: m.type, quantity: m.quantity, reference: m.reference, notes: m.notes, created_at: m.created_at,
      item_id: m.item_id, item_name: item ? item.name : null, unit: item ? item.unit : null,
      batch_no: batch ? batch.batch_no : null, expiry_date: batch ? batch.expiry_date : null,
      department: dept ? dept.name : null, supplier: sup ? sup.name : null, user_name: user ? user.name : null,
    });
  }
  return result;
}

async function addMovement(m) {
  const movement = new Movement({
    item_id: m.item_id,
    batch_id: m.batch_id ?? null,
    type: m.type,
    quantity: m.quantity,
    department_id: m.department_id ?? null,
    supplier_id: m.supplier_id ?? null,
    reference: m.reference ?? null,
    notes: m.notes ?? null,
    user_id: m.user_id,
    created_at: m.created_at || new Date().toISOString().replace("T", " ").slice(0, 19),
  });
  await movement.save();
}

/* ---------- public ---------- */
app.get("/api/health", ha(async (_req, res) => {
  res.json({ status: "ok" });
}));

app.post("/api/login", loginLimiter, ha(async (req, res) => {
  const { username, password } = req.body || {};
  const user = await User.findOne({ username: str(username, 60).toLowerCase(), active: 1 });
  if (!user || !verifyPassword(String(password || ""), user.password_hash)) {
    return res.status(401).json({ error: "Incorrect username or password." });
  }
  const token = crypto.randomBytes(32).toString("hex");
  await new Session({ token_hash: sha(token), user_id: user.id, expires_at: Date.now() + SESSION_MS }).save();
  res.cookie("redora_sid", token, { httpOnly: true, sameSite: "lax", secure: PROD, maxAge: SESSION_MS });
  res.json({ user: { id: user.id, username: user.username, name: user.name, role: user.role } });
}));

/* ---------- everything below needs a signed-in user ---------- */
app.post("/api/logout", authMiddleware, ha(async (req, res) => {
  await Session.deleteOne({ token_hash: req.tokenHash });
  res.clearCookie("redora_sid");
  res.json({ ok: true });
}));

app.get("/api/me", authMiddleware, (req, res) => res.json({ user: req.user, categories: CATEGORIES, expiryWarnDays: EXPIRY_WARN_DAYS }));

app.post("/api/me/password", authMiddleware, ha(async (req, res) => {
  const { current_password, new_password } = req.body || {};
  const row = await User.findOne({ id: req.user.id });
  if (!verifyPassword(String(current_password || ""), row.password_hash)) bad("Current password is incorrect.");
  if (String(new_password || "").length < 8) bad("New password must be at least 8 characters.");
  await User.updateOne({ id: req.user.id }, { password_hash: hashPassword(String(new_password)) });
  await Session.deleteMany({ user_id: req.user.id, token_hash: { $ne: req.tokenHash } });
  res.json({ ok: true });
}));

/* ----- dashboard ----- */
app.get("/api/dashboard", authMiddleware, ha(async (_req, res) => {
  const items = await itemsWithStock({ active: 1 });
  const lowItems = items.filter((i) => i.status === "low" || i.status === "out");
  const todayStr = todayDate();
  const warnDate = new Date(Date.now() + EXPIRY_WARN_DAYS * 864e5).toISOString().slice(0, 10);

  // Expiring soon: active items, qty > 0, expiry between today and today + warn days
  const allBatches = await Batch.find({ quantity: { $gt: 0 }, expiry_date: { $ne: null, $gte: todayStr, $lte: warnDate } }).lean();
  const activeItemIds = new Set(items.map((i) => i.id));
  const expiringBatches = allBatches.filter((b) => activeItemIds.has(b.item_id));
  const expiringSoon = [];
  for (const b of expiringBatches.sort((a, c) => a.expiry_date.localeCompare(c.expiry_date)).slice(0, 8)) {
    const item = items.find((i) => i.id === b.item_id);
    expiringSoon.push({ id: b.id, batch_no: b.batch_no, expiry_date: b.expiry_date, quantity: b.quantity, item_id: b.item_id, name: item?.name, unit: item?.unit });
  }
  const expiringCount = expiringBatches.length;

  // Expired: active items, qty > 0, expiry < today
  const expiredBatches = await Batch.find({ quantity: { $gt: 0 }, expiry_date: { $ne: null, $lt: todayStr } }).lean();
  const expiredFiltered = expiredBatches.filter((b) => activeItemIds.has(b.item_id));
  const expired = [];
  for (const b of expiredFiltered.sort((a, c) => a.expiry_date.localeCompare(c.expiry_date)).slice(0, 8)) {
    const item = items.find((i) => i.id === b.item_id);
    expired.push({ id: b.id, batch_no: b.batch_no, expiry_date: b.expiry_date, quantity: b.quantity, item_id: b.item_id, name: item?.name, unit: item?.unit });
  }
  const expiredCount = expiredFiltered.length;

  // Activity chart: last 14 days
  const fourteenDaysAgo = new Date(Date.now() - 13 * 864e5).toISOString().slice(0, 10);
  const recentMovements = await Movement.find({
    type: { $in: ["in", "out"] },
    created_at: { $gte: fourteenDaysAgo },
  }).lean();
  const activityMap = {};
  for (const m of recentMovements) {
    const day = (m.created_at || "").slice(0, 10);
    if (!activityMap[day]) activityMap[day] = { day, in_qty: 0, out_qty: 0 };
    if (m.quantity > 0) activityMap[day].in_qty += m.quantity;
    else activityMap[day].out_qty += -m.quantity;
  }
  const activity = Object.values(activityMap);

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
    recent: await queryMovements({ limit: 8 }),
    expiryWarnDays: EXPIRY_WARN_DAYS,
  });
}));

/* ----- items ----- */
async function parseItem(b) {
  const name = str(b.name, 120);
  if (!name) bad("Item name is required.");
  const category = str(b.category, 40);
  if (!CATEGORIES.includes(category)) bad("Choose a valid category.");
  const reorder = b.reorder_level === "" || b.reorder_level == null ? 0 : toInt(b.reorder_level);
  if (!(reorder >= 0)) bad("Reorder level must be a whole number, 0 or more.");
  let supplier_id = null;
  if (b.supplier_id !== "" && b.supplier_id != null) {
    supplier_id = toInt(b.supplier_id);
    if (!Number.isInteger(supplier_id) || !(await Supplier.findOne({ id: supplier_id }))) {
      bad("Supplier not found.");
    }
  }
  return {
    name, code: str(b.code, 40) || null, category,
    unit: str(b.unit, 20) || "units", reorder_level: reorder, supplier_id,
    storage_location: str(b.storage_location, 80) || null,
    tracks_expiry: b.tracks_expiry ? 1 : 0,
    notes: str(b.notes, 500) || null,
  };
}

app.get("/api/items", authMiddleware, ha(async (req, res) => {
  const all = req.query.include_inactive === "1";
  res.json(await itemsWithStock(all ? {} : { active: 1 }));
}));

app.get("/api/items/:id", authMiddleware, ha(async (req, res) => {
  const item = await getItem(toInt(req.params.id));
  const batches = await Batch.find({ item_id: item.id }).sort({ quantity: 1, expiry_date: 1 }).lean();
  res.json({ item, batches, movements: await queryMovements({ item_id: item.id, limit: 50 }) });
}));

app.post("/api/items", authMiddleware, ha(async (req, res) => {
  const v = await parseItem(req.body || {});
  const newItem = new Item(v);
  await newItem.save();
  res.status(201).json({ id: newItem.id });
}));

app.put("/api/items/:id", authMiddleware, ha(async (req, res) => {
  const id = toInt(req.params.id);
  await getItem(id);
  const v = await parseItem(req.body || {});
  await Item.updateOne({ id }, v);
  res.json({ ok: true });
}));

app.delete("/api/items/:id", authMiddleware, adminOnly, ha(async (req, res) => {
  const item = await getItem(toInt(req.params.id));
  if (item.total_stock > 0) bad("This item still has stock. Issue, write off or adjust it to zero first.");
  await Item.updateOne({ id: item.id }, { active: 0 });
  res.json({ ok: true });
}));

/* ----- stock movements ----- */
app.post("/api/stock/in", authMiddleware, ha(async (req, res) => {
  const b = req.body || {};
  const item = await getItem(toInt(b.item_id));
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
    if (supplierId !== null && !(await Supplier.findOne({ id: supplierId }))) bad("Supplier not found.");
  }

  const session = await require("mongoose").startSession();
  let batchId;
  try {
    await session.withTransaction(async () => {
      const existing = await Batch.findOne({ item_id: item.id, batch_no: batchNo }).session(session);
      if (existing) {
        if (item.tracks_expiry && existing.expiry_date !== expiry) {
          bad(`Batch ${batchNo} already exists with a different expiry date (${existing.expiry_date}).`);
        }
        await Batch.updateOne({ id: existing.id }, { $inc: { quantity: qty }, ...(unitCost != null ? { unit_cost: unitCost } : {}) }).session(session);
        batchId = existing.id;
      } else {
        const newBatch = new Batch({ item_id: item.id, batch_no: batchNo, expiry_date: expiry, quantity: qty, unit_cost: unitCost });
        await newBatch.save({ session });
        batchId = newBatch.id;
      }
      const movement = new Movement({
        item_id: item.id, batch_id: batchId, type: "in", quantity: qty, supplier_id: supplierId,
        reference: str(b.reference, 80) || null, notes: str(b.notes, 300) || null, user_id: req.user.id,
      });
      await movement.save({ session });
    });
  } finally {
    await session.endSession();
  }
  res.status(201).json({ ok: true, batch_id: batchId });
}));

app.post("/api/stock/out", authMiddleware, ha(async (req, res) => {
  const b = req.body || {};
  const item = await getItem(toInt(b.item_id));
  const qty = toInt(b.quantity);
  if (!(qty > 0)) bad("Quantity must be a whole number greater than 0.");
  const deptId = toInt(b.department_id);
  if (!Number.isInteger(deptId) || !(await Department.findOne({ id: deptId }))) {
    bad("Choose the department receiving the stock.");
  }
  const common = {
    item_id: item.id, type: "out", department_id: deptId,
    reference: str(b.reference, 80) || null, notes: str(b.notes, 300) || null, user_id: req.user.id,
  };
  const todayStr = todayDate();

  const session = await require("mongoose").startSession();
  try {
    await session.withTransaction(async () => {
      // FEFO: first expiry first out, skip expired
      const batches = await Batch.find({
        item_id: item.id,
        quantity: { $gt: 0 },
        $or: [{ expiry_date: null }, { expiry_date: { $gte: todayStr } }],
      }).sort({ expiry_date: 1 }).session(session).lean();

      const available = batches.reduce((s, x) => s + x.quantity, 0);
      if (available < qty) bad(`Only ${available} ${item.unit} available (expired stock can't be issued).`);
      let remaining = qty;
      for (const batch of batches) {
        if (remaining === 0) break;
        const take = Math.min(batch.quantity, remaining);
        await Batch.updateOne({ id: batch.id }, { $inc: { quantity: -take } }).session(session);
        const movement = new Movement({ ...common, batch_id: batch.id, quantity: -take });
        await movement.save({ session });
        remaining -= take;
      }
    });
  } finally {
    await session.endSession();
  }
  res.status(201).json({ ok: true });
}));

app.post("/api/stock/writeoff", authMiddleware, ha(async (req, res) => {
  const b = req.body || {};
  const batch = await Batch.findOne({ id: toInt(b.batch_id) });
  if (!batch) bad("Batch not found.");
  const qty = b.quantity === undefined || b.quantity === "" ? batch.quantity : toInt(b.quantity);
  if (!(qty > 0) || qty > batch.quantity) bad(`Quantity must be between 1 and ${batch.quantity}.`);
  const reason = str(b.reason, 200);
  if (!reason) bad("Give a reason (expired, damaged, contaminated…).");

  const session = await require("mongoose").startSession();
  try {
    await session.withTransaction(async () => {
      await Batch.updateOne({ id: batch.id }, { $inc: { quantity: -qty } }).session(session);
      const movement = new Movement({ item_id: batch.item_id, batch_id: batch.id, type: "writeoff", quantity: -qty, notes: reason, user_id: req.user.id });
      await movement.save({ session });
    });
  } finally {
    await session.endSession();
  }
  res.status(201).json({ ok: true });
}));

app.post("/api/stock/adjust", authMiddleware, adminOnly, ha(async (req, res) => {
  const b = req.body || {};
  const batch = await Batch.findOne({ id: toInt(b.batch_id) });
  if (!batch) bad("Batch not found.");
  const newQty = toInt(b.new_quantity);
  if (!(newQty >= 0)) bad("New quantity must be a whole number, 0 or more.");
  const reason = str(b.reason, 200);
  if (!reason) bad("Give a reason for the correction (e.g. stock count).");
  if (newQty === batch.quantity) bad("That is already the recorded quantity.");

  const session = await require("mongoose").startSession();
  try {
    await session.withTransaction(async () => {
      await Batch.updateOne({ id: batch.id }, { quantity: newQty }).session(session);
      const movement = new Movement({ item_id: batch.item_id, batch_id: batch.id, type: "adjust", quantity: newQty - batch.quantity, notes: reason, user_id: req.user.id });
      await movement.save({ session });
    });
  } finally {
    await session.endSession();
  }
  res.status(201).json({ ok: true });
}));

app.get("/api/movements", authMiddleware, ha(async (req, res) => res.json(await queryMovements(req.query))));

/* ----- suppliers ----- */
function parseSupplier(b) {
  const name = str(b.name, 120);
  if (!name) bad("Supplier name is required.");
  const email = str(b.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad("Enter a valid email address.");
  return { name, contact_person: str(b.contact_person, 100) || null, phone: str(b.phone, 40) || null, email: email || null, address: str(b.address, 250) || null };
}

app.get("/api/suppliers", authMiddleware, ha(async (_req, res) => {
  const suppliers = await Supplier.find({ active: 1 }).sort({ name: 1 }).lean();
  const result = [];
  for (const s of suppliers) {
    const item_count = await Item.countDocuments({ supplier_id: s.id, active: 1 });
    result.push({ ...s, item_count });
  }
  res.json(result);
}));

app.post("/api/suppliers", authMiddleware, ha(async (req, res) => {
  const v = parseSupplier(req.body || {});
  const sup = new Supplier(v);
  await sup.save();
  res.status(201).json({ id: sup.id });
}));

app.put("/api/suppliers/:id", authMiddleware, ha(async (req, res) => {
  const v = parseSupplier(req.body || {});
  const result = await Supplier.updateOne({ id: toInt(req.params.id) }, v);
  if (!result.matchedCount) notFound("Supplier not found.");
  res.json({ ok: true });
}));

app.delete("/api/suppliers/:id", authMiddleware, adminOnly, ha(async (req, res) => {
  const id = toInt(req.params.id);
  const result = await Supplier.updateOne({ id }, { active: 0 });
  if (!result.matchedCount) notFound("Supplier not found.");
  await Item.updateMany({ supplier_id: id }, { supplier_id: null });
  res.json({ ok: true });
}));

/* ----- departments ----- */
app.get("/api/departments", authMiddleware, ha(async (_req, res) => {
  res.json(await Department.find({}).sort({ name: 1 }).select("id name -_id").lean());
}));

app.post("/api/departments", authMiddleware, adminOnly, ha(async (req, res) => {
  const name = str(req.body?.name, 80);
  if (!name) bad("Department name is required.");
  const dept = new Department({ name });
  await dept.save();
  res.status(201).json({ id: dept.id });
}));

app.delete("/api/departments/:id", authMiddleware, adminOnly, ha(async (req, res) => {
  const id = toInt(req.params.id);
  const hasHistory = await Movement.findOne({ department_id: id });
  if (hasHistory) bad("This department has stock history, so it can't be removed.");
  await Department.deleteOne({ id });
  res.json({ ok: true });
}));

/* ----- users (admin) ----- */
app.get("/api/users", authMiddleware, adminOnly, ha(async (_req, res) => {
  res.json(await User.find({}).sort({ username: 1 }).select("id username name role active created_at -_id").lean());
}));

app.post("/api/users", authMiddleware, adminOnly, ha(async (req, res) => {
  const b = req.body || {};
  const username = str(b.username, 40).toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) bad("Username: 3–40 letters, numbers, dot, dash or underscore.");
  const name = str(b.name, 80);
  if (!name) bad("Full name is required.");
  const role = b.role === "admin" ? "admin" : "staff";
  const password = String(b.password || "");
  if (password.length < 8) bad("Password must be at least 8 characters.");
  const user = new User({ username, name, role, password_hash: hashPassword(password) });
  await user.save();
  res.status(201).json({ id: user.id });
}));

app.put("/api/users/:id", authMiddleware, adminOnly, ha(async (req, res) => {
  const id = toInt(req.params.id);
  const user = await User.findOne({ id });
  if (!user) notFound("User not found.");
  const b = req.body || {};
  const role = b.role === "admin" || b.role === "staff" ? b.role : user.role;
  const active = b.active === undefined ? user.active : b.active ? 1 : 0;
  const losingAdmin = user.role === "admin" && user.active && (role !== "admin" || !active);
  if (losingAdmin && (await User.countDocuments({ role: "admin", active: 1 })) <= 1) {
    bad("There must be at least one active admin.");
  }

  const updates = { role, active };
  if (b.password) {
    if (String(b.password).length < 8) bad("Password must be at least 8 characters.");
    updates.password_hash = hashPassword(String(b.password));
  }
  await User.updateOne({ id }, updates);
  if (!active || b.password) await Session.deleteMany({ user_id: id });
  res.json({ ok: true });
}));

/* ----- CSV export ----- */
function csvCell(v) {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function sendCsv(res, filename, columns, rows) {
  const lines = [columns.map((c) => csvCell(c[1])).join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvCell(r[c[0]])).join(","));
  res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"` });
  res.send("\uFEFF" + lines.join("\r\n"));
}

app.get("/api/export/items.csv", authMiddleware, ha(async (_req, res) => {
  sendCsv(res, `redora-stock-${today()}.csv`, [
    ["name", "Item"], ["code", "Code"], ["category", "Category"], ["unit", "Unit"],
    ["available_stock", "Available stock"], ["expired_stock", "Expired stock"], ["reorder_level", "Reorder level"],
    ["status", "Status"], ["next_expiry", "Next expiry"], ["supplier_name", "Supplier"], ["storage_location", "Location"],
  ], await itemsWithStock({ active: 1 }));
}));

app.get("/api/export/movements.csv", authMiddleware, ha(async (req, res) => {
  sendCsv(res, `redora-history-${today()}.csv`, [
    ["created_at", "Date (UTC)"], ["type", "Type"], ["item_name", "Item"], ["batch_no", "Batch"], ["expiry_date", "Expiry"],
    ["quantity", "Quantity change"], ["unit", "Unit"], ["department", "Department"], ["supplier", "Supplier"],
    ["reference", "Reference"], ["notes", "Notes"], ["user_name", "Recorded by"],
  ], await queryMovements({ ...req.query, limit: 2000 }));
}));

/* ---------- errors ---------- */
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));

app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  const msg = String(err.message || "");
  if (msg.includes("duplicate key") || msg.includes("E11000")) {
    const map = {
      "code": "That item code is already in use.",
      "username": "That username is already taken.",
      "suppliers": "A supplier with that name already exists.",
      "departments": "That department already exists.",
    };
    const key = Object.keys(map).find((k) => msg.includes(k));
    return res.status(409).json({ error: map[key] || "That already exists." });
  }
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid request." });
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

/* ---------- start ---------- */
(async () => {
  await connectDB();
  await seedDepartments();
  await ensureAdmin();
  app.listen(PORT, () => console.log(`Redora running on http://localhost:${PORT}`));
})();
