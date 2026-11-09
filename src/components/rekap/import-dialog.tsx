import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import Papa from "papaparse";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { categoryKey } from "@/server/category";
import { ApiError, postAction } from "./api";
import type { Category } from "./api";
import { queryKeys } from "./query-keys";
import { rupiah } from "./utils";

type ImportRow = { id: string; date: string; item: string; category: string; amount: number };

function parseFile(source: string): ImportRow[] {
  const parsed = Papa.parse<string[]>(source, { delimiter: ",", skipEmptyLines: "greedy" });
  if (parsed.errors.length) throw new Error("CSV tidak valid. Periksa tanda kutip dan pemisah koma.");
  const [header, ...rows] = parsed.data;
  if (!header || header.length !== 4 || header.some((value, index) => value.trim().toLowerCase() !== ["tanggal", "item", "kategori", "jumlah"][index]))
    throw new Error("Kolom harus Tanggal, Item, Kategori, Jumlah, sesuai ekspor Rekap.");
  if (!rows.length || rows.length > 500) throw new Error("CSV harus berisi 1–500 transaksi.");
  return rows.map((row, index) => {
    if (row.length !== 4) throw new Error(`Baris ${index + 2} harus memiliki empat kolom.`);
    const [date, item, category, amountText] = row.map((value) => value.trim());
    const amount = Number(amountText);
    const time = Date.parse(`${date}T12:00:00+07:00`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(time) || new Date(time + 7 * 3600000).toISOString().slice(0, 10) !== date ||
      !item || !category || category.length > 100 || category.includes(",") ||
      !/^[1-9]\d*$/.test(amountText) || !Number.isSafeInteger(amount))
      throw new Error(`Baris ${index + 2} tidak valid. Gunakan tanggal YYYY-MM-DD, item, kategori, dan jumlah rupiah bulat.`);
    return { id: crypto.randomUUID(), date, item, category, amount };
  });
}

export function ImportDialog({ open, onOpenChange, profileId, categories, onUnauthorized, onImported }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profileId: string;
  categories: Category[];
  onUnauthorized: () => void;
  onImported: (count: number) => void;
}) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [error, setError] = useState("");
  const fileVersion = useRef(0);
  const mutation = useMutation({
    mutationFn: () => postAction(profileId, "importExpenses", { transactions: rows }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.spendProfile(profileId) });
      onImported(rows.length);
      onOpenChange(false);
    },
    onError: (cause) => {
      if (cause instanceof ApiError && cause.status === 401) onUnauthorized();
    },
    retry: false,
  });

  useEffect(() => {
    if (!open) {
      fileVersion.current += 1;
      setRows([]);
      setError("");
      mutation.reset();
    }
  }, [open, profileId]);

  async function chooseFile(file?: File) {
    const version = ++fileVersion.current;
    setRows([]);
    setError("");
    mutation.reset();
    if (!file) return;
    if (file.size > 1024 * 1024) {
      setError("Ukuran CSV maksimal 1 MB.");
      return;
    }
    try {
      const source = await file.text();
      if (version === fileVersion.current) setRows(parseFile(source));
    } catch (cause) {
      if (version === fileVersion.current) setError(cause instanceof Error ? cause.message : "CSV tidak dapat dibaca.");
    }
  }

  const keys = new Set(categories.map((category) => categoryKey(category.name)));
  const newCategories = Array.from(new Map(rows.filter((row) => !keys.has(categoryKey(row.category))).map((row) => [categoryKey(row.category), row.category])).values());
  const archivedCategories = Array.from(new Set(rows.filter((row) => categories.some((category) => category.archived && categoryKey(category.name) === categoryKey(row.category))).map((row) => row.category)));
  const shownError = error || (mutation.error instanceof Error ? mutation.error.message : "");

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!mutation.isPending) onOpenChange(value); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Impor transaksi</DialogTitle>
          <DialogDescription>Impor ke profil aktif. Gunakan CSV ekspor Rekap dengan tanggal YYYY-MM-DD dan jumlah rupiah bulat.</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="import-file">Berkas CSV</FieldLabel>
          <Input id="import-file" type="file" accept=".csv,text/csv" disabled={mutation.isPending} onChange={(event) => void chooseFile(event.target.files?.[0])} />
        </Field>
        {shownError ? <Alert variant="destructive"><CircleAlert /><AlertTitle>Impor belum berhasil</AlertTitle><AlertDescription>{shownError}{mutation.error ? " Jika koneksi terputus, periksa transaksi sebelum menutup dialog atau mengimpor ulang." : ""}</AlertDescription></Alert> : null}
        {rows.length > 0 ? <div className="flex flex-col gap-3">
          <p className="text-sm">Periksa {rows.length} transaksi sebelum mengimpor. Mengimpor ulang berkas dapat membuat duplikat.</p>
          {newCategories.length ? <p className="text-sm">Kategori baru: {newCategories.join(", ")}</p> : null}
          {archivedCategories.length ? <p className="text-sm">Kategori arsip tetap diarsipkan: {archivedCategories.join(", ")}</p> : null}
          <div className="max-h-64 overflow-auto rounded-md border">
            <table className="w-full text-left text-sm">
              <thead><tr><th className="p-2">Tanggal</th><th className="p-2">Item</th><th className="p-2">Kategori</th><th className="p-2">Jumlah</th></tr></thead>
              <tbody>{rows.map((row) => <tr key={row.id} className="border-t"><td className="whitespace-nowrap p-2">{row.date}</td><td className="p-2">{row.item}</td><td className="p-2">{row.category}</td><td className="whitespace-nowrap p-2">{rupiah(row.amount)}</td></tr>)}</tbody>
            </table>
          </div>
        </div> : null}
        <DialogFooter>
          <Button variant="outline" disabled={mutation.isPending} onClick={() => onOpenChange(false)}>Batal</Button>
          <Button disabled={!rows.length || mutation.isPending} onClick={() => mutation.mutate()}>Impor {rows.length || ""} transaksi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
