import Link from "next/link";
import { CircleHelp } from "lucide-react";

export function HelpLink({ section }: { section: string }) {
  return (
    <Link
      aria-label={`Help for ${section.replaceAll("-", " ")}`}
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-700"
      href={`/help#${section}`}
      title="Open help"
    >
      <CircleHelp aria-hidden="true" className="size-5" />
    </Link>
  );
}
