import { useEffect, useRef } from "react";
import type { FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
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
import { changePasswordRequest } from "./api";

export function PasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const credentials = useRef<{
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
  } | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const value = credentials.current;
      if (!value) throw new Error("Isi kata sandi dengan lengkap.");
      if (value.newPassword !== value.confirmPassword)
        throw new Error("Kata sandi baru tidak sama.");
      const result = await changePasswordRequest(value.currentPassword, value.newPassword);
      if (!result.ok) throw new Error(result.error ?? "Kata sandi tidak dapat diubah.");
    },
    onSuccess: () => {
      onOpenChange(false);
    },
    onSettled: () => {
      credentials.current = null;
    },
    retry: false,
    gcTime: 0,
  });

  useEffect(() => {
    return () => {
      credentials.current = null;
    };
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    credentials.current = {
      currentPassword: String(form.get("currentPassword") ?? ""),
      newPassword: String(form.get("newPassword") ?? ""),
      confirmPassword: String(form.get("confirmPassword") ?? ""),
    };
    mutation.mutate();
  }

  function handleOpenChange(value: boolean) {
    if (!value) {
      credentials.current = null;
      mutation.reset();
    }
    onOpenChange(value);
  }

  const error = mutation.error instanceof Error ? mutation.error.message : "";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ubah kata sandi</DialogTitle>
          <DialogDescription>
            Sesi lain akan keluar setelah kata sandi disimpan.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>Tidak dapat disimpan</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <form id="password-form" onSubmit={submit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="currentPassword">Kata sandi saat ini</FieldLabel>
              <Input
                id="currentPassword"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="newPassword">Kata sandi baru</FieldLabel>
              <Input
                id="newPassword"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="confirmPassword">Ulangi kata sandi baru</FieldLabel>
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
              />
            </Field>
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Batal
          </Button>
          <Button type="submit" form="password-form" disabled={mutation.isPending}>
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
