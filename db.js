// Database layer — MongoDB via Mongoose
const mongoose = require("mongoose");
const crypto = require("crypto");

const MONGODB_URI =
  process.env.MONGODB_URI ||
  "mongodb+srv://danyathra1507_db_user:danyathra1507_db_user@cluster0.eg3j5nk.mongodb.net/redora?retryWrites=true&w=majority";

/* ---------- connection ---------- */
async function connectDB() {
  await mongoose.connect(MONGODB_URI);
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

const itemSchema = new mongoose.Schema({
  id: { type: Number, unique: true },
  name: { type: String, required: true },
  code: { type: String, sparse: true },
  category: { type: String, required: true },
  unit: { type: String, default: "units" },
  reorder_level: { type: Number, default: 0 },
  supplier_id: Number,
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
  batch_no: { type: String, required: true },
  expiry_date: String,
  quantity: { type: Number, default: 0 },
  unit_cost: Number,
  received_at: { type: String, default: () => new Date().toISOString().replace("T", " ").slice(0, 19) },
});
batchSchema.index({ item_id: 1, batch_no: 1 }, { unique: true });
batchSchema.pre("save", async function (next) {
  if (!this.id) this.id = await nextId("batch");
  next();
});

const movementSchema = new mongoose.Schema({
  id: { type: Number, unique: true },
  item_id: { type: Number, required: true, index: true },
  batch_id: Number,
  type: { type: String, enum: ["in", "out", "adjust", "writeoff"], required: true },
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

/* ---------- models ---------- */
const User = mongoose.model("User", userSchema);
const Session = mongoose.model("Session", sessionSchema);
const Supplier = mongoose.model("Supplier", supplierSchema);
const Department = mongoose.model("Department", departmentSchema);
const Item = mongoose.model("Item", itemSchema);
const Batch = mongoose.model("Batch", batchSchema);
const Movement = mongoose.model("Movement", movementSchema);

/* ---------- seed default departments ---------- */
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

/* ---------- first admin ---------- */
async function ensureAdmin(passwordOverride) {
  const count = await User.countDocuments();
  if (count > 0) return;
  const username = (process.env.ADMIN_USERNAME || "admin").toLowerCase();
  let password = passwordOverride || process.env.ADMIN_PASSWORD;
  let generated = false;
  if (!password) {
    password = crypto.randomBytes(9).toString("base64url");
    generated = true;
  }
  const user = new User({ username, name: "Administrator", role: "admin", password_hash: hashPassword(password) });
  await user.save();
  console.log(`Created first admin account  ->  username: ${username}`);
  if (generated) {
    console.log(`Generated password (shown once, change it after signing in): ${password}`);
  }
}

module.exports = {
  connectDB,
  mongoose,
  User, Session, Supplier, Department, Item, Batch, Movement,
  hashPassword, verifyPassword, ensureAdmin, seedDepartments, nextId,
};
