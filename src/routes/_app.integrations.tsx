import { createFileRoute } from "@tanstack/react-router";
import { IntegrationsPage } from "@/components/rekap/integrations-page";

export const Route = createFileRoute("/_app/integrations")({
  component: IntegrationsPage,
});
