const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("./equipment.db");

// แก้ username ที่ต้องการให้เป็น admin ตรงนี้
const usernameToPromote = "PW";

db.run(
  "UPDATE users SET role = ? WHERE username = ?",
  ["admin", usernameToPromote],
  function (err) {
    if (err) {
      console.error("เกิดข้อผิดพลาด:", err.message);
      db.close();
      return;
    }

    if (this.changes === 0) {
      console.log("ไม่พบ username:", usernameToPromote);
    } else {
      console.log("เปลี่ยนสิทธิ์เป็น Admin เรียบร้อย:", usernameToPromote);
    }

    db.close();
  }
);