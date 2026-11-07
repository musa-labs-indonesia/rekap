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
import { ApiError, postAction } from "./api";
import type { Category } from "./api";
import { queryKeys } from "./query-keys";

export function CategoryDialog({
  open,
  onOpenChange,
  profileId,
  category,
  onUnauthorized,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profileId: string;
  category?: Category | null;
  onUnauthorized: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: (name: string) =>
      postAction(profileId, category ? "renameCategory" : "createCategory", {
        ...(category ? { categoryId: category.id } : {}),
        name,
      }),
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
    setError("");
    mutation.reset();
  }, [open, category]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    mutation.mutate(String(form.get("name") ?? ""));
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
          <DialogTitle>{category ? "Ubah nama kategori" : "Kategori baru"}</DialogTitle>
          <DialogDescription>
            {category
              ? "Nama baru juga muncul pada transaksi lama."
              : "Kategori dapat dipilih untuk transaksi baru. Nama yang pernah dihapus akan diaktifkan kembali."}
          </DialogDescription>
        </DialogHeader>
        {shownError ? (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>Tidak dapat disimpan</AlertTitle>
            <AlertDescription>{shownError}</AlertDescription>
          </Alert>
        ) : null}
        <form id="category-form" key={category?.id ?? "new"} onSubmit={submit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="category-name">Nama kategori</FieldLabel>
              <Input
                id="category-name"
                name="name"
                defaultValue={category?.name}
                required
              />
            </Field>
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Batal
          </Button>
          <Button type="submit" form="category-form" disabled={mutation.isPending}>
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
