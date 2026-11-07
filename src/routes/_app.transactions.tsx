import { createFileRoute } from "@tanstack/react-router";
import { TransactionsPage } from "@/components/rekap/transactions-page";

export const Route = createFileRoute("/_app/transactions")({
  component: TransactionsPage,
});
