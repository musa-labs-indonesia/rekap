import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Info,
  KeyRound,
  MessageCircle,
  Monitor,
  Rocket,
  Send,
  Settings,
  ShieldCheck,
  Terminal,
  WalletCards,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "Panduan Rekap untuk anggota chat dan operator" },
      {
        name: "description",
        content:
          "Panduan untuk anggota chat dan operator Rekap. Catat pengeluaran lewat Telegram atau siapkan aplikasi di Cloudflare.",
      },
    ],
  }),
  component: Docs,
});

const sections = [
  { id: "mulai", label: "Mulai cepat", icon: Rocket },
  {
    id: "telegram",
    label: "Perintah Telegram",
    icon: MessageCircle,
  },
  {
    id: "website",
    label: "Situs web",
    icon: Monitor,
  },
  { id: "setup", label: "Penyiapan", icon: Settings },
  {
    id: "hubungkan-telegram",
    label: "Hubungkan Telegram",
    icon: Send,
  },
  {
    id: "lokal",
    label: "Pengembangan lokal",
    icon: Terminal,
  },
  {
    id: "pemulihan",
    label: "Pemulihan kata sandi",
    icon: KeyRound,
  },
  {
    id: "keamanan",
    label: "Keamanan dan batasan",
    icon: ShieldCheck,
  },
] as const;

const commands = [
  {
    command: "catat, 20.000, bubur ayam, makan",
    description:
      "Mencatat pengeluaran. Empat bagian wajib: perintah, jumlah, item, dan kategori.",
  },
  {
    command: "/chatid",
    description: "Menampilkan ID chat saat ini, termasuk sebelum profil terhubung.",
  },
  {
    command: "/addcategory nama kategori",
    description: "Menambah kategori baru untuk profil yang terhubung.",
  },
  {
    command: "/report_daily",
    description: "Menampilkan laporan hari ini.",
  },
  {
    command: "/report_weekly",
    description: "Menampilkan laporan minggu ini. Minggu dimulai hari Senin.",
  },
  {
    command: "/report_monthly",
    description: "Menampilkan laporan bulan ini.",
  },
];

const secrets = [
  [
    "APP_URL",
    "Alamat HTTPS publik aplikasi tanpa path atau garis miring di akhir.",
  ],
  [
    "BETTER_AUTH_SECRET",
    "Rahasia acak minimal 32 karakter. Gunakan nilai yang sama pada setiap rilis.",
  ],
  [
    "OWNER_USERNAME",
    "Nama pengguna awal: 3 sampai 30 karakter. Gunakan huruf Latin, angka, garis bawah, atau titik.",
  ],
  ["OWNER_PASSWORD", "Kata sandi awal: 12 sampai 128 karakter."],
  ["TELEGRAM_BOT_TOKEN", "Token bot dari BotFather."],
  ["TELEGRAM_BOT_USERNAME", "Nama bot tanpa tanda @."],
  [
    "TELEGRAM_WEBHOOK_SECRET",
    "Rahasia webhook acak: 1 sampai 256 karakter. Gunakan huruf, angka, garis bawah, atau tanda hubung.",
  ],
  [
    "TRUSTED_TELEGRAM_USER_ID",
    "ID pengguna Telegram numerik yang boleh meminta pemulihan di chat pribadi.",
  ],
];

const websiteFeatures = [
  {
    title: "Profil",
    description:
      "Buat, arsipkan, dan pulihkan profil. Satu profil terhubung ke satu ID chat Telegram.",
  },
  {
    title: "Transaksi",
    description:
      "Tambah, ubah, dan hapus pengeluaran. Tanggal historis didukung.",
  },
  {
    title: "Filter",
    description:
      "Pilih rentang tanggal dan kategori. Total serta rincian per kategori mengikuti filter.",
  },
  {
    title: "Ekspor CSV",
    description: "Unduh transaksi yang sedang tampil sebagai berkas CSV.",
  },
  {
    title: "Kategori",
    description:
      "Tambah, ubah nama, atau arsipkan kategori. Kategori arsip tetap ada di transaksi lama.",
  },
  {
    title: "Kata sandi",
    description: "Ubah kata sandi akun pemilik dari menu situs web.",
  },
];

function scrollToHash(hash: string, behavior: ScrollBehavior): boolean {
  const main = document.getElementById("isi");
  const target = document.getElementById(hash.slice(1));
  if (!main || !target) return false;
  if (hash === "#isi") {
    main.scrollTo({ top: 0, behavior });
    main.focus({ preventScroll: true });
    return true;
  }
  const offset =
    Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
  const top =
    main.scrollTop +
    target.getBoundingClientRect().top -
    main.getBoundingClientRect().top -
    offset;
  main.scrollTo({ top: Math.max(0, top), behavior });
  return true;
}

function Docs() {
  const [active, setActive] = useState<string>(sections[0].id);

  useEffect(() => {
    const main = document.getElementById("isi");
    if (!main) return;
    const updateActive = () => {
      let current: string = sections[0].id;
      for (const section of sections) {
        const element = document.getElementById(section.id);
        if (element && element.getBoundingClientRect().top <= 160) {
          current = section.id;
        }
      }
      setActive(current);
    };
    updateActive();
    main.addEventListener("scroll", updateActive, { passive: true });
    if (window.location.hash) scrollToHash(window.location.hash, "auto");
    return () => main.removeEventListener("scroll", updateActive);
  }, []);

  function navigateInPage(event: MouseEvent<HTMLDivElement>) {
    const anchor = (event.target as HTMLElement).closest("a[href^='#']");
    if (!anchor) return;
    const hash = anchor.getAttribute("href");
    if (!hash || hash === "#") return;
    if (!scrollToHash(hash, "smooth")) return;
    event.preventDefault();
    history.pushState(null, "", hash);
  }

  return (
    <div
      onClick={navigateInPage}
      className="fixed inset-0 bg-secondary p-2 text-foreground sm:p-4 lg:p-6"
    >
      <a
        href="#isi"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:border focus:border-border focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-medium"
      >
        Lompat ke isi
      </a>

      <div className="mx-auto flex h-full max-w-[1440px] flex-col overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-foreground/10">
        <div className="grid min-h-0 flex-1 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="hidden min-h-0 flex-col border-r border-border bg-card px-4 py-6 lg:flex lg:overflow-hidden lg:rounded-l-2xl">
            <a
              href="/"
              aria-label="Halaman utama Rekap"
              className="flex items-center gap-3 px-2"
            >
              <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <WalletCards className="size-5" aria-hidden="true" />
              </span>
              <span className="text-xl font-semibold tracking-tight">Rekap</span>
            </a>
            <div className="mt-8 flex min-h-0 flex-1 flex-col">
              <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Dokumentasi
              </p>
              <DocsNav
                active={active}
                className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1"
              />
            </div>
            <div className="mt-6 rounded-xl border border-border bg-secondary/40 p-4">
              <p className="text-sm font-medium text-foreground">
                Sudah memiliki akun?
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Masuk untuk melihat catatan pengeluaran.
              </p>
              <Button asChild size="sm" className="mt-3 w-full rounded-full">
                <a href="/">Masuk</a>
              </Button>
            </div>
          </aside>

          <div className="flex min-h-0 min-w-0 flex-col rounded-2xl bg-background lg:rounded-l-none lg:rounded-r-2xl">
            <header className="sticky top-0 z-40 flex min-h-[4.5rem] shrink-0 items-center justify-between gap-4 rounded-t-2xl border-b border-border bg-background px-4 py-3 sm:px-6 lg:rounded-tl-none lg:px-8">
              <div className="flex min-w-0 items-center gap-3">
                <a
                  href="/"
                  aria-label="Halaman utama Rekap"
                  className="flex items-center gap-2 lg:hidden"
                >
                  <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <WalletCards className="size-4" aria-hidden="true" />
                  </span>
                  <span className="text-lg font-semibold">Rekap</span>
                </a>
                <div className="hidden items-center gap-2 text-sm text-muted-foreground lg:flex">
                  <span>Panduan Rekap</span>
                  <ChevronRight className="size-3.5" aria-hidden="true" />
                  <span className="font-medium text-foreground">
                    {sections.find((section) => section.id === active)?.label}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className="hidden h-7 items-center gap-2 rounded-full border-border bg-card px-3 text-xs text-muted-foreground sm:inline-flex"
                >
                  <span
                    className="size-1.5 rounded-full bg-primary"
                    aria-hidden="true"
                  />
                  Publik
                </Badge>
                <Button
                  asChild
                  size="sm"
                  variant="outline"
                  className="rounded-full bg-card"
                >
                  <a href="/">Masuk</a>
                </Button>
              </div>
            </header>

            <main
              id="isi"
              tabIndex={-1}
              className="min-h-0 w-full flex-1 overflow-y-auto overscroll-contain"
            >
              <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-8">
                <details
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest("a")) {
                    event.currentTarget.open = false;
                  }
                }}
                className="sticky top-0 z-30 mb-4 rounded-xl border border-border bg-card p-4 shadow-md lg:hidden"
              >
                <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm font-medium">
                  <span className="flex items-center gap-2">
                    <BookOpen
                      className="size-4 text-primary"
                      aria-hidden="true"
                    />
                    Daftar isi
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {sections.find((section) => section.id === active)?.label}
                  </span>
                </summary>
                <DocsNav
                  active={active}
                  className="mt-3 max-h-[55vh] overflow-y-auto overscroll-contain pr-1"
                />
              </details>

              <Card className="relative gap-0 overflow-hidden py-0 shadow-sm">
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full bg-primary/15 blur-3xl"
                />
                <CardContent className="relative p-5 sm:p-7">
                  <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-center">
                    <div>
                      <Badge
                        variant="outline"
                        className="h-7 gap-2 rounded-full border-primary/20 bg-primary/10 px-3 text-primary"
                      >
                        <span
                          className="size-1.5 rounded-full bg-primary"
                          aria-hidden="true"
                        />
                        Panduan publik
                      </Badge>
                      <h1 className="mt-5 max-w-2xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
                        Siapkan Rekap dan catat pengeluaran.
                      </h1>
                      <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
                        Anggota chat mencatat pengeluaran dan meminta laporan
                        lewat Telegram. Operator menyiapkan bot dan mengelola
                        profil. Pemilik harus masuk untuk melihat data di situs web.
                      </p>
                      <div className="mt-6 flex flex-wrap gap-2.5">
                        <Button asChild className="rounded-full">
                          <a href="#mulai">
                            Mulai cepat
                            <ArrowRight
                              data-icon="inline-end"
                              aria-hidden="true"
                            />
                          </a>
                        </Button>
                        <Button
                          asChild
                          variant="outline"
                          className="rounded-full bg-card"
                        >
                          <a href="#setup">Lihat penyiapan</a>
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-xl border border-border bg-secondary/40 p-4">
                      <div className="flex items-center gap-2.5">
                        <span className="flex size-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
                          <MessageCircle className="size-4" aria-hidden="true" />
                        </span>
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            Contoh perintah
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Telegram
                          </p>
                        </div>
                      </div>
                      <pre className="mt-4 whitespace-pre-wrap break-words rounded-lg border border-border bg-card p-3 text-sm leading-6">
                        <code className="font-mono text-foreground">
                          catat, 20.000, bubur ayam, makan
                        </code>
                      </pre>
                      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                        Empat bagian: perintah, jumlah, item, dan kategori.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Fact
                  title="Satu akun pemilik"
                  description="Tidak ada pendaftaran mandiri."
                />
                <Fact
                  title="Satu chat per profil"
                  description="Grup atau chat pribadi Telegram."
                />
                <Fact
                  title="Empat kategori awal"
                  description="Makan, transport, belanja, tagihan."
                />
              </div>

              <div className="mt-4 space-y-4">
            <Section id="mulai" title="Mulai cepat">
              <p>
                Operator harus menyelesaikan penyiapan sebelum dua langkah
                pertama. Anggota chat dapat mulai mencatat setelah bot terhubung.
              </p>
              <ol className="grid gap-4 sm:grid-cols-3">
                <Step number="01" title="Operator membuat profil">
                  Masuk ke situs web dengan akun pemilik. Buat profil, lalu isi
                  nama dan ID chat Telegram. ID grup biasanya negatif.
                </Step>
                <Step number="02" title="Operator menghubungkan bot">
                  Di BotFather, nonaktifkan mode privasi grup. Jika bot sudah ada
                  di grup, keluarkan lalu tambahkan kembali. Atur webhook dengan
                  metode <InlineCode>setWebhook</InlineCode> seperti dijelaskan di{" "}
                  <a className="underline underline-offset-4" href="#hubungkan-telegram">
                    Hubungkan Telegram
                  </a>
                  .
                </Step>
                <Step number="03" title="Anggota chat mencatat pengeluaran">
                  Kirim <InlineCode>catat, 20.000, bubur ayam, makan</InlineCode>{" "}
                  di chat yang terhubung.
                </Step>
              </ol>
              <Callout title="Penting">
                Hanya chat yang terhubung ke profil aktif yang dapat mencatat.
                Profil yang diarsipkan tidak menerima transaksi dari Telegram.
              </Callout>
            </Section>

            <Section id="telegram" title="Perintah Telegram">
              <p>
                Bot menerima perintah di grup atau chat pribadi yang terhubung ke
                profil. Semua anggota chat dapat menambah pengeluaran, menambah
                kategori, atau meminta laporan.
              </p>
              <div className="space-y-3 sm:hidden">
                {commands.map((item) => (
                  <div
                    key={item.command}
                    className="rounded-xl border border-border bg-secondary/40 p-4"
                  >
                    <InlineCode>{item.command}</InlineCode>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                ))}
              </div>
              <div className="hidden overflow-hidden rounded-xl border border-border bg-card sm:block">
                <table className="w-full table-fixed border-collapse text-left text-sm">
                  <caption className="sr-only">
                    Perintah Telegram dan fungsinya
                  </caption>
                  <thead className="bg-secondary/60">
                    <tr>
                      <th
                        scope="col"
                        className="w-[46%] px-3 py-2.5 text-xs font-medium text-muted-foreground"
                      >
                        Perintah
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2.5 text-xs font-medium text-muted-foreground"
                      >
                        Fungsi
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {commands.map((item) => (
                      <tr key={item.command}>
                        <td className="break-words border-t border-border px-3 py-3 align-top">
                          <InlineCode>{item.command}</InlineCode>
                        </td>
                        <td className="border-t border-border px-3 py-3 align-top">
                          {item.description}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="space-y-3">
                <ListItem>
                  Jumlah harus bilangan bulat rupiah lebih dari 0.{" "}
                  <InlineCode>20.000</InlineCode> dan{" "}
                  <InlineCode>20000</InlineCode> diterima.
                </ListItem>
                <ListItem>
                  Total semua pengeluaran dalam satu profil tidak boleh melebihi
                  Rp9.000.000.000.000.000.
                </ListItem>
                <ListItem>
                  Profil baru memiliki kategori{" "}
                  <InlineCode>makan</InlineCode>,{" "}
                  <InlineCode>transport</InlineCode>,{" "}
                  <InlineCode>belanja</InlineCode>, dan{" "}
                  <InlineCode>tagihan</InlineCode>.
                </ListItem>
                <ListItem>
                  Laporan memakai periode Jakarta saat ini. Laporan berisi total,
                  jumlah transaksi, dan tiga transaksi terbaru.
                </ListItem>
                <ListItem>
                  Pesan Telegram yang sama tidak dicatat dua kali.
                </ListItem>
              </ul>
              <Callout title="Edit dan hapus pesan">
                Edit atau hapus pesan Telegram tidak mengubah pengeluaran yang
                sudah tersimpan. Gunakan situs web untuk mengubah atau menghapus
                transaksi.
              </Callout>
            </Section>

            <Section id="website" title="Situs web">
              <p>
                Setiap instalasi memiliki satu akun pemilik. Masuk ke situs web
                dengan nama pengguna dan kata sandi akun tersebut. Pendaftaran
                mandiri tidak tersedia.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {websiteFeatures.map((feature) => (
                  <div
                    key={feature.title}
                    className="rounded-xl border border-border bg-secondary/40 p-4"
                  >
                    <h3 className="text-base font-medium text-foreground">
                      {feature.title}
                    </h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {feature.description}
                    </p>
                  </div>
                ))}
              </div>
              <Callout title="Kategori arsip">
                Kategori yang diarsipkan tetap tampil di transaksi lama, tetapi
                tidak dapat dipilih untuk transaksi baru.
              </Callout>
            </Section>

            <Section id="setup" title="Penyiapan">
              <p>
                Gunakan langkah ini untuk memasang Rekap di Cloudflare. Perintah
                migrasi mengubah database jarak jauh. Periksa ID database sebelum
                menjalankannya.
              </p>

              <h3 className="text-lg font-semibold text-foreground">
                Siapkan kebutuhan berikut
              </h3>
              <ul className="grid gap-2 sm:grid-cols-2">
                <CheckItem>Node.js 22.18 atau lebih baru</CheckItem>
                <CheckItem>Vite+ (vp)</CheckItem>
                <CheckItem>Akun Cloudflare dengan Workers dan D1</CheckItem>
                <CheckItem>Bot Telegram dari BotFather</CheckItem>
              </ul>

              <h3 className="text-lg font-semibold text-foreground">
                1. Pasang dependensi dan masuk ke Cloudflare
              </h3>
              <CodeBlock>{`vp install
vp exec cf auth login`}</CodeBlock>

              <h3 className="text-lg font-semibold text-foreground">
                2. Buat database D1
              </h3>
              <p>
                Buat database, lalu simpan UUID hasilnya di{" "}
                <InlineCode>D1_DATABASE_ID</InlineCode>. UUID di{" "}
                <InlineCode>cloudflare.config.ts</InlineCode> hanya placeholder.
                Jangan terapkan aplikasi dengan UUID itu.
              </p>
              <CodeBlock>{`vp exec cf d1 create --name rekap
export D1_DATABASE_ID="<uuid-dari-hasil>"`}</CodeBlock>
              <p>
                Terapkan migrasi ke database baru. Perintah ini menulis ke
                database jarak jauh. Periksa ID sebelum menjalankan perintah.
              </p>
              <CodeBlock>{`vp exec cf d1 migrations apply "$D1_DATABASE_ID" --dir migrations`}</CodeBlock>

              <h3 className="text-lg font-semibold text-foreground">
                3. Siapkan rahasia Worker
              </h3>
              <p>
                Simpan nilai ini dalam berkas JSON di luar repositori, atau
                gunakan pengelolaan rahasia Cloudflare. Berkas JSON berisi objek
                nama variabel dan nilai string, seperti contoh berikut.
              </p>
              <CodeBlock>{`{
  "APP_URL": "https://YOUR-ORIGIN",
  "BETTER_AUTH_SECRET": "<rahasia-acak-minimal-32-karakter>",
  "OWNER_USERNAME": "<nama-pemilik>",
  "OWNER_PASSWORD": "<kata-sandi-awal>",
  "TELEGRAM_BOT_TOKEN": "<token-dari-BotFather>",
  "TELEGRAM_BOT_USERNAME": "<nama-bot-tanpa-at>",
  "TELEGRAM_WEBHOOK_SECRET": "<rahasia-webhook>",
  "TRUSTED_TELEGRAM_USER_ID": "<id-pengguna-numerik>"
}`}</CodeBlock>
              <p>
                Ganti setiap nilai contoh. Jangan masukkan berkas ini ke Git.
              </p>
              <div className="space-y-3 sm:hidden">
                {secrets.map(([name, description]) => (
                  <div
                    key={name}
                    className="rounded-xl border border-border bg-secondary/40 p-4"
                  >
                    <InlineCode>{name}</InlineCode>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {description}
                    </p>
                  </div>
                ))}
              </div>
              <div className="hidden overflow-hidden rounded-xl border border-border bg-card sm:block">
                <table className="w-full table-fixed border-collapse text-left text-sm">
                  <caption className="sr-only">
                    Variabel rahasia Worker dan nilainya
                  </caption>
                  <thead className="bg-secondary/60">
                    <tr>
                      <th
                        scope="col"
                        className="w-[42%] px-3 py-2.5 text-xs font-medium text-muted-foreground"
                      >
                        Nama
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2.5 text-xs font-medium text-muted-foreground"
                      >
                        Isi
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {secrets.map(([name, description]) => (
                      <tr key={name}>
                        <td className="break-words border-t border-border px-3 py-3 align-top">
                          <InlineCode>{name}</InlineCode>
                        </td>
                        <td className="border-t border-border px-3 py-3 align-top">
                          {description}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h3 className="text-lg font-semibold text-foreground">
                4. Terapkan aplikasi
              </h3>
              <CodeBlock>{`vp exec cf deploy --secrets-file /path/to/secrets.json`}</CodeBlock>
              <p>
                Ganti <InlineCode>/path/to/secrets.json</InlineCode> dengan lokasi
                berkas JSON. Permintaan autentikasi
                pertama membuat akun pemilik. Setelah itu, perubahan pada{" "}
                <InlineCode>OWNER_USERNAME</InlineCode> atau{" "}
                <InlineCode>OWNER_PASSWORD</InlineCode> tidak mengubah akun. Ubah
                kata sandi di situs web. Gunakan nilai{" "}
                <InlineCode>BETTER_AUTH_SECRET</InlineCode> yang sama pada setiap
                penerapan. Gunakan{" "}
                <InlineCode>D1_DATABASE_ID</InlineCode> yang sama, lalu periksa URL
                sebelum menghubungkan Telegram.
              </p>
            </Section>

            <Section id="hubungkan-telegram" title="Hubungkan Telegram">
              <ol className="space-y-4">
                <NumberedItem number="1">
                  Di BotFather, nonaktifkan mode privasi grup. Jika bot sudah ada
                  di grup, keluarkan bot lalu tambahkan kembali.
                </NumberedItem>
                <NumberedItem number="2">
                  Panggil metode <InlineCode>setWebhook</InlineCode> di Telegram
                  Bot API. Atur <InlineCode>url</InlineCode> ke{" "}
                  <InlineCode>https://YOUR-ORIGIN/api/telegram</InlineCode> dan{" "}
                  <InlineCode>secret_token</InlineCode> ke nilai{" "}
                  <InlineCode>TELEGRAM_WEBHOOK_SECRET</InlineCode>. Telegram harus
                  dapat mengakses URL melalui HTTPS.
                </NumberedItem>
                <NumberedItem number="3">
                  Kirim <InlineCode>/chatid</InlineCode> di chat yang ingin
                  dihubungkan. Bot akan membalas dengan ID chat; ID grup biasanya
                  negatif.
                </NumberedItem>
                <NumberedItem number="4">
                  Masuk ke situs web sebagai pemilik, lalu buat profil dengan ID
                  chat tersebut.
                </NumberedItem>
              </ol>
              <Callout title="Rahasia">
                Perlakukan token bot dan rahasia webhook seperti kata sandi.
                Jangan masukkan ke riwayat shell, log, atau tangkapan layar.
              </Callout>
            </Section>

            <Section id="lokal" title="Pengembangan lokal">
              <p>
                Buat berkas <InlineCode>.dev.vars</InlineCode> yang diabaikan Git
                dengan variabel yang sama. Gunakan{" "}
                <InlineCode>APP_URL=http://localhost:3000</InlineCode> dan
                kredensial non-produksi.
              </p>
              <CodeBlock>{`vp exec cf d1 migrations apply 11111111-1111-4111-8111-111111111111 --local --persist-to .cloudflare/state --dir migrations
vp exec cf dev`}</CodeBlock>
              <p>
                Telegram tidak dapat mengirim webhook langsung ke{" "}
                <InlineCode>localhost</InlineCode>. Gunakan layanan penerusan
                HTTPS publik. Jangan gunakan rahasia produksi atau data
                pengeluaran nyata di pengembangan lokal.
              </p>
              <h3 className="text-lg font-semibold text-foreground">
                Jalankan pemeriksaan
              </h3>
              <CodeBlock>{`vp exec tsc --noEmit
vp test run src/server/auth.test.ts --config src/server/auth/test.config.ts
vp test run --root src/server telegram.test.ts
vp exec cf build`}</CodeBlock>
              <p>
                Tes memakai adapter SQLite lokal, bukan database D1 di Cloudflare
                atau Telegram Bot API langsung.
              </p>
            </Section>

            <Section id="pemulihan" title="Pemulihan kata sandi">
              <p>
                Kirim <InlineCode>/forgot_password</InlineCode> ke bot di chat
                pribadi dari akun Telegram tepercaya. Tautan berlaku 10 menit dan
                hanya bisa dipakai sekali. Jangan bagikan tautan.
              </p>
              <p>
                Jika Telegram tidak tersedia, operator dengan akses tulis D1 dapat
                membuat tautan pemulihan dari terminal tepercaya.
              </p>
              <CodeBlock>{`export D1_DATABASE_ID="<uuid-database>"
export APP_URL="https://YOUR-ORIGIN"
node scripts/recover.mjs`}</CodeBlock>
              <p>
                Perintah ini menulis ke database jarak jauh dan membatalkan tautan
                pemulihan yang ada. Perintah mencetak tautan sensitif; jangan
                simpan atau bagikan keluaran terminal. Buka tautan dalam 10 menit
                dan atur kata sandi baru. Untuk database lokal yang dapat dibuang,
                tambahkan <InlineCode>--local</InlineCode> dan gunakan ID database
                serta alamat dasar lokal.
              </p>
            </Section>

            <Section id="keamanan" title="Keamanan dan batasan">
              <Callout title="Versi awal">
                Uji Rekap dengan data tidak sensitif sebelum memakainya. Cadangkan
                database D1 secara teratur.
              </Callout>
              <ul className="space-y-3">
                <ListItem>
                  Batas masuk dan pemulihan berlaku per IP. Batas ini tidak
                  menghentikan tebakan kata sandi terdistribusi. Gunakan kata
                  sandi kuat dan tambahkan kontrol akses Cloudflare jika situs
                  terbuka untuk publik.
                </ListItem>
                <ListItem>
                  Sebelum mengaktifkan pelacakan Worker, pastikan catatan
                  pelacakan menyamarkan token bot pada URL permintaan Telegram
                  keluar. Nonaktifkan log isi permintaan dan batasi akses ke log
                  serta cadangan D1.
                </ListItem>
                <ListItem>
                  Setiap instalasi memiliki satu akun pemilik. Setiap profil
                  terhubung ke satu chat.
                </ListItem>
                <ListItem>
                  WhatsApp belum didukung. Batas dan harga Cloudflare dapat
                  berubah. Periksa kuota Workers dan D1 sebelum menerapkan aplikasi.
                </ListItem>
              </ul>
            </Section>
              </div>

              <footer className="mt-8 flex flex-col gap-3 border-t border-border pt-5 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <p>Rekap mencatat pengeluaran dari Telegram.</p>
                <div className="flex gap-4">
                  <a href="#isi" className="hover:text-foreground">
                    Kembali ke atas
                  </a>
                  <a href="/" className="hover:text-foreground">
                    Masuk
                  </a>
                </div>
              </footer>
              </div>
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}

function DocsNav({
  active,
  className = "",
}: {
  active: string;
  className?: string;
}) {
  return (
    <nav aria-label="Daftar isi" className={className}>
      <ul className="flex flex-col gap-1">
        {sections.map((section) => {
          const Icon = section.icon;
          const isActive = section.id === active;
          return (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                aria-current={isActive ? "location" : undefined}
                className={`group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-secondary font-medium text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                }`}
              >
                <Icon
                  className={`size-4 shrink-0 ${
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground group-hover:text-foreground"
                  }`}
                  aria-hidden="true"
                />
                <span>{section.label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 lg:scroll-mt-6">
      <Card className="gap-0 py-0 shadow-sm">
        <CardContent className="p-5 sm:p-7">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="h-5 w-1 rounded-full bg-primary"
            />
            <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              {title}
            </h2>
          </div>
          <div className="mt-4 space-y-5 text-sm leading-relaxed text-muted-foreground sm:text-[15px] [&>p]:max-w-3xl [&>ul]:max-w-3xl">
            {children}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function Fact({ title, description }: { title: string; description: string }) {
  return (
    <Card size="sm" className="gap-0 py-0 shadow-sm">
      <CardContent className="flex items-start gap-3 p-4">
        <span
          aria-hidden="true"
          className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
        />
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function Step({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="rounded-xl border border-border bg-secondary/40 p-4">
      <span className="inline-flex size-8 items-center justify-center rounded-lg bg-primary/10 text-xs font-semibold text-primary">
        {number}
      </span>
      <h3 className="mt-3 text-base font-medium text-foreground">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        {children}
      </p>
    </li>
  );
}

function NumberedItem({
  number,
  children,
}: {
  number: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-semibold text-primary">
        {number}
      </span>
      <span>{children}</span>
    </li>
  );
}

function ListItem({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="mt-2 size-1.5 shrink-0 rounded-full bg-primary"
      />
      <span>{children}</span>
    </li>
  );
}

function CheckItem({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Check
        className="mt-0.5 size-4 shrink-0 text-primary"
        aria-hidden="true"
      />
      <span>{children}</span>
    </li>
  );
}

function InlineCode({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-md border border-border bg-secondary/60 px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">
      {children}
    </code>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-secondary/40">
      <pre className="whitespace-pre-wrap break-words p-4 text-sm leading-6">
        <code className="font-mono text-foreground">{children}</code>
      </pre>
    </div>
  );
}

function Callout({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
      <div className="flex items-center gap-2">
        <Info className="size-4 text-primary" aria-hidden="true" />
        <p className="text-sm font-medium text-foreground">{title}</p>
      </div>
      <div className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </div>
  );
}
