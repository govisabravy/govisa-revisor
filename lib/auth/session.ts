import { cookies } from "next/headers";
import { getIronSession, SessionOptions } from "iron-session";

export interface SessionData {
  userId?: string;
  role?: "admin" | "user";
  mustChangePassword?: boolean;
}

const secret = process.env.SESSION_SECRET ?? "";
if (secret.length < 32) {
  console.warn(
    "SESSION_SECRET vazio ou < 32 chars. Configure um valor longo no .env.local."
  );
}

export const sessionOptions: SessionOptions = {
  password: secret.padEnd(32, "x"),
  cookieName: "govisa_revisor_session",
  cookieOptions: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7
  }
};

export async function getSession() {
  return getIronSession<SessionData>(cookies(), sessionOptions);
}
