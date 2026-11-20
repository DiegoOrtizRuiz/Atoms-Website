import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/auth";
import { effectiveRole } from "@/lib/effective-role";
import { PresenceProvider } from "@/lib/presence";

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const role = await effectiveRole(user);
  return (
    <PresenceProvider user={user}>
      <AppShell effectiveRole={role} user={user}>{children}</AppShell>
    </PresenceProvider>
  );
}
