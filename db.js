// Database layer — uses Node's built-in SQLite (node:sqlite, Node 22.5+).
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, "redora.db"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','staff')),
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE,
  category TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'units',
  reorder_level INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  supplier_id INTEGER REFERENCES suppliers(id),
  storage_location TEXT,
  tracks_expiry INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id),
  batch_no TEXT NOT NULL,
  expiry_date TEXT,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit_cost REAL,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (item_id, batch_no)
);

CREATE TABLE IF NOT EXISTS movements (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id),
  batch_id INTEGER REFERENCES batches(id),
  type TEXT NOT NULL CHECK (type IN ('in','out','adjust','writeoff')),
  quantity INTEGER NOT NULL,            -- signed change: + adds stock, - removes stock
  department_id INTEGER REFERENCES departments(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  reference TEXT,
  notes TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_batches_item ON batches(item_id);
CREATE INDEX IF NOT EXISTS idx_movements_item ON movements(item_id);
CREATE INDEX IF NOT EXISTS idx_movements_created ON movements(created_at);
`);

// Default departments (only when the table is empty)
if (db.prepare("SELECT COUNT(*) AS n FROM departments").get().n === 0) {
  const ins = db.prepare("INSERT INTO departments (name) VALUES (?)");
  [
    "Pharmacy",
    "Emergency",
    "ICU",
    "Operation Theatre",
    "General Ward",
    "Laboratory",
    "Radiology",
    "Outpatient (OPD)",
  ].forEach((n) => ins.run(n));
}

function tx(fn) {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

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

// Creates the first admin account if no users exist yet.
function ensureAdmin(passwordOverride) {
  if (db.prepare("SELECT COUNT(*) AS n FROM users").get().n > 0) return;
  const username = (process.env.ADMIN_USERNAME || "admin").toLowerCase();
  let password = passwordOverride || process.env.ADMIN_PASSWORD;
  let generated = false;
  if (!password) {
    password = crypto.randomBytes(9).toString("base64url");
    generated = true;
  }
  db.prepare(
    "INSERT INTO users (username, name, role, password_hash) VALUES (?, ?, 'admin', ?)"
  ).run(username, "Administrator", hashPassword(password));
  console.log(`Created first admin account  ->  username: ${username}`);
  if (generated) {
    console.log(`Generated password (shown once, change it after signing in): ${password}`);
  }
}

module.exports = { db, tx, hashPassword, verifyPassword, ensureAdmin };
