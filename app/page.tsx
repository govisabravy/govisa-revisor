import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { ensureSeedAdmin } from "@/lib/auth/seed";

export const dynamic = "force-dynamic";

export default async function Root() {
  await ensureSeedAdmin();
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.must_change_password) redirect("/change-password");
  redirect(user.role === "admin" ? "/admin" : "/app");
}
