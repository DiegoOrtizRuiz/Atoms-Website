"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CurrentUser } from "@/lib/auth";
import { fmtDate, fmtOrDash } from "@/lib/format";
import { permissionColumns, rolePermissions } from "@/lib/permissions";
import { requestPasswordReset } from "./actions";

type RecentItem = {
  id: string;
  kind: string;
  at: string;
  description: string;
  dealId: string | null;
};

export function MyProfile({
  recent,
  user,
}: {
  recent: RecentItem[];
  user: CurrentUser;
}) {
  const [sending, setSending] = useState(false);

  async function resetPassword() {
    setSending(true);
    try {
      await requestPasswordReset();
      toast.success("Password reset email sent.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to send password reset email.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-5 px-4 pb-8 md:px-8">
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Name</p>
              <p className="font-medium">{fmtOrDash(user.fullName)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Email</p>
              <p className="font-medium">{fmtOrDash(user.email)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Role</p>
              <Badge className="mt-1 capitalize" variant="outline">{user.role.replaceAll("_", " ")}</Badge>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Verticals</p>
              <p>{user.verticals.join(", ") || "—"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Clients</p>
              <p>{user.clients.join(", ") || "—"}</p>
            </div>
            <Button disabled={sending} onClick={resetPassword} variant="outline">
              {sending ? "Sending email…" : "Reset password"}
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>What I can do</CardTitle></CardHeader>
          <CardContent>
            <dl className="space-y-2">
              {permissionColumns.map((column) => {
                const permission = rolePermissions[user.role][column.key];
                return (
                  <div className="flex items-start justify-between gap-4 border-b pb-2 last:border-0" key={column.key}>
                    <dt className="text-muted-foreground">{column.label}</dt>
                    <dd className="text-right font-medium">
                      {typeof permission === "boolean" ? (permission ? "Yes" : "No") : permission}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Recent logins and edits</CardTitle></CardHeader>
        <CardContent>
          {recent.length ? (
            <ol className="space-y-3">
              {recent.map((item) => (
                <li className="flex flex-col gap-1 border-b pb-3 last:border-0 sm:flex-row sm:items-center sm:justify-between" key={item.id}>
                  <div className="flex items-center gap-2">
                    <Badge className="capitalize" variant={item.kind === "deal_edit" ? "default" : "secondary"}>
                      {item.kind.replaceAll("_", " ")}
                    </Badge>
                    <span>{item.dealId ? <a className="text-primary underline" href={`/deals?deal=${encodeURIComponent(item.dealId)}`}>{item.description}</a> : item.description}</span>
                  </div>
                  <time className="text-xs text-muted-foreground" dateTime={item.at}>{fmtDate(item.at, "PPpp")}</time>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">No recent logins or edits.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
