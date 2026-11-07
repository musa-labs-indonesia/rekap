import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { initialDate } from "./utils";

export function MonthFilter({ selectedMonth, selectMonth }: {
  selectedMonth: string;
  selectMonth: (month: string) => void;
}) {
  const currentMonth = initialDate().slice(0, 7);

  function moveMonth(offset: number) {
    const date = new Date(`${selectedMonth}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + offset);
    selectMonth(date.toISOString().slice(0, 7));
  }

  return (
    <div className="flex items-end gap-2">
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Bulan sebelumnya"
        disabled={selectedMonth <= "0001-01"}
        onClick={() => moveMonth(-1)}
      >
        <ChevronLeft />
      </Button>
      <Field className="w-auto">
        <FieldLabel htmlFor="report-month">Bulan laporan</FieldLabel>
        <Input
          id="report-month"
          type="month"
          min="0001-01"
          max={currentMonth}
          value={selectedMonth}
          onChange={(event) => {
            const month = event.currentTarget.value;
            if (/^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month >= "0001-01" && month <= currentMonth)
              selectMonth(month);
          }}
        />
      </Field>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Bulan berikutnya"
        disabled={selectedMonth >= currentMonth}
        onClick={() => moveMonth(1)}
      >
        <ChevronRight />
      </Button>
    </div>
  );
}
