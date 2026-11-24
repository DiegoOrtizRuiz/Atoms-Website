import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireUser } from "@/lib/auth";
import { dealStages, jsonObject } from "@/lib/deals";
import { fmtNumber, fmtOrDash } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Rollup" };

type StageRollupRow = {
  vertical: string | null;
  stage: (typeof dealStages)[number] | null;
  deal_count: number | null;
};

function outreachValue(value: unknown) {
  return value === true || value === "true";
}

function percent(count: number, total: number) {
  return total ? `${fmtNumber((count / total) * 100, { maximumFractionDigits: 0 })}%` : "—";
}

export default async function RollupPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const [rollup, verticals, oldDeals, contacts] = await Promise.all([
    supabase.from("v_stage_rollup").select("vertical, stage, deal_count"),
    supabase.from("vertical_config").select("vertical, active").order("sort_order"),
    supabase
      .from("deals")
      .select("id, vertical, market, address, stage, stage_entered_at")
      .order("stage_entered_at", { ascending: true }),
    supabase
      .from("contacts")
      .select("id, contact_name, title, email, linked_deals, attributes")
      .order("contact_name"),
  ]);
  for (const result of [rollup, verticals, oldDeals, contacts]) {
    if (result.error) throw new Error(result.error.message);
  }

  const { error: activityError } = await supabase.from("activity_log").insert({
    user_id: user.id,
    event: "page_view",
    path: "/rollup",
    detail: { source: "server" },
  });
  if (activityError) console.error("Unable to record the Rollup page view.", activityError);

  const stages = new Map<string, number>();
  for (const row of (rollup.data ?? []) as StageRollupRow[]) {
    if (!row.vertical || !row.stage) continue;
    const key = `${row.vertical}\u0000${row.stage}`;
    stages.set(key, (stages.get(key) ?? 0) + (row.deal_count ?? 0));
  }

  const configuredVerticals = verticals.data ?? [];
  const inactiveVerticals = new Set(
    configuredVerticals.filter((item) => !item.active).map((item) => item.vertical),
  );
  const verticalOrder = configuredVerticals
    .filter((item) => item.active)
    .map((item) => item.vertical);
  const longestInStage = (oldDeals.data ?? [])
    .filter((deal) => !deal.vertical || !inactiveVerticals.has(deal.vertical))
    .slice(0, 10);
  const contactsList = contacts.data ?? [];
  const outreach = contactsList.map((contact) => ({
    ...contact,
    attributes: jsonObject(contact.attributes),
  }));
  const emailedCount = outreach.filter((contact) => outreachValue(contact.attributes.emailed)).length;
  const linkedinCount = outreach.filter((contact) => outreachValue(contact.attributes.linkedin_dm)).length;
  const helpfulCount = outreach.filter((contact) => outreachValue(contact.attributes.helpful_reply)).length;
  const now = Date.now();

  return (
    <>
      <PageHeader
        title="Stage rollup"
        description="Pipeline volume, time in stage, and contact outreach from the live dataset."
        helpSection="rollup"
      />
      <div className="space-y-5 px-4 pb-8 md:px-8">
        <Card>
          <CardHeader>
            <CardTitle>Deals by vertical and stage</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vertical</TableHead>
                  {dealStages.map((stage) => <TableHead className="text-center" key={stage}>{stage}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {verticalOrder.map((vertical) => (
                  <TableRow key={vertical}>
                    <TableHead>{vertical}</TableHead>
                    {dealStages.map((stage) => {
                      const count = stages.get(`${vertical}\u0000${stage}`) ?? 0;
                      return (
                        <TableCell className="text-center" key={stage}>
                          <a
                            aria-label={`${vertical}, ${stage}: ${count} deals`}
                            className="inline-flex min-w-8 justify-center rounded px-2 py-1 font-medium hover:bg-muted"
                            href={`/deals?vertical=${encodeURIComponent(vertical)}&stage=${encodeURIComponent(stage)}`}
                          >
                            {fmtNumber(count)}
                          </a>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
                {!verticalOrder.length && (
                  <TableRow><TableCell colSpan={dealStages.length + 1}>No verticals configured.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="grid gap-5 xl:grid-cols-[1fr_1.2fr]">
          <Card>
            <CardHeader><CardTitle>Longest in current stage</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Deal</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Days</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {longestInStage.map((deal) => {
                    const days = Math.max(0, Math.floor((now - new Date(deal.stage_entered_at).getTime()) / 86400000));
                    const old = days > 30;
                    return (
                      <TableRow key={deal.id}>
                        <TableCell>
                          <a className="font-medium text-primary underline" href={`/deals?deal=${encodeURIComponent(deal.id)}`}>
                            {fmtOrDash(deal.address) === "—" ? deal.id : deal.address}
                          </a>
                          <p className="text-xs text-muted-foreground">{[deal.market, deal.vertical].filter(Boolean).join(" · ") || "—"}</p>
                        </TableCell>
                        <TableCell><Badge className={old ? "border-amber-300 bg-amber-100 text-amber-900" : ""} variant="outline">{deal.stage}</Badge></TableCell>
                        <TableCell className={old ? "font-semibold text-amber-800" : ""}>{fmtNumber(days)}</TableCell>
                      </TableRow>
                    );
                  })}
                  {longestInStage.length === 0 && <TableRow><TableCell colSpan={3}>No deals found.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Contact outreach</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border p-3">
                  <dt className="text-xs text-muted-foreground">Emailed</dt>
                  <dd className="mt-1 text-lg font-semibold">{percent(emailedCount, outreach.length)}</dd>
                  <dd className="text-xs text-muted-foreground">{emailedCount} / {outreach.length}</dd>
                </div>
                <div className="rounded-lg border p-3">
                  <dt className="text-xs text-muted-foreground">LinkedIn DM</dt>
                  <dd className="mt-1 text-lg font-semibold">{percent(linkedinCount, outreach.length)}</dd>
                  <dd className="text-xs text-muted-foreground">{linkedinCount} / {outreach.length}</dd>
                </div>
                <div className="rounded-lg border p-3">
                  <dt className="text-xs text-muted-foreground">Helpful reply</dt>
                  <dd className="mt-1 text-lg font-semibold">{percent(helpfulCount, outreach.length)}</dd>
                  <dd className="text-xs text-muted-foreground">{helpfulCount} / {outreach.length}</dd>
                </div>
              </dl>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contact</TableHead>
                    <TableHead>Outreach</TableHead>
                    <TableHead>Linked deals</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {outreach.map((contact) => (
                    <TableRow key={contact.id}>
                      <TableCell>
                        <p className="font-medium">{fmtOrDash(contact.contact_name)}</p>
                        <p className="text-xs text-muted-foreground">{fmtOrDash(contact.title)}</p>
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        {outreachValue(contact.attributes.emailed) ? "Emailed" : ""}
                        {outreachValue(contact.attributes.linkedin_dm) ? " · LinkedIn" : ""}
                        {outreachValue(contact.attributes.helpful_reply) ? " · Helpful reply" : ""}
                        {!outreachValue(contact.attributes.emailed) &&
                          !outreachValue(contact.attributes.linkedin_dm) &&
                          !outreachValue(contact.attributes.helpful_reply)
                          ? "—"
                          : null}
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        {contact.linked_deals.length
                          ? contact.linked_deals.map((dealId) => (
                              <a className="mr-2 inline-block text-primary underline" href={`/deals?deal=${encodeURIComponent(dealId)}`} key={dealId}>{dealId}</a>
                            ))
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!outreach.length && <TableRow><TableCell colSpan={3}>No contacts recorded.</TableCell></TableRow>}
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground">
                Outreach rates use all {fmtNumber(outreach.length)} contacts as the denominator.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
