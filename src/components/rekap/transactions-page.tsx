import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Plus, ReceiptText, RotateCcw } from "lucide-react";
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
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApp } from "./app-provider";
import { ApiError, postAction } from "./api";
import type { Expense } from "./api";
import { ConfirmDialog } from "./confirm-dialog";
import { PageHeader } from "./page-header";
import { QueryError } from "./query-error";
import { TransactionDialog } from "./transaction-dialog";
import { TransactionList } from "./transaction-list";
import { queryKeys } from "./query-keys";
import {
  PAGE_SIZE,
  exportExpensesCsv,
  initialDate,
  monthStart,
  periodLabel,
  rupiah,
} from "./utils";
import { useSpendData } from "./use-spend-data";

function pageItems(current: number, total: number) {
  const items: Array<number | "ellipsis"> = [];
  for (let number = 1; number <= total; number += 1) {
    if (number === 1 || number === total || Math.abs(number - current) <= 1) {
      items.push(number);
    } else if (items[items.length - 1] !== "ellipsis") {
      items.push("ellipsis");
    }
  }
  return items;
}

export function TransactionsPage() {
  const { selectedProfile, selectedProfileId, handleUnauthorized } = useApp();
  const queryClient = useQueryClient();
  const [start, setStart] = useState(() => monthStart());
  const [end, setEnd] = useState(() => initialDate());
  const [categoryFilter, setCategoryFilter] = useState("");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);

  const { expenses, categories, loading, error, reload } = useSpendData({
    profileId: selectedProfileId,
    start,
    end,
    category: categoryFilter,
    onUnauthorized: handleUnauthorized,
  });

  const archived = Boolean(selectedProfile?.archived);
  const deleteMutation = useMutation({
    mutationFn: (expense: Expense) =>
      postAction(selectedProfileId, "deleteExpense", { expenseId: expense.id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.spendProfile(selectedProfileId),
      });
      setDeleteTarget(null);
    },
    onError: (cause) => {
      if (cause instanceof ApiError && cause.status === 401) handleUnauthorized();
    },
    retry: false,
  });

  useEffect(() => {
    setCategoryFilter("");
    setPage(1);
    setDialogOpen(false);
    setEditing(null);
    setDeleteTarget(null);
    deleteMutation.reset();
  }, [selectedProfileId]);

  useEffect(() => {
    setPage(1);
  }, [start, end, categoryFilter]);

  const pageCount = Math.max(1, Math.ceil(expenses.length / PAGE_SIZE));
  const pageStart = (page - 1) * PAGE_SIZE;
  const pageExpenses = useMemo(
    () => expenses.slice(pageStart, pageStart + PAGE_SIZE),
    [expenses, pageStart],
  );
  const items = pageItems(page, pageCount);
  const period = start && end ? periodLabel(start, end) : "";

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  function openExpense(expense: Expense | null) {
    setEditing(expense);
    setDialogOpen(true);
  }

  function requestDelete(expense: Expense) {
    deleteMutation.reset();
    setDeleteTarget(expense);
  }

  function resetFilters() {
    setStart(monthStart());
    setEnd(initialDate());
    setCategoryFilter("");
    setPage(1);
  }

  function closeDeleteDialog(open: boolean) {
    if (!open) {
      setDeleteTarget(null);
      deleteMutation.reset();
    }
  }

  return (
    <div className="pb-10">
      <PageHeader
        title="Transaksi"
        actions={
          <>
            <Button
              variant="outline"
              className="hidden sm:inline-flex"
              onClick={() => exportExpensesCsv(expenses)}
              disabled={!selectedProfile || loading || expenses.length === 0}
            >
              <Download />
              Ekspor CSV
            </Button>
            <Button onClick={() => openExpense(null)} disabled={!selectedProfile || archived}>
              <Plus />
              Tambah transaksi
            </Button>
          </>
        }
      />
      <div
        className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-4 py-6 md:px-8 md:py-8"
        aria-busy={loading}
      >
        <Card className="[--card-spacing:var(--space-4)]">
          <CardContent>
            <div
              className="flex flex-col gap-3 xl:flex-row xl:items-end"
              role="group"
              aria-label="Filter transaksi"
            >
              <Field className="w-full xl:w-[170px]">
                <FieldLabel
                  htmlFor="start"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Dari
                </FieldLabel>
                <Input
                  id="start"
                  type="date"
                  value={start}
                  max={end}
                  onChange={(event) => setStart(event.target.value)}
                />
              </Field>
              <Field className="w-full xl:w-[170px]">
                <FieldLabel
                  htmlFor="end"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Sampai
                </FieldLabel>
                <Input
                  id="end"
                  type="date"
                  value={end}
                  min={start}
                  onChange={(event) => setEnd(event.target.value)}
                />
              </Field>
              <Field className="w-full xl:w-[220px]">
                <FieldLabel
                  htmlFor="category-filter"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Kategori
                </FieldLabel>
                <Select
                  value={categoryFilter || "all"}
                  onValueChange={(value) => setCategoryFilter(value === "all" ? "" : value)}
                >
                  <SelectTrigger id="category-filter" className="w-full">
                    <SelectValue placeholder="Semua kategori" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="all">Semua kategori</SelectItem>
                      {categories.map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name}
                          {category.archived ? " (arsip)" : ""}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Button variant="ghost" className="w-full xl:w-auto" onClick={resetFilters}>
                <RotateCcw />
                Atur ulang
              </Button>
            </div>
          </CardContent>
        </Card>

        {error ? <QueryError message={error} onRetry={reload} /> : null}

        <Card className="[--card-spacing:var(--space-5)]">
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              Daftar transaksi
            </CardTitle>
            <CardDescription>
              {period
                ? `Periode ${period}.`
                : "Pilih rentang tanggal untuk melihat transaksi."}
            </CardDescription>
            <CardAction>
              <Badge variant="secondary" className="tabular-nums">
                {expenses.length} transaksi
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="px-0">
            <TransactionList
              expenses={pageExpenses}
              loading={loading}
              disabled={archived || deleteMutation.isPending}
              onEdit={openExpense}
              onDelete={requestDelete}
              empty={
                <Empty className="p-8">
                  <EmptyMedia variant="icon">
                    <ReceiptText />
                  </EmptyMedia>
                  <EmptyHeader>
                    <EmptyTitle>Belum ada transaksi.</EmptyTitle>
                    <EmptyDescription>
                      Tidak ada transaksi pada periode dan filter ini. Ubah filter atau tambahkan
                      transaksi baru.
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button onClick={() => openExpense(null)} disabled={!selectedProfile || archived}>
                      <Plus />
                      Tambah transaksi
                    </Button>
                  </EmptyContent>
                </Empty>
              }
            />
          </CardContent>
          {!loading && expenses.length > 0 ? (
            <CardFooter className="flex-col items-center justify-between gap-3 bg-transparent sm:flex-row">
              <p className="text-sm text-muted-foreground">
                Menampilkan {pageStart + 1}-{Math.min(pageStart + PAGE_SIZE, expenses.length)} dari{" "}
                {expenses.length} transaksi
              </p>
              <Pagination className="mx-0 w-auto">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      href="#transactions"
                      text="Sebelumnya"
                      aria-label="Halaman sebelumnya"
                      aria-disabled={page === 1}
                      className={page === 1 ? "pointer-events-none opacity-50" : ""}
                      onClick={(event) => {
                        event.preventDefault();
                        if (page > 1) setPage(page - 1);
                      }}
                    />
                  </PaginationItem>
                  {items.map((item, index) =>
                    item === "ellipsis" ? (
                      <PaginationItem key={`ellipsis-${index}`}>
                        <PaginationEllipsis />
                      </PaginationItem>
                    ) : (
                      <PaginationItem key={item}>
                        <PaginationLink
                          href="#transactions"
                          isActive={page === item}
                          aria-label={`Halaman ${item}`}
                          onClick={(event) => {
                            event.preventDefault();
                            setPage(item);
                          }}
                        >
                          {item}
                        </PaginationLink>
                      </PaginationItem>
                    ),
                  )}
                  <PaginationItem>
                    <PaginationNext
                      href="#transactions"
                      text="Berikutnya"
                      aria-label="Halaman berikutnya"
                      aria-disabled={page === pageCount}
                      className={page === pageCount ? "pointer-events-none opacity-50" : ""}
                      onClick={(event) => {
                        event.preventDefault();
                        if (page < pageCount) setPage(page + 1);
                      }}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </CardFooter>
          ) : null}
        </Card>
      </div>

      <TransactionDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditing(null);
        }}
        profileId={selectedProfileId}
        categories={categories}
        expense={editing}
        onUnauthorized={handleUnauthorized}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={closeDeleteDialog}
        title="Hapus transaksi?"
        description={
          deleteTarget
            ? `${deleteTarget.item} sebesar ${rupiah(deleteTarget.amount)} akan dihapus.`
            : ""
        }
        confirmLabel="Hapus"
        pending={deleteMutation.isPending}
        error={deleteMutation.error instanceof Error ? deleteMutation.error.message : ""}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget);
        }}
      />
    </div>
  );
}
