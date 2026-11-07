import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useApp } from "./app-provider";

export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  const { selectedProfile } = useApp();
  return (
    <header className="sticky top-0 z-10 flex h-20 shrink-0 items-center justify-between gap-3 border-b bg-background px-4 md:px-8">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger className="md:hidden" />
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold md:text-2xl">{title}</h1>
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm text-muted-foreground">
              {selectedProfile ? selectedProfile.name : "Pilih profil"}
            </p>
            {selectedProfile?.archived ? <Badge variant="outline">Diarsipkan</Badge> : null}
          </div>
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
