import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  ChartPie,
  Plus,
  ReceiptText,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useApp } from "./app-provider";
import { CategoryDonut } from "./category-donut";
import { MonthFilter } from "./month-filter";
import { PageHeader } from "./page-header";
import { QueryError } from "./query-error";
import { SpendingTrendChart } from "./spending-trend-chart";
import { StatCard } from "./stat-card";
import { TransactionList } from "./transaction-list";
import type { CategoryTotal } from "./utils";
import {
  buildTrend,
  initialDate,
  monthRange,
  percentage,
  periodLabel,
  rupiah,
} from "./utils";
import { useSpendData } from "./use-spend-data";

export function DashboardPage() {
  const { selectedProfile, selectedProfileId, handleUnauthorized } = useApp();
  const [selectedMonth, selectMonth] = useState(() => initialDate().slice(0, 7));
  const { start, end } = monthRange(selectedMonth);
  const { expenses, categories, loading, error, reload } = useSpendData({
    profileId: selectedProfileId,
    start,
    end,
    category: "",
    onUnauthorized: handleUnauthorized,
  });

  const total = useMemo(
    () => expenses.reduce((sum, expense) => sum + expense.amount, 0),
    [expenses],
  );
  const breakdown = useMemo(() => {
    const sums = new Map<string, CategoryTotal>();
    for (const expense of expenses) {
      const entry = sums.get(expense.category) ?? {
        name: expense.category,
        amount: 0,
        count: 0,
      };
      entry.amount += expense.amount;
      entry.count += 1;
      sums.set(expense.category, entry);
    }
    return [...sums.values()].sort((first, second) => second.amount - first.amount);
  }, [expenses]);
  const trend = useMemo(() => buildTrend(expenses, start, end), [expenses, start, end]);
  const trendMax = useMemo(
    () => trend.reduce((maximum, point) => Math.max(maximum, point.amount), 0),
    [trend],
  );
  const latest = useMemo(() => expenses.slice(0, 10), [expenses]);
  const largest = useMemo(
    () =>
      expenses.reduce<(typeof expenses)[number] | null>(
        (current, expense) => (!current || expense.amount > current.amount ? expense : current),
        null,
      ),
    [expenses],
  );
  const topCategory = breakdown[0];
  const average = expenses.length ? Math.round(total / expenses.length) : 0;
  const period = periodLabel(start, end);
  const initialLoading = loading && expenses.length === 0;

  return (
    <div className="pb-10">
      <PageHeader
        title="Dashboard"
        actions={
          <Button variant="outline" asChild>
            <Link to="/transactions">
              Lihat transaksi
              <ArrowRight />
            </Link>
          </Button>
        }
      />
      <div
        className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-4 py-6 md:px-8 md:py-8"
        aria-busy={loading}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Ringkasan {period} untuk {selectedProfile?.name ?? "profil aktif"}.
          </p>
          <MonthFilter selectedMonth={selectedMonth} selectMonth={selectMonth} />
        </div>

        {error ? <QueryError message={error} onRetry={reload} /> : null}

        {initialLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Skeleton className="h-[132px] rounded-xl" />
            <Skeleton className="h-[132px] rounded-xl" />
            <Skeleton className="h-[132px] rounded-xl" />
            <Skeleton className="h-[132px] rounded-xl" />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Total pengeluaran"
              value={rupiah(total)}
              detail={
                expenses.length
                  ? `${expenses.length} transaksi pada periode ini`
                  : "Belum ada transaksi pada periode ini"
              }
              icon={Wallet}
            />
            <StatCard
              label="Rata-rata transaksi"
              value={rupiah(average)}
              detail={
                expenses.length ? "Dihitung dari transaksi periode ini" : "Belum ada transaksi"
              }
              icon={TrendingUp}
            />
            <StatCard
              label="Transaksi terbesar"
              value={largest ? rupiah(largest.amount) : "Rp0"}
              detail={largest ? largest.item : "Belum ada transaksi"}
              icon={ReceiptText}
            />
            <StatCard
              label="Kategori teratas"
              value={topCategory ? topCategory.name : "Belum ada"}
              detail={
                topCategory
                  ? `${rupiah(topCategory.amount)} · ${percentage(topCategory.amount, total)}%`
                  : "Belum ada pengeluaran"
              }
              icon={ChartPie}
              progress={
                topCategory
                  ? { value: percentage(topCategory.amount, total), className: "bg-chart-1" }
                  : undefined
              }
            />
          </div>
        )}

        {initialLoading ? (
          <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
            <Skeleton className="h-[380px] rounded-xl" />
            <Skeleton className="h-[380px] rounded-xl" />
          </div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
            <Card className="[--card-spacing:var(--space-5)]">
              <CardHeader>
                <CardTitle role="heading" aria-level={2}>
                  Tren pengeluaran
                </CardTitle>
                <CardDescription>Pengeluaran per hari pada periode yang dipilih.</CardDescription>
                <CardAction>
                  <Badge variant="outline" className="hidden sm:inline-flex">
                    {period}
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent>
                <SpendingTrendChart trend={trend} trendMax={trendMax} total={total} />
              </CardContent>
            </Card>
            <Card className="[--card-spacing:var(--space-5)]">
              <CardHeader>
                <CardTitle role="heading" aria-level={2}>
                  Rincian kategori
                </CardTitle>
                <CardDescription>Porsi setiap kategori dari total pengeluaran.</CardDescription>
                <CardAction>
                  <Badge variant="outline">
                    {categories.filter((category) => !category.archived).length} kategori aktif
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent>
                <CategoryDonut breakdown={breakdown} categories={categories} total={total} />
              </CardContent>
            </Card>
          </div>
        )}

        <Card className="[--card-spacing:var(--space-5)]">
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              Transaksi terbaru
            </CardTitle>
            <CardDescription>10 transaksi terakhir pada periode yang dipilih.</CardDescription>
            <CardAction>
              <Badge variant="secondary" className="tabular-nums">
                {expenses.length} transaksi
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="px-0">
            <TransactionList
              expenses={latest}
              loading={initialLoading}
              empty={
                <Empty className="p-8">
                  <EmptyMedia variant="icon">
                    <ReceiptText />
                  </EmptyMedia>
                  <EmptyHeader>
                    <EmptyTitle>Belum ada transaksi.</EmptyTitle>
                    <EmptyDescription>
                      Catat pengeluaran di Telegram atau tambahkan dari halaman Transaksi.
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button asChild>
                      <Link to="/transactions">
                        <Plus />
                        Tambah transaksi
                      </Link>
                    </Button>
                  </EmptyContent>
                </Empty>
              }
            />
          </CardContent>
          <CardFooter className="border-t bg-transparent">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/transactions">
                Lihat semua transaksi
                <ArrowRight />
              </Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
