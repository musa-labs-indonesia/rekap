import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Pencil, Plus, Shapes, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useApp } from "./app-provider";
import { ApiError, postAction } from "./api";
import type { Category } from "./api";
import { CategoryDialog } from "./category-dialog";
import { ConfirmDialog } from "./confirm-dialog";
import { PageHeader } from "./page-header";
import { QueryError } from "./query-error";
import { queryKeys } from "./query-keys";
import { initialDate } from "./utils";
import { useSpendData } from "./use-spend-data";

export function CategoriesPage() {
  const { selectedProfile, selectedProfileId, handleUnauthorized } = useApp();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editCategory, setEditCategory] = useState<Category | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const today = initialDate();
  const { categories, loading, error, reload } = useSpendData({
    profileId: selectedProfileId,
    start: today,
    end: today,
    category: "",
    onUnauthorized: handleUnauthorized,
  });
  const activeCategories = categories.filter((category) => !category.archived);
  const archivedProfile = Boolean(selectedProfile?.archived);
  const initialLoading = loading && categories.length === 0;
  const deleteMutation = useMutation({
    mutationFn: (category: Category) =>
      postAction(selectedProfileId, "deleteCategory", { categoryId: category.id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.spendProfile(selectedProfileId) });
      setDeleteTarget(null);
    },
    onError: (cause) => {
      if (cause instanceof ApiError && cause.status === 401) handleUnauthorized();
    },
    retry: false,
  });

  function openCategory(category: Category | null) {
    setEditCategory(category);
    setDialogOpen(true);
  }

  return (
    <div className="pb-10">
      <PageHeader
        title="Kategori"
        actions={
          <Button onClick={() => openCategory(null)} disabled={!selectedProfile || archivedProfile}>
            <Plus />
            Tambah kategori
          </Button>
        }
      />
      <div
        className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-4 py-6 md:px-8 md:py-8"
        aria-busy={loading}
      >
        {error ? <QueryError message={error} onRetry={reload} /> : null}
        <Card className="[--card-spacing:var(--space-5)]">
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>Daftar kategori</CardTitle>
            <CardDescription>Tambah, ubah, atau hapus kategori untuk profil ini.</CardDescription>
            <CardAction>
              <Badge variant="secondary">{activeCategories.length} kategori</Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            {initialLoading ? (
              <div className="flex flex-col gap-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : activeCategories.length ? (
              <ul className="grid gap-x-8 md:grid-cols-2">
                {activeCategories.map((category) => (
                  <li key={category.id} className="flex min-w-0 items-center justify-between gap-3 border-b py-3">
                    <span className="truncate text-sm font-medium">{category.name}</span>
                    {!archivedProfile ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Tindakan untuk kategori ${category.name}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuGroup>
                            <DropdownMenuItem onSelect={() => openCategory(category)}>
                              <Pencil />
                              Ubah nama
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => {
                                deleteMutation.reset();
                                setDeleteTarget(category);
                              }}
                            >
                              <Trash2 />
                              Hapus
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>
                <EmptyMedia variant="icon"><Shapes /></EmptyMedia>
                <EmptyHeader>
                  <EmptyTitle>Belum ada kategori.</EmptyTitle>
                  <EmptyDescription>Tambahkan kategori untuk merapikan transaksi profil ini.</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button onClick={() => openCategory(null)} disabled={!selectedProfile || archivedProfile}>
                    <Plus />
                    Tambah kategori
                  </Button>
                </EmptyContent>
              </Empty>
            )}
          </CardContent>
        </Card>
      </div>
      <CategoryDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditCategory(null);
        }}
        profileId={selectedProfileId}
        category={editCategory}
        onUnauthorized={handleUnauthorized}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            deleteMutation.reset();
          }
        }}
        title="Hapus kategori?"
        description={deleteTarget ? `${deleteTarget.name} tidak lagi tersedia untuk transaksi baru. Transaksi lama tetap tersimpan.` : ""}
        confirmLabel="Hapus"
        pending={deleteMutation.isPending}
        error={deleteMutation.error instanceof Error ? deleteMutation.error.message : ""}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget);
        }}
      />
    </div>
  );
}
