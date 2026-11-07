import { createFileRoute } from "@tanstack/react-router";
import { CategoriesPage } from "@/components/rekap/categories-page";

export const Route = createFileRoute("/_app/categories")({
  component: CategoriesPage,
});
