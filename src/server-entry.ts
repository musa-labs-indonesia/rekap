import { createServerEntry, createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import type { ExecutionContext, ScheduledController } from "@cloudflare/workers-types/index";
import { handleScheduled } from "./server/recap";
import type { IntegrationEnv } from "./server/integrations";

const entry = createServerEntry({ fetch: createStartHandler(defaultStreamHandler) });

export default {
  ...entry,
  scheduled: (controller: ScheduledController, env: IntegrationEnv, _ctx: ExecutionContext) =>
    handleScheduled(controller, env),
};
