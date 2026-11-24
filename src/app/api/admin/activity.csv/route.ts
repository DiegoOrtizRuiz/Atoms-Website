import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const eventValues = ["login", "page_view", "deal_edit", "admin_change", "snapshot", "csv_export", "password_set", "config_change", "import", "ai_review"] as const;
const uuid = z.uuid();

function csvCell(value: unknown) {
  let text = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
  if (/^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET(request: Request) {
  const user = await requireUser();
  if (user.role !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const userFilter = params.get("user_id");
  const eventFilter = params.get("event");
  const from = params.get("from");
  const to = params.get("to");
  if (userFilter && !uuid.safeParse(userFilter).success) {
    return new Response("Invalid user filter", { status: 400 });
  }
  if (eventFilter && !eventValues.some((event) => event === eventFilter)) {
    return new Response("Invalid event filter", { status: 400 });
  }
  if ((from && !z.iso.date().safeParse(from).success) || (to && !z.iso.date().safeParse(to).success)) {
    return new Response("Invalid date filter", { status: 400 });
  }

  const supabase = await createClient();
  const { error: logError } = await supabase.from("activity_log").insert({
    user_id: user.id,
    event: "csv_export",
    path: "/api/admin/activity.csv",
    detail: {
      user_id: userFilter,
      event: eventFilter,
      from,
      to,
    },
  });
  if (logError) throw new Error(`CSV export could not be logged: ${logError.message}`);

  let query = supabase
    .from("activity_log")
    .select("id, user_id, event, path, detail, created_at")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (userFilter) query = query.eq("user_id", userFilter);
  if (eventFilter) query = query.eq("event", eventFilter);
  if (from) query = query.gte("created_at", `${from}T00:00:00.000Z`);
  if (to) {
    const end = new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86400000).toISOString();
    query = query.lt("created_at", end);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode("\uFEFFcreated_at,user_id,user_name,event,path,detail\r\n"));
        for (let offset = 0; ; offset += 500) {
          const { data, error } = await query.range(offset, offset + 499);
          if (error) throw new Error(error.message);
          if (!data.length) break;
          const ids = [...new Set(data.map((row) => row.user_id))];
          const { data: names, error: namesError } = await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", ids);
          if (namesError) throw new Error(namesError.message);
          const nameById = new Map(names.map((profile) => [profile.id, profile.full_name]));
          const lines = data.map((row) =>
            [
              row.created_at,
              row.user_id,
              nameById.get(row.user_id) ?? "",
              row.event,
              row.path,
              row.detail,
            ].map(csvCell).join(","),
          );
          controller.enqueue(encoder.encode(`${lines.join("\r\n")}\r\n`));
          if (data.length < 500) break;
        }
        controller.close();
      } catch (error) {
        console.error("Unable to stream the activity CSV.", error);
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="activity-log.csv"',
      "Cache-Control": "no-store",
    },
  });
}
