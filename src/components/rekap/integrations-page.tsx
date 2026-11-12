import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cable, CircleAlert, ExternalLink, Link2, Unplug } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useApp } from "./app-provider";
import { ApiError, channelAction, fetchChannels } from "./api";
import type { Integration } from "./api";
import { PageHeader } from "./page-header";
import { queryKeys } from "./query-keys";

function statusBadge(integration: Integration) {
  if (integration.status === "connected") return <Badge variant="secondary">Terhubung</Badge>;
  if (integration.status === "error") return <Badge variant="destructive">Bermasalah</Badge>;
  if (integration.status === "connecting") return <Badge variant="outline">Menghubungkan</Badge>;
  return <Badge variant="outline">Terputus</Badge>;
}

function HelpLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
    >
      {children}
      <ExternalLink className="size-3" aria-hidden="true" />
    </a>
  );
}

export function IntegrationsPage() {
  const queryClient = useQueryClient();
  const { handleUnauthorized } = useApp();
  const [telegramToken, setTelegramToken] = useState("");
  const [discordToken, setDiscordToken] = useState("");
  const [showTelegramForm, setShowTelegramForm] = useState(false);
  const channelsQuery = useQuery({
    queryKey: queryKeys.channels,
    queryFn: fetchChannels,
    retry: false,
  });
  useEffect(() => {
    if (channelsQuery.error instanceof ApiError && channelsQuery.error.status === 401)
      handleUnauthorized();
  }, [channelsQuery.error, handleUnauthorized]);

  const mutation = useMutation({
    mutationFn: ({ action, values }: { action: string; values?: Record<string, unknown> }) =>
      channelAction(action, values),
    onSuccess: () => {
      setTelegramToken("");
      setDiscordToken("");
      setShowTelegramForm(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.channels });
    },
    onError: (cause) => {
      if (cause instanceof ApiError && cause.status === 401) handleUnauthorized();
    },
    retry: false,
  });

  const integrations = channelsQuery.data?.integrations ?? [];
  const telegram = integrations.find((item) => item.type === "telegram");
  const discord = integrations.find((item) => item.type === "discord");
  const error = channelsQuery.error instanceof Error ? channelsQuery.error.message : "";
  const telegramBot =
    typeof telegram?.publicConfig.botUsername === "string"
      ? telegram.publicConfig.botUsername
      : "";
  const discordBot =
    typeof discord?.publicConfig.botName === "string" ? discord.publicConfig.botName : "";
  const discordApplication =
    typeof discord?.publicConfig.applicationId === "string"
      ? discord.publicConfig.applicationId
      : "";

  function connectTelegram() {
    mutation.mutate({ action: "connectTelegram", values: { token: telegramToken } });
  }

  function connectDiscord() {
    mutation.mutate({ action: "connectDiscord", values: { token: discordToken } });
  }

  return (
    <div className="pb-10">
      <PageHeader
        title="Integrasi"
        actions={
          <Button variant="outline" asChild>
            <a href="/docs#kanal">
              <Link2 />
              Panduan kanal
            </a>
          </Button>
        }
      />
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Hubungkan bot sekali untuk seluruh instalasi. Setelah terhubung, tautkan chat atau
          channel ke profil dari halaman Profil.
        </p>
        {error ? <Alert variant="destructive"><CircleAlert /><AlertTitle>Integrasi tidak dapat dimuat</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
        {mutation.error ? <Alert variant="destructive"><CircleAlert /><AlertTitle>Perubahan gagal</AlertTitle><AlertDescription>{mutation.error instanceof Error ? mutation.error.message : "Coba lagi."}</AlertDescription></Alert> : null}

        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Telegram</CardTitle>
              <CardDescription>Bot Telegram untuk grup dan chat pribadi.</CardDescription>
              <CardAction>{telegram ? statusBadge(telegram) : null}</CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {telegram?.lastError ? <Alert variant="destructive"><CircleAlert /><AlertTitle>Telegram bermasalah</AlertTitle><AlertDescription>{telegram.lastError}</AlertDescription></Alert> : null}
              {telegramBot ? (
                <p className="text-sm">Bot: <span className="font-medium">@{telegramBot}</span></p>
              ) : null}
              {telegram?.source === "env" ? (
                <p className="text-sm text-muted-foreground">
                  Koneksi ini berasal dari installer. Token disimpan sebagai secret Worker.
                </p>
              ) : null}
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="telegram-token">Token bot Telegram</FieldLabel>
                  {showTelegramForm || telegram?.status !== "connected" ? (
                    <Input
                      id="telegram-token"
                      type="password"
                      autoComplete="off"
                      value={telegramToken}
                      onChange={(event) => setTelegramToken(event.target.value)}
                      placeholder="123456:ABC..."
                    />
                  ) : null}
                  <FieldDescription>
                    <HelpLink href="/docs#telegram-bot">Lihat cara mendapatkan token</HelpLink>
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </CardContent>
            <CardFooter className="flex-wrap justify-end gap-2 bg-transparent">
              {telegram?.status === "connected" ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowTelegramForm((value) => !value)}
                  >
                    Ganti token
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={mutation.isPending}
                    onClick={() => mutation.mutate({ action: "disconnectTelegram" })}
                  >
                    <Unplug />
                    Putuskan
                  </Button>
                </>
              ) : telegram?.source === "env" ? (
                <Button
                  size="sm"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate({ action: "activateTelegram" })}
                >
                  <Cable />
                  Aktifkan lagi
                </Button>
              ) : null}
              {telegram?.status !== "connected" || showTelegramForm ? (
                <Button size="sm" onClick={connectTelegram} disabled={mutation.isPending || !telegramToken.trim()}>
                  Hubungkan Telegram
                </Button>
              ) : null}
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Discord</CardTitle>
              <CardDescription>Bot Discord dengan slash command.</CardDescription>
              <CardAction>{discord ? statusBadge(discord) : null}</CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {discord?.lastError ? <Alert variant="destructive"><CircleAlert /><AlertTitle>Discord bermasalah</AlertTitle><AlertDescription>{discord.lastError}</AlertDescription></Alert> : null}
              {discordBot ? (
                <div className="text-sm">
                  <p>Bot: <span className="font-medium">{discordBot}</span></p>
                  {discordApplication ? <p className="text-muted-foreground">Application ID: {discordApplication}</p> : null}
                </div>
              ) : null}
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="discord-token">Token bot Discord</FieldLabel>
                  {discord?.status !== "connected" ? (
                    <Input
                      id="discord-token"
                      type="password"
                      autoComplete="off"
                      value={discordToken}
                      onChange={(event) => setDiscordToken(event.target.value)}
                    />
                  ) : null}
                  <FieldDescription>
                    <HelpLink href="/docs#discord-bot">Lihat cara mendapatkan token</HelpLink>
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </CardContent>
            <CardFooter className="flex-wrap justify-end gap-2 bg-transparent">
              {discord?.status === "connected" ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate({ action: "disconnectDiscord" })}
                >
                  <Unplug />
                  Putuskan
                </Button>
              ) : (
                <Button size="sm" onClick={connectDiscord} disabled={mutation.isPending || !discordToken.trim()}>
                  Hubungkan Discord
                </Button>
              )}
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}
