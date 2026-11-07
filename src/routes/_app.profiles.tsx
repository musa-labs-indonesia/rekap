import { createFileRoute } from "@tanstack/react-router";
import { ProfilesPage } from "@/components/rekap/profiles-page";

export const Route = createFileRoute("/_app/profiles")({
  component: ProfilesPage,
});
