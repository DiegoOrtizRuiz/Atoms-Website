import { HelpLink } from "@/components/help-link";

export function PageHeader({
  title,
  description,
  children,
  helpSection,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
  helpSection: string;
}) {
  return (
    <header className="flex min-h-28 flex-col justify-between gap-5 border-b border-slate-200 bg-white px-6 py-6 sm:flex-row sm:items-center lg:px-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
          {title}
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-500">
          {description}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {children}
        <HelpLink section={helpSection} />
      </div>
    </header>
  );
}
