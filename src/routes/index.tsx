import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  CircleAlert,
  CircleDollarSign,
  Download,
  KeyRound,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  ReceiptText,
  RotateCcw,
  Shapes,
  Trash2,
  TrendingUp,
  Wallet,
  WalletCards,
} from "lucide-react";
import { cn } from "cn";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/")({ component: Home });

type Profile = { id: string; name: string; chat_id: string; archived: number };
type Category = { id: string; name: string; archived: number };
type Expense = {
  id: string;
  item: string;
  amount: number;
  occurred_at: number;
  category: string;
  category_id: string;
};
type Data = { profiles: Profile[]; categories: Category[]; expenses: Expense[] };
type CategoryTotal = { name: string; amount: number; count: number };
type TrendPoint = { key: string; label: string; amount: number };

const chartColors = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

const chartClasses = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"] as const;

const trendConfig = {
  amount: { label: "Pengeluaran", color: chartColors[0] },
} satisfies ChartConfig;

const donutConfig = {
  amount: { label: "Pengeluaran", color: chartColors[0] },
} satisfies ChartConfig;

const rupiah = (amount: number) => `Rp${new Intl.NumberFormat("id-ID").format(amount)}`;
const compactRupiah = (amount: number) =>
  `Rp${new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(amount)}`;
const dateString = (value: number | Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
const displayDate = (value: number) =>
  new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(value);
const initialDate = () => dateString(new Date());
const percentage = (amount: number, total: number) =>
  total > 0 ? Math.round((amount / total) * 100) : 0;

function dayRange(start: string, end: string): string[] {
  const first = Date.parse(`${start}T00:00:00Z`);
  const last = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(first) || !Number.isFinite(last) || first > last) return [];
  const days: string[] = [];
  for (let time = first; time <= last; time += 86400000)
    days.push(new Date(time).toISOString().slice(0, 10));
  return days;
}

function buildTrend(expenses: Expense[], start: string, end: string): TrendPoint[] {
  const sums = new Map<string, number>();
  for (const expense of expenses) {
    const key = dateString(expense.occurred_at);
    sums.set(key, (sums.get(key) ?? 0) + expense.amount);
  }
  const days = dayRange(start, end);
  if (days.length > 0 && days.length <= 45)
    return days.map((day) => ({
      key: day,
      label: String(Number(day.slice(8, 10))),
      amount: sums.get(day) ?? 0,
    }));
  const months = new Map<string, number>();
  for (const [day, amount] of sums) {
    const key = day.slice(0, 7);
    months.set(key, (months.get(key) ?? 0) + amount);
  }
  return [...months.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([key, amount]) => ({
      key,
      label: new Intl.DateTimeFormat("id-ID", {
        timeZone: "Asia/Jakarta",
        month: "short",
      }).format(new Date(`${key}-01T00:00:00+07:00`)),
      amount,
    }));
}

function BrandMark() {
  return (
    <span className="flex items-center gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <WalletCards aria-hidden="true" className="size-5" />
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="text-lg font-semibold">Rekap</span>
        <span className="text-xs text-muted-foreground">Catatan pengeluaran</span>
      </span>
    </span>
  );
}

function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  progress,
}: {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  progress?: { value: number; className: string };
}) {
  return (
    <Card className="[--card-spacing:var(--space-4)]">
      <CardHeader>
        <CardTitle>
          <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Icon aria-hidden="true" className="size-4" />
            {label}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="truncate text-3xl font-semibold tabular-nums">{value}</p>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
        {progress ? (
          <Progress
            value={progress.value}
            className="mt-1 h-2"
            indicatorClassName={progress.className}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function LoginScreen({ onSubmit, error }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void; error: string }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-4 md:p-8">
      <div className="grid w-full max-w-md overflow-hidden rounded-3xl border bg-card shadow-[0_1px_2px_var(--shadow-soft)] lg:max-w-4xl lg:grid-cols-[1.05fr_1fr]">
        <aside className="hidden flex-col justify-between bg-secondary p-10 lg:flex">
          <BrandMark />
          <div className="max-w-sm">
            <p className="text-3xl font-semibold leading-tight">
              Pengeluaran rapi,
              <br />
              tanpa spreadsheet.
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              Catat dari Telegram. Tinjau dan rapikan di sini.
            </p>
            <ul className="mt-8 flex flex-col gap-4 text-sm">
              <li className="flex gap-3">
                <MessageCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
                Catat lewat chat Telegram.
              </li>
              <li className="flex gap-3">
                <Shapes aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
                Rekap per kategori.
              </li>
              <li className="flex gap-3">
                <Download aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
                Ekspor CSV untuk arsip.
              </li>
            </ul>
          </div>
          <p className="text-xs text-muted-foreground">
            Satu profil terhubung ke satu chat Telegram.
          </p>
        </aside>
        <div className="flex flex-col justify-center p-6 sm:p-10">
          <div className="mb-8 lg:hidden">
            <BrandMark />
          </div>
          <h1 className="text-2xl font-semibold">Selamat datang kembali.</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Masuk untuk melihat catatan pengeluaran Anda.
          </p>
          <form className="mt-8" onSubmit={onSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="username">Nama pengguna</FieldLabel>
                <Input id="username" name="username" autoComplete="username" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Kata sandi</FieldLabel>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </Field>
              <Button type="submit" size="lg" className="w-full">
                Masuk
              </Button>
            </FieldGroup>
          </form>
          {error ? (
            <Alert variant="destructive" className="mt-4">
              <CircleAlert />
              <AlertTitle>Masuk gagal</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <p className="mt-6 text-sm text-muted-foreground">
            Lupa kata sandi? Gunakan perintah pemulihan di Telegram.
          </p>
          <div className="my-6 h-px bg-border" />
          <a
            href="/docs"
            className="inline-flex w-fit items-center gap-2 text-sm font-medium text-foreground underline-offset-4 hover:text-accent hover:underline"
          >
            <BookOpen aria-hidden="true" className="size-4" />
            Panduan Rekap
          </a>
        </div>
      </div>
    </main>
  );
}

function Home() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [data, setData] = useState<Data>({ profiles: [], categories: [], expenses: [] });
  const [profile, setProfile] = useState("");
  const [start, setStart] = useState(() => `${initialDate().slice(0, 7)}-01`);
  const [end, setEnd] = useState(initialDate);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [panel, setPanel] = useState("");
  const [edit, setEdit] = useState<Expense | null>(null);
  const [expenseCategory, setExpenseCategory] = useState("");
  const [activeSection, setActiveSection] = useState("ringkasan");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  async function load() {
    const current = ++requestId.current;
    setLoading(true);
    try {
      const query = new URLSearchParams({
        profile,
        start: String(Date.parse(`${start}T00:00:00+07:00`)),
        end: String(Date.parse(`${end}T00:00:00+07:00`) + 86400000),
        category: categoryFilter,
      });
      const response = await fetch(`/api/data?${query}`);
      if (current !== requestId.current) return;
      if (response.status === 401) {
        setSignedIn(false);
        return;
      }
      if (!response.ok) throw new Error("Data tidak dapat dimuat.");
      const result = (await response.json()) as Data;
      if (current !== requestId.current) return;
      setData(result);
      if (!profile && result.profiles.length)
        setProfile(result.profiles.find((item) => !item.archived)?.id || result.profiles[0].id);
      setSignedIn(true);
      setError("");
    } catch (cause) {
      if (current === requestId.current)
        setError(cause instanceof Error ? cause.message : "Terjadi kesalahan.");
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [profile, start, end, categoryFilter]);

  async function mutate(action: string, values: Record<string, unknown>) {
    setError("");
    try {
      const response = await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, profileId: profile, ...values }),
      });
      if (response.status === 401) {
        setSignedIn(false);
        return false;
      }
      const result = (await response.json()) as { error?: string; id?: string };
      if (!response.ok) {
        setError(result.error || "Perubahan tidak dapat disimpan.");
        return false;
      }
      setPanel("");
      setEdit(null);
      if (action === "createProfile" && result.id) {
        requestId.current++;
        setCategoryFilter("");
        setProfile(result.id);
        setActiveSection("ringkasan");
      } else await load();
      return true;
    } catch {
      setError("Perubahan tidak dapat disimpan. Periksa koneksi Anda.");
      return false;
    }
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/sign-in/username", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
    });
    if (!response.ok) {
      setError("Nama pengguna atau kata sandi salah.");
      return;
    }
    setSignedIn(true);
    await load();
  }

  async function changePassword(form: FormData) {
    if (form.get("newPassword") !== form.get("confirmPassword")) {
      setError("Kata sandi baru tidak sama.");
      return;
    }
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: form.get("currentPassword"),
          newPassword: form.get("newPassword"),
          revokeOtherSessions: true,
        }),
      });
      if (!response.ok) {
        setError("Kata sandi tidak dapat diubah. Periksa kata sandi saat ini.");
        return;
      }
      setError("");
      setPanel("");
    } catch {
      setError("Kata sandi tidak dapat diubah. Periksa koneksi Anda.");
    }
  }

  async function signOut() {
    await fetch("/api/auth/sign-out", { method: "POST" });
    setSignedIn(false);
    setError("");
    setPanel("");
    setEdit(null);
  }

  const total = useMemo(
    () => data.expenses.reduce((sum, expense) => sum + expense.amount, 0),
    [data.expenses],
  );
  const breakdown = useMemo(() => {
    const sums = new Map<string, CategoryTotal>();
    for (const expense of data.expenses) {
      const entry = sums.get(expense.category) ?? {
        name: expense.category,
        amount: 0,
        count: 0,
      };
      entry.amount += expense.amount;
      entry.count += 1;
      sums.set(expense.category, entry);
    }
    return [...sums.values()].sort((first, second) => second.amount - first.amount);
  }, [data.expenses]);
  const categoryTotals = useMemo(
    () => new Map(breakdown.map((entry) => [entry.name, entry])),
    [breakdown],
  );
  const categoryColors = useMemo(
    () =>
      new Map(
        breakdown.map((entry, index) => [entry.name, chartClasses[index % chartClasses.length]]),
      ),
    [breakdown],
  );
  const categoryRows = useMemo(
    () =>
      [...data.categories].sort((first, second) => {
        if (first.archived !== second.archived) return Number(first.archived) - Number(second.archived);
        const firstAmount = categoryTotals.get(first.name)?.amount ?? 0;
        const secondAmount = categoryTotals.get(second.name)?.amount ?? 0;
        return secondAmount - firstAmount || first.name.localeCompare(second.name);
      }),
    [data.categories, categoryTotals],
  );
  const trend = useMemo(() => buildTrend(data.expenses, start, end), [data.expenses, start, end]);
  const trendMax = useMemo(
    () => trend.reduce((maximum, point) => Math.max(maximum, point.amount), 0),
    [trend],
  );
  const topCategory = breakdown[0];
  const average = data.expenses.length ? Math.round(total / data.expenses.length) : 0;
  const largestExpense = useMemo(
    () =>
      data.expenses.reduce<Expense | null>(
        (largest, expense) => (!largest || expense.amount > largest.amount ? expense : largest),
        null,
      ),
    [data.expenses],
  );
  const selected = data.profiles.find((item) => item.id === profile);
  const topShare = topCategory ? percentage(topCategory.amount, total) : 0;

  function openPanel(name: string) {
    setError("");
    setEdit(null);
    setPanel(name);
  }

  function openExpense(expense: Expense | null) {
    setError("");
    setEdit(expense);
    setExpenseCategory(
      expense?.category_id ?? data.categories.find((category) => !category.archived)?.id ?? "",
    );
    setPanel("expense");
  }

  function selectProfile(value: string) {
    requestId.current++;
    setData((current) => ({ ...current, expenses: [], categories: [] }));
    setProfile(value);
    setCategoryFilter("");
    setActiveSection("ringkasan");
  }

  function renameCategory(category: Category) {
    const name = prompt("Nama kategori", category.name);
    if (name && name !== category.name)
      void mutate("renameCategory", { categoryId: category.id, name });
  }

  function archiveCategory(category: Category) {
    if (confirm("Arsipkan kategori ini?"))
      void mutate("archiveCategory", { categoryId: category.id });
  }

  function deleteExpense(expense: Expense) {
    if (confirm("Hapus transaksi ini?")) void mutate("deleteExpense", { expenseId: expense.id });
  }

  function exportCsv() {
    const safe = (value: string | number) =>
      `"${String(value)
        .replace(/^[=+\-@\t\r]/, "'$&")
        .replaceAll('"', '""')}"`;
    const rows = [
      ["Tanggal", "Item", "Kategori", "Jumlah"],
      ...data.expenses.map((expense) => [
        dateString(expense.occurred_at),
        expense.item,
        expense.category,
        expense.amount,
      ]),
    ];
    const blob = new Blob(["\ufeff" + rows.map((row) => row.map(safe).join(",")).join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "rekap.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function submitPanel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (panel === "password") void changePassword(form);
    else if (panel === "profile")
      void mutate("createProfile", { name: form.get("name"), chatId: form.get("chatId") });
    else if (panel === "category") void mutate("createCategory", { name: form.get("name") });
    else {
      if (!expenseCategory) {
        setError("Pilih kategori transaksi.");
        return;
      }
      void mutate("saveExpense", {
        expenseId: edit?.id,
        amount: form.get("amount"),
        item: form.get("item"),
        categoryId: expenseCategory,
        date: form.get("date"),
      });
    }
  }

  function resetFilters() {
    requestId.current++;
    setStart(`${initialDate().slice(0, 7)}-01`);
    setEnd(initialDate());
    setCategoryFilter("");
  }

  const panelTitle =
    panel === "password"
      ? "Ubah kata sandi"
      : panel === "profile"
        ? "Profil baru"
        : panel === "category"
          ? "Kategori baru"
          : edit
            ? "Ubah transaksi"
            : "Tambah transaksi";
  const panelDescription =
    panel === "password"
      ? "Sesi lain akan keluar setelah kata sandi disimpan."
      : panel === "profile"
        ? "Setiap profil terhubung ke satu chat Telegram."
        : panel === "category"
          ? "Kategori baru dapat dipilih untuk transaksi berikutnya."
          : edit
            ? "Ubah rincian transaksi pada periode ini."
            : "Catat pengeluaran baru pada profil aktif.";

  if (signedIn === null)
    return (
      <main className="flex min-h-svh items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm">
          <BrandMark />
          <div className="mt-8 flex flex-col gap-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-10 w-32" />
          </div>
        </div>
      </main>
    );

  if (!signedIn) return <LoginScreen onSubmit={login} error={error} />;

  return (
    <SidebarProvider className="min-h-svh bg-background p-0 md:p-3">
      <div className="mx-auto flex h-svh w-full max-w-[1600px] overflow-hidden border-0 bg-card md:h-[calc(100dvh-1.5rem)] md:rounded-3xl md:border md:shadow-[0_1px_2px_var(--shadow-soft)]">
        <Sidebar
          collapsible="none"
          className="h-full shrink-0 border-r border-sidebar-border bg-sidebar"
        >
          <SidebarHeader className="p-5">
            <a
              href="#ringkasan"
              className="block rounded-lg"
              onClick={() => setActiveSection("ringkasan")}
            >
              <BrandMark />
            </a>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Menu</SidebarGroupLabel>
              <SidebarGroupContent>
                <nav aria-label="Navigasi utama">
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        asChild
                        size="lg"
                        isActive={activeSection === "ringkasan"}
                        onClick={() => setActiveSection("ringkasan")}
                      >
                        <a href="#ringkasan">
                          <LayoutDashboard />
                          <span>Dashboard</span>
                        </a>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        asChild
                        size="lg"
                        isActive={activeSection === "transaksi"}
                        onClick={() => setActiveSection("transaksi")}
                      >
                        <a href="#transaksi">
                          <ReceiptText />
                          <span>Transaksi</span>
                        </a>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        asChild
                        size="lg"
                        isActive={activeSection === "kategori"}
                        onClick={() => setActiveSection("kategori")}
                      >
                        <a href="#kategori">
                          <Shapes />
                          <span>Kategori</span>
                        </a>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </nav>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarGroup>
              <SidebarGroupLabel>Profil aktif</SidebarGroupLabel>
              <SidebarGroupContent>
                <div className="flex flex-col gap-2 px-2">
                  <Select value={profile} onValueChange={selectProfile}>
                    <SelectTrigger id="profile-select" className="w-full" aria-label="Profil aktif">
                      <SelectValue placeholder="Pilih profil" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {data.profiles.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.name}
                            {item.archived ? " (arsip)" : ""}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {selected ? (
                    <p className="text-xs text-muted-foreground">ID chat {selected.chat_id}</p>
                  ) : null}
                  {selected ? (
                    selected.archived ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="justify-start"
                        onClick={() => void mutate("restoreProfile", {})}
                      >
                        <ArchiveRestore data-icon="inline-start" />
                        Pulihkan profil
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="justify-start"
                        onClick={() => {
                          if (confirm("Arsipkan profil ini? Chat tidak dapat menambah transaksi."))
                            void mutate("archiveProfile", {});
                        }}
                      >
                        <Archive data-icon="inline-start" />
                        Arsipkan profil
                      </Button>
                    )
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="justify-start"
                    onClick={() => openPanel("profile")}
                  >
                    <Plus data-icon="inline-start" />
                    Profil baru
                  </Button>
                </div>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter className="border-t border-sidebar-border p-3">
            <nav aria-label="Utilitas">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild size="lg">
                    <a href="/docs">
                      <BookOpen />
                      <span>Panduan</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton size="lg" onClick={() => openPanel("password")}>
                    <KeyRound />
                    <span>Ubah kata sandi</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton size="lg" onClick={() => void signOut()}>
                    <LogOut />
                    <span>Keluar</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </nav>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset className="h-full min-w-0 overflow-y-auto bg-background">
          <header className="sticky top-0 z-10 flex h-20 shrink-0 items-center justify-between gap-3 border-b bg-background px-4 md:px-8">
            <div className="flex min-w-0 items-center gap-2">
              <SidebarTrigger className="md:hidden" />
              <div className="min-w-0">
                <h1 className="truncate text-xl font-semibold md:text-2xl">Dashboard</h1>
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate text-sm text-muted-foreground">
                    {selected ? selected.name : "Pilih profil untuk mulai"}
                  </p>
                  {selected?.archived ? <Badge variant="outline">Diarsipkan</Badge> : null}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="outline"
                className="hidden sm:inline-flex"
                disabled={loading || !selected || data.expenses.length === 0}
                onClick={exportCsv}
              >
                <Download data-icon="inline-start" />
                Ekspor CSV
              </Button>
              <Button
                disabled={!selected || Boolean(selected.archived)}
                onClick={() => openExpense(null)}
              >
                <Plus data-icon="inline-start" />
                Tambah transaksi
              </Button>
            </div>
          </header>
          <div
            className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-4 py-6 md:px-8 md:py-8"
            aria-busy={loading}
          >
            {error && !panel ? (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertTitle>Data tidak dapat dimuat</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            {!selected ? (
              <Empty className="rounded-3xl border border-dashed bg-card py-16">
                <EmptyMedia variant="icon">
                  <WalletCards />
                </EmptyMedia>
                <EmptyHeader>
                  <EmptyTitle>Mulai dengan profil.</EmptyTitle>
                  <EmptyDescription>
                    Buat profil dan hubungkan ID chat Telegram untuk mencatat pengeluaran.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button onClick={() => openPanel("profile")}>
                    <Plus data-icon="inline-start" />
                    Buat profil
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              <>
                <section id="ringkasan" className="scroll-mt-24 flex flex-col gap-4">
                  <h2 className="sr-only">Ringkasan</h2>
                  <div
                    className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
                    role="group"
                    aria-label="Filter periode"
                  >
                    <div className="flex w-full flex-col gap-1.5 sm:w-[160px]">
                      <Label htmlFor="start" className="text-xs font-medium text-muted-foreground">
                        Dari
                      </Label>
                      <Input
                        id="start"
                        type="date"
                        value={start}
                        onChange={(event) => {
                          requestId.current++;
                          setStart(event.target.value);
                        }}
                      />
                    </div>
                    <div className="flex w-full flex-col gap-1.5 sm:w-[160px]">
                      <Label htmlFor="end" className="text-xs font-medium text-muted-foreground">
                        Sampai
                      </Label>
                      <Input
                        id="end"
                        type="date"
                        value={end}
                        onChange={(event) => {
                          requestId.current++;
                          setEnd(event.target.value);
                        }}
                      />
                    </div>
                    <div className="flex w-full flex-col gap-1.5 sm:w-[180px]">
                      <Label
                        htmlFor="category-filter"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        Kategori
                      </Label>
                      <Select
                        value={categoryFilter || "all"}
                        onValueChange={(value) => {
                          requestId.current++;
                          setCategoryFilter(value === "all" ? "" : value);
                        }}
                      >
                        <SelectTrigger id="category-filter" className="w-full">
                          <SelectValue placeholder="Semua kategori" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="all">Semua kategori</SelectItem>
                            {data.categories.map((category) => (
                              <SelectItem key={category.id} value={category.id}>
                                {category.name}
                                {category.archived ? " (arsip)" : ""}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button variant="ghost" className="w-full sm:w-auto" onClick={resetFilters}>
                      <RotateCcw data-icon="inline-start" />
                      Atur ulang
                    </Button>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <StatCard
                      label="Total pengeluaran"
                      value={rupiah(total)}
                      detail={
                        data.expenses.length
                          ? `${data.expenses.length} transaksi pada periode ini`
                          : "Belum ada transaksi pada periode ini"
                      }
                      icon={Wallet}
                    />
                    <StatCard
                      label="Rata-rata transaksi"
                      value={rupiah(average)}
                      detail={
                        data.expenses.length ? "Dihitung dari transaksi periode ini" : "Belum ada transaksi"
                      }
                      icon={CircleDollarSign}
                    />
                    <StatCard
                      label="Transaksi terbesar"
                      value={largestExpense ? rupiah(largestExpense.amount) : "Rp0"}
                      detail={largestExpense ? largestExpense.item : "Belum ada transaksi"}
                      icon={TrendingUp}
                    />
                    <StatCard
                      label="Kategori teratas"
                      value={topCategory ? topCategory.name : "Belum ada"}
                      detail={
                        topCategory
                          ? `${rupiah(topCategory.amount)} dari total`
                          : "Belum ada pengeluaran"
                      }
                      icon={Shapes}
                      progress={
                        topCategory ? { value: topShare, className: "bg-chart-1" } : undefined
                      }
                    />
                  </div>
                </section>

                <div className="grid gap-6 xl:grid-cols-3">
                  <Card className="[--card-spacing:var(--space-5)] xl:col-span-2">
                    <CardHeader>
                      <CardTitle role="heading" aria-level={2}>
                        Tren pengeluaran
                      </CardTitle>
                      <CardDescription>
                        Perubahan pengeluaran pada periode yang dipilih.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {data.expenses.length && trend.length ? (
                        <ChartContainer
                          config={trendConfig}
                          className="h-[300px] w-full"
                          role="img"
                          aria-label={`Grafik tren pengeluaran, total ${rupiah(total)}`}
                        >
                          <BarChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
                            <defs>
                              <pattern
                                id="rekap-bar-hatch"
                                width="7"
                                height="7"
                                patternUnits="userSpaceOnUse"
                                patternTransform="rotate(35)"
                              >
                                <rect width="7" height="7" fill="var(--muted)" />
                                <line
                                  x1="0"
                                  y1="0"
                                  x2="0"
                                  y2="7"
                                  stroke="var(--border)"
                                  strokeWidth="2"
                                />
                              </pattern>
                            </defs>
                            <CartesianGrid
                              vertical={false}
                              stroke="var(--border)"
                              strokeDasharray="3 5"
                            />
                            <XAxis
                              dataKey="label"
                              tickLine={false}
                              axisLine={false}
                              tickMargin={10}
                              minTickGap={12}
                              interval="preserveStartEnd"
                            />
                            <YAxis
                              tickLine={false}
                              axisLine={false}
                              tickMargin={8}
                              width={72}
                              tickFormatter={compactRupiah}
                            />
                            <ChartTooltip
                              content={
                                <ChartTooltipContent
                                  formatter={(value) => rupiah(Number(value))}
                                />
                              }
                            />
                            <Bar
                              dataKey="amount"
                              radius={8}
                              maxBarSize={36}
                              isAnimationActive={false}
                            >
                              {trend.map((point) => (
                                <Cell
                                  key={point.key}
                                  fill={
                                    point.amount === trendMax && trendMax > 0
                                      ? chartColors[0]
                                      : "url(#rekap-bar-hatch)"
                                  }
                                />
                              ))}
                            </Bar>
                          </BarChart>
                        </ChartContainer>
                      ) : (
                        <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
                          Belum ada pengeluaran pada periode ini.
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="[--card-spacing:var(--space-5)]">
                    <CardHeader>
                      <CardTitle role="heading" aria-level={2}>
                        Rincian kategori
                      </CardTitle>
                      <CardDescription>Porsi setiap kategori dari total pengeluaran.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {breakdown.length ? (
                        <>
                          <div className="relative mx-auto w-full max-w-[240px]">
                            <ChartContainer
                              config={donutConfig}
                              className="aspect-square w-full"
                              role="img"
                              aria-label="Diagram porsi pengeluaran per kategori"
                            >
                              <PieChart>
                                <Pie
                                  data={breakdown}
                                  dataKey="amount"
                                  nameKey="name"
                                  innerRadius={62}
                                  outerRadius={92}
                                  paddingAngle={4}
                                  stroke="none"
                                  isAnimationActive={false}
                                >
                                  {breakdown.map((entry, index) => (
                                    <Cell
                                      key={entry.name}
                                      fill={chartColors[index % chartColors.length]}
                                    />
                                  ))}
                                </Pie>
                                <ChartTooltip
                                  content={
                                    <ChartTooltipContent
                                      nameKey="name"
                                      hideLabel
                                      formatter={(value) => rupiah(Number(value))}
                                    />
                                  }
                                />
                              </PieChart>
                            </ChartContainer>
                            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                              <p className="text-xl font-semibold tabular-nums">
                                {compactRupiah(total)}
                              </p>
                              <p className="text-xs text-muted-foreground">Total</p>
                            </div>
                          </div>
                          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {breakdown.map((entry, index) => (
                              <div
                                key={entry.name}
                                className="flex min-w-0 items-center justify-between gap-2 text-sm"
                              >
                                <span className="flex min-w-0 items-center gap-2">
                                  <span
                                    aria-hidden="true"
                                    className={cn(
                                      "size-2.5 shrink-0 rounded-full",
                                      chartClasses[index % chartClasses.length],
                                    )}
                                  />
                                  <span className="truncate">{entry.name}</span>
                                </span>
                                <span className="shrink-0 tabular-nums text-muted-foreground">
                                  {percentage(entry.amount, total)}%
                                </span>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : (
                        <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
                          Belum ada pengeluaran untuk ditampilkan.
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                <div className="grid gap-6 xl:grid-cols-3">
                  <Card
                    id="transaksi"
                    className="scroll-mt-24 [--card-spacing:var(--space-5)] xl:col-span-2"
                  >
                    <CardHeader>
                      <CardTitle role="heading" aria-level={2}>
                        Transaksi terbaru
                      </CardTitle>
                      <CardDescription>Catatan pada periode yang dipilih.</CardDescription>
                      <CardAction>
                        <Badge variant="secondary" className="tabular-nums">
                          {data.expenses.length} transaksi
                        </Badge>
                      </CardAction>
                    </CardHeader>
                    <CardContent className="px-0">
                      {loading ? (
                        <div className="flex flex-col gap-2 px-5">
                          <Skeleton className="h-12 w-full" />
                          <Skeleton className="h-12 w-full" />
                          <Skeleton className="h-12 w-full" />
                          <Skeleton className="h-12 w-full" />
                        </div>
                      ) : data.expenses.length === 0 ? (
                        <Empty className="p-8">
                          <EmptyMedia variant="icon">
                            <ReceiptText />
                          </EmptyMedia>
                          <EmptyHeader>
                            <EmptyTitle>Belum ada transaksi.</EmptyTitle>
                            <EmptyDescription>
                              Catat pengeluaran di Telegram atau tambahkan di sini.
                            </EmptyDescription>
                          </EmptyHeader>
                          <EmptyContent>
                            <Button onClick={() => openExpense(null)}>
                              <Plus data-icon="inline-start" />
                              Tambah transaksi
                            </Button>
                          </EmptyContent>
                        </Empty>
                      ) : (
                        <>
                          <div className="hidden md:block">
                            <Table>
                              <TableHeader>
                                <TableRow className="hover:bg-transparent">
                                  <TableHead className="pl-5">Item</TableHead>
                                  <TableHead>Kategori</TableHead>
                                  <TableHead>Tanggal</TableHead>
                                  <TableHead className="text-right">Jumlah</TableHead>
                                  <TableHead className="pr-5 text-right">
                                    <span className="sr-only">Tindakan</span>
                                  </TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {data.expenses.map((expense) => (
                                  <TableRow key={expense.id}>
                                    <TableCell className="max-w-[280px] pl-5 font-medium whitespace-normal">
                                      {expense.item}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                      {expense.category}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                      {displayDate(expense.occurred_at)}
                                    </TableCell>
                                    <TableCell className="text-right font-medium tabular-nums">
                                      {rupiah(expense.amount)}
                                    </TableCell>
                                    <TableCell className="pr-5 text-right">
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="icon-sm"
                                            aria-label={`Tindakan untuk ${expense.item}`}
                                            disabled={Boolean(selected.archived)}
                                          >
                                            <MoreHorizontal />
                                          </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                          <DropdownMenuGroup>
                                            <DropdownMenuItem onSelect={() => openExpense(expense)}>
                                              <Pencil />
                                              Ubah
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                              variant="destructive"
                                              onSelect={() => deleteExpense(expense)}
                                            >
                                              <Trash2 />
                                              Hapus
                                            </DropdownMenuItem>
                                          </DropdownMenuGroup>
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                          <div className="divide-y md:hidden" data-slot="mobile-transactions">
                            {data.expenses.map((expense) => (
                              <div
                                key={expense.id}
                                className="flex items-start justify-between gap-3 px-5 py-4"
                              >
                                <div className="min-w-0">
                                  <p className="truncate font-medium">{expense.item}</p>
                                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                    <span>{expense.category}</span>
                                    <span>{displayDate(expense.occurred_at)}</span>
                                  </div>
                                </div>
                                <div className="flex shrink-0 flex-col items-end gap-1">
                                  <p className="text-sm font-medium tabular-nums">
                                    {rupiah(expense.amount)}
                                  </p>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label={`Tindakan untuk ${expense.item}`}
                                        disabled={Boolean(selected.archived)}
                                      >
                                        <MoreHorizontal />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuGroup>
                                        <DropdownMenuItem onSelect={() => openExpense(expense)}>
                                          <Pencil />
                                          Ubah
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          variant="destructive"
                                          onSelect={() => deleteExpense(expense)}
                                        >
                                          <Trash2 />
                                          Hapus
                                        </DropdownMenuItem>
                                      </DropdownMenuGroup>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>

                  <Card
                    id="kategori"
                    className="scroll-mt-24 [--card-spacing:var(--space-5)] self-start"
                  >
                    <CardHeader>
                      <CardTitle role="heading" aria-level={2}>
                        Kategori
                      </CardTitle>
                      <CardDescription>Pengeluaran dan porsi setiap kategori.</CardDescription>
                      <CardAction>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Tambah kategori"
                          disabled={Boolean(selected.archived)}
                          onClick={() => openPanel("category")}
                        >
                          <Plus />
                        </Button>
                      </CardAction>
                    </CardHeader>
                    <CardContent>
                      {categoryRows.length ? (
                        <div className="flex flex-col gap-5">
                          {categoryRows.map((category) => {
                            const entry = categoryTotals.get(category.name);
                            const amount = entry?.amount ?? 0;
                            const share = percentage(amount, total);
                            const color =
                              categoryColors.get(category.name) ?? chartClasses[chartClasses.length - 1];
                            return (
                              <div key={category.id} className="flex flex-col gap-2">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <span
                                      aria-hidden="true"
                                      className={cn("size-2.5 shrink-0 rounded-full", color)}
                                    />
                                    <span
                                      className={cn(
                                        "truncate text-sm font-medium",
                                        category.archived && "text-muted-foreground",
                                      )}
                                    >
                                      {category.name}
                                    </span>
                                    {category.archived ? (
                                      <Badge variant="outline">Arsip</Badge>
                                    ) : null}
                                  </div>
                                  <div className="flex shrink-0 items-center gap-1">
                                    <span className="text-sm font-medium tabular-nums">
                                      {rupiah(amount)}
                                    </span>
                                    {!category.archived && !selected.archived ? (
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="icon-xs"
                                            aria-label={`Tindakan untuk kategori ${category.name}`}
                                          >
                                            <MoreHorizontal />
                                          </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                          <DropdownMenuGroup>
                                            <DropdownMenuItem
                                              onSelect={() => renameCategory(category)}
                                            >
                                              <Pencil />
                                              Ubah nama
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                              variant="destructive"
                                              onSelect={() => archiveCategory(category)}
                                            >
                                              <Archive />
                                              Arsipkan
                                            </DropdownMenuItem>
                                          </DropdownMenuGroup>
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    ) : null}
                                  </div>
                                </div>
                                <Progress
                                  value={share}
                                  className="h-2"
                                  indicatorClassName={color}
                                />
                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                  <span>{entry?.count ?? 0} transaksi</span>
                                  <span className="tabular-nums">{share}%</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">Belum ada kategori.</p>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </>
            )}
          </div>
        </SidebarInset>
      </div>

      <Dialog
        open={Boolean(panel)}
        onOpenChange={(open) => {
          if (!open) {
            setPanel("");
            setEdit(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{panelTitle}</DialogTitle>
            <DialogDescription>{panelDescription}</DialogDescription>
          </DialogHeader>
          {error ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>Tidak dapat disimpan</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <form id="rekap-panel" onSubmit={submitPanel}>
            <FieldGroup>
              {panel === "password" ? (
                <>
                  <Field>
                    <FieldLabel htmlFor="currentPassword">Kata sandi saat ini</FieldLabel>
                    <Input
                      id="currentPassword"
                      name="currentPassword"
                      type="password"
                      autoComplete="current-password"
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="newPassword">Kata sandi baru</FieldLabel>
                    <Input
                      id="newPassword"
                      name="newPassword"
                      type="password"
                      autoComplete="new-password"
                      minLength={12}
                      maxLength={128}
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="confirmPassword">Ulangi kata sandi baru</FieldLabel>
                    <Input
                      id="confirmPassword"
                      name="confirmPassword"
                      type="password"
                      autoComplete="new-password"
                      minLength={12}
                      maxLength={128}
                      required
                    />
                  </Field>
                </>
              ) : panel === "profile" ? (
                <>
                  <Field>
                    <FieldLabel htmlFor="name">Nama profil</FieldLabel>
                    <Input id="name" name="name" required />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="chatId">ID chat Telegram</FieldLabel>
                    <Input id="chatId" name="chatId" required />
                  </Field>
                </>
              ) : panel === "category" ? (
                <Field>
                  <FieldLabel htmlFor="name">Nama kategori</FieldLabel>
                  <Input id="name" name="name" required />
                </Field>
              ) : (
                <>
                  <Field>
                    <FieldLabel htmlFor="item">Item</FieldLabel>
                    <Input id="item" name="item" defaultValue={edit?.item} required />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="amount">Jumlah (rupiah)</FieldLabel>
                    <Input
                      id="amount"
                      name="amount"
                      type="number"
                      min={1}
                      step={1}
                      defaultValue={edit?.amount}
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="expense-category">Kategori</FieldLabel>
                    <Select value={expenseCategory} onValueChange={setExpenseCategory}>
                      <SelectTrigger
                        id="expense-category"
                        className="w-full"
                        aria-invalid={!expenseCategory}
                      >
                        <SelectValue placeholder="Pilih kategori" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {data.categories
                            .filter(
                              (category) =>
                                !category.archived || category.id === edit?.category_id,
                            )
                            .map((category) => (
                              <SelectItem key={category.id} value={category.id}>
                                {category.name}
                              </SelectItem>
                            ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="date">Tanggal</FieldLabel>
                    <Input
                      id="date"
                      name="date"
                      type="date"
                      defaultValue={edit ? dateString(edit.occurred_at) : initialDate()}
                      required
                    />
                  </Field>
                </>
              )}
            </FieldGroup>
          </form>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPanel("");
                setEdit(null);
              }}
            >
              Batal
            </Button>
            <Button type="submit" form="rekap-panel">
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
