const express = require("express");
const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const multer = require("multer");
const bcrypt = require("bcrypt");
const session = require("express-session");
const expressLayouts = require("express-ejs-layouts");

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================
// เตรียมโฟลเดอร์ upload
// ==========================
const uploadDir = path.join(__dirname, "public", "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ==========================
// Database
// ==========================
const db = new sqlite3.Database("./equipment.db");

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, function (err, row) {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, function (err, rows) {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function initDB() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      category TEXT,
      unit TEXT,
      location TEXT,
      qty INTEGER NOT NULL DEFAULT 0,
      image TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

 await run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      qty INTEGER NOT NULL,
      note TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(item_id) REFERENCES items(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS item_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      caption TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(item_id) REFERENCES items(id)
    )
  `);

  // เพิ่มคอลัมน์ description ให้ตาราง items ถ้ายังไม่มี
  const itemColumns = await all("PRAGMA table_info(items)");
  const hasDescriptionColumn = itemColumns.some(
    col => col.name === "description"
  );

  if (!hasDescriptionColumn) {
    await run("ALTER TABLE items ADD COLUMN description TEXT");
    console.log("Added description column to items table");
  }

  // สร้าง admin เริ่มต้น
  const admin = await get("SELECT * FROM users WHERE username = ?", ["admin"]);
}

initDB();

// ==========================
// ตั้งค่า Express
// ==========================
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: "equipment-secret-key",
    resave: false,
    saveUninitialized: false
  })
);

// ส่งข้อมูล user ให้ทุกหน้า
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// ==========================
// Upload รูปภาพ
// ==========================
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const filename = Date.now() + "-" + Math.round(Math.random() * 1e9) + ext;
    cb(null, filename);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: function (req, file, cb) {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("อนุญาตเฉพาะไฟล์รูปภาพเท่านั้น"));
    }
  }
});

// ==========================
// Middleware ตรวจสอบสิทธิ์
// ==========================
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).send("ไม่มีสิทธิ์เข้าถึงหน้านี้");
  }
  next();
}

// ==========================
// Auth Routes
// ==========================
app.get("/", (req, res) => {
  if (req.session.user) return res.redirect("/dashboard");
  res.redirect("/login");
});

app.get("/login", (req, res) => {
  res.render("login", { title: "เข้าสู่ระบบ", error: null });
});

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await get("SELECT * FROM users WHERE username = ?", [
      username
    ]);

    if (!user) {
      return res.render("login", {
        title: "เข้าสู่ระบบ",
        error: "ไม่พบชื่อผู้ใช้"
      });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.render("login", {
        title: "เข้าสู่ระบบ",
        error: "รหัสผ่านไม่ถูกต้อง"
      });
    }

    req.session.user = {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role
    };

    res.redirect("/dashboard");
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get("/register", (req, res) => {
  res.render("register", { title: "สมัครสมาชิก", error: null });
});

app.post("/register", async (req, res) => {
  try {
    const { name, username, password } = req.body;

    if (!name || !username || !password) {
      return res.render("register", {
        title: "สมัครสมาชิก",
        error: "กรุณากรอกข้อมูลให้ครบ"
      });
    }

    const hash = await bcrypt.hash(password, 10);

    await run(
      "INSERT INTO users (name, username, password_hash, role) VALUES (?, ?, ?, ?)",
      [name, username, hash, "member"]
    );

    res.redirect("/login");
  } catch (err) {
    res.render("register", {
      title: "สมัครสมาชิก",
      error: "ชื่อผู้ใช้นี้มีอยู่แล้ว หรือเกิดข้อผิดพลาด"
    });
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});


// ==========================
// เปลี่ยนรหัสผ่าน Admin / Member
// ==========================
app.get("/change-password", requireLogin, (req, res) => {
  res.render("change_password", {
    title: "เปลี่ยนรหัสผ่าน",
    error: null,
    success: null
  });
});

app.post("/change-password", requireLogin, async (req, res) => {
  try {
    const { oldPassword, newPassword, confirmPassword } = req.body;

    if (!oldPassword || !newPassword || !confirmPassword) {
      return res.render("change_password", {
        title: "เปลี่ยนรหัสผ่าน",
        error: "กรุณากรอกข้อมูลให้ครบ",
        success: null
      });
    }

    if (newPassword.length < 6) {
      return res.render("change_password", {
        title: "เปลี่ยนรหัสผ่าน",
        error: "รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร",
        success: null
      });
    }

    if (newPassword !== confirmPassword) {
      return res.render("change_password", {
        title: "เปลี่ยนรหัสผ่าน",
        error: "รหัสผ่านใหม่และยืนยันรหัสผ่านไม่ตรงกัน",
        success: null
      });
    }

    const user = await get("SELECT * FROM users WHERE id = ?", [
      req.session.user.id
    ]);

    if (!user) {
      return res.render("change_password", {
        title: "เปลี่ยนรหัสผ่าน",
        error: "ไม่พบข้อมูลผู้ใช้",
        success: null
      });
    }

    const isOldPasswordCorrect = await bcrypt.compare(
      oldPassword,
      user.password_hash
    );

    if (!isOldPasswordCorrect) {
      return res.render("change_password", {
        title: "เปลี่ยนรหัสผ่าน",
        error: "รหัสผ่านเดิมไม่ถูกต้อง",
        success: null
      });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    await run(
      "UPDATE users SET password_hash = ? WHERE id = ?",
      [newPasswordHash, req.session.user.id]
    );

    res.render("change_password", {
      title: "เปลี่ยนรหัสผ่าน",
      error: null,
      success: "เปลี่ยนรหัสผ่านเรียบร้อยแล้ว"
    });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ==========================
// Dashboard
// ==========================
app.get("/dashboard", requireLogin, async (req, res) => {
  const keyword = req.query.q || "";

  const items = await all(
    `
    SELECT * FROM items
    WHERE name LIKE ? OR code LIKE ? OR category LIKE ?
    ORDER BY CAST(code AS INTEGER) ASC
    `,
    [`%${keyword}%`, `%${keyword}%`, `%${keyword}%`]
  );

  res.render("dashboard", {
    title: "รายการวัตถุมงคล",
    items,
    keyword
  });
});

// ==========================
// รายละเอียดวัตถุมงคลแต่ละรายการ
// ==========================
app.get("/items/:id", requireLogin, async (req, res) => {
  try {
    const item = await get("SELECT * FROM items WHERE id = ?", [req.params.id]);

    if (!item) {
      return res.status(404).send("ไม่พบข้อมูลวัตถุมงคล");
    }

    const images = await all(
      "SELECT * FROM item_images WHERE item_id = ? ORDER BY id DESC",
      [req.params.id]
    );

    const transactions = await all(
      `
      SELECT 
        t.*,
        u.name AS user_name
      FROM transactions t
      JOIN users u ON t.user_id = u.id
      WHERE t.item_id = ?
      ORDER BY t.id DESC
      `,
      [req.params.id]
    );

    res.render("item_detail", {
      title: "รายละเอียดวัตถุมงคล",
      item,
      images,
      transactions
    });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ==========================
// Admin อัปโหลดรูปเพิ่มเติมของวัตถุมงคล
// ==========================
app.post(
  "/admin/items/:id/images",
  requireAdmin,
  upload.array("images", 10),
  async (req, res) => {
    try {
      const itemId = req.params.id;
      const caption = req.body.caption || "";

      const item = await get("SELECT * FROM items WHERE id = ?", [itemId]);

      if (!item) {
        return res.status(404).send("ไม่พบข้อมูลวัตถุมงคล");
      }

      if (!req.files || req.files.length === 0) {
        return res.redirect(`/items/${itemId}`);
      }

      for (const file of req.files) {
        await run(
          `
          INSERT INTO item_images (item_id, filename, caption)
          VALUES (?, ?, ?)
          `,
          [itemId, file.filename, caption]
        );
      }

      res.redirect(`/items/${itemId}`);
    } catch (err) {
      res.status(500).send(err.message);
    }
  }
);

// ==========================
// Admin ลบรูปเพิ่มเติม
// ==========================
app.post("/admin/item-images/:imageId/delete", requireAdmin, async (req, res) => {
  try {
    const image = await get("SELECT * FROM item_images WHERE id = ?", [
      req.params.imageId
    ]);

    if (!image) {
      return res.status(404).send("ไม่พบรูปภาพ");
    }

    const filePath = path.join(uploadDir, image.filename);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await run("DELETE FROM item_images WHERE id = ?", [req.params.imageId]);

    res.redirect(`/items/${image.item_id}`);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ==========================
// Admin: บริหารจัดการวัตถุมงคล
// ==========================
app.get("/admin/items", requireAdmin, async (req, res) => {
  const items = await all(`
    SELECT * FROM items
    ORDER BY CAST(code AS INTEGER) ASC
  `);

  res.render("admin_items", {
    title: "บริหารจัดการวัตถุมงคล",
    items
  });
});

app.get("/admin/items/new", requireAdmin, (req, res) => {
  res.render("item_form", {
    title: "เพิ่มวัตถุมงคล",
    item: null,
    action: "/admin/items/new"
  });
});

app.post("/admin/items/new", requireAdmin, upload.single("image"), async (req, res) => {
  try {
    const { code, name, category, unit, location, qty, description } = req.body;
    const image = req.file ? req.file.filename : null;
    const amount = parseInt(qty || "0", 10);

    const result = await run(
      `
      INSERT INTO items (code, name, category, unit, location, qty, image, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [code, name, category, unit, location, amount, image, description]
    );

    if (amount > 0) {
      await run(
        `
        INSERT INTO transactions (item_id, user_id, type, qty, note)
        VALUES (?, ?, ?, ?, ?)
        `,
        [result.lastID, req.session.user.id, "RECEIVE", amount, "เพิ่มรายการเริ่มต้น"]
      );
    }

    res.redirect("/admin/items");
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get("/admin/items/:id/edit", requireAdmin, async (req, res) => {
  const item = await get("SELECT * FROM items WHERE id = ?", [req.params.id]);

  if (!item) return res.status(404).send("ไม่พบข้อมูล");

  res.render("item_form", {
    title: "แก้ไขวัตถุมงคล",
    item,
    action: `/admin/items/${item.id}/edit`
  });
});

app.post("/admin/items/:id/edit", requireAdmin, upload.single("image"), async (req, res) => {
  try {
    const { code, name, category, unit, location, description } = req.body;
    const oldItem = await get("SELECT * FROM items WHERE id = ?", [
      req.params.id
    ]);

    if (!oldItem) return res.status(404).send("ไม่พบข้อมูล");

    let image = oldItem.image;
    if (req.file) {
      image = req.file.filename;
    }

    await run(
  `
  UPDATE items
  SET code = ?, name = ?, category = ?, unit = ?, location = ?, image = ?, description = ?
  WHERE id = ?
  `,
  [code, name, category, unit, location, image, description, req.params.id]
);

    res.redirect("/admin/items");
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.post("/admin/items/:id/add-stock", requireAdmin, async (req, res) => {
  try {
    const qty = parseInt(req.body.qty || "0", 10);
    const note = req.body.note || "รับเข้าเพิ่มเติม";

    if (qty <= 0) {
      return res.redirect("/admin/items");
    }

    await run("BEGIN TRANSACTION");

    await run("UPDATE items SET qty = qty + ? WHERE id = ?", [
      qty,
      req.params.id
    ]);

    await run(
      `
      INSERT INTO transactions (item_id, user_id, type, qty, note)
      VALUES (?, ?, ?, ?, ?)
      `,
      [req.params.id, req.session.user.id, "RECEIVE", qty, note]
    );

    await run("COMMIT");

    res.redirect("/admin/items");
  } catch (err) {
    await run("ROLLBACK").catch(() => {});
    res.status(500).send(err.message);
  }
});

app.post("/admin/items/:id/delete", requireAdmin, async (req, res) => {
  try {
    await run("DELETE FROM transactions WHERE item_id = ?", [req.params.id]);
    await run("DELETE FROM items WHERE id = ?", [req.params.id]);
    res.redirect("/admin/items");
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ==========================
// Member/Admin: เบิกวัตถุมงคล
// ==========================
app.get("/withdraw/:id", requireLogin, async (req, res) => {
  const item = await get("SELECT * FROM items WHERE id = ?", [req.params.id]);

  if (!item) return res.status(404).send("ไม่พบรายการวัตถุมงคล");

  res.render("withdraw", {
    title: "เบิกวัตถุมงคล",
    item,
    error: null
  });
});

app.post("/withdraw/:id", requireLogin, async (req, res) => {
  try {
    const itemId = req.params.id;
    const qty = parseInt(req.body.qty || "0", 10);
    const note = req.body.note || "";

    const item = await get("SELECT * FROM items WHERE id = ?", [itemId]);

    if (!item) return res.status(404).send("ไม่พบรายการวัตถุมงคล");

    if (qty <= 0) {
      return res.render("withdraw", {
        title: "เบิกวัตถุมงคล",
        item,
        error: "จำนวนที่เบิกต้องมากกว่า 0"
      });
    }

    await run("BEGIN IMMEDIATE TRANSACTION");

    const current = await get("SELECT qty FROM items WHERE id = ?", [itemId]);

    if (!current || current.qty < qty) {
      await run("ROLLBACK");
      return res.render("withdraw", {
        title: "เบิกวัตถุมงคล",
        item,
        error: "จำนวนคงเหลือไม่เพียงพอ"
      });
    }

    await run("UPDATE items SET qty = qty - ? WHERE id = ?", [qty, itemId]);

    await run(
      `
      INSERT INTO transactions (item_id, user_id, type, qty, note)
      VALUES (?, ?, ?, ?, ?)
      `,
      [itemId, req.session.user.id, "ISSUE", qty, note]
    );

    await run("COMMIT");

    res.redirect("/dashboard");
  } catch (err) {
    await run("ROLLBACK").catch(() => {});
    res.status(500).send(err.message);
  }
});

// ==========================
// ประวัติการรับเข้า/เบิกออก ทั้งหมด
// Admin และ Member เห็นประวัติทั้งหมดเหมือนกัน
// ==========================
app.get("/history", requireLogin, async (req, res) => {
  try {
    const rows = await all(`
      SELECT 
        t.*,
        i.code,
        i.name AS item_name,
        i.unit,
        u.name AS user_name
      FROM transactions t
      JOIN items i ON t.item_id = i.id
      JOIN users u ON t.user_id = u.id
      ORDER BY t.id DESC
    `);

    res.render("history", {
      title: "ประวัติการรับเข้า/เบิกออก",
      rows
    });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ==========================
// Start Server
// ==========================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});