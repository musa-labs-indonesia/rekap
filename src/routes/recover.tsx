import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, CircleCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { BrandMark } from "@/components/rekap/brand-mark";
import { recoverRequest } from "@/components/rekap/api";

export const Route = createFileRoute("/recover")({
  head: () => ({
    meta: [{ title: "Atur ulang kata sandi — Rekap" }],
  }),
  component: Recover,
});

function Recover() {
  const queryClient = useQueryClient();
  const credentials = useRef<{ token: string; password: string } | null>(null);
  const [formError, setFormError] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const value = credentials.current;
      if (!value) throw new Error("Isi kata sandi baru.");
      let ok = false;
      try {
        ok = await recoverRequest(value.token, value.password);
      } catch {
        throw new Error("Tidak dapat mengubah kata sandi. Periksa koneksi Anda.");
      }
      if (!ok)
        throw new Error(
          "Tautan tidak valid atau sudah kedaluwarsa. Kata sandi harus 12 sampai 128 karakter.",
        );
    },
    onSuccess: () => {
      queryClient.clear();
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("rekap.profile");
        window.history.replaceState(null, "", "/recover");
      }
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
    setFormError("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");
    if (password !== confirm) {
      setFormError("Kata sandi tidak sama.");
      return;
    }
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    credentials.current = { token, password };
    mutation.mutate();
  }

  const shownError = formError || (mutation.error instanceof Error ? mutation.error.message : "");

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-4 md:p-8">
      <div className="w-full max-w-md">
        <div className="mb-8">
          <BrandMark />
        </div>
        <Card className="[--card-spacing:var(--space-6)]">
          <CardHeader>
            <h1 className="text-2xl font-semibold">Atur ulang kata sandi.</h1>
            <CardDescription>Gunakan kata sandi baru yang sulit ditebak.</CardDescription>
          </CardHeader>
          <CardContent>
            {mutation.isSuccess ? (
              <div className="flex flex-col gap-4">
                <Alert>
                  <CircleCheck />
                  <AlertTitle>Kata sandi berhasil diubah</AlertTitle>
                  <AlertDescription>
                    Silakan masuk dengan kata sandi baru Anda.
                  </AlertDescription>
                </Alert>
                <Button asChild size="lg" className="w-full">
                  <Link to="/">Kembali ke masuk</Link>
                </Button>
              </div>
            ) : (
              <form onSubmit={submit}>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="password">Kata sandi baru</FieldLabel>
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      autoComplete="new-password"
                      minLength={12}
                      maxLength={128}
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="confirm">Ulangi kata sandi</FieldLabel>
                    <Input
                      id="confirm"
                      name="confirm"
                      type="password"
                      autoComplete="new-password"
                      minLength={12}
                      maxLength={128}
                      required
                    />
                  </Field>
                  {shownError ? (
                    <Alert variant="destructive">
                      <CircleAlert />
                      <AlertTitle>Tidak dapat disimpan</AlertTitle>
                      <AlertDescription>{shownError}</AlertDescription>
                    </Alert>
                  ) : null}
                  <Button
                    type="submit"
                    size="lg"
                    className="w-full"
                    disabled={mutation.isPending}
                  >
                    Simpan kata sandi
                  </Button>
                  <Button variant="ghost" className="w-full" asChild>
                    <Link to="/">Kembali ke masuk</Link>
                  </Button>
                </FieldGroup>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
