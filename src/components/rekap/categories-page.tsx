import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, ChartPie, MoreHorizontal, Pencil, Plus, Shapes, Wallet } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useApp } from "./app-provider";
import { ApiError, postAction } from "./api";
import type { Category } from "./api";
import { CategoryDialog } from "./category-dialog";
import { ConfirmDialog } from "./confirm-dialog";
import { PageHeader } from "./page-header";
import { QueryError } from "./query-error";
import { queryKeys } from "./query-keys";
import { StatCard } from "./stat-card";
import type { CategoryTotal } from "./utils";
import {
  chartClasses,
  initialDate,
  monthStart,
  percentage,
  periodLabel,
  rupiah,
} from "./utils";
import { useSpendData } from "./use-spend-data";

export function CategoriesPage() {
  const { selectedProfile, selectedProfileId, handleUnauthorized } = useApp();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editCategory, setEditCategory] = useState<Category | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Category | null>(null);
  const start = monthStart();
  const end = initialDate();

  const { expenses, categories, loading, error, reload } = useSpendData({
    profileId: selectedProfileId,
    start,
    end,
    category: "",
    onUnauthorized: handleUnauthorized,
  });

  const archivedProfile = Boolean(selectedProfile?.archived);
  const archiveMutation = useMutation({
    mutationFn: (category: Category) =>
      postAction(selectedProfileId, "archiveCategory", { categoryId: category.id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.spendProfile(selectedProfileId),
      });
      setArchiveTarget(null);
    },
    onError: (cause) => {
      if (cause instanceof ApiError && cause.status === 401) handleUnauthorized();
    },
    retry: false,
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
  const categoryTotals = useMemo(
    () => new Map(breakdown.map((entry) => [entry.name, entry])),
    [breakdown],
  );
  const categoryColors = useMemo(
    () =>
      new Map(
        breakdown.map((entry, index) => [
          entry.name,
          chartClasses[index % chartClasses.length],
        ]),
      ),
    [breakdown],
  );
  const rows = useMemo(
    () =>
      [...categories].sort((first, second) => {
        if (first.archived !== second.archived)
          return Number(first.archived) - Number(second.archived);
        const firstAmount = categoryTotals.get(first.name)?.amount ?? 0;
        const secondAmount = categoryTotals.get(second.name)?.amount ?? 0;
        return secondAmount - firstAmount || first.name.localeCompare(second.name);
      }),
    [categories, categoryTotals],
  );
  const topCategory = breakdown[0];
  const activeCount = categories.filter((category) => !category.archived).length;
  const archivedCount = categories.length - activeCount;
  const initialLoading = loading && categories.length === 0;

  function openCategory(category: Category | null) {
    setEditCategory(category);
    setDialogOpen(true);
  }

  function requestArchive(category: Category) {
    archiveMutation.reset();
    setArchiveTarget(category);
  }

  function closeArchiveDialog(open: boolean) {
    if (!open) {
      setArchiveTarget(null);
      archiveMutation.reset();
    }
  }

  return (
    <div className="pb-10">
      <PageHeader
        title="Kategori"
        actions={
          <Button
            onClick={() => openCategory(null)}
            disabled={!selectedProfile || archivedProfile}
          >
            <Plus />
            Tambah kategori
          </Button>
        }
      />
      <div
        className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-4 py-6 md:px-8 md:py-8"
        aria-busy={loading}
      >
        <p className="text-sm text-muted-foreground">
          Pengeluaran per kategori pada {periodLabel(start, end).toLowerCase()}.
        </p>

        {error ? <QueryError message={error} onRetry={reload} /> : null}

        {initialLoading ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <Skeleton className="h-[132px] rounded-xl" />
            <Skeleton className="h-[132px] rounded-xl" />
            <Skeleton className="h-[132px] rounded-xl" />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Total bulan ini"
              value={rupiah(total)}
              detail={
                expenses.length
                  ? `${expenses.length} transaksi bulan ini`
                  : "Belum ada transaksi bulan ini"
              }
              icon={Wallet}
            />
            <StatCard
              label="Kategori aktif"
              value={String(activeCount)}
              detail={
                archivedCount
                  ? `${archivedCount} kategori diarsipkan`
                  : `${categories.length} kategori terdaftar`
              }
              icon={Shapes}
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

        <Card className="[--card-spacing:var(--space-5)]">
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              Kategori
            </CardTitle>
            <CardDescription>
              Kelola kategori dan lihat pengeluaran bulan ini.
            </CardDescription>
            <CardAction>
              <Badge variant="secondary" className="tabular-nums">
                {categories.length} kategori
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            {initialLoading ? (
              <div className="flex flex-col gap-3">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : rows.length ? (
              <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
                {rows.map((category) => {
                  const entry = categoryTotals.get(category.name);
                  const amount = entry?.amount ?? 0;
                  const share = percentage(amount, total);
                  const color =
                    categoryColors.get(category.name) ??
                    chartClasses[chartClasses.length - 1];
                  return (
                    <div key={category.id} className="flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            aria-hidden="true"
                            className={cn("size-2.5 shrink-0 rounded-full", color)}
                          />
                          <span
                            className={cn(
                              "truncate text-sm font-medium",
                              category.archived && "text-muted-foreground",
                            )}
                          >
                            {category.name}
                          </span>
                          {category.archived ? (
                            <Badge variant="outline">Arsip</Badge>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <span className="text-sm font-medium tabular-nums">
                            {rupiah(amount)}
                          </span>
                          {!category.archived && !archivedProfile ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  aria-label={`Tindakan untuk kategori ${category.name}`}
                                >
                                  <MoreHorizontal />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuGroup>
                                  <DropdownMenuItem
                                    onSelect={() => openCategory(category)}
                                  >
                                    <Pencil />
                                    Ubah nama
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    variant="destructive"
                                    onSelect={() => requestArchive(category)}
                                  >
                                    <Archive />
                                    Arsipkan
                                  </DropdownMenuItem>
                                </DropdownMenuGroup>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : null}
                        </div>
                      </div>
                      <Progress
                        value={share}
                        className="h-2"
                        indicatorClassName={color}
                      />
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{entry?.count ?? 0} transaksi</span>
                        <span className="tabular-nums">{share}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <Empty>
                <EmptyMedia variant="icon">
                  <Shapes />
                </EmptyMedia>
                <EmptyHeader>
                  <EmptyTitle>Belum ada kategori.</EmptyTitle>
                  <EmptyDescription>
                    Tambahkan kategori untuk merapikan transaksi profil ini.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    onClick={() => openCategory(null)}
                    disabled={!selectedProfile || archivedProfile}
                  >
                    <Plus />
                    Tambah kategori
                  </Button>
                </EmptyContent>
              </Empty>
            )}
          </CardContent>
        </Card>
      </div>

      <CategoryDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditCategory(null);
        }}
        profileId={selectedProfileId}
        category={editCategory}
        onUnauthorized={handleUnauthorized}
      />

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        onOpenChange={closeArchiveDialog}
        title="Arsipkan kategori?"
        description={
          archiveTarget
            ? `${archiveTarget.name} tidak lagi dapat dipilih untuk transaksi baru. Transaksi lama tetap tersimpan.`
            : ""
        }
        confirmLabel="Arsipkan"
        pending={archiveMutation.isPending}
        error={archiveMutation.error instanceof Error ? archiveMutation.error.message : ""}
        onConfirm={() => {
          if (archiveTarget) archiveMutation.mutate(archiveTarget);
        }}
      />
    </div>
  );
}
