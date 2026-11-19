import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PhasePlaceholder } from "@/components/phase-placeholder";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage() {
  const user = await requireUser();
  if (user.role !== "admin") notFound();

  return (
    <>
      <PageHeader
        title="Administration"
        description="Manage access, review activity, and monitor pipeline health."
      />
      <PhasePlaceholder
        description="User management, usage reporting, permissions, and audit tools are added in the admin phase."
        icon={ShieldCheck}
        title="Administration is ready to connect"
      />
    </>
  );
}
