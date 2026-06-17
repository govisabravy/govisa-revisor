import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import Topbar from "@/components/Topbar";
import { ensureSeedAdmin } from "@/lib/auth/seed";
import { SYSTEM_PAUSED } from "@/lib/system-status";
import SystemPausedScreen from "@/components/SystemPausedScreen";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await ensureSeedAdmin();
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (SYSTEM_PAUSED) return <SystemPausedScreen />;
  if (user.must_change_password) redirect("/change-password");
  return (
    <>
      <Topbar user={{ email: user.email, name: user.name, role: user.role }} />
      {children}
    </>
  );
}
