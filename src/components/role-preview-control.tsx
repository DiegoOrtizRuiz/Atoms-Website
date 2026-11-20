"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setViewAsRole } from "@/app/(app)/role-preview-actions";
import type { UserRole } from "@/lib/auth";
import { userRoles } from "@/lib/roles";

export function RolePreviewControl({
  role,
}: {
  role: UserRole;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function changeRole(value: string) {
    if (!userRoles.includes(value as UserRole)) return;
    setSaving(true);
    try {
      await setViewAsRole(value);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to change role preview.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <label className="flex items-center gap-2 text-xs text-slate-300">
      <span className="whitespace-nowrap">Viewing as:</span>
      <select
        aria-label="Viewing as role"
        className="h-8 rounded-md border border-slate-700 bg-slate-900 px-2 text-xs capitalize text-white"
        disabled={saving}
        onChange={(event) => void changeRole(event.target.value)}
        value={role}
      >
        {userRoles.map((item) => (
          <option className="capitalize" key={item} value={item}>
            {item.replaceAll("_", " ")}
          </option>
        ))}
      </select>
    </label>
  );
}
