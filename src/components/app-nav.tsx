"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  ChartNoAxesCombined,
  LayoutDashboard,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/auth";

const links = [
  { href: "/deals", label: "Operations", icon: LayoutDashboard },
  { href: "/weekly", label: "Weekly Review", icon: BarChart3 },
  { href: "/rollup", label: "Rollup", icon: ChartNoAxesCombined },
  { href: "/me", label: "My profile", icon: UserRound },
  { href: "/admin", label: "Admin", icon: ShieldCheck, adminOnly: true },
] as const;

export function AppNav({ role }: { role: UserRole }) {
  const pathname = usePathname();

  return (
    <nav className="space-y-1 px-3 py-5" aria-label="Primary navigation">
      {links
        .filter((link) => !("adminOnly" in link) || role === "admin")
        .map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:bg-slate-900 hover:text-white",
              )}
              href={href}
              key={href}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          );
        })}
    </nav>
  );
}
