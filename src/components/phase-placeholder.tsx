import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function PhasePlaceholder({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="p-6 lg:p-10">
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="grid min-h-72 place-items-center p-10 text-center">
          <div className="max-w-md">
            <div className="mx-auto mb-5 grid size-12 place-items-center rounded-xl bg-cyan-50 text-cyan-700">
              <Icon className="size-6" />
            </div>
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {description}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
