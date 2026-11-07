import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Plus, Download, LogOut, WalletCards, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

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

const rupiah = (amount: number) => `Rp${new Intl.NumberFormat("id-ID").format(amount)}`;
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
const monthEnd = () => {
  const [year, month] = initialDate().split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
};

function Home() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [data, setData] = useState<Data>({ profiles: [], categories: [], expenses: [] });
  const [profile, setProfile] = useState("");
  const [start, setStart] = useState(() => `${initialDate().slice(0, 7)}-01`);
  const [end, setEnd] = useState(monthEnd);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [panel, setPanel] = useState("");
  const [edit, setEdit] = useState<Expense | null>(null);
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
        setProfile(result.profiles.find((p) => !p.archived)?.id || result.profiles[0].id);
      setSignedIn(true);
      setError("");
    } catch (e) {
      if (current === requestId.current)
        setError(e instanceof Error ? e.message : "Terjadi kesalahan.");
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
        body: JSON.stringify({ currentPassword: form.get("currentPassword"), newPassword: form.get("newPassword"), revokeOtherSessions: true }),
      });
      if (!response.ok) { setError("Kata sandi tidak dapat diubah. Periksa kata sandi saat ini."); return; }
      setError("");
      setPanel("");
    } catch { setError("Kata sandi tidak dapat diubah. Periksa koneksi Anda."); }
  }
  const total = useMemo(
    () => data.expenses.reduce((sum, expense) => sum + expense.amount, 0),
    [data.expenses],
  );
  const breakdown = useMemo(() => {
    const sums = new Map<string, number>();
    for (const expense of data.expenses)
      sums.set(expense.category, (sums.get(expense.category) || 0) + expense.amount);
    return [...sums.entries()].sort((a, b) => b[1] - a[1]);
  }, [data.expenses]);
  const selected = data.profiles.find((p) => p.id === profile);
  function exportCsv() {
    const safe = (value: string | number) =>
      `"${String(value)
        .replace(/^[=+\-@\t\r]/, "'$&")
        .replaceAll('"', '""')}"`;
    const rows = [
      ["Tanggal", "Item", "Kategori", "Jumlah"],
      ...data.expenses.map((e) => [dateString(e.occurred_at), e.item, e.category, e.amount]),
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

  if (signedIn === null)
    return (
      <main className="auth-wrap">
        <p>Memuat Rekap…</p>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  if (!signedIn)
    return (
      <main className="auth-wrap">
        <div className="auth-mark">
          <WalletCards /> Rekap
        </div>
        <h1>Selamat datang kembali.</h1>
        <p>Masuk untuk melihat catatan pengeluaran Anda.</p>
        <form onSubmit={login}>
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
            <Button type="submit">Masuk</Button>
          </FieldGroup>
        </form>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <p className="hint">Lupa kata sandi? Gunakan perintah pemulihan di Telegram.</p>
      </main>
    );
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <WalletCards aria-hidden="true" /> Rekap <span>catatan pengeluaran</span>
        </div>
        <div>
        <Button variant="ghost" onClick={() => { setError(""); setPanel("password") }}>Ubah kata sandi</Button>
        <Button
          variant="ghost"
          onClick={async () => {
            await fetch("/api/auth/sign-out", { method: "POST" });
            setSignedIn(false);
          }}
        >
          <LogOut data-icon="inline-start" /> Keluar
        </Button>
        </div>
      </header>
      <main className="workspace">
        <div className="page-heading">
          <div>
            <p className="overline">Catatan keuangan</p>
            <h1>Pengeluaran</h1>
            <p>Semua pengeluaran, dalam satu tempat.</p>
          </div>
          <Button
            onClick={() => {
              setEdit(null);
              setPanel("profile");
            }}
          >
            <Plus data-icon="inline-start" /> Profil baru
          </Button>
        </div>
        <div className="profile-bar">
          <label htmlFor="profile">Profil</label>
          <select
            id="profile"
            value={profile}
            onChange={(e) => {
              requestId.current++;
              setData((d) => ({ ...d, expenses: [], categories: [] }));
              setProfile(e.target.value);
              setCategoryFilter("");
            }}
          >
            <option value="">Pilih profil</option>
            {data.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.archived ? " (arsip)" : ""}
              </option>
            ))}
          </select>
          {selected && <span>ID chat {selected.chat_id}</span>}
          {selected &&
            (selected.archived ? (
              <Button variant="ghost" onClick={() => void mutate("restoreProfile", {})}>
                Pulihkan profil
              </Button>
            ) : (
              <Button
                variant="ghost"
                onClick={() => {
                  if (confirm("Arsipkan profil ini? Chat tidak dapat menambah transaksi."))
                    void mutate("archiveProfile", {});
                }}
              >
                Arsipkan profil
              </Button>
            ))}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {!selected ? (
          <section className="empty">
            <h2>Mulai dengan profil.</h2>
            <p>Buat profil dan hubungkan ID chat Telegram untuk mencatat pengeluaran.</p>
            <Button onClick={() => setPanel("profile")}>
              <Plus data-icon="inline-start" /> Buat profil
            </Button>
          </section>
        ) : (
          <>
            <div className="filters">
              <label>
                Dari{" "}
                <input
                  type="date"
                  value={start}
                  onChange={(e) => {
                    requestId.current++;
                    setStart(e.target.value);
                  }}
                />
              </label>
              <label>
                Sampai{" "}
                <input
                  type="date"
                  value={end}
                  onChange={(e) => {
                    requestId.current++;
                    setEnd(e.target.value);
                  }}
                />
              </label>
              <label>
                Kategori{" "}
                <select
                  value={categoryFilter}
                  onChange={(e) => {
                    requestId.current++;
                    setCategoryFilter(e.target.value);
                  }}
                >
                  <option value="">Semua kategori</option>
                  {data.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button variant="outline" disabled={loading} onClick={exportCsv}>
                <Download data-icon="inline-start" /> Ekspor CSV
              </Button>
            </div>
            <section className="summary">
              <div>
                <p>Total pengeluaran</p>
                <strong>{rupiah(total)}</strong>
                <span>{data.expenses.length} transaksi dalam periode ini</span>
              </div>
              <div className="summary-action">
                <p>Catat langsung di sini atau dari Telegram.</p>
                <Button
                  disabled={!!selected.archived}
                  onClick={() => {
                    setEdit(null);
                    setPanel("expense");
                  }}
                >
                  <Plus data-icon="inline-start" /> Tambah transaksi
                </Button>
              </div>
            </section>
            <div className="content-grid">
              <section className="ledger">
                <div className="section-heading">
                  <div>
                    <h2>Transaksi</h2>
                    <p>Catatan untuk periode yang dipilih.</p>
                  </div>
                  <span>{data.expenses.length} transaksi</span>
                </div>
                {loading ? (
                  <p>Memuat transaksi…</p>
                ) : data.expenses.length === 0 ? (
                  <div className="empty-ledger">
                    <h3>Belum ada transaksi.</h3>
                    <p>Catat pengeluaran di Telegram atau tambahkan di sini.</p>
                  </div>
                ) : (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Tanggal</th>
                          <th>Item</th>
                          <th>Kategori</th>
                          <th>Jumlah</th>
                          <th>
                            <span className="sr-only">Tindakan</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.expenses.map((e) => (
                          <tr key={e.id}>
                            <td>{displayDate(e.occurred_at)}</td>
                            <td>{e.item}</td>
                            <td>{e.category}</td>
                            <td>{rupiah(e.amount)}</td>
                            <td>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Ubah ${e.item}`}
                                disabled={!!selected.archived}
                                onClick={() => {
                                  setEdit(e);
                                  setPanel("expense");
                                }}
                              >
                                <Pencil />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Hapus ${e.item}`}
                                disabled={!!selected.archived}
                                onClick={() => {
                                  if (confirm("Hapus transaksi ini?"))
                                    void mutate("deleteExpense", { expenseId: e.id });
                                }}
                              >
                                <Trash2 />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
              <aside>
                <section className="breakdown">
                  <div className="section-heading">
                    <div>
                      <h2>Per kategori</h2>
                      <p>Ringkasan periode ini.</p>
                    </div>
                  </div>
                  {breakdown.length ? (
                    breakdown.map(([name, amount]) => (
                      <div className="category-row" key={name}>
                        <div>
                          <span>{name}</span>
                          <strong>{rupiah(amount)}</strong>
                        </div>
                        <div className="bar">
                          <div style={{ width: `${(amount / total) * 100}%` }} />
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="muted">Belum ada pengeluaran untuk ditampilkan.</p>
                  )}
                </section>
                <section className="categories">
                  <div className="section-heading">
                    <h2>Kategori</h2>
                    <Button
                      variant="ghost"
                      disabled={!!selected.archived}
                      onClick={() => setPanel("category")}
                    >
                      <Plus data-icon="inline-start" /> Tambah
                    </Button>
                  </div>
                  {data.categories.map((c) => (
                    <div className="category-item" key={c.id}>
                      <span>
                        {c.name}
                        {c.archived ? " (arsip)" : ""}
                      </span>
                      {!c.archived && !selected.archived && (
                        <div>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Ubah kategori ${c.name}`}
                            onClick={() => {
                              const name = prompt("Nama kategori", c.name);
                              if (name) void mutate("renameCategory", { categoryId: c.id, name });
                            }}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Arsipkan kategori ${c.name}`}
                            onClick={() => {
                              if (confirm("Arsipkan kategori ini?"))
                                void mutate("archiveCategory", { categoryId: c.id });
                            }}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </section>
              </aside>
            </div>
          </>
        )}
        {panel && (
          <Dialog open onOpenChange={(open) => { if (!open) setPanel("") }}>
            <DialogContent className="dialog" showCloseButton={false} aria-describedby={undefined}>
              <div className="section-heading">
                <DialogTitle>
                  {panel === "password"
                    ? "Ubah kata sandi"
                    : panel === "profile"
                    ? "Profil baru"
                    : panel === "category"
                      ? "Kategori baru"
                      : edit
                        ? "Ubah transaksi"
                        : "Tambah transaksi"}
                </DialogTitle>
                <Button variant="ghost" onClick={() => setPanel("")}>
                  Tutup
                </Button>
              </div>
              {error && <p className="error" role="alert">{error}</p>}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  if (panel === "password") void changePassword(f);
                  else if (panel === "profile")
                    void mutate("createProfile", { name: f.get("name"), chatId: f.get("chatId") });
                  else if (panel === "category")
                    void mutate("createCategory", { name: f.get("name") });
                  else
                    void mutate("saveExpense", {
                      expenseId: edit?.id,
                      amount: f.get("amount"),
                      item: f.get("item"),
                      categoryId: f.get("categoryId"),
                      date: f.get("date"),
                    });
                }}
              >
                <FieldGroup>
                  {panel === "password" ? (
                    <>
                      <Field><FieldLabel htmlFor="currentPassword">Kata sandi saat ini</FieldLabel><Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required /></Field>
                      <Field><FieldLabel htmlFor="newPassword">Kata sandi baru</FieldLabel><Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></Field>
                      <Field><FieldLabel htmlFor="confirmPassword">Ulangi kata sandi baru</FieldLabel><Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></Field>
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
                          min="1"
                          step="1"
                          defaultValue={edit?.amount}
                          required
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="categoryId">Kategori</FieldLabel>
                        <select
                          id="categoryId"
                          name="categoryId"
                          defaultValue={edit?.category_id || ""}
                          required
                        >
                          <option value="">Pilih kategori</option>
                          {data.categories
                            .filter((c) => !c.archived || c.id === edit?.category_id)
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                        </select>
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
                  <Button type="submit">Simpan</Button>
                </FieldGroup>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </main>
    </div>
  );
}
