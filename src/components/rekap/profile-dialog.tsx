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
import { useApp } from "./app-provider";
import { ApiError, postAction } from "./api";
import { queryKeys } from "./query-keys";

export function ProfileDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { selectProfile, handleUnauthorized } = useApp();
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: (values: { name: string; chatId: string }) =>
      postAction("", "createProfile", values),
    onSuccess: (result) => {
      if (result.id) selectProfile(result.id);
      void queryClient.invalidateQueries({ queryKey: queryKeys.profiles });
      onOpenChange(false);
    },
    onError: (cause) => {
      if (cause instanceof ApiError && cause.status === 401) handleUnauthorized();
    },
    retry: false,
  });

  useEffect(() => {
    if (!open) return;
    setError("");
    mutation.reset();
  }, [open]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const chatId = String(form.get("chatId") ?? "").trim();
    if (!name || !/^-?\d+$/.test(chatId)) {
      setError("Isi nama dan ID chat Telegram yang valid.");
      return;
    }
    mutation.mutate({ name, chatId });
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
          <DialogTitle>Profil baru</DialogTitle>
          <DialogDescription>
            Setiap profil terhubung ke satu chat Telegram.
          </DialogDescription>
        </DialogHeader>
        {shownError ? (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>Tidak dapat disimpan</AlertTitle>
            <AlertDescription>{shownError}</AlertDescription>
          </Alert>
        ) : null}
        <form id="profile-form" onSubmit={submit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="profile-name">Nama profil</FieldLabel>
              <Input id="profile-name" name="name" required />
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-chat-id">ID chat Telegram</FieldLabel>
              <Input
                id="profile-chat-id"
                name="chatId"
                inputMode="numeric"
                autoComplete="off"
                required
              />
            </Field>
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Batal
          </Button>
          <Button type="submit" form="profile-form" disabled={mutation.isPending}>
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
