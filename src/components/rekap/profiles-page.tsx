import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Plus, Users } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useApp } from "./app-provider";
import { ApiError, postAction } from "./api";
import type { Profile } from "./api";
import { ConfirmDialog } from "./confirm-dialog";
import { PageHeader } from "./page-header";
import { ProfileDialog } from "./profile-dialog";
import { queryKeys } from "./query-keys";

type ProfileAction = {
  profile: Profile;
  action: "archiveProfile" | "restoreProfile";
};

export function ProfilesPage() {
  const queryClient = useQueryClient();
  const { profiles, selectedProfileId, handleUnauthorized } = useApp();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [profileAction, setProfileAction] = useState<ProfileAction | null>(null);

  const profileMutation = useMutation({
    mutationFn: (value: ProfileAction) => postAction(value.profile.id, value.action),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.profiles });
      setProfileAction(null);
    },
    onError: (cause) => {
      if (cause instanceof ApiError && cause.status === 401) handleUnauthorized();
    },
    retry: false,
  });

  function closeActionDialog(open: boolean) {
    if (!open) {
      setProfileAction(null);
      profileMutation.reset();
    }
  }

  const archive = profileAction?.action === "archiveProfile";

  return (
    <div className="pb-10">
      <PageHeader
        title="Profil"
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus />
            Profil baru
          </Button>
        }
      />
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-sm text-muted-foreground">
            Setiap profil terhubung ke satu chat Telegram. Pilih profil aktif dari menu samping.
          </p>
          <Badge variant="outline">{profiles.length} profil</Badge>
        </div>

        {profiles.length ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {profiles.map((profile) => {
              const selected = profile.id === selectedProfileId;
              return (
                <Card
                  key={profile.id}
                  className={cn(
                    "[--card-spacing:var(--space-5)]",
                    selected && "ring-2 ring-primary/40",
                  )}
                >
                  <CardHeader>
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
                        <Users aria-hidden="true" className="size-5" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="truncate">{profile.name}</CardTitle>
                        <CardDescription>ID chat {profile.chat_id}</CardDescription>
                      </div>
                    </div>
                    <CardAction className="flex flex-wrap justify-end gap-1.5">
                      {selected ? <Badge>Sedang dipilih</Badge> : null}
                      {profile.archived ? (
                        <Badge variant="outline">Diarsipkan</Badge>
                      ) : (
                        <Badge variant="secondary">Aktif</Badge>
                      )}
                    </CardAction>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/60 px-3 py-2">
                      <span className="text-xs text-muted-foreground">ID chat Telegram</span>
                      <span className="truncate text-sm font-medium tabular-nums">
                        {profile.chat_id}
                      </span>
                    </div>
                  </CardContent>
                  <CardFooter className="justify-end bg-transparent">
                    {profile.archived ? (
                      <Button
                        size="sm"
                        onClick={() =>
                          setProfileAction({ profile, action: "restoreProfile" })
                        }
                      >
                        <ArchiveRestore />
                        Pulihkan profil
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setProfileAction({ profile, action: "archiveProfile" })
                        }
                      >
                        <Archive />
                        Arsipkan profil
                      </Button>
                    )}
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        ) : (
          <Empty className="rounded-xl border border-dashed bg-card py-16">
            <EmptyMedia variant="icon">
              <Users />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>Mulai dengan profil.</EmptyTitle>
              <EmptyDescription>
                Buat profil dan hubungkan ID chat Telegram untuk mencatat pengeluaran.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => setDialogOpen(true)}>
                <Plus />
                Buat profil
              </Button>
            </EmptyContent>
          </Empty>
        )}
      </div>

      <ProfileDialog open={dialogOpen} onOpenChange={setDialogOpen} />

      <ConfirmDialog
        open={Boolean(profileAction)}
        onOpenChange={closeActionDialog}
        title={archive ? "Arsipkan profil?" : "Pulihkan profil?"}
        description={
          profileAction
            ? archive
              ? `Chat ${profileAction.profile.chat_id} tidak dapat menambah transaksi. Data tetap tersimpan.`
              : `Chat ${profileAction.profile.chat_id} dapat menambah transaksi lagi.`
            : ""
        }
        confirmLabel={archive ? "Arsipkan" : "Pulihkan"}
        pending={profileMutation.isPending}
        error={profileMutation.error instanceof Error ? profileMutation.error.message : ""}
        destructive={archive}
        onConfirm={() => {
          if (profileAction) profileMutation.mutate(profileAction);
        }}
      />
    </div>
  );
}
