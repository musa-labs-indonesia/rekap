import type { Expense } from "./api";

export type CategoryTotal = { name: string; amount: number; count: number };
export type TrendPoint = { key: string; label: string; amount: number };

export const PAGE_SIZE = 10;

export const chartColors = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

export const chartClasses = [
  "bg-chart-1",
  "bg-chart-2",
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-5",
] as const;

export const rupiah = (amount: number) =>
  `Rp${new Intl.NumberFormat("id-ID").format(amount)}`;

export const compactRupiah = (amount: number) =>
  `Rp${new Intl.NumberFormat("id-ID", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(amount)}`;

export const dateString = (value: number | Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);

export const displayDate = (value: number) =>
  new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(value);

export const initialDate = () => dateString(new Date());

export const monthStart = () => `${initialDate().slice(0, 7)}-01`;

export function monthRange(month: string, today = initialDate()) {
  const start = `${month}-01`;
  const lastDay = new Date(`${start}T00:00:00Z`);
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
  const end = lastDay.toISOString().slice(0, 10);
  return { start, end: end > today ? today : end };
}

export const percentage = (amount: number, total: number) =>
  total > 0 ? Math.round((amount / total) * 100) : 0;

const dayMonth = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  day: "numeric",
  month: "short",
});

const yearLabel = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  year: "numeric",
});

export const periodLabel = (start: string, end: string) => {
  if (!start || !end) return "periode belum dipilih";
  const startDate = new Date(`${start}T00:00:00+07:00`);
  const endDate = new Date(`${end}T00:00:00+07:00`);
  if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime()))
    return "periode tidak valid";
  const startYear = yearLabel.format(startDate);
  const endYear = yearLabel.format(endDate);
  if (start === end) return `${dayMonth.format(startDate)} ${startYear}`;
  if (startYear === endYear)
    return `${dayMonth.format(startDate)} - ${dayMonth.format(endDate)} ${endYear}`;
  return `${dayMonth.format(startDate)} ${startYear} - ${dayMonth.format(endDate)} ${endYear}`;
};

function dayRange(start: string, end: string): string[] {
  const first = Date.parse(`${start}T00:00:00Z`);
  const last = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(first) || !Number.isFinite(last) || first > last) return [];
  const days: string[] = [];
  for (let time = first; time <= last; time += 86400000)
    days.push(new Date(time).toISOString().slice(0, 10));
  return days;
}

export function buildTrend(expenses: Expense[], start: string, end: string): TrendPoint[] {
  const sums = new Map<string, number>();
  for (const expense of expenses) {
    const key = dateString(expense.occurred_at);
    sums.set(key, (sums.get(key) ?? 0) + expense.amount);
  }
  const days = dayRange(start, end);
  if (days.length > 0 && days.length <= 45)
    return days.map((day) => ({
      key: day,
      label: String(Number(day.slice(8, 10))),
      amount: sums.get(day) ?? 0,
    }));
  const months = new Map<string, number>();
  for (const [day, amount] of sums) {
    const key = day.slice(0, 7);
    months.set(key, (months.get(key) ?? 0) + amount);
  }
  return [...months.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([key, amount]) => ({
      key,
      label: new Intl.DateTimeFormat("id-ID", {
        timeZone: "Asia/Jakarta",
        month: "short",
      }).format(new Date(`${key}-01T00:00:00+07:00`)),
      amount,
    }));
}

export function exportExpensesCsv(expenses: Expense[]) {
  const safe = (value: string | number) =>
    `"${String(value)
      .replace(/^[=+\-@\t\r]/, "'$&")
      .replaceAll('"', '""')}"`;
  const rows = [
    ["Tanggal", "Item", "Kategori", "Jumlah"],
    ...expenses.map((expense) => [
      dateString(expense.occurred_at),
      expense.item,
      expense.category,
      expense.amount,
    ]),
  ];
  const blob = new Blob(["\ufeff" + rows.map((row) => row.map(safe).join(",")).join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "rekap.csv";
  link.click();
  URL.revokeObjectURL(url);
}
