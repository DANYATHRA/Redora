require("dotenv").config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const {
  connectDB,
  User,
  Session,
  Supplier,
  Department,
  Store,
  Item,
  Batch,
  Movement,
  PurchaseOrder,
  ItemAudit,
  PasswordReset,
  StockTake,
  AlertConfig,
  hashPassword,
  verifyPassword,
  ensureAdmin,
  seedDepartments,
  seedStores,
  seedAlertConfig,
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
      "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
  });
  next();
});

/* ---------- static files (served before DB middleware) ---------- */
app.use(express.static(path.join(__dirname, "public")));

/* ---------- DB init (cached for serverless cold starts) ---------- */
let _initPromise = null;
let _dbError = null;
async function initOnce() {
  if (_dbError) {
    // Retry on next request if it previously failed
    _initPromise = null;
    _dbError = null;
  }
  if (!_initPromise) {
    _initPromise = (async () => {
      try {
        await connectDB();
        await seedDepartments();
        await seedStores();
        await seedAlertConfig();
        await ensureAdmin();
      } catch (err) {
        _dbError = err;
        console.error("MongoDB Atlas connection error:", err.message);
        throw err;
      }
    })();
  }
  return _initPromise;
}

// Middleware: ensure DB is connected before API requests
app.use("/api", async (req, _res, next) => {
  if (req.path === "/health") return next();
  try {
    await initOnce();
    next();
  } catch (e) {
    next(new HttpError(500, `MongoDB connection error: ${e.message}. Please check your MongoDB Atlas password and Network Access whitelist (0.0.0.0/0).`));
  }
});

// Fallback for HTML5 client-side routing
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

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
const ha = (fn) => (req, res, next) => {
  fn(req, res).catch(next);
};
const toInt = (v) => {
  if (v === null || v === undefined || v === "") return NaN;
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
};
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
  req.user = { id: user.id, username: user.username, name: user.name, role: user.role, email: user.email };
  req.tokenHash = sha(token);
  next();
}
const adminOnly = (req, res, next) =>
  req.user.role === "admin" ? next() : res.status(403).json({ error: "Admin access required." });

// Periodic session cleanup
setInterval(async () => {
  try {
    await Session.deleteMany({ expires_at: { $lt: Date.now() } });
  } catch {}
}, 60 * 60 * 1000).unref();

/* ---------- stock queries ---------- */
async function itemsWithStock(filter = {}, storeId = null) {
  const items = await Item.find(filter).sort({ name: 1 }).lean();
  const todayStr = todayDate();

  const result = [];
  for (const item of items) {
    const batchQuery = { item_id: item.id };
    if (storeId) batchQuery.store_id = storeId;
    const batches = await Batch.find(batchQuery).lean();
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

async function getItem(id, storeId = null) {
  if (!Number.isInteger(id)) bad("Choose an item.");
  const rows = await itemsWithStock({ id }, storeId);
  if (!rows.length) notFound("Item not found.");
  return rows[0];
}

async function queryMovements(q, defaultLimit = 200) {
  const filter = {};
  if (q.item_id) filter.item_id = toInt(q.item_id);
  if (["in", "out", "adjust", "writeoff", "transfer"].includes(q.type)) filter.type = q.type;
  if (q.store_id) filter.store_id = toInt(q.store_id);
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
    const store = m.store_id ? await Store.findOne({ id: m.store_id }).lean() : null;
    const toStore = m.to_store_id ? await Store.findOne({ id: m.to_store_id }).lean() : null;
    const user = m.user_id ? await User.findOne({ id: m.user_id }).lean() : null;
    result.push({
      id: m.id,
      type: m.type,
      quantity: m.quantity,
      reference: m.reference,
      notes: m.notes,
      created_at: m.created_at,
      item_id: m.item_id,
      item_name: item ? item.name : null,
      unit: item ? item.unit : null,
      batch_no: batch ? batch.batch_no : null,
      expiry_date: batch ? batch.expiry_date : null,
      department: dept ? dept.name : null,
      supplier: sup ? sup.name : null,
      store: store ? store.name : null,
      to_store: toStore ? toStore.name : null,
      user_name: user ? user.name : null,
    });
  }
  return result;
}

/* ---------- public endpoints ---------- */
app.get(
  "/api/health",
  ha(async (_req, res) => {
    res.json({ status: "ok" });
  })
);

app.post(
  "/api/login",
  loginLimiter,
  ha(async (req, res) => {
    const { username, password } = req.body || {};
    const identifier = str(username, 80).toLowerCase().trim();
    if (!identifier) return res.status(400).json({ error: "Username or email is required." });
    
    const user = await User.findOne({
      $or: [{ username: identifier }, { email: identifier }],
      active: 1,
    });
    if (!user || !verifyPassword(String(password || ""), user.password_hash)) {
      return res.status(401).json({ error: "Incorrect username/email or password." });
    }
    const token = crypto.randomBytes(32).toString("hex");
    await new Session({ token_hash: sha(token), user_id: user.id, expires_at: Date.now() + SESSION_MS }).save();
    res.cookie("redora_sid", token, { httpOnly: true, sameSite: "lax", secure: PROD, maxAge: SESSION_MS });
    res.json({ user: { id: user.id, username: user.username, name: user.name, role: user.role, email: user.email } });
  })
);

/* Forgot password & reset */
app.post(
  "/api/forgot-password",
  ha(async (req, res) => {
    const identifier = str(req.body?.username || req.body?.email || "", 80).toLowerCase();
    if (!identifier) bad("Enter your username or email address.");
    const user = await User.findOne({
      $or: [{ username: identifier }, { email: identifier }],
      active: 1,
    });
    if (!user) {
      // Return success to avoid username enumeration
      return res.json({ ok: true, message: "If an active account exists, password reset instructions have been generated." });
    }
    const resetToken = crypto.randomBytes(24).toString("hex");
    const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour
    await PasswordReset.deleteMany({ user_id: user.id });
    await new PasswordReset({ token_hash: sha(resetToken), user_id: user.id, expires_at: expiresAt }).save();
    
    // In hospital/demo environment, we also return the token directly for immediate access if SMTP not configured
    res.json({
      ok: true,
      message: `Password reset token generated for user "${user.username}".`,
      reset_token: resetToken,
      expires_in: "1 hour",
    });
  })
);

app.post(
  "/api/reset-password",
  ha(async (req, res) => {
    const { token, new_password } = req.body || {};
    if (!token) bad("Reset token is required.");
    if (String(new_password || "").length < 8) bad("Password must be at least 8 characters.");
    const record = await PasswordReset.findOne({ token_hash: sha(token), expires_at: { $gt: Date.now() } });
    if (!record) bad("Invalid or expired reset token.");

    await User.updateOne({ id: record.user_id }, { password_hash: hashPassword(String(new_password)) });
    await Session.deleteMany({ user_id: record.user_id });
    await PasswordReset.deleteOne({ _id: record._id });
    res.json({ ok: true, message: "Password updated successfully. You can now sign in." });
  })
);

/* ---------- authenticated endpoints ---------- */
app.post(
  "/api/logout",
  authMiddleware,
  ha(async (req, res) => {
    await Session.deleteOne({ token_hash: req.tokenHash });
    res.clearCookie("redora_sid");
    res.json({ ok: true });
  })
);

app.get("/api/me", authMiddleware, async (req, res) => {
  const stores = await Store.find({ active: 1 }).sort({ is_default: -1, name: 1 }).select("id name code is_default").lean();
  res.json({
    user: req.user,
    categories: CATEGORIES,
    expiryWarnDays: EXPIRY_WARN_DAYS,
    stores,
  });
});

app.post(
  "/api/me/password",
  authMiddleware,
  ha(async (req, res) => {
    const { current_password, new_password } = req.body || {};
    const row = await User.findOne({ id: req.user.id });
    if (!verifyPassword(String(current_password || ""), row.password_hash)) bad("Current password is incorrect.");
    if (String(new_password || "").length < 8) bad("New password must be at least 8 characters.");
    await User.updateOne({ id: req.user.id }, { password_hash: hashPassword(String(new_password)) });
    await Session.deleteMany({ user_id: req.user.id, token_hash: { $ne: req.tokenHash } });
    res.json({ ok: true });
  })
);

/* ----- dashboard ----- */
app.get(
  "/api/dashboard",
  authMiddleware,
  ha(async (req, res) => {
    const storeId = req.query.store_id ? toInt(req.query.store_id) : null;
    const items = await itemsWithStock({ active: 1 }, storeId);
    const lowItems = items.filter((i) => i.status === "low" || i.status === "out");
    const todayStr = todayDate();
    const warnDate = new Date(Date.now() + EXPIRY_WARN_DAYS * 864e5).toISOString().slice(0, 10);

    const batchFilter = { quantity: { $gt: 0 } };
    if (storeId) batchFilter.store_id = storeId;

    const allBatches = await Batch.find({
      ...batchFilter,
      expiry_date: { $ne: null, $gte: todayStr, $lte: warnDate },
    }).lean();
    const activeItemIds = new Set(items.map((i) => i.id));
    const expiringBatches = allBatches.filter((b) => activeItemIds.has(b.item_id));
    const expiringSoon = [];
    for (const b of expiringBatches.sort((a, c) => a.expiry_date.localeCompare(c.expiry_date)).slice(0, 8)) {
      const item = items.find((i) => i.id === b.item_id);
      expiringSoon.push({
        id: b.id,
        batch_no: b.batch_no,
        expiry_date: b.expiry_date,
        quantity: b.quantity,
        item_id: b.item_id,
        name: item?.name,
        unit: item?.unit,
      });
    }

    const expiredBatches = await Batch.find({
      ...batchFilter,
      expiry_date: { $ne: null, $lt: todayStr },
    }).lean();
    const expiredFiltered = expiredBatches.filter((b) => activeItemIds.has(b.item_id));
    const expired = [];
    for (const b of expiredFiltered.sort((a, c) => a.expiry_date.localeCompare(c.expiry_date)).slice(0, 8)) {
      const item = items.find((i) => i.id === b.item_id);
      expired.push({
        id: b.id,
        batch_no: b.batch_no,
        expiry_date: b.expiry_date,
        quantity: b.quantity,
        item_id: b.item_id,
        name: item?.name,
        unit: item?.unit,
      });
    }

    const fourteenDaysAgo = new Date(Date.now() - 13 * 864e5).toISOString().slice(0, 10);
    const recentMovementQuery = {
      type: { $in: ["in", "out"] },
      created_at: { $gte: fourteenDaysAgo },
    };
    if (storeId) recentMovementQuery.store_id = storeId;
    const recentMovements = await Movement.find(recentMovementQuery).lean();

    const activityMap = {};
    for (const m of recentMovements) {
      const day = (m.created_at || "").slice(0, 10);
      if (!activityMap[day]) activityMap[day] = { day, in_qty: 0, out_qty: 0 };
      if (m.quantity > 0) activityMap[day].in_qty += m.quantity;
      else activityMap[day].out_qty += -m.quantity;
    }
    const activity = Object.values(activityMap);

    const pendingPOs = await PurchaseOrder.countDocuments({ status: { $in: ["ordered", "partially_received"] } });

    res.json({
      totals: {
        items: items.length,
        low: items.filter((i) => i.status === "low").length,
        out: items.filter((i) => i.status === "out").length,
        expiring: expiringBatches.length,
        expired: expiredFiltered.length,
        pending_pos: pendingPOs,
      },
      needsReorder: lowItems.sort((a, b) => a.available_stock - b.available_stock).slice(0, 8),
      expiringSoon,
      expired,
      activity,
      recent: await queryMovements({ limit: 8, store_id: storeId }),
      expiryWarnDays: EXPIRY_WARN_DAYS,
    });
  })
);

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
  let store_id = 1;
  if (b.store_id !== "" && b.store_id != null) {
    store_id = toInt(b.store_id) || 1;
  }
  return {
    name,
    code: str(b.code, 40) || null,
    barcode: str(b.barcode, 60) || null,
    category,
    unit: str(b.unit, 20) || "units",
    reorder_level: reorder,
    supplier_id,
    store_id,
    storage_location: str(b.storage_location, 80) || null,
    tracks_expiry: b.tracks_expiry ? 1 : 0,
    notes: str(b.notes, 500) || null,
  };
}

app.get(
  "/api/items",
  authMiddleware,
  ha(async (req, res) => {
    const all = req.query.include_inactive === "1";
    const storeId = req.query.store_id ? toInt(req.query.store_id) : null;
    res.json(await itemsWithStock(all ? {} : { active: 1 }, storeId));
  })
);

app.get(
  "/api/items/barcode/:code",
  authMiddleware,
  ha(async (req, res) => {
    const queryCode = str(req.params.code, 60).trim();
    if (!queryCode) bad("Barcode or code is required.");
    // Search by barcode, code, or item name
    const item = await Item.findOne({
      $or: [{ barcode: queryCode }, { code: queryCode }, { name: new RegExp(`^${queryCode}$`, "i") }],
      active: 1,
    }).lean();
    if (!item) notFound("No matching item found for that code / barcode.");
    const detail = await getItem(item.id);
    res.json(detail);
  })
);

app.get(
  "/api/items/:id",
  authMiddleware,
  ha(async (req, res) => {
    const itemId = toInt(req.params.id);
    const item = await getItem(itemId);
    const batches = await Batch.find({ item_id: item.id }).sort({ quantity: 1, expiry_date: 1 }).lean();
    const movements = await queryMovements({ item_id: item.id, limit: 50 });
    const audits = await ItemAudit.find({ item_id: item.id }).sort({ id: -1 }).limit(20).lean();
    res.json({ item, batches, movements, audits });
  })
);

app.post(
  "/api/items",
  authMiddleware,
  ha(async (req, res) => {
    const v = await parseItem(req.body || {});
    const newItem = new Item(v);
    await newItem.save();

    await new ItemAudit({
      item_id: newItem.id,
      item_name: newItem.name,
      user_id: req.user.id,
      user_name: req.user.name,
      action: "create",
      changes: [{ field: "created", old_value: "", new_value: "Item created" }],
    }).save();

    res.status(201).json({ id: newItem.id });
  })
);

app.put(
  "/api/items/:id",
  authMiddleware,
  ha(async (req, res) => {
    const id = toInt(req.params.id);
    const existing = await Item.findOne({ id }).lean();
    if (!existing) notFound("Item not found.");
    const v = await parseItem(req.body || {});

    // Compute change log
    const changes = [];
    const fieldsToTrack = ["name", "code", "barcode", "category", "unit", "reorder_level", "storage_location", "notes"];
    for (const field of fieldsToTrack) {
      const oldVal = String(existing[field] ?? "");
      const newVal = String(v[field] ?? "");
      if (oldVal !== newVal) {
        changes.push({ field, old_value: oldVal, new_value: newVal });
      }
    }
    if (changes.length > 0) {
      await new ItemAudit({
        item_id: id,
        item_name: v.name,
        user_id: req.user.id,
        user_name: req.user.name,
        action: "update",
        changes,
      }).save();
    }

    await Item.updateOne({ id }, v);
    res.json({ ok: true });
  })
);

app.delete(
  "/api/items/:id",
  authMiddleware,
  adminOnly,
  ha(async (req, res) => {
    const item = await getItem(toInt(req.params.id));
    if (item.total_stock > 0) bad("This item still has stock. Issue, write off or adjust it to zero first.");
    await Item.updateOne({ id: item.id }, { active: 0 });

    await new ItemAudit({
      item_id: item.id,
      item_name: item.name,
      user_id: req.user.id,
      user_name: req.user.name,
      action: "deactivate",
      changes: [{ field: "active", old_value: "1", new_value: "0" }],
    }).save();

    res.json({ ok: true });
  })
);

app.get(
  "/api/items/:id/audit",
  authMiddleware,
  ha(async (req, res) => {
    const audits = await ItemAudit.find({ item_id: toInt(req.params.id) }).sort({ id: -1 }).lean();
    res.json(audits);
  })
);

/* ----- stock movements (Receive, Issue, Writeoff, Adjust, Transfer) ----- */
app.post(
  "/api/stock/in",
  authMiddleware,
  ha(async (req, res) => {
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
    const storeId = toInt(b.store_id) || 1;

    let batch = await Batch.findOne({ item_id: item.id, batch_no: batchNo, store_id: storeId });
    let batchId;
    if (batch) {
      if (item.tracks_expiry && batch.expiry_date !== expiry) {
        bad(`Batch ${batchNo} already exists with a different expiry date (${batch.expiry_date}).`);
      }
      await Batch.updateOne(
        { id: batch.id },
        { $inc: { quantity: qty }, ...(unitCost != null ? { unit_cost: unitCost } : {}) }
      );
      batchId = batch.id;
    } else {
      batch = new Batch({
        item_id: item.id,
        store_id: storeId,
        batch_no: batchNo,
        expiry_date: expiry,
        quantity: qty,
        unit_cost: unitCost,
      });
      await batch.save();
      batchId = batch.id;
    }

    const movement = new Movement({
      item_id: item.id,
      batch_id: batchId,
      store_id: storeId,
      type: "in",
      quantity: qty,
      supplier_id: supplierId,
      reference: str(b.reference, 80) || null,
      notes: str(b.notes, 300) || null,
      user_id: req.user.id,
    });
    await movement.save();

    res.status(201).json({ ok: true, batch_id: batchId });
  })
);

app.post(
  "/api/stock/out",
  authMiddleware,
  ha(async (req, res) => {
    const b = req.body || {};
    const item = await getItem(toInt(b.item_id));
    const qty = toInt(b.quantity);
    if (!(qty > 0)) bad("Quantity must be a whole number greater than 0.");
    const deptId = toInt(b.department_id);
    if (!Number.isInteger(deptId) || !(await Department.findOne({ id: deptId }))) {
      bad("Choose the department receiving the stock.");
    }
    const storeId = toInt(b.store_id) || null;
    const todayStr = todayDate();

    const batchQuery = {
      item_id: item.id,
      quantity: { $gt: 0 },
      $or: [{ expiry_date: null }, { expiry_date: { $gte: todayStr } }],
    };
    if (storeId) batchQuery.store_id = storeId;

    const batches = await Batch.find(batchQuery).sort({ expiry_date: 1 }).lean();
    const available = batches.reduce((s, x) => s + x.quantity, 0);
    if (available < qty) bad(`Only ${available} ${item.unit} available (expired stock can't be issued).`);

    let remaining = qty;
    for (const batch of batches) {
      if (remaining === 0) break;
      const take = Math.min(batch.quantity, remaining);
      await Batch.updateOne({ id: batch.id }, { $inc: { quantity: -take } });
      const movement = new Movement({
        item_id: item.id,
        batch_id: batch.id,
        store_id: batch.store_id || 1,
        type: "out",
        quantity: -take,
        department_id: deptId,
        reference: str(b.reference, 80) || null,
        notes: str(b.notes, 300) || null,
        user_id: req.user.id,
      });
      await movement.save();
      remaining -= take;
    }

    res.status(201).json({ ok: true });
  })
);

/* Stock Transfer between Stores */
app.post(
  "/api/stock/transfer",
  authMiddleware,
  ha(async (req, res) => {
    const b = req.body || {};
    const fromStoreId = toInt(b.from_store_id);
    const toStoreId = toInt(b.to_store_id);
    if (!fromStoreId || !toStoreId) bad("Select source and destination stores.");
    if (fromStoreId === toStoreId) bad("Destination store must be different from source store.");

    const batchId = toInt(b.batch_id);
    const batch = await Batch.findOne({ id: batchId, store_id: fromStoreId });
    if (!batch) bad("Source batch not found in the specified store.");

    const qty = toInt(b.quantity);
    if (!(qty > 0) || qty > batch.quantity) bad(`Transfer quantity must be between 1 and ${batch.quantity}.`);

    // Deduct from source batch
    await Batch.updateOne({ id: batch.id }, { $inc: { quantity: -qty } });

    // Add to target store batch
    let targetBatch = await Batch.findOne({
      item_id: batch.item_id,
      batch_no: batch.batch_no,
      store_id: toStoreId,
    });
    if (targetBatch) {
      await Batch.updateOne({ id: targetBatch.id }, { $inc: { quantity: qty } });
    } else {
      targetBatch = new Batch({
        item_id: batch.item_id,
        store_id: toStoreId,
        batch_no: batch.batch_no,
        expiry_date: batch.expiry_date,
        quantity: qty,
        unit_cost: batch.unit_cost,
      });
      await targetBatch.save();
    }

    // Log movement
    const movement = new Movement({
      item_id: batch.item_id,
      batch_id: batch.id,
      store_id: fromStoreId,
      to_store_id: toStoreId,
      type: "transfer",
      quantity: qty,
      reference: str(b.reference, 80) || `TRF-${Date.now().toString().slice(-6)}`,
      notes: str(b.notes, 300) || null,
      user_id: req.user.id,
    });
    await movement.save();

    res.status(201).json({ ok: true, target_batch_id: targetBatch.id });
  })
);

app.post(
  "/api/stock/writeoff",
  authMiddleware,
  ha(async (req, res) => {
    const b = req.body || {};
    const batch = await Batch.findOne({ id: toInt(b.batch_id) });
    if (!batch) bad("Batch not found.");
    const qty = b.quantity === undefined || b.quantity === "" ? batch.quantity : toInt(b.quantity);
    if (!(qty > 0) || qty > batch.quantity) bad(`Quantity must be between 1 and ${batch.quantity}.`);
    const reason = str(b.reason, 200);
    if (!reason) bad("Give a reason (expired, damaged, contaminated…).");

    await Batch.updateOne({ id: batch.id }, { $inc: { quantity: -qty } });
    const movement = new Movement({
      item_id: batch.item_id,
      batch_id: batch.id,
      store_id: batch.store_id || 1,
      type: "writeoff",
      quantity: -qty,
      notes: reason,
      user_id: req.user.id,
    });
    await movement.save();

    res.status(201).json({ ok: true });
  })
);

app.post(
  "/api/stock/adjust",
  authMiddleware,
  adminOnly,
  ha(async (req, res) => {
    const b = req.body || {};
    const batch = await Batch.findOne({ id: toInt(b.batch_id) });
    if (!batch) bad("Batch not found.");
    const newQty = toInt(b.new_quantity);
    if (!(newQty >= 0)) bad("New quantity must be a whole number, 0 or more.");
    const reason = str(b.reason, 200);
    if (!reason) bad("Give a reason for the correction (e.g. stock count).");
    if (newQty === batch.quantity) bad("That is already the recorded quantity.");

    await Batch.updateOne({ id: batch.id }, { quantity: newQty });
    const movement = new Movement({
      item_id: batch.item_id,
      batch_id: batch.id,
      store_id: batch.store_id || 1,
      type: "adjust",
      quantity: newQty - batch.quantity,
      notes: reason,
      user_id: req.user.id,
    });
    await movement.save();

    res.status(201).json({ ok: true });
  })
);

app.get(
  "/api/movements",
  authMiddleware,
  ha(async (req, res) => {
    res.json(await queryMovements(req.query));
  })
);

/* ----- Purchase Orders & Supplier Invoices ----- */
app.get(
  "/api/purchase-orders",
  authMiddleware,
  ha(async (req, res) => {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.supplier_id) filter.supplier_id = toInt(req.query.supplier_id);
    const pos = await PurchaseOrder.find(filter).sort({ id: -1 }).limit(100).lean();

    const result = [];
    for (const po of pos) {
      const sup = await Supplier.findOne({ id: po.supplier_id }).lean();
      const store = await Store.findOne({ id: po.store_id }).lean();
      result.push({
        ...po,
        supplier_name: sup ? sup.name : null,
        store_name: store ? store.name : null,
      });
    }
    res.json(result);
  })
);

app.get(
  "/api/purchase-orders/:id",
  authMiddleware,
  ha(async (req, res) => {
    const po = await PurchaseOrder.findOne({ id: toInt(req.params.id) }).lean();
    if (!po) notFound("Purchase order not found.");
    const sup = await Supplier.findOne({ id: po.supplier_id }).lean();
    const store = await Store.findOne({ id: po.store_id }).lean();
    const user = await User.findOne({ id: po.created_by }).lean();
    res.json({
      ...po,
      supplier_name: sup ? sup.name : null,
      supplier_email: sup ? sup.email : null,
      supplier_phone: sup ? sup.phone : null,
      store_name: store ? store.name : null,
      created_by_name: user ? user.name : null,
    });
  })
);

app.post(
  "/api/purchase-orders",
  authMiddleware,
  ha(async (req, res) => {
    const b = req.body || {};
    const supplier_id = toInt(b.supplier_id);
    if (!supplier_id || !(await Supplier.findOne({ id: supplier_id }))) bad("Choose a valid supplier.");
    const store_id = toInt(b.store_id) || 1;
    const rawItems = Array.isArray(b.items) ? b.items : [];
    if (!rawItems.length) bad("Add at least one line item to the purchase order.");

    const items = [];
    let total = 0;
    for (const it of rawItems) {
      const itemDoc = await Item.findOne({ id: toInt(it.item_id) });
      if (!itemDoc) bad(`Item ID ${it.item_id} not found.`);
      const qty = toInt(it.quantity);
      if (!(qty > 0)) bad(`Invalid quantity for ${itemDoc.name}.`);
      const cost = Number(it.unit_cost) >= 0 ? Number(it.unit_cost) : 0;
      total += qty * cost;
      items.push({
        item_id: itemDoc.id,
        item_name: itemDoc.name,
        unit: itemDoc.unit,
        quantity: qty,
        unit_cost: cost,
        received_qty: 0,
      });
    }

    const count = await PurchaseOrder.countDocuments();
    const poNumber = `PO-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`;

    const po = new PurchaseOrder({
      po_number: poNumber,
      supplier_id,
      store_id,
      status: b.status === "ordered" ? "ordered" : "draft",
      ordered_at: b.status === "ordered" ? today() : null,
      invoice_number: str(b.invoice_number, 60) || null,
      invoice_date: str(b.invoice_date, 10) || null,
      items,
      total_amount: total,
      notes: str(b.notes, 500) || null,
      created_by: req.user.id,
    });
    await po.save();

    res.status(201).json({ id: po.id, po_number: po.po_number });
  })
);

app.post(
  "/api/purchase-orders/:id/status",
  authMiddleware,
  ha(async (req, res) => {
    const id = toInt(req.params.id);
    const { status } = req.body || {};
    if (!["ordered", "cancelled"].includes(status)) bad("Invalid status.");
    const po = await PurchaseOrder.findOne({ id });
    if (!po) notFound("Purchase order not found.");
    if (po.status === "received") bad("Received orders cannot change status.");

    const update = { status };
    if (status === "ordered" && !po.ordered_at) update.ordered_at = today();
    await PurchaseOrder.updateOne({ id }, update);
    res.json({ ok: true });
  })
);

/* Receive goods against a Purchase Order / Invoice */
app.post(
  "/api/purchase-orders/:id/receive",
  authMiddleware,
  ha(async (req, res) => {
    const id = toInt(req.params.id);
    const po = await PurchaseOrder.findOne({ id });
    if (!po) notFound("Purchase order not found.");
    if (po.status === "received" || po.status === "cancelled") bad(`This purchase order is already ${po.status}.`);

    const b = req.body || {};
    const invoiceNumber = str(b.invoice_number || po.invoice_number, 60);
    const receipts = Array.isArray(b.receipts) ? b.receipts : [];
    if (!receipts.length) bad("Provide receipt batch details for at least one item.");

    let allFullyReceived = true;
    for (const line of po.items) {
      const rec = receipts.find((r) => r.item_id === line.item_id);
      if (!rec || !rec.quantity) {
        if (line.received_qty < line.quantity) allFullyReceived = false;
        continue;
      }
      const qty = toInt(rec.quantity);
      if (!(qty > 0)) continue;

      const itemDoc = await Item.findOne({ id: line.item_id });
      const batchNo = str(rec.batch_no, 40) || (itemDoc?.tracks_expiry ? bad(`Batch number required for ${line.item_name}`) : "DEFAULT");
      const expiry = rec.expiry_date ? str(rec.expiry_date, 10) : null;
      if (itemDoc?.tracks_expiry && !expiry) bad(`Expiry date required for ${line.item_name}`);

      // Add to batch
      let batch = await Batch.findOne({ item_id: line.item_id, batch_no: batchNo, store_id: po.store_id });
      let batchId;
      if (batch) {
        await Batch.updateOne({ id: batch.id }, { $inc: { quantity: qty } });
        batchId = batch.id;
      } else {
        batch = new Batch({
          item_id: line.item_id,
          store_id: po.store_id,
          batch_no: batchNo,
          expiry_date: expiry,
          quantity: qty,
          unit_cost: line.unit_cost,
        });
        await batch.save();
        batchId = batch.id;
      }

      // Record movement
      await new Movement({
        item_id: line.item_id,
        batch_id: batchId,
        store_id: po.store_id,
        type: "in",
        quantity: qty,
        supplier_id: po.supplier_id,
        reference: invoiceNumber ? `Inv: ${invoiceNumber} (PO: ${po.po_number})` : `PO: ${po.po_number}`,
        notes: `Received from PO ${po.po_number}`,
        user_id: req.user.id,
      }).save();

      line.received_qty = (line.received_qty || 0) + qty;
      if (line.received_qty < line.quantity) allFullyReceived = false;
    }

    po.status = allFullyReceived ? "received" : "partially_received";
    po.invoice_number = invoiceNumber || po.invoice_number;
    po.received_at = today();
    await po.save();

    res.json({ ok: true, status: po.status });
  })
);

/* ----- Stock-take (Cycle count) Sheets & Reconciliation ----- */
app.get(
  "/api/stock-take/sheet",
  authMiddleware,
  ha(async (req, res) => {
    const storeId = req.query.store_id ? toInt(req.query.store_id) : 1;
    const items = await Item.find({ active: 1 }).sort({ storage_location: 1, name: 1 }).lean();
    const sheetItems = [];

    for (const it of items) {
      const batches = await Batch.find({ item_id: it.id, store_id: storeId, quantity: { $gt: 0 } }).lean();
      if (!batches.length) {
        sheetItems.push({
          item_id: it.id,
          item_name: it.name,
          category: it.category,
          storage_location: it.storage_location || "—",
          unit: it.unit,
          batch_id: null,
          batch_no: "—",
          expiry_date: null,
          recorded_qty: 0,
        });
      } else {
        for (const b of batches) {
          sheetItems.push({
            item_id: it.id,
            item_name: it.name,
            category: it.category,
            storage_location: it.storage_location || "—",
            unit: it.unit,
            batch_id: b.id,
            batch_no: b.batch_no,
            expiry_date: b.expiry_date,
            recorded_qty: b.quantity,
          });
        }
      }
    }
    const store = await Store.findOne({ id: storeId }).lean();
    res.json({
      sheet_number: `ST-${Date.now().toString().slice(-6)}`,
      date: today(),
      store_name: store ? store.name : "Main Store",
      items: sheetItems,
    });
  })
);

app.post(
  "/api/stock-take/reconcile",
  authMiddleware,
  adminOnly,
  ha(async (req, res) => {
    const { store_id, counts, title } = req.body || {};
    if (!Array.isArray(counts) || !counts.length) bad("No counts submitted.");

    const storeId = toInt(store_id) || 1;
    const reconciledItems = [];
    const countNumber = `STK-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`;

    for (const c of counts) {
      if (!c.batch_id) continue;
      const batch = await Batch.findOne({ id: toInt(c.batch_id), store_id: storeId });
      if (!batch) continue;

      const counted = toInt(c.counted_qty);
      if (Number.isNaN(counted) || counted < 0) continue;

      const diff = counted - batch.quantity;
      reconciledItems.push({
        item_id: batch.item_id,
        batch_id: batch.id,
        batch_no: batch.batch_no,
        recorded_qty: batch.quantity,
        counted_qty: counted,
        diff,
        notes: str(c.notes, 150) || null,
      });

      if (diff !== 0) {
        await Batch.updateOne({ id: batch.id }, { quantity: counted });
        await new Movement({
          item_id: batch.item_id,
          batch_id: batch.id,
          store_id: storeId,
          type: "adjust",
          quantity: diff,
          reference: countNumber,
          notes: `Stock-take discrepancy: ${diff > 0 ? "+" : ""}${diff} (${str(c.notes, 100) || "Physical count"})`,
          user_id: req.user.id,
        }).save();
      }
    }

    const stDoc = new StockTake({
      sheet_number: countNumber,
      title: str(title, 100) || "Routine Physical Stock-Take",
      store_id: storeId,
      status: "reconciled",
      created_by: req.user.id,
      items: reconciledItems,
      reconciled_at: today(),
    });
    await stDoc.save();

    res.json({ ok: true, sheet_number: countNumber, discrepancies_count: reconciledItems.filter((i) => i.diff !== 0).length });
  })
);

/* ----- Printable Reports (Valuation & Monthly Consumption) ----- */
app.get(
  "/api/reports/valuation",
  authMiddleware,
  ha(async (req, res) => {
    const storeId = req.query.store_id ? toInt(req.query.store_id) : null;
    const items = await itemsWithStock({ active: 1 }, storeId);

    const report = [];
    let grandTotalValue = 0;
    let grandTotalItems = 0;

    for (const it of items) {
      const batchQuery = { item_id: it.id, quantity: { $gt: 0 } };
      if (storeId) batchQuery.store_id = storeId;
      const batches = await Batch.find(batchQuery).lean();

      let itemValue = 0;
      const batchDetails = batches.map((b) => {
        const cost = b.unit_cost || 0;
        const val = b.quantity * cost;
        itemValue += val;
        return {
          batch_no: b.batch_no,
          expiry_date: b.expiry_date,
          quantity: b.quantity,
          unit_cost: cost,
          value: val,
        };
      });

      grandTotalValue += itemValue;
      grandTotalItems += it.available_stock;

      report.push({
        id: it.id,
        name: it.name,
        code: it.code,
        category: it.category,
        unit: it.unit,
        reorder_level: it.reorder_level,
        available_stock: it.available_stock,
        expired_stock: it.expired_stock,
        total_value: itemValue,
        batches: batchDetails,
      });
    }

    res.json({
      date: today(),
      grand_total_items: grandTotalItems,
      grand_total_value: grandTotalValue,
      items: report,
    });
  })
);

app.get(
  "/api/reports/consumption",
  authMiddleware,
  ha(async (req, res) => {
    const month = str(req.query.month, 7) || today().slice(0, 7); // e.g. "2026-11"
    const movements = await Movement.find({
      type: { $in: ["out", "writeoff"] },
      created_at: { $gte: `${month}-01`, $lte: `${month}-31 23:59:59` },
    }).lean();

    const depts = await Department.find({}).lean();
    const deptMap = Object.fromEntries(depts.map((d) => [d.id, d.name]));

    const consumptionByItem = {};
    for (const m of movements) {
      const item = await Item.findOne({ id: m.item_id }).lean();
      if (!item) continue;
      const batch = m.batch_id ? await Batch.findOne({ id: m.batch_id }).lean() : null;
      const cost = batch?.unit_cost || 0;
      const qty = Math.abs(m.quantity);
      const val = qty * cost;

      if (!consumptionByItem[item.id]) {
        consumptionByItem[item.id] = {
          item_id: item.id,
          name: item.name,
          category: item.category,
          unit: item.unit,
          issued_qty: 0,
          written_off_qty: 0,
          total_qty: 0,
          total_cost: 0,
          departments: {},
        };
      }
      const record = consumptionByItem[item.id];
      if (m.type === "out") {
        record.issued_qty += qty;
        const dName = deptMap[m.department_id] || "General";
        record.departments[dName] = (record.departments[dName] || 0) + qty;
      } else {
        record.written_off_qty += qty;
      }
      record.total_qty += qty;
      record.total_cost += val;
    }

    res.json({
      month,
      items: Object.values(consumptionByItem),
    });
  })
);

/* ----- Alerts (Low Stock & Expiry email/SMS) ----- */
app.get(
  "/api/alerts/config",
  authMiddleware,
  ha(async (_req, res) => {
    const config = (await AlertConfig.findOne({ id: 1 })) || new AlertConfig({ id: 1 });
    res.json(config);
  })
);

app.put(
  "/api/alerts/config",
  authMiddleware,
  adminOnly,
  ha(async (req, res) => {
    const b = req.body || {};
    await AlertConfig.updateOne(
      { id: 1 },
      {
        alert_email: str(b.alert_email, 120),
        sms_number: str(b.sms_number, 30),
        notify_low_stock: !!b.notify_low_stock,
        notify_expiring: !!b.notify_expiring,
        notify_expired: !!b.notify_expired,
        updated_at: new Date().toISOString().replace("T", " ").slice(0, 19),
      },
      { upsert: true }
    );
    res.json({ ok: true });
  })
);

app.post(
  "/api/alerts/trigger",
  authMiddleware,
  ha(async (_req, res) => {
    const config = (await AlertConfig.findOne({ id: 1 })) || {};
    const items = await itemsWithStock({ active: 1 });
    const low = items.filter((i) => i.status === "low" || i.status === "out");
    const todayStr = todayDate();
    const warnDate = new Date(Date.now() + EXPIRY_WARN_DAYS * 864e5).toISOString().slice(0, 10);

    const expiring = await Batch.find({
      quantity: { $gt: 0 },
      expiry_date: { $ne: null, $gte: todayStr, $lte: warnDate },
    }).lean();

    const summary = {
      alert_email: config.alert_email || "admin@hospital.org",
      low_stock_count: low.length,
      expiring_batch_count: expiring.length,
      status: "Dispatched",
      sent_at: new Date().toISOString().replace("T", " ").slice(0, 19),
      message: `Alert dispatched to ${config.alert_email || "configured recipients"}: ${low.length} low stock items and ${expiring.length} batches expiring soon.`,
    };
    res.json(summary);
  })
);

/* ----- Stores / Branches ----- */
app.get(
  "/api/stores",
  authMiddleware,
  ha(async (_req, res) => {
    res.json(await Store.find({ active: 1 }).sort({ is_default: -1, name: 1 }).lean());
  })
);

app.post(
  "/api/stores",
  authMiddleware,
  adminOnly,
  ha(async (req, res) => {
    const name = str(req.body?.name, 100);
    if (!name) bad("Store name is required.");
    const code = str(req.body?.code, 20).toUpperCase();
    const location = str(req.body?.location, 100);
    const store = new Store({ name, code, location });
    await store.save();
    res.status(201).json({ id: store.id });
  })
);

app.delete(
  "/api/stores/:id",
  authMiddleware,
  adminOnly,
  ha(async (req, res) => {
    const id = toInt(req.params.id);
    const store = await Store.findOne({ id });
    if (!store) notFound("Store not found.");
    if (store.is_default) bad("Cannot remove default store.");
    const hasBatches = await Batch.findOne({ store_id: id, quantity: { $gt: 0 } });
    if (hasBatches) bad("Store still contains active batches with stock.");
    await Store.updateOne({ id }, { active: 0 });
    res.json({ ok: true });
  })
);

/* ----- suppliers ----- */
function parseSupplier(b) {
  const name = str(b.name, 120);
  if (!name) bad("Supplier name is required.");
  const email = str(b.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad("Enter a valid email address.");
  return {
    name,
    contact_person: str(b.contact_person, 100) || null,
    phone: str(b.phone, 40) || null,
    email: email || null,
    address: str(b.address, 250) || null,
  };
}

app.get(
  "/api/suppliers",
  authMiddleware,
  ha(async (_req, res) => {
    const suppliers = await Supplier.find({ active: 1 }).sort({ name: 1 }).lean();
    const result = [];
    for (const s of suppliers) {
      const item_count = await Item.countDocuments({ supplier_id: s.id, active: 1 });
      result.push({ ...s, item_count });
    }
    res.json(result);
  })
);

app.post(
  "/api/suppliers",
  authMiddleware,
  ha(async (req, res) => {
    const v = parseSupplier(req.body || {});
    const sup = new Supplier(v);
    await sup.save();
    res.status(201).json({ id: sup.id });
  })
);

app.put(
  "/api/suppliers/:id",
  authMiddleware,
  ha(async (req, res) => {
    const v = parseSupplier(req.body || {});
    const result = await Supplier.updateOne({ id: toInt(req.params.id) }, v);
    if (!result.matchedCount) notFound("Supplier not found.");
    res.json({ ok: true });
  })
);

app.delete(
  "/api/suppliers/:id",
  authMiddleware,
  adminOnly,
  ha(async (req, res) => {
    const id = toInt(req.params.id);
    const result = await Supplier.updateOne({ id }, { active: 0 });
    if (!result.matchedCount) notFound("Supplier not found.");
    await Item.updateMany({ supplier_id: id }, { supplier_id: null });
    res.json({ ok: true });
  })
);

/* ----- departments ----- */
app.get(
  "/api/departments",
  authMiddleware,
  ha(async (_req, res) => {
    res.json(await Department.find({}).sort({ name: 1 }).select("id name -_id").lean());
  })
);

app.post(
  "/api/departments",
  authMiddleware,
  adminOnly,
  ha(async (req, res) => {
    const name = str(req.body?.name, 80);
    if (!name) bad("Department name is required.");
    const dept = new Department({ name });
    await dept.save();
    res.status(201).json({ id: dept.id });
  })
);

app.delete(
  "/api/departments/:id",
  authMiddleware,
  adminOnly,
  ha(async (req, res) => {
    const id = toInt(req.params.id);
    const hasHistory = await Movement.findOne({ department_id: id });
    if (hasHistory) bad("This department has stock history, so it can't be removed.");
    await Department.deleteOne({ id });
    res.json({ ok: true });
  })
);

/* ----- users (admin) ----- */
app.get(
  "/api/users",
  authMiddleware,
  adminOnly,
  ha(async (_req, res) => {
    res.json(await User.find({}).sort({ username: 1 }).select("id username name email role active created_at -_id").lean());
  })
);

app.post(
  "/api/users",
  authMiddleware,
  adminOnly,
  ha(async (req, res) => {
    const b = req.body || {};
    const username = str(b.username, 40).toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) bad("Username: 3–40 letters, numbers, dot, dash or underscore.");
    const name = str(b.name, 80);
    if (!name) bad("Full name is required.");
    const email = str(b.email, 120);
    const role = b.role === "admin" ? "admin" : "staff";
    const password = String(b.password || "");
    if (password.length < 8) bad("Password must be at least 8 characters.");
    const user = new User({ username, name, email, role, password_hash: hashPassword(password) });
    await user.save();
    res.status(201).json({ id: user.id });
  })
);

app.put(
  "/api/users/:id",
  authMiddleware,
  adminOnly,
  ha(async (req, res) => {
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
    if (b.email !== undefined) updates.email = str(b.email, 120);
    if (b.password) {
      if (String(b.password).length < 8) bad("Password must be at least 8 characters.");
      updates.password_hash = hashPassword(String(b.password));
    }
    await User.updateOne({ id }, updates);
    if (!active || b.password) await Session.deleteMany({ user_id: id });
    res.json({ ok: true });
  })
);

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

app.get(
  "/api/export/items.csv",
  authMiddleware,
  ha(async (_req, res) => {
    sendCsv(
      res,
      `redora-stock-${today()}.csv`,
      [
        ["name", "Item"],
        ["code", "Code"],
        ["barcode", "Barcode"],
        ["category", "Category"],
        ["unit", "Unit"],
        ["available_stock", "Available stock"],
        ["expired_stock", "Expired stock"],
        ["reorder_level", "Reorder level"],
        ["status", "Status"],
        ["next_expiry", "Next expiry"],
        ["supplier_name", "Supplier"],
        ["storage_location", "Location"],
      ],
      await itemsWithStock({ active: 1 })
    );
  })
);

app.get(
  "/api/export/movements.csv",
  authMiddleware,
  ha(async (req, res) => {
    sendCsv(
      res,
      `redora-history-${today()}.csv`,
      [
        ["created_at", "Date (UTC)"],
        ["type", "Type"],
        ["item_name", "Item"],
        ["batch_no", "Batch"],
        ["expiry_date", "Expiry"],
        ["quantity", "Quantity change"],
        ["unit", "Unit"],
        ["department", "Department"],
        ["supplier", "Supplier"],
        ["store", "Store"],
        ["to_store", "Destination Store"],
        ["reference", "Reference"],
        ["notes", "Notes"],
        ["user_name", "Recorded by"],
      ],
      await queryMovements({ ...req.query, limit: 2000 })
    );
  })
);

/* ---------- error handlers ---------- */
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));

app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  const msg = String(err.message || "");
  if (msg.includes("duplicate key") || msg.includes("E11000")) {
    const map = {
      code: "That item code is already in use.",
      barcode: "That barcode is already in use.",
      username: "That username is already taken.",
      suppliers: "A supplier with that name already exists.",
      departments: "That department already exists.",
      stores: "That store name already exists.",
      po_number: "That PO number already exists.",
    };
    const key = Object.keys(map).find((k) => msg.includes(k));
    return res.status(409).json({ error: map[key] || "That already exists." });
  }
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid request." });
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

/* ---------- start ---------- */
if (require.main === module) {
  initOnce().then(() => {
    app.listen(PORT, () => console.log(`Redora running on http://localhost:${PORT}`));
  });
}

module.exports = app;
