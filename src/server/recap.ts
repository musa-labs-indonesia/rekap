import type { ScheduledController } from "@cloudflare/workers-types/index";
import { buildReportData, type Period } from "./channel-commands";
import { discordIntegrationConfig, telegramBotConfig, type IntegrationEnv } from "./integrations";
import { sendTelegramText } from "./telegram";
import { sendDiscordMessage } from "./discord";

const schedules: Record<string, Period> = {
  "0 1 * * 1": "weekly",
  "0 1 1 * *": "monthly",
};

export async function handleScheduled(
  controller: Pick<ScheduledController, "cron">,
  env: IntegrationEnv,
): Promise<void> {
  const period = schedules[controller.cron];
  if (!period) return;
  const now = Date.now();
  const profiles = await env.DB.prepare(
    "SELECT id, name FROM profiles WHERE archived = 0 ORDER BY name",
  ).all<{ id: string; name: string }>();
  const telegram = await telegramBotConfig(env.DB, env);
  const discord = await discordIntegrationConfig(env.DB, env);
  for (const profile of profiles.results) {
    const channels = await env.DB.prepare(
      "SELECT pc.external_id, i.type FROM profile_channels pc JOIN integrations i ON i.id = pc.integration_id WHERE pc.profile_id = ? AND pc.active = 1 AND i.status = 'connected' ORDER BY pc.created_at",
    )
      .bind(profile.id)
      .all<{ external_id: string; type: "telegram" | "discord" }>();
    if (!channels.results.length) continue;
    const report = await buildReportData(env.DB, profile, period, now, true);
    if (!report.count) continue;
    for (const channel of channels.results) {
      try {
        if (channel.type === "telegram" && telegram)
          await sendTelegramText(telegram.token, channel.external_id, report.text);
        if (channel.type === "discord" && discord)
          await sendDiscordMessage(discord.token, channel.external_id, report.text);
      } catch {}
    }
  }
}
