import { getSession } from "./session";
import { getUserById, type UserRecord } from "../db";

export async function getCurrentUser(): Promise<UserRecord | null> {
  const session = await getSession();
  if (!session.userId) return null;
  const user = getUserById(session.userId);
  if (!user || !user.active) return null;
  return user;
}
