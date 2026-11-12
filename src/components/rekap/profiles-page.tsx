import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Archive, ArchiveRestore, Cable, Plus, Users } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
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
import { ApiError, fetchChannels, postAction } from "./api";
import type { Profile } from "./api";
import { ChannelDialog } from "./channel-dialog";
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
  const [channelProfile, setChannelProfile] = useState<Profile | null>(null);
  const [profileAction, setProfileAction] = useState<ProfileAction | null>(null);
  const channelsQuery = useQuery({
    queryKey: queryKeys.channels,
    queryFn: fetchChannels,
    retry: false,
  });
  const channels = channelsQuery.data?.channels ?? [];
  const integrations = channelsQuery.data?.integrations ?? [];

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
          <>
            <Button variant="outline" asChild>
              <Link to="/integrations">
                <Cable />
                Integrasi
              </Link>
            </Button>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus />
              Profil baru
            </Button>
          </>
        }
      />
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-sm text-muted-foreground">
            Kelola profil dan tautkan chat Telegram atau channel Discord. Pilih profil aktif dari
            menu samping.
          </p>
          <Badge variant="outline">{profiles.length} profil</Badge>
        </div>

        {profiles.length ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {profiles.map((profile) => {
              const selected = profile.id === selectedProfileId;
              const linkedChannels = channels.filter(
                (channel) => channel.profile_id === profile.id,
              );
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
                      <div className="min-w-0 flex-1">
                        <CardTitle className="break-words">{profile.name}</CardTitle>
                        <CardDescription>
                          {linkedChannels.length
                            ? `${linkedChannels.length} kanal terhubung`
                            : "Belum ada kanal"}
                        </CardDescription>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {selected ? <Badge>Sedang dipilih</Badge> : null}
                          {profile.archived ? (
                            <Badge variant="outline">Diarsipkan</Badge>
                          ) : (
                            <Badge variant="secondary">Aktif</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {linkedChannels.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {linkedChannels.map((channel) => (
                          <Badge key={channel.id} variant="outline">
                            {channel.type === "telegram" ? "Telegram" : "Discord"}
                            {" · "}
                            {channel.external_name &&
                            channel.external_name !== channel.integration_name
                              ? channel.external_name
                              : channel.external_id}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Hubungkan chat Telegram atau channel Discord untuk mulai mencatat.
                      </p>
                    )}
                  </CardContent>
                  <CardFooter className="justify-end gap-2 bg-transparent">
                    {!profile.archived ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setChannelProfile(profile)}
                      >
                        <Cable />
                        Kanal
                      </Button>
                    ) : null}
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
                Buat profil, lalu tautkan chat Telegram atau channel Discord untuk mencatat
                pengeluaran.
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
      <ChannelDialog
        open={Boolean(channelProfile)}
        onOpenChange={(open) => {
          if (!open) setChannelProfile(null);
        }}
        profile={channelProfile}
        integrations={integrations}
        channels={channels}
      />

      <ConfirmDialog
        open={Boolean(profileAction)}
        onOpenChange={closeActionDialog}
        title={archive ? "Arsipkan profil?" : "Pulihkan profil?"}
        description={
          profileAction
            ? archive
              ? `Profil ${profileAction.profile.name} tidak dapat menambah transaksi. Data tetap tersimpan.`
              : `Profil ${profileAction.profile.name} dapat menambah transaksi lagi.`
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
