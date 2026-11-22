import { safeNextPath } from "@/lib/auth-redirect";
import { CompleteAuth } from "./complete-auth";

export default async function CompletePage({ searchParams }: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <CompleteAuth next={safeNextPath(next ?? null)} />;
}
