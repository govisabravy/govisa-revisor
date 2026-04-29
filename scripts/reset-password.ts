import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import path from "path";

const email = process.argv[2];
const newPassword = process.argv[3];
if (!email || !newPassword) {
  console.error("Uso: tsx scripts/reset-password.ts <email> <new_password>");
  process.exit(1);
}

const dbPath = path.join(process.cwd(), "data", process.env.AUTH_DB_PATH ?? "govisa-revisor.db");
const db = new Database(dbPath);
const hash = bcrypt.hashSync(newPassword, 10);
const now = new Date().toISOString();

const r = db
  .prepare(
    "UPDATE users SET password_hash=?, must_change_password=0, updated_at=? WHERE email=?"
  )
  .run(hash, now, email);

if (r.changes === 0) {
  console.error("Email não encontrado:", email);
  process.exit(1);
}
console.log(`OK — senha resetada pra ${email}`);
console.log(`DB: ${dbPath}`);
