import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

export function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  progress,
}: {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  progress?: { value: number; className: string };
}) {
  return (
    <Card className="[--card-spacing:var(--space-4)]">
      <CardHeader>
        <CardTitle>
          <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Icon aria-hidden="true" className="size-4" />
            {label}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="truncate text-3xl font-semibold tabular-nums">{value}</p>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
        {progress ? (
          <Progress
            value={progress.value}
            className="mt-1 h-2"
            indicatorClassName={progress.className}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
