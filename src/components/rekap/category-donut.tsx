import { Cell, Pie, PieChart } from "recharts";
import { cn } from "cn";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { chartClasses, chartColors, compactRupiah, percentage, rupiah } from "./utils";
import type { CategoryTotal } from "./utils";

const donutConfig = {
  amount: { label: "Pengeluaran", color: chartColors[0] },
} satisfies ChartConfig;

export function CategoryDonut({
  breakdown,
  total,
}: {
  breakdown: CategoryTotal[];
  total: number;
}) {
  if (!breakdown.length)
    return (
      <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
        Belum ada pengeluaran untuk ditampilkan.
      </div>
    );

  return (
    <>
      <div className="relative mx-auto w-full max-w-[240px]">
        <ChartContainer
          config={donutConfig}
          className="aspect-square w-full"
          role="img"
          aria-label="Diagram porsi pengeluaran per kategori"
        >
          <PieChart>
            <Pie
              data={breakdown}
              dataKey="amount"
              nameKey="name"
              innerRadius={62}
              outerRadius={92}
              paddingAngle={4}
              stroke="none"
              isAnimationActive={false}
            >
              {breakdown.map((entry, index) => (
                <Cell key={entry.name} fill={chartColors[index % chartColors.length]} />
              ))}
            </Pie>
            <ChartTooltip
              content={
                <ChartTooltipContent
                  nameKey="name"
                  hideLabel
                  formatter={(value) => rupiah(Number(value))}
                />
              }
            />
          </PieChart>
        </ChartContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <p className="text-xl font-semibold tabular-nums">{compactRupiah(total)}</p>
          <p className="text-xs text-muted-foreground">Total</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {breakdown.map((entry, index) => (
          <div
            key={entry.name}
            className="flex min-w-0 items-center justify-between gap-2 text-sm"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className={cn(
                  "size-2.5 shrink-0 rounded-full",
                  chartClasses[index % chartClasses.length],
                )}
              />
              <span className="truncate">{entry.name}</span>
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {percentage(entry.amount, total)}%
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
