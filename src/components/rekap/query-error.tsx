import { CircleAlert, RotateCcw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function QueryError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertTitle>Data tidak dapat dimuat</AlertTitle>
      <AlertDescription>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>{message}</span>
          <Button variant="outline" size="sm" onClick={() => onRetry()}>
            <RotateCcw />
            Coba lagi
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
