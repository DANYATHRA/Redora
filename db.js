// Database layer — MongoDB via Mongoose
const mongoose = require("mongoose");
const crypto = require("crypto");

const MONGODB_URI =
  process.env.MONGODB_URI ||
  "mongodb+srv://danyathra1507_db_user:danyathra1507_db_user@cluster0.eg3j5nk.mongodb.net/redora?retryWrites=true&w=majority";

/* ---------- connection ---------- */
let isConnected = false;
async function connectDB() {
  if (isConnected || mongoose.connection.readyState === 1) {
    isConnected = true;
    return;
  }
  await mongoose.connect(MONGODB_URI);
  isConnected = true;
  console.log("Connected to MongoDB Atlas");
}

/* ---------- counter helper (auto-increment IDs) ---------- */
const counterSchema = new mongoose.Schema({
  _id: String,
  seq: { type: Number, default: 0 },
});
const Counter = mongoose.model("Counter", counterSchema);

async function nextId(name) {
  const c = await Counter.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return c.seq;
}

/* ---------- schemas ---------- */
const userSchema = new mongoose.Schema({
  id: { type: Number, unique: true },
  username: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String, default: "" },
  role: { type: String, enum: ["admin", "staff"], required: true },
  password_hash: { type: String, required: true },
  active: { type: Number, default: 1 },
  created_at: { type: String, default: () => new Date().toISOString().replace("T", " ").slice(0, 19) },
});
userSchema.pre("save", async function (next) {
  if (!this.id) this.id = await nextId("user");
  next();
});

const sessionSchema = new mongoose.Schema({
  token_hash: { type: String, required: true, unique: true },
  user_id: { type: Number, required: true },
  expires_at: { type: Number, required: true },
});

const supplierSchema = new mongoose.Schema({
  id: { type: Number, unique: true },
  name: { type: String, required: true, unique: true },
  contact_person: String,
  phone: String,
  email: String,
  address: String,
  active: { type: Number, default: 1 },
  created_at: { type: String, default: () => new Date().toISOString().replace("T", " ").slice(0, 19) },
});
supplierSchema.pre("save", async function (next) {
  if (!this.id) this.id = await nextId("supplier");
  next();
});

const departmentSchema = new mongoose.Schema({
  id: { type: Number, unique: true },
  name: { type: String, required: true, unique: true },
});
departmentSchema.pre("save", async function (next) {
  if (!this.id) this.id = await nextId("department");
  next();
});

/* Stores / Branches */
const storeSchema = new mongoose.Schema({
  id: { type: Number, unique: true },
  name: { type: String, required: true, unique: true },
  code: { type: String, default: "" },
  location: { type: String, default: "" },
  is_default: { type: Boolean, default: false },
  active: { type: Number, default: 1 },
  created_at: { type: String, default: () => new Date().toISOString().replace("T", " ").slice(0, 19) },
});
storeSchema.pre("save", async function (next) {
  if (!this.id) this.id = await nextId("store");
  next();
});

const itemSchema = new mongoose.Schema({
  id: { type: Number, unique: true },
  name: { type: String, required: true },
  code: { type: String, sparse: true },
  barcode: { type: String, sparse: true },
  category: { type: String, required: true },
  unit: { type: String, default: "units" },
  reorder_level: { type: Number, default: 0 },
  supplier_id: Number,
  store_id: { type: Number, default: 1 },
  storage_location: String,
  tracks_expiry: { type: Number, default: 1 },
  notes: String,
  active: { type: Number, default: 1 },
  created_at: { type: String, default: () => new Date().toISOString().replace("T", " ").slice(0, 19) },
});
itemSchema.pre("save", async function (next) {
  if (!this.id) this.id = await nextId("item");
  next();
});

const batchSchema = new mongoose.Schema({
  id: { type: Number, unique: true },
  item_id: { type: Number, required: true, index: true },
  store_id: { type: Number, default: 1, index: true },
  batch_no: { type: String, required: true },
  expiry_date: String,
  quantity: { type: Number, default: 0 },
  unit_cost: Number,
  received_at: { type: String, default: () => new Date().toISOString().replace("T", " ").slice(0, 19) },
});
batchSchema.index({ item_id: 1, batch_no: 1, store_id: 1 });
batchSchema.pre("save", async function (next) {
  if (!this.id) this.id = await nextId("batch");
  next();
});

const movementSchema = new mongoose.Schema({
  id: { type: Number, unique: true },
  item_id: { type: Number, required: true, index: true },
  batch_id: Number,
  store_id: { type: Number, default: 1 },
  to_store_id: Number,
  type: { type: String, enum: ["in", "out", "adjust", "writeoff", "transfer"], required: true },
  quantity: { type: Number, required: true },
  department_id: Number,
  supplier_id: Number,
  reference: String,
  notes: String,
  user_id: Number,
  created_at: { type: String, default: () => new Date().toISOString().replace("T", " ").slice(0, 19), index: true },
});
movementSchema.pre("save", async function (next) {
  if (!this.id) this.id = await nextId("movement");
  next();
});

/* Purchase Orders & Supplier Invoices */
const purchaseOrderItemSchema = new mongoose.Schema({
  item_id: { type: Number, required: true },
  item_name: { type: String, required: true },
  unit: { type: String, default: "units" },
  quantity: { type: Number, required: true },
  unit_cost: { type: Number, default: 0 },
  received_qty: { type: Number, default: 0 },
  batch_no: String,
  expiry_date: String,
});

const purchaseOrderSchema = new mongoose.Schema({
  id: { type: Number, unique: true },
  po_number: { type: String, required: true, unique: true },
  supplier_id: { type: Number, required: true },
  store_id: { type: Number, default: 1 },
  status: { type: String, enum: ["draft", "ordered", "partially_received", "received", "cancelled"], default: "draft" },
  invoice_number: String,
  invoice_date: String,
  items: [purchaseOrderItemSchema],
  total_amount: { type: Number, default: 0 },
  notes: String,
  created_by: Number,
  created_at: { type: String, default: () => new Date().toISOString().replace("T", " ").slice(0, 19) },
  ordered_at: String,
  received_at: String,
});
purchaseOrderSchema.pre("save", async function (next) {
  if (!this.id) this.id = await nextId("po");
  next();
});

/* Item Audit Change Log */
const itemAuditSchema = new mongoose.Schema({
  id: { type: Number, unique: true },
  item_id: { type: Number, required: true, index: true },
  item_name: String,
  user_id: Number,
  user_name: String,
  action: { type: String, default: "update" },
  changes: [
    {
      field: String,
      old_value: String,
      new_value: String,
    },
  ],
  created_at: { type: String, default: () => new Date().toISOString().replace("T", " ").slice(0, 19) },
});
itemAuditSchema.pre("save", async function (next) {
  if (!this.id) this.id = await nextId("item_audit");
  next();
});

/* Password Reset */
const passwordResetSchema = new mongoose.Schema({
  token_hash: { type: String, required: true, unique: true },
  user_id: { type: Number, required: true },
  expires_at: { type: Number, required: true },
});

/* Stock-take (Cycle count) Sheets */
const stockTakeItemSchema = new mongoose.Schema({
  item_id: Number,
  item_name: String,
  unit: String,
  batch_id: Number,
  batch_no: String,
  expiry_date: String,
  recorded_qty: Number,
  counted_qty: Number,
  diff: Number,
  notes: String,
});

const stockTakeSchema = new mongoose.Schema({
  id: { type: Number, unique: true },
  sheet_number: { type: String, required: true, unique: true },
  title: String,
  store_id: { type: Number, default: 1 },
  status: { type: String, enum: ["open", "reconciled"], default: "open" },
  created_by: Number,
  items: [stockTakeItemSchema],
  created_at: { type: String, default: () => new Date().toISOString().replace("T", " ").slice(0, 19) },
  reconciled_at: String,
});
stockTakeSchema.pre("save", async function (next) {
  if (!this.id) this.id = await nextId("stock_take");
  next();
});

/* Write-off Requests (Two-Step Approval for Staff) */
const writeOffRequestSchema = new mongoose.Schema({
  id: { type: Number, unique: true },
  item_id: { type: Number, required: true, index: true },
  item_name: { type: String, required: true },
  batch_id: { type: Number, required: true },
  batch_no: { type: String, required: true },
  store_id: { type: Number, default: 1 },
  store_name: String,
  quantity: { type: Number, required: true },
  unit: { type: String, default: "units" },
  reason: { type: String, required: true },
  status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending", index: true },
  requested_by_id: Number,
  requested_by_name: String,
  requested_at: { type: String, default: () => new Date().toISOString().replace("T", " ").slice(0, 19) },
  reviewed_by_id: Number,
  reviewed_by_name: String,
  reviewed_at: String,
  review_notes: String,
});
writeOffRequestSchema.pre("save", async function (next) {
  if (!this.id) this.id = await nextId("writeoff_request");
  next();
});

/* Alert Configuration */
const alertConfigSchema = new mongoose.Schema({
  id: { type: Number, default: 1, unique: true },
  alert_email: { type: String, default: "admin@hospital.org" },
  notify_low_stock: { type: Boolean, default: true },
  notify_expiring: { type: Boolean, default: true },
  notify_expired: { type: Boolean, default: true },
  sms_number: { type: String, default: "" },
  updated_at: { type: String, default: () => new Date().toISOString().replace("T", " ").slice(0, 19) },
});

/* ---------- models ---------- */
const User = mongoose.model("User", userSchema);
const Session = mongoose.model("Session", sessionSchema);
const Supplier = mongoose.model("Supplier", supplierSchema);
const Department = mongoose.model("Department", departmentSchema);
const Store = mongoose.model("Store", storeSchema);
const Item = mongoose.model("Item", itemSchema);
const Batch = mongoose.model("Batch", batchSchema);
const Movement = mongoose.model("Movement", movementSchema);
const PurchaseOrder = mongoose.model("PurchaseOrder", purchaseOrderSchema);
const ItemAudit = mongoose.model("ItemAudit", itemAuditSchema);
const PasswordReset = mongoose.model("PasswordReset", passwordResetSchema);
const StockTake = mongoose.model("StockTake", stockTakeSchema);
const AlertConfig = mongoose.model("AlertConfig", alertConfigSchema);
const WriteOffRequest = mongoose.model("WriteOffRequest", writeOffRequestSchema);

/* ---------- seeds ---------- */
async function seedDepartments() {
  const count = await Department.countDocuments();
  if (count === 0) {
    const names = [
      "Pharmacy", "Emergency", "ICU", "Operation Theatre",
      "General Ward", "Laboratory", "Radiology", "Outpatient (OPD)",
    ];
    for (const name of names) {
      const dept = new Department({ name });
      await dept.save();
    }
  }
}

async function seedStores() {
  const count = await Store.countDocuments();
  if (count === 0) {
    const defaults = [
      { name: "Main Central Pharmacy", code: "MAIN", location: "Block A - Ground Floor", is_default: true },
      { name: "Emergency Satellite Store", code: "ER", location: "ER Trauma Wing", is_default: false },
      { name: "Operation Theatre Store", code: "OT", location: "OT Complex - 2nd Floor", is_default: false },
    ];
    for (const d of defaults) {
      const store = new Store(d);
      await store.save();
    }
  }
}

async function seedAlertConfig() {
  const existing = await AlertConfig.findOne({ id: 1 });
  if (!existing) {
    await new AlertConfig({ id: 1 }).save();
  }
}

/* ---------- password helpers ---------- */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, saltB64, hashB64] = stored.split("$");
    if (scheme !== "scrypt") return false;
    const expected = Buffer.from(hashB64, "base64");
    const actual = crypto.scryptSync(password, Buffer.from(saltB64, "base64"), expected.length);
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/* ---------- first admin & staff ---------- */
async function ensureAdmin(passwordOverride) {
  const defaultPassword = passwordOverride || process.env.ADMIN_PASSWORD || "Redora@123";
  let admin = await User.findOne({ $or: [{ username: "admin" }, { email: "danyathra1507@gmail.com" }] });
  if (!admin) {
    admin = new User({
      username: "admin",
      name: "Administrator",
      role: "admin",
      email: "danyathra1507@gmail.com",
      password_hash: hashPassword(defaultPassword),
      active: 1,
    });
    await admin.save();
    console.log("Created initial admin account -> username: admin, password: " + defaultPassword);
  } else {
    // Ensure email is set so user can sign in via email or username
    if (!admin.email) {
      await User.updateOne({ id: admin.id }, { email: "danyathra1507@gmail.com" });
    }
  }

  let staff = await User.findOne({ username: "staff" });
  if (!staff) {
    staff = new User({
      username: "staff",
      name: "Pharmacy Staff",
      role: "staff",
      email: "staff@hospital.org",
      password_hash: hashPassword(defaultPassword),
      active: 1,
    });
    await staff.save();
  }
}

/* ---------- seed sample hospital catalog ---------- */
async function seedSampleCatalog() {
  const itemCount = await Item.countDocuments();
  if (itemCount > 0) return;

  const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
  const stamp = (offset, hour = 10) => {
    const d = new Date();
    d.setUTCHours(hour, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().replace("T", " ").slice(0, 19);
  };

  const storeDocs = await Store.find({}).lean();
  const mainStore = storeDocs.find((s) => s.is_default) || storeDocs[0] || { id: 1 };

  const supMap = {};
  const suppliersData = [
    ["MediCore Pharma Distributors", "Anil Kumar", "+91 98400 11122", "orders@medicore.example", "12 Industrial Estate, Coimbatore"],
    ["SteriSafe Surgical Supplies", "Priya Nair", "+91 98950 33445", "sales@sterisafe.example", "45 Market Road, Kochi"],
    ["LabLine Diagnostics", "R. Venkatesh", "+91 99620 55667", "support@labline.example", "7 Tech Park, Chennai"],
    ["CareWear PPE Traders", "Meena Iyer", "+91 97100 77889", "hello@carewear.example", "88 Mill Street, Tiruppur"],
  ];
  for (const [name, contact_person, phone, email, address] of suppliersData) {
    let sup = await Supplier.findOne({ name });
    if (!sup) {
      sup = new Supplier({ name, contact_person, phone, email, address });
      await sup.save();
    }
    supMap[name.split(" ")[0]] = sup.id;
  }

  const catalog = [
    ["Herbal / Ayurvedic Cough Syrup 100 mL", "MED-007", "Medicine", "bottles", 40, "MediCore", "Pharmacy A-4", 1, [["AYU2401", 365, 100, 20, 156.0]], "8908015919107"],
    ["Paracetamol 500 mg", "MED-001", "Medicine", "strips", 100, "MediCore", "Pharmacy A-1", 1, [["PCM2401", 420, 400, 150, 12.5], ["PCM2407", 700, 300, 40, 13]], "890100000001"],
    ["Amoxicillin 500 mg", "MED-002", "Medicine", "strips", 80, "MediCore", "Pharmacy A-2", 1, [["AMX2312", 45, 200, 140, 38]], "890100000002"],
    ["Insulin Glargine 100 IU/mL", "MED-003", "Medicine", "vials", 30, "MediCore", "Cold room 1", 1, [["INS8821", 120, 90, 75, 540]], "890100000003"],
    ["Normal Saline 0.9% 500 mL", "FLD-001", "Medicine", "bags", 200, "MediCore", "Store 2", 1, [["NS2406", 300, 600, 330, 28]], "890100000004"],
    ["Surgical Gloves, sterile (size 7.5)", "SUR-001", "Surgical", "pairs", 300, "SteriSafe", "OT Store", 1, [["GLV3310", 540, 1200, 980, 14]], "890100000005"],
    ["Disposable Syringe 5 mL", "CON-001", "Consumable", "pcs", 500, "SteriSafe", "Store 1", 1, [["SYR9001", 800, 2000, 1450, 3.2]], "890100000006"],
    ["N95 Respirator Mask", "PPE-001", "PPE", "pcs", 200, "CareWear", "Store 3", 0, [["DEFAULT", null, 900, 760, 38]], "890100000007"],
  ];

  let n = 0;
  for (const [name, code, cat, unit, reorder, sName, loc, exp, batches, bcode] of catalog) {
    const newItem = new Item({
      name,
      code,
      barcode: bcode || `89010000000${n}`,
      category: cat,
      unit,
      reorder_level: reorder,
      supplier_id: supMap[sName],
      store_id: mainStore.id,
      storage_location: loc,
      tracks_expiry: exp,
    });
    await newItem.save();
    const itemId = newItem.id;

    for (let bi = 0; bi < batches.length; bi++) {
      const [bno, expOff, received, issued, cost] = batches[bi];
      const left = received - issued;
      const newBatch = new Batch({
        item_id: itemId,
        store_id: mainStore.id,
        batch_no: bno,
        expiry_date: expOff === null ? null : day(expOff),
        quantity: left,
        unit_cost: cost,
        received_at: stamp(-60 + bi * 10),
      });
      await newBatch.save();
      const batchId = newBatch.id;

      await new Movement({
        item_id: itemId,
        batch_id: batchId,
        store_id: mainStore.id,
        type: "in",
        quantity: received,
        supplier_id: supMap[sName],
        reference: `PO-${2400 + n}`,
        user_id: 1,
        created_at: stamp(-60 + bi * 10),
      }).save();
    }
    n++;
  }
}

module.exports = {
  connectDB,
  mongoose,
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
  WriteOffRequest,
  hashPassword,
  verifyPassword,
  ensureAdmin,
  seedDepartments,
  seedStores,
  seedAlertConfig,
  seedSampleCatalog,
  nextId,
};
