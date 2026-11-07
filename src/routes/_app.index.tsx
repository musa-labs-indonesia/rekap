import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "@/components/rekap/dashboard-page";

export const Route = createFileRoute("/_app/")({
  component: DashboardPage,
});
