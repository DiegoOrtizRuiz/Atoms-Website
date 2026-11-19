import { BarChart3, LogOut } from "lucide-react";
import { signOut } from "@/app/login/actions";
import type { CurrentUser } from "@/lib/auth";
import { AppNav } from "./app-nav";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function AppShell({
  children,
  user,
}: {
  children: React.ReactNode;
  user: CurrentUser;
}) {
  return (
    <div className="min-h-screen bg-slate-100 lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="flex border-b border-slate-800 bg-slate-950 lg:fixed lg:inset-y-0 lg:w-[260px] lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex h-18 items-center gap-3 border-b border-white/10 px-6">
          <div className="grid size-9 place-items-center rounded-lg bg-cyan-400 text-slate-950">
            <BarChart3 className="size-5" />
          </div>
          <div>
            <p className="font-semibold tracking-tight text-white">
              Site Pipeline
            </p>
            <p className="text-xs text-slate-500">Acquisitions workspace</p>
          </div>
        </div>
        <AppNav role={user.role} />
        <div className="ml-auto border-l border-white/10 p-3 lg:ml-0 lg:mt-auto lg:border-l-0 lg:border-t">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <div className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-800 text-xs font-semibold text-slate-200">
              {initials(user.fullName)}
            </div>
            <div className="hidden min-w-0 flex-1 lg:block">
              <p className="truncate text-sm font-medium text-slate-200">
                {user.fullName}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <Badge className="h-5 border-slate-700 bg-slate-900 px-1.5 text-[10px] font-medium capitalize text-slate-300">
                  {user.role.replaceAll("_", " ")}
                </Badge>
              </div>
            </div>
            <form action={signOut}>
              <Button
                aria-label="Sign out"
                className="text-slate-500 hover:bg-slate-900 hover:text-white"
                size="icon"
                type="submit"
                variant="ghost"
              >
                <LogOut className="size-4" />
              </Button>
            </form>
          </div>
        </div>
      </aside>
      <main className="min-w-0 lg:col-start-2">{children}</main>
    </div>
  );
}
