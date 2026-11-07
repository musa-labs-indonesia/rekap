import { Cell, Pie, PieChart } from "recharts";
import { cn } from "cn";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { chartClasses, chartColors, compactRupiah, percentage, rupiah } from "./utils";
import type { Category } from "./api";
import type { CategoryTotal } from "./utils";

const donutConfig = {
  amount: { label: "Pengeluaran", color: chartColors[0] },
} satisfies ChartConfig;

export function CategoryDonut({
  breakdown,
  categories,
  total,
}: {
  breakdown: CategoryTotal[];
  categories: Category[];
  total: number;
}) {
  const entries = [
    ...breakdown,
    ...categories
      .filter((category) => !category.archived && !breakdown.some((entry) => entry.name === category.name))
      .map((category) => ({ name: category.name, amount: 0, count: 0 })),
  ];

  return (
    <>
      {breakdown.length ? (
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
      ) : (
        <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
          Belum ada pengeluaran untuk ditampilkan.
        </div>
      )}
      <div className="mt-4 flex flex-col gap-3">
        {entries.map((entry, index) => (
          <div
            key={entry.name}
            className="flex min-w-0 items-start justify-between gap-3 text-sm"
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
            <span className="flex shrink-0 flex-col items-end tabular-nums">
              <span>{rupiah(entry.amount)} · {percentage(entry.amount, total)}%</span>
              <span className="text-xs text-muted-foreground">{entry.count} transaksi</span>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
