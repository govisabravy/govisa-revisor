import { cookies } from "next/headers";
import { getIronSession, SessionOptions } from "iron-session";

export interface SessionData {
  userId?: string;
  role?: "admin" | "user";
  mustChangePassword?: boolean;
  createdAt?: number;
}

const secret = process.env.SESSION_SECRET ?? "";

if (secret.length < 32) {
  const msg =
    "SESSION_SECRET ausente ou < 32 chars. Gere com `openssl rand -hex 32` e configure a env var.";
  if (process.env.NODE_ENV === "production") {
    throw new Error(msg);
  }
  console.warn(`[session] ${msg} (dev fallback em uso — NÃO usar em prod)`);
}

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export const sessionOptions: SessionOptions = {
  password: secret.padEnd(32, "x"),
  cookieName: "govisa_revisor_session",
  cookieOptions: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_SECONDS
  }
};

export async function getSession() {
  return getIronSession<SessionData>(cookies(), sessionOptions);
}
