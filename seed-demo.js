// Fills an EMPTY database with sample hospital data so you can explore Redora.
// Run with:  npm run demo      (never run this on a real production database)
require("dotenv").config();
const {
  connectDB, mongoose,
  User, Supplier, Department, Item, Batch, Movement,
  hashPassword, ensureAdmin,
} = require("./db");

const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
const stamp = (offset, hour = 10) => {
  const d = new Date();
  d.setUTCHours(hour, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().replace("T", " ").slice(0, 19);
};

(async () => {
  await connectDB();

  const itemCount = await Item.countDocuments();
  if (itemCount > 0) {
    console.log("Database already has items — demo data not added.");
    process.exit(0);
  }

  await ensureAdmin("Redora@123");
  if (!(await User.findOne({ username: "staff" }))) {
    const staff = new User({ username: "staff", name: "Pharmacy Staff", role: "staff", password_hash: hashPassword("Redora@123") });
    await staff.save();
  }

  const deptDocs = await Department.find({}).lean();
  const depts = Object.fromEntries(deptDocs.map((d) => [d.name, d.id]));

  const supMap = {};
  const suppliersData = [
    ["MediCore Pharma Distributors", "Anil Kumar", "+91 98400 11122", "orders@medicore.example", "12 Industrial Estate, Coimbatore"],
    ["SteriSafe Surgical Supplies", "Priya Nair", "+91 98950 33445", "sales@sterisafe.example", "45 Market Road, Kochi"],
    ["LabLine Diagnostics", "R. Venkatesh", "+91 99620 55667", "support@labline.example", "7 Tech Park, Chennai"],
    ["CareWear PPE Traders", "Meena Iyer", "+91 97100 77889", "hello@carewear.example", "88 Mill Street, Tiruppur"],
  ];
  for (const [name, contact_person, phone, email, address] of suppliersData) {
    const sup = new Supplier({ name, contact_person, phone, email, address });
    await sup.save();
    supMap[name.split(" ")[0]] = sup.id;
  }

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
    const newItem = new Item({ name, code, category: cat, unit, reorder_level: reorder, supplier_id: supMap[sName], storage_location: loc, tracks_expiry: exp });
    await newItem.save();
    const itemId = newItem.id;

    for (let bi = 0; bi < batches.length; bi++) {
      const [bno, expOff, received, issued, cost] = batches[bi];
      const left = received - issued;
      const newBatch = new Batch({
        item_id: itemId, batch_no: bno,
        expiry_date: expOff === null ? null : day(expOff),
        quantity: left, unit_cost: cost,
        received_at: stamp(-60 + bi * 10),
      });
      await newBatch.save();
      const batchId = newBatch.id;

      const moveIn = new Movement({
        item_id: itemId, batch_id: batchId, type: "in", quantity: received,
        department_id: null, supplier_id: supMap[sName],
        reference: `PO-${2400 + n}`, notes: null, user_id: 1,
        created_at: stamp(-60 + bi * 10),
      });
      await moveIn.save();

      let rest = issued, k = 0;
      while (rest > 0) {
        const q = Math.min(rest, Math.max(1, Math.round(issued / 6)));
        const dept = deptCycle[(n + k) % deptCycle.length];
        const moveOut = new Movement({
          item_id: itemId, batch_id: batchId, type: "out", quantity: -q,
          department_id: depts[dept], supplier_id: null,
          reference: `REQ-${3000 + n * 10 + k}`, notes: null, user_id: 1,
          created_at: stamp(-((k * 2 + n) % 13), 9 + (k % 8)),
        });
        await moveOut.save();
        rest -= q; k++;
      }
      n++;
    }
  }

  console.log("Demo data added.  Sign in with  admin / Redora@123  or  staff / Redora@123");
  await mongoose.disconnect();
  process.exit(0);
})();
