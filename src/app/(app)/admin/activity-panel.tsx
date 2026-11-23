"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fmtDate, fmtOrDash } from "@/lib/format";
import type { Database } from "@/lib/database.types";
import { getAdminActivity } from "./actions";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type ActivityEvent = "login" | "page_view" | "deal_edit" | "admin_change" | "snapshot" | "csv_export" | "password_set" | "config_change" | "import";
type ActivityRow = Awaited<ReturnType<typeof getAdminActivity>>["rows"][number];

const events: ActivityEvent[] = ["login", "page_view", "deal_edit", "admin_change", "snapshot", "csv_export", "password_set", "config_change", "import"];

function detailObject(value: ActivityRow["detail"]) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function ActivityPanel({ profiles }: { profiles: Profile[] }) {
  const [userId, setUserId] = useState("");
  const [event, setEvent] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [count, setCount] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void getAdminActivity({
      userId: userId || undefined,
      event: event ? event as ActivityEvent : undefined,
      from: from || undefined,
      to: to || undefined,
      page,
    }).then((result) => {
      if (!active) return;
      setRows(result.rows);
      setCount(result.count);
    }).catch((cause: unknown) => {
      if (!active) return;
      setError(cause instanceof Error ? cause.message : "Unable to load activity.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [event, from, page, to, userId]);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (userId) params.set("user_id", userId);
    if (event) params.set("event", event);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return params.toString();
  }, [event, from, to, userId]);
  const pages = Math.max(1, Math.ceil(count / 50));

  return (
    <Card>
      <CardHeader><CardTitle>Activity log</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          <select aria-label="Filter by user" className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm" onChange={(item) => { setUserId(item.target.value); setPage(1); }} value={userId}>
            <option value="">All users</option>
            {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name}</option>)}
          </select>
          <select aria-label="Filter by event" className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm" onChange={(item) => { setEvent(item.target.value); setPage(1); }} value={event}>
            <option value="">All events</option>
            {events.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
          </select>
          <Input aria-label="From date" onChange={(item) => { setFrom(item.target.value); setPage(1); }} type="date" value={from} />
          <Input aria-label="To date" onChange={(item) => { setTo(item.target.value); setPage(1); }} type="date" value={to} />
          <Button render={<a href={`/api/admin/activity.csv${query ? `?${query}` : ""}`} /> } variant="outline">Export CSV</Button>
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead><tr className="border-b">
              {["When", "User", "Event", "Path", "Details"].map((heading) => <th className="p-2 font-medium" key={heading}>{heading}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((row) => {
                const detail = detailObject(row.detail);
                const dealId = typeof detail.deal_id === "string" ? detail.deal_id : null;
                const summary = Object.entries(detail)
                  .filter(([key]) => key !== "deal_id")
                  .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
                  .join(" · ");
                return (
                  <tr className="border-b last:border-0" key={row.id}>
                    <td className="p-2">{fmtDate(row.created_at, "PPpp")}</td>
                    <td className="p-2">{fmtOrDash(row.user?.full_name)}{row.user?.role && <Badge className="ml-2 capitalize" variant="outline">{row.user.role.replaceAll("_", " ")}</Badge>}</td>
                    <td className="p-2"><Badge variant="secondary">{row.event.replaceAll("_", " ")}</Badge></td>
                    <td className="p-2">{fmtOrDash(row.path)}</td>
                    <td className="max-w-[30rem] truncate p-2">
                      {dealId && <a className="mr-2 text-primary underline" href={`/deals?deal=${encodeURIComponent(dealId)}`}>Open deal</a>}
                      {summary}
                    </td>
                  </tr>
                );
              })}
              {!loading && !rows.length && <tr><td className="p-4 text-muted-foreground" colSpan={5}>No activity matches these filters.</td></tr>}
              {loading && <tr><td className="p-4 text-muted-foreground" colSpan={5}>Loading activity…</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span>{count} events · page {page} of {pages}</span>
          <div className="flex gap-2">
            <Button disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)} variant="outline">Previous</Button>
            <Button disabled={page >= pages || loading} onClick={() => setPage((value) => value + 1)} variant="outline">Next</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
