import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { requireUser, type UserRole } from "@/lib/auth";
import { dealStages, type DealStage } from "@/lib/deals";
import { describeDealPermissions, rolePermissions } from "@/lib/permissions";
import { stageStyleFor } from "@/lib/stage-colors";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Help" };

const roleNames: Record<UserRole, string> = {
  admin: "Administrator",
  leadership: "Leadership",
  acq_lead: "Acquisition lead",
  analyst: "Analyst",
  viewer: "Viewer",
};

const stageDescriptions: Record<DealStage, string> = {
  Sourcing: "Looking for an opportunity.",
  "In Pipeline": "An opportunity is being considered.",
  "Pre LOI": "Preparing to make an offer.",
  "Negotiating LOI": "Discussing the main terms of an offer.",
  "Negotiating PSA": "Discussing the purchase agreement.",
  "In Contract": "The purchase agreement has been signed.",
  Closed: "The deal is complete.",
  "On Hold": "Work on the deal is paused.",
  "Needs review": "The stage needs a person to check it.",
};

function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="list-decimal space-y-2 pl-5 leading-7">{children}</ol>;
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section className="scroll-mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" id={id}>
      <h2 className="text-xl font-semibold text-slate-950">{title}</h2>
      {children}
    </section>
  );
}

function Example({ file, alt }: { file: string; alt: string }) {
  return (
    <figure className="space-y-2">
      <Image alt={alt} className="h-auto w-full rounded-lg border border-slate-200" height={900} src={`/help/${file}.png`} width={1440} />
      <figcaption className="text-xs text-slate-500">{alt}</figcaption>
    </figure>
  );
}

export default async function HelpPage() {
  const user = await requireUser();
  const permissions = rolePermissions[user.role];
  const supabase = await createClient();
  const { error } = await supabase.from("activity_log").insert({
    user_id: user.id,
    event: "page_view",
    path: "/help",
    detail: { source: "server" },
  });
  if (error) console.error("Unable to record the Help page view.", error);

  return (
    <>
      <PageHeader title="Help" description="A simple guide to finding, reviewing, and sharing deals." helpSection="your-role" />
      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 text-sm text-slate-700 sm:px-6">
        <nav aria-label="Help sections" className="flex flex-wrap gap-x-4 gap-y-2 text-sm font-medium text-cyan-800">
          {[
            ["your-role", "Your role"],
            ["meeting", "Weekly meeting"],
            ["operations", "Operations"],
            ["map", "Map"],
            ["weekly", "Weekly Review"],
            ["rollup", "Rollup"],
            ...(permissions.admin ? [["admin", "Admin"]] : []),
            ["glossary", "Glossary"],
            ["something-wrong", "Something looks wrong?"],
          ].map(([id, label]) => <a className="underline hover:text-cyan-950" href={`#${id}`} key={id}>{label}</a>)}
        </nav>

        <Section id="your-role" title="Your role">
          <p><strong>Role:</strong> {roleNames[user.role]}</p>
          <p>{describeDealPermissions(user)}</p>
          <p>
            {permissions.confirmAssumptions
              ? "You can also confirm assumptions on deals you are allowed to review."
              : "You cannot confirm assumptions."}{" "}
            {permissions.saveSnapshot ? "You can save a weekly snapshot." : "You cannot save a weekly snapshot."}
          </p>
          <p>Need different access? Ask your administrator.</p>
        </Section>

        <Section id="meeting" title="Run the weekly meeting in 5 steps">
          <Steps>
            <li>Open <Link className="text-cyan-800 underline" href="/weekly">Weekly Review</Link> and check the items needing attention this week.</li>
            <li>Review each group of deals, starting with dates and recent changes.</li>
            <li>Choose <strong>Show all deals</strong> if the team needs the complete list.</li>
            <li>Choose <strong>Present</strong> for the meeting; use the arrows or space bar to move between groups, then choose <strong>Exit</strong>.</li>
            <li>Choose <strong>Export</strong> to download slides. If you have permission, save a snapshot to compare with a later meeting.</li>
          </Steps>
        </Section>

        <Section id="operations" title="Operations">
          <Steps>
            <li>Open <Link className="text-cyan-800 underline" href="/deals">Operations</Link> and use the filters to find deals by client, vertical, market, or stage. Use <strong>Reset</strong> to clear your choices.</li>
            <li>Select an address to see the deal&apos;s details and history.</li>
            <li>If you can edit a cell, a pencil appears when you hover over it. Double-click the cell, change the value, and press Enter to save.</li>
            <li>Use the three-dot menu beside a value to mark it as an assumption or, if permitted, confirm it. If someone else changed the deal, review the latest value before trying again.</li>
          </Steps>
          <Example file="filters" alt="The Operations filter bar" />
          <Example file="assumption" alt="An assumption and its value actions menu" />
        </Section>

        <Section id="map" title="Map">
          <Steps>
            <li>In Operations, select <strong>Map</strong>. The same filters still apply.</li>
            <li>Hover over a marker to see a short deal card; select a marker to open the full details. On a touch screen, tap once for the card and again for details.</li>
            <li>Check <strong>Not on map</strong> for deals without a location on the map. If the map is unavailable, you can still select a deal from the list.</li>
          </Steps>
          <Example file="map-card" alt="A deal card in the Map view" />
        </Section>

        <Section id="weekly" title="Weekly Review">
          <Steps>
            <li>Open <Link className="text-cyan-800 underline" href="/weekly">Weekly Review</Link> to see the meeting list and items needing attention.</li>
            <li>Use <strong>Show all deals</strong> to include other deals. Choose <strong>Present</strong> for a larger meeting view or <strong>Export</strong> to download slides.</li>
            <li>If available to you, choose <strong>Save snapshot</strong>, then use <strong>Compare to snapshot</strong> to see changes since that saved view.</li>
          </Steps>
          <Example file="weekly" alt="Weekly Review controls for presenting and exporting" />
        </Section>

        <Section id="rollup" title="Rollup">
          <Steps>
            <li>Open <Link className="text-cyan-800 underline" href="/rollup">Rollup</Link> to see deal counts by group and stage.</li>
            <li>Select a number to see those deals in Operations, or select a deal under <strong>Longest in current stage</strong> for its details.</li>
            <li>Review the contact outreach summary below the counts.</li>
          </Steps>
        </Section>

        {permissions.admin ? (
          <Section id="admin" title="Admin">
            <Steps>
              <li>Open <Link className="text-cyan-800 underline" href="/admin">Admin</Link> to manage users and their access.</li>
              <li>Review activity, usage, and data health to find issues or items needing attention.</li>
              <li>When adding a workbook, review the proposed changes before applying them; applying updates the shared deals for everyone.</li>
            </Steps>
          </Section>
        ) : null}

        <Section id="glossary" title="Glossary">
          <h3 className="font-semibold text-slate-950">Deal stages</h3>
          <ul className="space-y-2">
            {dealStages.map((stage) => (
              <li className="flex flex-wrap items-center gap-2" key={stage}>
                <Badge className={stageStyleFor(stage).badgeClass}>{stage}</Badge>
                <span>{stageDescriptions[stage]}</span>
              </li>
            ))}
          </ul>
          <dl className="space-y-3">
            <div><dt className="font-semibold">Vertical</dt><dd>A group of similar kinds of deals, such as Food.</dd></div>
            <div><dt className="font-semibold">Market and city</dt><dd>Market is the area a client is searching; city is where the property is. They can be different.</dd></div>
            <div><dt className="font-semibold">—</dt><dd>The value is unknown or not provided, not zero.</dd></div>
            <div><dt className="font-semibold"><span aria-hidden="true" className="mr-2 inline-block size-2 rounded-full bg-amber-500" />Assumption</dt><dd>An unconfirmed value that needs a person to check it.</dd></div>
            <div><dt className="font-semibold"><span aria-hidden="true" className="mr-2 inline-block size-2 rounded-full bg-violet-500" />AI-drafted</dt><dd>A computer-suggested value or note that needs a person to review it.</dd></div>
            <div><dt className="font-semibold">Confirmed</dt><dd>A permitted person has checked the value and marked it confirmed.</dd></div>
            <div><dt className="font-semibold">Needs review</dt><dd>A deal has information that needs a person&apos;s attention; check its details before relying on it.</dd></div>
            <div><dt className="font-semibold">Snapshot</dt><dd>A saved picture of the weekly list used to compare with a later view.</dd></div>
          </dl>
        </Section>

        <Section id="something-wrong" title="Something looks wrong?">
          <p>Contact your administrator or the person who gave you access. Include the deal address or name, the page you were using, what you expected, what happened, and the time. A screenshot can help; do not include passwords.</p>
        </Section>
      </main>
    </>
  );
}
