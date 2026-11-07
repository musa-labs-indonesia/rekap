import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError, postAction } from "./api";
import type { Category, Expense } from "./api";
import { queryKeys } from "./query-keys";
import { dateString, initialDate } from "./utils";

export function TransactionDialog({
  open,
  onOpenChange,
  profileId,
  categories,
  expense,
  onUnauthorized,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profileId: string;
  categories: Category[];
  expense: Expense | null;
  onUnauthorized: () => void;
}) {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState("");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: (values: { item: string; amount: string; date: string; categoryId: string }) =>
      postAction(profileId, "saveExpense", { expenseId: expense?.id, ...values }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.spendProfile(profileId) });
      onOpenChange(false);
    },
    onError: (cause) => {
      if (cause instanceof ApiError && cause.status === 401) onUnauthorized();
    },
    retry: false,
  });

  useEffect(() => {
    if (!open) return;
    setCategory(expense?.category_id ?? categories.find((item) => !item.archived)?.id ?? "");
    setError("");
    mutation.reset();
  }, [open, expense]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!category) {
      setError("Pilih kategori transaksi.");
      return;
    }
    const form = new FormData(event.currentTarget);
    mutation.mutate({
      item: String(form.get("item") ?? ""),
      amount: String(form.get("amount") ?? ""),
      date: String(form.get("date") ?? ""),
      categoryId: category,
    });
  }

  function handleOpenChange(value: boolean) {
    if (!value) {
      setError("");
      mutation.reset();
    }
    onOpenChange(value);
  }

  const shownError = error || (mutation.error instanceof Error ? mutation.error.message : "");

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{expense ? "Ubah transaksi" : "Tambah transaksi"}</DialogTitle>
          <DialogDescription>
            {expense
              ? "Ubah rincian transaksi pada periode ini."
              : "Catat pengeluaran baru pada profil aktif."}
          </DialogDescription>
        </DialogHeader>
        {shownError ? (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>Tidak dapat disimpan</AlertTitle>
            <AlertDescription>{shownError}</AlertDescription>
          </Alert>
        ) : null}
        <form id="transaction-form" onSubmit={submit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="item">Item</FieldLabel>
              <Input id="item" name="item" defaultValue={expense?.item} required />
            </Field>
            <Field>
              <FieldLabel htmlFor="amount">Jumlah (rupiah)</FieldLabel>
              <Input
                id="amount"
                name="amount"
                type="number"
                min={1}
                step={1}
                defaultValue={expense?.amount}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="expense-category">Kategori</FieldLabel>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger
                  id="expense-category"
                  className="w-full"
                  aria-invalid={!category}
                >
                  <SelectValue placeholder="Pilih kategori" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {categories
                      .filter(
                        (item) => !item.archived || item.id === expense?.category_id,
                      )
                      .map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="date">Tanggal</FieldLabel>
              <Input
                id="date"
                name="date"
                type="date"
                defaultValue={expense ? dateString(expense.occurred_at) : initialDate()}
                required
              />
            </Field>
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Batal
          </Button>
          <Button type="submit" form="transaction-form" disabled={mutation.isPending}>
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
