import type { ReactNode } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Expense } from "./api";
import { displayDate, reporterLabel, rupiah } from "./utils";

function RowActions({
  expense,
  disabled,
  onEdit,
  onDelete,
}: {
  expense: Expense;
  disabled?: boolean;
  onEdit?: (expense: Expense) => void;
  onDelete?: (expense: Expense) => void;
}) {
  if (!onEdit && !onDelete) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Tindakan untuk ${expense.item}`}
          disabled={disabled}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          {onEdit ? (
            <DropdownMenuItem onSelect={() => onEdit(expense)}>
              <Pencil />
              Ubah
            </DropdownMenuItem>
          ) : null}
          {onDelete ? (
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete(expense)}>
              <Trash2 />
              Hapus
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TransactionList({
  expenses,
  loading,
  empty,
  onEdit,
  onDelete,
  disabled,
}: {
  expenses: Expense[];
  loading: boolean;
  empty: ReactNode;
  onEdit?: (expense: Expense) => void;
  onDelete?: (expense: Expense) => void;
  disabled?: boolean;
}) {
  const hasActions = Boolean(onEdit || onDelete);

  if (loading)
    return (
      <div className="flex flex-col gap-2 px-5">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );

  if (expenses.length === 0) return <>{empty}</>;

  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-5">Item</TableHead>
              <TableHead>Kategori</TableHead>
              <TableHead>Pelapor</TableHead>
              <TableHead>Tanggal</TableHead>
              <TableHead className="text-right">Jumlah</TableHead>
              {hasActions ? (
                <TableHead className="pr-5 text-right">
                  <span className="sr-only">Tindakan</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {expenses.map((expense) => (
              <TableRow key={expense.id}>
                <TableCell className="max-w-[280px] pl-5 font-medium whitespace-normal">
                  {expense.item}
                </TableCell>
                <TableCell className="text-muted-foreground">{expense.category}</TableCell>
                <TableCell
                  className="text-muted-foreground"
                  title={
                    expense.reporter_username ? `@${expense.reporter_username}` : undefined
                  }
                >
                  {reporterLabel(expense) || "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {displayDate(expense.occurred_at)}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {rupiah(expense.amount)}
                </TableCell>
                {hasActions ? (
                  <TableCell className="pr-5 text-right">
                    <div className="flex justify-end">
                      <RowActions
                        expense={expense}
                        disabled={disabled}
                        onEdit={onEdit}
                        onDelete={onDelete}
                      />
                    </div>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="divide-y md:hidden" data-slot="mobile-transactions">
        {expenses.map((expense) => (
          <div
            key={expense.id}
            className="flex items-start justify-between gap-3 px-5 py-4"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{expense.item}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{expense.category}</span>
                {reporterLabel(expense) ? <span>{reporterLabel(expense)}</span> : null}
                <span>{displayDate(expense.occurred_at)}</span>
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <p className="text-sm font-medium tabular-nums">{rupiah(expense.amount)}</p>
              {hasActions ? (
                <RowActions
                  expense={expense}
                  disabled={disabled}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
