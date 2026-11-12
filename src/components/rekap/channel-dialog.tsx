import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Cable, CircleAlert, ExternalLink, Link2, Unplug } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApp } from "./app-provider";
import { ApiError, channelAction } from "./api";
import type { Channel, Integration, Profile } from "./api";
import { queryKeys } from "./query-keys";

type DiscordChannel = {
  guildId: string;
  guildName: string;
  channelId: string;
  channelName: string;
};

export function ChannelDialog({
  open,
  onOpenChange,
  profile,
  integrations,
  channels,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: Profile | null;
  integrations: Integration[];
  channels: Channel[];
}) {
  const queryClient = useQueryClient();
  const { handleUnauthorized } = useApp();
  const [code, setCode] = useState("");
  const [discordChannels, setDiscordChannels] = useState<DiscordChannel[]>([]);
  const [discordChannelId, setDiscordChannelId] = useState("");
  const linked = profile ? channels.filter((channel) => channel.profile_id === profile.id) : [];
  const telegram = integrations.find((item) => item.type === "telegram");
  const discord = integrations.find((item) => item.type === "discord");
  const mutation = useMutation({
    mutationFn: ({ action, values }: { action: string; values?: Record<string, unknown> }) =>
      channelAction(action, values),
    onSuccess: (result, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.channels });
      if (variables.action === "createLinkCode" && typeof result.code === "string")
        setCode(result.code);
      if (variables.action === "listDiscordChannels" && Array.isArray(result.channels))
        setDiscordChannels(result.channels as DiscordChannel[]);
    },
    onError: (cause) => {
      if (cause instanceof ApiError && cause.status === 401) handleUnauthorized();
    },
    retry: false,
  });

  function reset() {
    setCode("");
    setDiscordChannels([]);
    setDiscordChannelId("");
    mutation.reset();
  }

  function close(value: boolean) {
    if (!value) reset();
    onOpenChange(value);
  }

  function createCode() {
    if (!profile) return;
    mutation.mutate({
      action: "createLinkCode",
      values: { profileId: profile.id, integrationId: telegram?.id ?? "telegram" },
    });
  }

  function loadDiscordChannels() {
    mutation.mutate({
      action: "listDiscordChannels",
      values: { integrationId: discord?.id ?? "discord" },
    });
  }

  function linkDiscordChannel() {
    if (!profile || !discord || !discordChannelId) return;
    const selected = discordChannels.find((channel) => channel.channelId === discordChannelId);
    if (!selected) return;
    mutation.mutate({
      action: "linkChannel",
      values: {
        profileId: profile.id,
        integrationId: discord.id,
        externalId: selected.channelId,
        externalName: `${selected.guildName} / #${selected.channelName}`,
      },
    });
  }

  const shownError = mutation.error instanceof Error ? mutation.error.message : "";

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Kanal {profile?.name ?? ""}</DialogTitle>
          <DialogDescription>
            Tautkan chat Telegram atau channel Discord ke profil ini. Satu kanal hanya untuk satu
            profil.
          </DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          <a
            href="/docs#kanal"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
          >
            Panduan menghubungkan kanal
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        </p>
        {shownError ? (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>Perubahan gagal</AlertTitle>
            <AlertDescription>{shownError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">Kanal terhubung</h3>
            <Badge variant="secondary">{linked.length}</Badge>
          </div>
          {linked.length ? (
            <div className="divide-y rounded-lg border">
              {linked.map((channel) => (
                <div key={channel.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {channel.external_name &&
                      channel.external_name !== channel.integration_name
                        ? channel.external_name
                        : channel.external_id}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {channel.type === "telegram" ? "Telegram" : "Discord"}
                      {channel.active ? "" : " · tidak aktif"}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={mutation.isPending || !profile}
                    onClick={() =>
                      profile &&
                      mutation.mutate({
                        action: "unlinkChannel",
                        values: { profileId: profile.id, channelId: channel.id },
                      })
                    }
                  >
                    <Unplug />
                    Lepas
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Belum ada kanal untuk profil ini.</p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-3 rounded-xl border p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Telegram</h3>
              <Badge variant={telegram?.status === "connected" ? "secondary" : "outline"}>
                {telegram?.status === "connected" ? "Siap" : "Belum siap"}
              </Badge>
            </div>
            {telegram?.status === "connected" ? (
              <>
                <p className="text-xs text-muted-foreground">
                  Buat kode, lalu kirim <span className="font-medium">/connect KODE</span> di grup.
                </p>
                {code ? (
                  <p className="rounded-lg bg-muted px-3 py-2 text-center font-mono text-lg font-semibold tracking-widest">
                    {code}
                  </p>
                ) : null}
                <Button size="sm" variant="outline" onClick={createCode} disabled={mutation.isPending}>
                  <Link2 />
                  Buat kode
                </Button>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Hubungkan bot Telegram dulu di halaman Integrasi.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-3 rounded-xl border p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Discord</h3>
              <Badge variant={discord?.status === "connected" ? "secondary" : "outline"}>
                {discord?.status === "connected" ? "Siap" : "Belum siap"}
              </Badge>
            </div>
            {discord?.status === "connected" ? (
              <>
                <Button size="sm" variant="outline" onClick={loadDiscordChannels} disabled={mutation.isPending}>
                  <Cable />
                  Muat channel
                </Button>
                {discordChannels.length ? (
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="discord-channel">Channel Discord</FieldLabel>
                      <Select value={discordChannelId} onValueChange={setDiscordChannelId}>
                        <SelectTrigger id="discord-channel" className="w-full">
                          <SelectValue placeholder="Pilih channel" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {discordChannels.map((channel) => (
                              <SelectItem
                                key={`${channel.guildId}-${channel.channelId}`}
                                value={channel.channelId}
                              >
                                {channel.guildName} / #{channel.channelName}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <FieldDescription>Bot harus sudah masuk ke server Discord.</FieldDescription>
                    </Field>
                  </FieldGroup>
                ) : null}
                {discordChannels.length ? (
                  <Button size="sm" onClick={linkDiscordChannel} disabled={mutation.isPending || !discordChannelId}>
                    <Link2 />
                    Tautkan channel
                  </Button>
                ) : null}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Hubungkan bot Discord dulu di halaman Integrasi.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Tutup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
