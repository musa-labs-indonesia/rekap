import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { chartColors, compactRupiah, rupiah } from "./utils";
import type { TrendPoint } from "./utils";

const trendConfig = {
  amount: { label: "Pengeluaran", color: chartColors[0] },
} satisfies ChartConfig;

export function SpendingTrendChart({
  trend,
  trendMax,
  total,
}: {
  trend: TrendPoint[];
  trendMax: number;
  total: number;
}) {
  if (!trend.length || trendMax === 0)
    return (
      <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
        Belum ada pengeluaran pada periode ini.
      </div>
    );

  return (
    <ChartContainer
      config={trendConfig}
      className="h-[300px] w-full"
      role="img"
      aria-label={`Grafik tren pengeluaran, total ${rupiah(total)}`}
    >
      <BarChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
        <defs>
          <pattern
            id="rekap-bar-hatch"
            width="7"
            height="7"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(35)"
          >
            <rect width="7" height="7" fill="var(--muted)" />
            <line x1="0" y1="0" x2="0" y2="7" stroke="var(--border)" strokeWidth="2" />
          </pattern>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 5" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={10}
          minTickGap={12}
          interval="preserveStartEnd"
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={72}
          tickFormatter={compactRupiah}
        />
        <ChartTooltip
          content={<ChartTooltipContent formatter={(value) => rupiah(Number(value))} />}
        />
        <Bar dataKey="amount" radius={8} maxBarSize={36} isAnimationActive={false}>
          {trend.map((point) => (
            <Cell
              key={point.key}
              fill={point.amount === trendMax ? chartColors[0] : "url(#rekap-bar-hatch)"}
            />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
