// Fills an EMPTY database with sample hospital data so you can explore Redora.
// Run with:  npm run demo      (never run this on a real production database)
const { db, tx, hashPassword, ensureAdmin } = require("./db");

if (db.prepare("SELECT COUNT(*) AS n FROM items").get().n > 0) {
  console.log("Database already has items — demo data not added.");
  process.exit(0);
}

ensureAdmin("Redora@123");
if (!db.prepare("SELECT 1 FROM users WHERE username = 'staff'").get()) {
  db.prepare("INSERT INTO users (username, name, role, password_hash) VALUES ('staff', 'Pharmacy Staff', 'staff', ?)")
    .run(hashPassword("Redora@123"));
}

const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
const stamp = (offset, hour = 10) => {
  const d = new Date();
  d.setUTCHours(hour, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().replace("T", " ").slice(0, 19);
};

const depts = Object.fromEntries(db.prepare("SELECT id, name FROM departments").all().map((d) => [d.name, d.id]));

tx(() => {
  const supplier = db.prepare("INSERT INTO suppliers (name, contact_person, phone, email, address) VALUES (?, ?, ?, ?, ?)");
  const sup = {};
  [
    ["MediCore Pharma Distributors", "Anil Kumar", "+91 98400 11122", "orders@medicore.example", "12 Industrial Estate, Coimbatore"],
    ["SteriSafe Surgical Supplies", "Priya Nair", "+91 98950 33445", "sales@sterisafe.example", "45 Market Road, Kochi"],
    ["LabLine Diagnostics", "R. Venkatesh", "+91 99620 55667", "support@labline.example", "7 Tech Park, Chennai"],
    ["CareWear PPE Traders", "Meena Iyer", "+91 97100 77889", "hello@carewear.example", "88 Mill Street, Tiruppur"],
  ].forEach((s) => { sup[s[0].split(" ")[0]] = Number(supplier.run(...s).lastInsertRowid); });

  const item = db.prepare(
    `INSERT INTO items (name, code, category, unit, reorder_level, supplier_id, storage_location, tracks_expiry)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const batch = db.prepare("INSERT INTO batches (item_id, batch_no, expiry_date, quantity, unit_cost, received_at) VALUES (?, ?, ?, ?, ?, ?)");
  const move = db.prepare(
    `INSERT INTO movements (item_id, batch_id, type, quantity, department_id, supplier_id, reference, notes, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
  );

  // [name, code, category, unit, reorder, supplier, location, expiry?, batches[[batchNo, expiryOffsetDays, received, issued, cost]]]
  const catalog = [
    ["Paracetamol 500 mg", "MED-001", "Medicine", "strips", 100, "MediCore", "Pharmacy A-1", 1, [["PCM2401", 420, 400, 150, 12.5], ["PCM2407", 700, 300, 40, 13]]],
    ["Amoxicillin 500 mg", "MED-002", "Medicine", "strips", 80, "MediCore", "Pharmacy A-2", 1, [["AMX2312", 45, 200, 140, 38]]],
    ["Insulin Glargine 100 IU/mL", "MED-003", "Medicine", "vials", 30, "MediCore", "Cold room 1", 1, [["INS8821", 120, 90, 75, 540]]],
    ["Ondansetron 4 mg Injection", "MED-004", "Medicine", "ampoules", 60, "MediCore", "Pharmacy B-1", 1, [["OND1190", 20, 150, 60, 22]]],
    ["Ceftriaxone 1 g Injection", "MED-005", "Medicine", "vials", 120, "MediCore", "Pharmacy B-2", 1, [["CEF5520", -12, 80, 62, 64], ["CEF5601", 260, 150, 120, 66]]],
    ["Normal Saline 0.9% 500 mL", "FLD-001", "Medicine", "bags", 200, "MediCore", "Store 2", 1, [["NS2406", 300, 600, 330, 28]]],
    ["Salbutamol Inhaler", "MED-006", "Medicine", "inhalers", 25, "MediCore", "Pharmacy A-3", 1, [["SAL7704", 90, 60, 60, 165]]],
    ["Surgical Gloves, sterile (size 7.5)", "SUR-001", "Surgical", "pairs", 300, "SteriSafe", "OT Store", 1, [["GLV3310", 540, 1200, 980, 14]]],
    ["Sutures — Vicryl 2-0", "SUR-002", "Surgical", "packs", 40, "SteriSafe", "OT Store", 1, [["VIC4412", 600, 120, 70, 210]]],
    ["Disposable Syringe 5 mL", "CON-001", "Consumable", "pcs", 500, "SteriSafe", "Store 1", 1, [["SYR9001", 800, 2000, 1450, 3.2]]],
    ["IV Cannula 20G", "CON-002", "Consumable", "pcs", 300, "SteriSafe", "Store 1", 1, [["CAN6620", 500, 800, 640, 9.5]]],
    ["N95 Respirator Mask", "PPE-001", "PPE", "pcs", 200, "CareWear", "Store 3", 0, [["DEFAULT", null, 900, 760, 38]]],
    ["Surgical Face Mask (3-ply)", "PPE-002", "PPE", "boxes", 40, "CareWear", "Store 3", 0, [["DEFAULT", null, 120, 55, 120]]],
    ["Blood Glucose Test Strips", "LAB-001", "Lab supplies", "vials", 50, "LabLine", "Lab Store", 1, [["GTS3302", 150, 200, 95, 480]]],
    ["Pulse Oximeter (fingertip)", "EQP-001", "Equipment", "pcs", 5, "LabLine", "Equipment Room", 0, [["DEFAULT", null, 12, 4, 1850]]],
    ["Hand Sanitizer 500 mL", "CON-003", "Consumable", "bottles", 80, "CareWear", "Store 3", 1, [["HSN1180", 330, 150, 90, 95]]],
  ];

  const deptCycle = ["Emergency", "ICU", "General Ward", "Operation Theatre", "Pharmacy", "Outpatient (OPD)", "Laboratory"];
  let n = 0;
  for (const [name, code, cat, unit, reorder, sName, loc, exp, batches] of catalog) {
    const itemId = Number(item.run(name, code, cat, unit, reorder, sup[sName], loc, exp).lastInsertRowid);
    batches.forEach(([bno, expOff, received, issued, cost], bi) => {
      const left = received - issued;
      const batchId = Number(batch.run(itemId, bno, expOff === null ? null : day(expOff), left, cost, stamp(-60 + bi * 10)).lastInsertRowid);
      move.run(itemId, batchId, "in", received, null, sup[sName], `PO-${2400 + n}`, null, stamp(-60 + bi * 10));
      // spread the issues over recent days
      let rest = issued, k = 0;
      while (rest > 0) {
        const q = Math.min(rest, Math.max(1, Math.round(issued / 6)));
        const dept = deptCycle[(n + k) % deptCycle.length];
        move.run(itemId, batchId, "out", -q, depts[dept], null, `REQ-${3000 + n * 10 + k}`, null, stamp(-((k * 2 + n) % 13), 9 + (k % 8)));
        rest -= q; k++;
      }
      n++;
    });
  }
});

console.log("Demo data added.  Sign in with  admin / Redora@123  or  staff / Redora@123");
