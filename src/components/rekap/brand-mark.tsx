import { WalletCards } from "lucide-react";

export function BrandMark() {
  return (
    <span className="flex items-center gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <WalletCards aria-hidden="true" className="size-5" />
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="text-lg font-semibold">Rekap</span>
        <span className="text-xs text-muted-foreground">Catatan pengeluaran</span>
      </span>
    </span>
  );
}
