import { useEffect, useRef } from "react";
import type { FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { BookOpen, CircleAlert, Download, MessageCircle, Shapes } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { loginRequest } from "./api";
import { BrandMark } from "./brand-mark";

export function LoginScreen({ onLoggedIn }: { onLoggedIn: () => Promise<void> }) {
  const credentials = useRef<{ username: string; password: string } | null>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      const value = credentials.current;
      if (!value) throw new Error("Isi nama pengguna dan kata sandi.");
      let ok = false;
      try {
        ok = await loginRequest(value.username, value.password);
      } catch {
        throw new Error("Tidak dapat masuk. Periksa koneksi Anda.");
      }
      if (!ok) throw new Error("Nama pengguna atau kata sandi salah.");
    },
    onSuccess: async () => {
      await onLoggedIn();
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
      username: String(form.get("username") ?? ""),
      password: String(form.get("password") ?? ""),
    };
    mutation.mutate();
  }

  const error = mutation.error instanceof Error ? mutation.error.message : "";

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-4 md:p-8">
      <div className="grid w-full max-w-md overflow-hidden rounded-3xl border bg-card shadow-[0_1px_2px_var(--shadow-soft)] lg:max-w-4xl lg:grid-cols-[1.05fr_1fr]">
        <aside className="hidden flex-col justify-between bg-secondary p-10 lg:flex">
          <BrandMark />
          <div className="max-w-sm">
            <p className="text-3xl font-semibold leading-tight">
              Pengeluaran rapi,
              <br />
              tanpa spreadsheet.
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              Catat dari Telegram. Tinjau dan rapikan di sini.
            </p>
            <ul className="mt-8 flex flex-col gap-4 text-sm">
              <li className="flex gap-3">
                <MessageCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
                Catat lewat chat Telegram.
              </li>
              <li className="flex gap-3">
                <Shapes aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
                Rekap per kategori.
              </li>
              <li className="flex gap-3">
                <Download aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
                Ekspor CSV untuk arsip.
              </li>
            </ul>
          </div>
          <p className="text-xs text-muted-foreground">
            Satu profil terhubung ke satu chat Telegram.
          </p>
        </aside>
        <div className="flex flex-col justify-center p-6 sm:p-10">
          <div className="mb-8 lg:hidden">
            <BrandMark />
          </div>
          <h1 className="text-2xl font-semibold">Selamat datang kembali.</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Masuk untuk melihat catatan pengeluaran Anda.
          </p>
          <form className="mt-8" onSubmit={submit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="username">Nama pengguna</FieldLabel>
                <Input id="username" name="username" autoComplete="username" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Kata sandi</FieldLabel>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </Field>
              <Button type="submit" size="lg" className="w-full" disabled={mutation.isPending}>
                Masuk
              </Button>
            </FieldGroup>
          </form>
          {error ? (
            <Alert variant="destructive" className="mt-4">
              <CircleAlert />
              <AlertTitle>Masuk gagal</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <p className="mt-6 text-sm text-muted-foreground">
            Lupa kata sandi? Gunakan perintah pemulihan di Telegram.
          </p>
          <div className="my-6 h-px bg-border" />
          <a
            href="/docs"
            className="inline-flex w-fit items-center gap-2 text-sm font-medium text-foreground underline-offset-4 hover:text-accent hover:underline"
          >
            <BookOpen aria-hidden="true" className="size-4" />
            Panduan Rekap
          </a>
        </div>
      </div>
    </main>
  );
}
