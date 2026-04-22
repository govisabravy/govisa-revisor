import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import Topbar from "@/components/Topbar";
import { ensureSeedAdmin } from "@/lib/auth/seed";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await ensureSeedAdmin();
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.must_change_password) redirect("/change-password");
  if (user.role !== "admin") redirect("/app");
  return (
    <>
      <Topbar user={{ email: user.email, name: user.name, role: user.role }} />
      {children}
    </>
  );
}
