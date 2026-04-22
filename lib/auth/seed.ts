import { v4 as uuid } from "uuid";
import { countUsers, createUser, getUserByEmail } from "../db";
import { hashPassword } from "./password";

let seeded = false;

export async function ensureSeedAdmin(): Promise<void> {
  if (seeded) return;
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    seeded = true;
    return;
  }
  if (countUsers() > 0) {
    seeded = true;
    return;
  }
  if (getUserByEmail(email)) {
    seeded = true;
    return;
  }
  const hash = await hashPassword(password);
  createUser({
    id: uuid(),
    email,
    password_hash: hash,
    name: "Admin",
    role: "admin",
    must_change_password: true
  });
  seeded = true;
  console.log(`[seed] admin criado: ${email}`);
}
