import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowRight, Check, ExternalLink, LockKeyhole, WalletCards } from 'lucide-react'
import { GithubIcon } from '@/components/rekap/github-icon'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import './styles.css'

type Account = { id: string; name: string }
type Installation = { phase: string; name: string; bot: string; verificationUrl?: string; appUrl?: string; notice?: string; updateAvailable?: boolean; migrationWorker?: string; migrationWorkerUrl?: string; orphanWorkers?: string[]; orphanVersionTags?: string[]; blocked?: { from?: string; reason?: string; canCancel?: boolean; canRetry?: 'migration' | 'version'; databaseChanged?: boolean; database?: string; previousVersion?: string; newVersion?: string } }
type Details = { botToken: string; username: string; password: string }

const emptyDetails = { botToken: '', username: '', password: '' }
const phases: Record<string, string> = {
  database: 'Menyiapkan database', database_pending: 'Memeriksa database', migrations: 'Menyiapkan tabel',
  worker: 'Mengunggah aplikasi', worker_pending: 'Memeriksa aplikasi', domain: 'Mengaktifkan alamat',
  health: 'Memeriksa aplikasi', webhook: 'Menghubungkan Telegram', commands: 'Menyiapkan menu bot',
  update_prepare: 'Memeriksa aplikasi dan database', update_deploy: 'Menyiapkan versi baru',
  update_migration_domain: 'Mengaktifkan route migrasi', update_migration_apply: 'Memperbarui database', update_migration_cleanup: 'Membersihkan Worker sementara',
  update_deploy_pending: 'Memeriksa versi aktif', update_health: 'Memeriksa aplikasi',
}
const errors: Record<string, string> = {
  'Bot already has a webhook': 'Bot ini sudah terhubung ke webhook lain. Gunakan bot baru agar koneksi lama tidak berubah.',
  'Bot cannot be used': 'Bot tidak bisa bergabung ke grup. Periksa pengaturan bot di BotFather.',
  'No valid workers.dev subdomain': 'Buat subdomain workers.dev di akun Cloudflare ini, lalu coba lagi.',
  'An installation already exists for this account': 'Akun ini sudah memiliki proses pemasangan. Muat ulang halaman untuk melanjutkan.',
  'Installation is busy or missing': 'Pemasangan sedang berjalan atau tidak ditemukan. Coba lagi sebentar.',
  'Installer version changed during installation': 'Versi installer berubah saat pemasangan. Periksa resource di Cloudflare, lalu mulai ulang setelah pemasangan kedaluwarsa.',
  'Database creation is unresolved; check Cloudflare before retrying': 'Pembuatan database belum pasti. Periksa nama resource di Cloudflare sebelum melanjutkan.',
  'Worker upload is unresolved; check Cloudflare before retrying': 'Pengunggahan Worker belum pasti. Periksa nama resource di Cloudflare sebelum melanjutkan.',
  'App is not ready yet': 'Aplikasi belum merespons. Tunggu sebentar, lalu lanjutkan.',
  'Bot webhook changed during installation': 'Webhook bot berubah selama pemasangan. Periksa koneksi bot sebelum melanjutkan.',
  'Invalid installation details': 'Periksa token bot, nama pengguna, dan kata sandi.',
  'Database migrations require a manual update': 'Riwayat atau perubahan database ini membutuhkan pembaruan manual.',
  'Database migration did not complete': 'Perubahan database belum selesai. Periksa database sebelum melanjutkan.',
  'Worker database binding does not match': 'Database Worker tidak cocok dengan pemasangan ini. Pembaruan dihentikan.',
  'Worker secrets are missing': 'Konfigurasi rahasia Worker tidak lengkap. Pembaruan dihentikan.',
  'Worker deployment changed during update': 'Versi aktif Worker berubah. Periksa Cloudflare sebelum melanjutkan.',
  'Migration Worker upload is unresolved; check Cloudflare before retrying': 'Pengunggahan Worker migrasi belum pasti. Periksa Cloudflare sebelum melanjutkan.',
  'Worker version upload is unresolved; check Cloudflare before retrying': 'Pengunggahan versi belum pasti. Periksa Cloudflare sebelum melanjutkan.',
  'Worker deployment is unresolved; check Cloudflare before retrying': 'Penerapan versi belum pasti. Periksa Cloudflare sebelum melanjutkan.',
  'Update is blocked; check Cloudflare before retrying': 'Pembaruan dihentikan karena keadaan Cloudflare belum pasti. Ikuti petunjuk pemeriksaan, lalu pilih Periksa lagi.',
  'Worker subdomain route is not active yet': 'Route Worker sementara belum aktif. Installer tidak akan mengaktifkannya ulang secara otomatis. Tunggu, lalu pilih Periksa lagi. Jika route tetap tidak aktif, pilih Coba Worker baru.',
  'Worker subdomain route is still active': 'Route Worker sementara masih aktif. Installer belum menyelesaikan pembersihan. Periksa Cloudflare, lalu pilih Periksa lagi.',
  'Could not check Worker subdomain': 'Installer tidak dapat membaca status route Worker. Periksa Cloudflare, lalu pilih Periksa lagi.',
  'Update cannot be cancelled': 'Pembaruan tidak dapat dibatalkan karena versi aktif Worker tidak cocok atau database sudah berubah. Periksa Cloudflare.',
  'Update cannot be retried': 'Pembaruan tidak dapat dicoba ulang dari keadaan ini. Periksa Cloudflare.',
}

function pendingMessage(installation: Installation): string {
  if (installation.phase === 'update_migration_upload_pending') return `Pengunggahan Worker migrasi${installation.migrationWorker ? ` ${installation.migrationWorker}` : ''} belum pasti. Installer akan memeriksa Cloudflare. Jika Worker ada dan milik pemasangan ini, pembaruan lanjut. Jika tidak ditemukan atau tidak dapat dibuktikan, pembaruan berhenti. Pilih Periksa lagi. Setelah itu, Anda dapat memilih Coba Worker baru.`
  return 'Pengunggahan versi belum pasti. Installer akan mencari versi dengan penanda pembaruan. Jika ditemukan, pembaruan lanjut. Jika tidak, pembaruan berhenti. Pilih Periksa lagi. Setelah itu, Anda dapat memilih Coba versi baru. Installer tidak memakai ulang tag lama.'
}

function recoveryMessage(installation: Installation): string {
  const worker = installation.migrationWorker ?? 'yang tercatat'
  switch (installation.blocked?.reason) {
    case 'migration_worker_missing':
      return `Worker sementara ${worker} tidak ditemukan. Permintaan unggahan pertama mungkin masih berjalan. Pilih Periksa lagi untuk memeriksa ulang. Jika tidak muncul, pilih Coba Worker baru. Installer tidak akan memakai ulang nama lama.`
    case 'migration_worker_unverified':
      return `Worker sementara ${worker} ada di Cloudflare, tetapi installer tidak dapat membuktikan bahwa Worker itu milik pemasangan ini. Buka Workers & Pages dan periksa binding D1-nya. Jangan hapus Worker lain. Jika Anda yakin Worker itu milik pemasangan ini, matikan route workers.dev dan hapus manual, lalu pilih Periksa lagi. Jika tidak, pilih Coba Worker baru atau batalkan pembaruan.`
    case 'migration_worker_cleanup_unverified':
      return `Database sudah diperbarui, tetapi installer tidak dapat membuktikan bahwa Worker sementara ${worker} masih milik pemasangan ini. Installer tidak mengubah route atau menghapus Worker itu. Route workers.dev mungkin masih aktif. Periksa Worker dan route-nya di Cloudflare. Jika Anda yakin Worker itu milik pemasangan ini, matikan route dan hapus Worker itu secara manual, lalu pilih Periksa lagi.`
    case 'migration_worker_route_disabled':
      return `Route workers.dev untuk Worker sementara ${worker} tidak aktif. Installer sudah mengaktifkannya sebelum migrasi, tetapi route berubah. Aktifkan route itu di Cloudflare, lalu pilih Periksa lagi, atau pilih Coba Worker baru.`
    case 'migration_worker_route_unknown':
      return `Installer tidak dapat membaca status route Worker sementara ${worker}. Jangan anggap Worker itu hilang. Periksa Worker dan route-nya di Cloudflare. Jika route aktif, matikan route dan hapus Worker itu secara manual hanya jika Anda yakin Worker itu milik pemasangan ini, lalu pilih Periksa lagi.`
    case 'migration_worker_route_unreachable':
      return `Cloudflare melaporkan route Worker sementara ${worker} aktif, tetapi URL Worker belum merespons setelah 10 detik. Installer tidak menganggap route itu nonaktif. Tunggu, lalu pilih Periksa lagi. Jika URL tetap tidak merespons, pilih Coba Worker baru atau periksa Worker itu secara manual.`
    case 'migration_worker_route_close_unresolved':
      return `Database sudah diperbarui dan Cloudflare melaporkan route Worker sementara ${worker} nonaktif, tetapi URL Worker masih merespons setelah 10 detik. Tunggu, lalu pilih Periksa lagi. Jika URL masih merespons, hapus Worker itu secara manual hanya jika Anda yakin Worker itu milik pemasangan ini.`
    case 'migration_worker_delete_unresolved':
      return `Database sudah diperbarui, tetapi installer belum dapat menghapus Worker sementara ${worker}. Pilih Periksa lagi untuk mencoba pembersihan lagi.`
    case 'migration_route_enable_failed':
      return `Cloudflare menolak permintaan untuk mengaktifkan route Worker sementara ${worker}. Periksa izin Workers Scripts di akun ini. Setelah izin diperbaiki, pilih Periksa lagi, atau pilih Coba Worker baru.`
    case 'migration_route_enable_unresolved':
      return `Hasil aktivasi route Worker sementara ${worker} belum pasti. Installer tidak akan mengirim permintaan aktivasi kedua karena permintaan pertama mungkin masih berjalan. Tunggu, lalu pilih Periksa lagi. Jika route tetap tidak aktif, pilih Coba Worker baru atau batalkan pembaruan.`
    case 'migration_route_disable_failed':
      return `Database sudah diperbarui, tetapi installer tidak dapat memastikan route Worker sementara ${worker} sudah dimatikan. Jangan tutup halaman. Matikan route workers.dev dan hapus Worker itu secara manual hanya jika Anda yakin Worker itu milik pemasangan ini, lalu pilih Periksa lagi.`
    case 'migration_worker_unknown':
      return 'Data pembaruan tidak lengkap. Periksa Worker dan database di Cloudflare sebelum melanjutkan.'
    case 'worker_version_missing':
      return 'Versi dengan penanda pembaruan ini tidak ditemukan. Permintaan unggahan pertama mungkin masih berjalan. Pilih Periksa lagi untuk memeriksa ulang. Jika tidak muncul, pilih Coba versi baru. Installer tidak akan memakai ulang tag lama.'
    case 'worker_version_ambiguous':
      return 'Ada lebih dari satu versi Worker dengan penanda pembaruan ini. Jangan hapus versi apa pun. Periksa Worker di Cloudflare, lalu pilih Periksa lagi, Coba versi baru, atau batalkan pembaruan.'
    case 'worker_deployment_unresolved':
      return 'Installer tidak dapat memastikan apakah deployment pertama selesai. Jangan ulangi deployment secara otomatis. Periksa versi aktif di Cloudflare. Jika versi baru sudah aktif, pilih Periksa lagi. Jika belum, deploy versi baru secara manual, lalu pilih Periksa lagi.'
    case 'worker_deployment_changed':
      return 'Versi aktif Worker berubah atau bukan satu versi penuh. Periksa deployment di Cloudflare. Jika perlu, kembalikan ke versi sebelumnya, lalu pilih Periksa lagi atau batalkan pembaruan.'
    default:
      return 'Pembaruan dihentikan. Periksa Cloudflare sebelum melanjutkan.'
  }
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const result = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await result.json() as T & { error?: string }
  if (!result.ok) throw new Error(errors[data.error ?? ''] ?? 'Permintaan gagal. Coba lagi atau periksa akun Cloudflare dan bot Telegram.')
  return data
}

function App() {
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [accountId, setAccountId] = useState('')
  const [installation, setInstallation] = useState<Installation | null>(null)
  const [details, setDetails] = useState<Details>(emptyDetails)
  const [review, setReview] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [verificationPending, setVerificationPending] = useState(false)
  const account = accounts?.find(item => item.id === accountId)

  useEffect(() => {
    fetch('/api/session').then(async response => {
      if (response.status === 401) return null
      if (!response.ok) throw new Error('Tidak dapat memuat akun Cloudflare.')
      return response.json() as Promise<{ accounts: Account[] }>
    }).then(data => {
      if (data) {
        setAccounts(data.accounts)
        setAccountId(data.accounts[0]?.id ?? '')
      }
    }).catch(() => setError('Tidak dapat memuat akun Cloudflare. Coba sambungkan kembali.')).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!accountId) return
    let active = true
    setLoading(true)
    setError('')
    setInstallation(null)
    setReview(false)
    api<{ installation: Installation | null }>('/api/install/status', { accountId })
      .then(data => { if (active) setInstallation(data.installation) })
      .catch(cause => { if (active) setError(cause.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [accountId])

  async function connect() {
    setBusy(true)
    setError('')
    try {
      const result = await api<{ url: string }>('/api/oauth/start', {})
      window.location.assign(result.url)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Tidak dapat terhubung.')
      setBusy(false)
    }
  }

  async function disconnect() {
    setBusy(true)
    setError('')
    try {
      await api('/api/oauth/logout', {})
      setAccounts(null)
      setAccountId('')
      setInstallation(null)
      setDetails(emptyDetails)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Tidak dapat memutuskan koneksi.')
    } finally { setBusy(false) }
  }

  async function begin() {
    setBusy(true)
    setError('')
    try {
      const result = await api<{ installation: Installation }>('/api/install/start', { accountId, ...details })
      setDetails(emptyDetails)
      setReview(false)
      setInstallation(result.installation)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Tidak dapat memulai pemasangan.')
    } finally { setBusy(false) }
  }

  async function resetExpired() {
    setBusy(true)
    setError('')
    try {
      await api('/api/install/reset', { accountId })
      setInstallation(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Tidak dapat memulai ulang.')
    } finally { setBusy(false) }
  }

  async function beginUpdate() {
    setBusy(true)
    setError('')
    try {
      const result = await api<{ installation: Installation }>('/api/install/update', { accountId })
      setInstallation(result.installation)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Tidak dapat memulai pembaruan.')
    } finally { setBusy(false) }
  }

  async function cancelUpdate() {
    setBusy(true)
    setError('')
    try {
      const result = await api<{ installation: Installation }>('/api/install/update/cancel', { accountId })
      setInstallation(result.installation)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Tidak dapat membatalkan pembaruan.')
    } finally { setBusy(false) }
  }

  async function retryUpdate(target: 'migration' | 'version') {
    setBusy(true)
    setError('')
    try {
      await api('/api/install/update/retry', { accountId, target })
      const result = await api<{ installation: Installation }>('/api/install/step', { accountId })
      setInstallation(result.installation)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Tidak dapat mencoba ulang pembaruan.')
      try {
        const result = await api<{ installation: Installation | null }>('/api/install/status', { accountId })
        setInstallation(result.installation)
      } catch { setError('Sesi berakhir. Sambungkan kembali untuk memeriksa pembaruan.') }
    } finally { setBusy(false) }
  }

  async function advance(run: boolean) {
    setBusy(true)
    setError('')
    setVerificationPending(false)
    try {
      let current = installation
      do {
        const result = await api<{ installation: Installation }>('/api/install/step', { accountId })
        current = result.installation
        setInstallation(current)
      } while (run && current.phase !== 'done' && current.phase !== 'expired' && current.phase !== 'verify' && current.phase !== 'update_blocked')
      if (!run && current.phase === 'verify') setVerificationPending(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pemasangan terhenti.')
      try {
        const result = await api<{ installation: Installation | null }>('/api/install/status', { accountId })
        setInstallation(result.installation)
      } catch { setError('Sesi berakhir. Sambungkan kembali untuk memeriksa pemasangan.') }
    } finally { setBusy(false) }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5 sm:px-8">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground"><WalletCards aria-hidden="true" className="size-5" /></span>
            <div className="flex flex-col leading-tight"><span className="text-lg font-semibold">Rekap</span><span className="text-xs text-muted-foreground">Pemasangan</span></div>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="icon"><a href="https://github.com/musa-labs-indonesia/rekap" target="_blank" rel="noreferrer" aria-label="Rekap di GitHub"><GithubIcon /></a></Button>
            {accounts && <Button variant="ghost" size="sm" onClick={disconnect} disabled={busy}>Putuskan koneksi</Button>}
          </div>
        </div>
      </header>
      <main className="mx-auto grid max-w-5xl gap-10 px-5 py-10 sm:px-8 sm:py-16 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] md:gap-16">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <h1 className="min-w-0 text-3xl font-semibold tracking-tight sm:text-4xl">Pasang Rekap di Cloudflare</h1>
            <p className="max-w-md leading-relaxed text-muted-foreground">Buat tempat untuk mencatat pengeluaran bersama lewat Telegram.</p>
          </div>
          <ol className="flex flex-col gap-5 text-sm">
            <li className="flex gap-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary font-medium">1</span><span><strong className="block font-medium">Hubungkan Cloudflare</strong><span className="text-muted-foreground">Pilih akun tempat Rekap dipasang.</span></span></li>
            <li className="flex gap-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary font-medium">2</span><span><strong className="block font-medium">Siapkan Telegram</strong><span className="text-muted-foreground">Gunakan bot baru dan verifikasi akunmu.</span></span></li>
            <li className="flex gap-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary font-medium">3</span><span><strong className="block font-medium">Buat aplikasi</strong><span className="text-muted-foreground">Rekap membuat Worker dan database D1.</span></span></li>
          </ol>
          <p className="text-sm"><a className="underline underline-offset-4" href="https://www.youtube.com/playlist?list=PLUxAoMuU5FD0" target="_blank" rel="noreferrer">Tonton panduan pemasangan di YouTube</a></p>
          <p className="flex max-w-md items-start gap-2 text-sm leading-relaxed text-muted-foreground"><LockKeyhole aria-hidden="true" className="mt-0.5 size-4 shrink-0" />Data pengeluaran disimpan di akun Cloudflare yang kamu pilih.</p>
        </div>

        <Card className="h-fit">
          <CardHeader><CardTitle>{!accounts ? 'Hubungkan akun' : installation ? 'Pemasangan Rekap' : review ? 'Periksa sebelum lanjut' : 'Siapkan pemasangan'}</CardTitle><CardDescription>{!accounts ? 'Masuk ke Cloudflare untuk memulai.' : installation ? 'Progres disimpan jika halaman tertutup.' : review ? 'Pastikan akun dan bot yang dipilih sudah benar.' : 'Isi detail bot dan akun pemilik Rekap.'}</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-5">
            {error && <Alert variant="destructive"><AlertTitle>Belum bisa melanjutkan</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
            {loading ? <p className="text-sm text-muted-foreground">Memuat...</p> : !accounts ? <>
              <p className="text-sm leading-relaxed text-muted-foreground">Cloudflare akan meminta izin untuk mengelola Worker dan D1 di akun yang kamu setujui. Izin ini berlaku untuk resource lain di akun tersebut.</p>
              <Button onClick={connect} disabled={busy}>Hubungkan Cloudflare <ArrowRight data-icon="inline-end" /></Button>
            </> : !account ? <p className="text-sm text-muted-foreground">Tidak ada akun Cloudflare yang dapat digunakan.</p> : <>
              {!installation && !review && <form className="flex flex-col gap-5" onSubmit={event => { event.preventDefault(); setReview(true) }}>
                <FieldGroup>
                  <Field><FieldLabel htmlFor="account">Akun Cloudflare</FieldLabel><select id="account" value={accountId} onChange={event => setAccountId(event.target.value)} className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">{accounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><FieldDescription>Worker dan database akan dibuat di akun ini.</FieldDescription></Field>
                  <Field><FieldLabel htmlFor="bot-token">Token bot Telegram</FieldLabel><Input id="bot-token" type="password" autoComplete="off" value={details.botToken} onChange={event => setDetails({ ...details, botToken: event.target.value })} required /><FieldDescription>Buat bot baru di BotFather. Bot yang sudah punya webhook tidak dapat digunakan.</FieldDescription></Field>
                  <Field><FieldLabel htmlFor="username">Nama pengguna pemilik</FieldLabel><Input id="username" autoComplete="username" value={details.username} onChange={event => setDetails({ ...details, username: event.target.value })} minLength={3} maxLength={30} pattern="[A-Za-z0-9_.]+" required /><FieldDescription>Gunakan huruf, angka, titik, atau garis bawah.</FieldDescription></Field>
                  <Field><FieldLabel htmlFor="password">Kata sandi pemilik</FieldLabel><Input id="password" type="password" autoComplete="new-password" value={details.password} onChange={event => setDetails({ ...details, password: event.target.value })} minLength={12} maxLength={128} required /><FieldDescription>Minimal 12 karakter.</FieldDescription></Field>
                </FieldGroup>
                <Button type="submit">Periksa detail <ArrowRight data-icon="inline-end" /></Button>
              </form>}
              {!installation && review && <>
                <dl className="grid gap-4 text-sm"><div><dt className="text-muted-foreground">Akun Cloudflare</dt><dd className="font-medium">{account.name}</dd><dd className="break-all text-muted-foreground">{account.id}</dd></div><div><dt className="text-muted-foreground">Nama pengguna pemilik</dt><dd className="font-medium">{details.username}</dd></div><div><dt className="text-muted-foreground">Token bot dan kata sandi</dt><dd>Disembunyikan</dd></div></dl>
                <p className="text-sm leading-relaxed text-muted-foreground">Langkah berikutnya memeriksa bot dan meminta verifikasi Telegram. Worker dan database baru dibuat setelah kamu menyetujui pemasangan.</p>
                <div className="flex flex-wrap gap-2"><Button onClick={begin} disabled={busy}>Periksa bot <ArrowRight data-icon="inline-end" /></Button><Button variant="outline" onClick={() => setReview(false)} disabled={busy}>Kembali</Button></div>
              </>}
              {installation?.phase === 'verify' && <>
                <p className="text-sm leading-relaxed">Buka bot <strong>@{installation.bot}</strong>, lalu tekan <strong>Start</strong>. Akun Telegram ini digunakan untuk memulihkan kata sandi Rekap.</p>
                <div className="flex flex-wrap gap-2"><Button asChild variant="outline"><a href={installation.verificationUrl} target="_blank" rel="noreferrer">Buka Telegram <ExternalLink data-icon="inline-end" /></a></Button><Button onClick={() => advance(false)} disabled={busy}>Periksa verifikasi</Button></div>
                <p role="status" className="text-sm text-muted-foreground">{verificationPending ? 'Verifikasi belum ditemukan. Buka kembali bot dan tekan Start, lalu periksa lagi.' : 'Jika belum berhasil, buka kembali bot dan tekan Start sebelum memeriksa lagi.'}</p>
              </>}
              {installation && !installation.phase.startsWith('update_') && installation.phase !== 'verify' && installation.phase !== 'done' && installation.phase !== 'expired' && <>
                <p className="text-sm leading-relaxed">Resource baru akan dibuat dengan nama <strong>{installation.name}</strong> di akun <strong>{account.name}</strong>.</p>
                <p className="text-sm text-muted-foreground">{phases[installation.phase] ?? 'Menyiapkan pemasangan'}{busy ? '...' : '.'}</p>
                <Button onClick={() => advance(true)} disabled={busy}>{installation.phase === 'database' ? 'Mulai pemasangan' : 'Lanjutkan pemasangan'} <ArrowRight data-icon="inline-end" /></Button>
                <p className="text-sm text-muted-foreground">Proses dapat dilanjutkan setelah halaman ditutup, selama waktu pemasangan 30 menit belum habis.</p>
              </>}
              {installation?.phase.startsWith('update_') && <>
                <p className="text-sm leading-relaxed">Perbarui <strong>{installation.name}</strong> di akun <strong>{account.name}</strong>. Pembaruan dapat mengubah struktur database. Rahasia Worker dan koneksi Telegram tidak diganti. Cadangkan database sebelum melanjutkan.</p>
                {installation.migrationWorkerUrl && <p className="break-all text-xs text-muted-foreground">Worker migrasi: {installation.migrationWorkerUrl}</p>}
                {installation.phase === 'update_blocked' || installation.phase === 'update_upload_pending' || installation.phase === 'update_migration_upload_pending' ? <>
                  <Alert variant="destructive">
                    <AlertTitle>{installation.phase === 'update_blocked' ? 'Pembaruan dihentikan' : 'Pengunggahan belum pasti'}</AlertTitle>
                    <AlertDescription>{installation.phase === 'update_blocked' ? recoveryMessage(installation) : pendingMessage(installation)}</AlertDescription>
                  </Alert>
                  {installation.blocked && (installation.blocked.database || installation.blocked.previousVersion || installation.blocked.newVersion || installation.migrationWorkerUrl) && <dl className="grid gap-1 text-xs text-muted-foreground">
                    {installation.migrationWorkerUrl && <div className="flex gap-2"><dt>URL Worker</dt><dd className="break-all">{installation.migrationWorkerUrl}</dd></div>}
                    {installation.blocked.database && <div className="flex gap-2"><dt>Database</dt><dd className="break-all">{installation.blocked.database}</dd></div>}
                    {installation.blocked.previousVersion && <div className="flex gap-2"><dt>Versi sebelumnya</dt><dd className="break-all">{installation.blocked.previousVersion}</dd></div>}
                    {installation.blocked.newVersion && <div className="flex gap-2"><dt>Versi baru</dt><dd className="break-all">{installation.blocked.newVersion}</dd></div>}
                  </dl>}
                  {installation.blocked?.databaseChanged && <p className="text-sm text-muted-foreground">Database sudah berubah. Pembaruan ini tidak dapat dibatalkan.</p>}
                  {installation.orphanWorkers?.length ? <p className="break-all text-sm text-muted-foreground">Worker sementara yang belum dibersihkan: {installation.orphanWorkers.join(', ')}. Pilih Periksa lagi untuk mencoba lagi.</p> : null}
                  {installation.orphanVersionTags?.length ? <p className="break-all text-sm text-muted-foreground">Tag versi yang tidak dipakai ulang: {installation.orphanVersionTags.join(', ')}.</p> : null}
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => advance(false)} disabled={busy}>Periksa lagi <ArrowRight data-icon="inline-end" /></Button>
                    {installation.blocked?.canRetry === 'migration' && <Button variant="outline" onClick={() => retryUpdate('migration')} disabled={busy}>Coba Worker baru</Button>}
                    {installation.blocked?.canRetry === 'version' && <Button variant="outline" onClick={() => retryUpdate('version')} disabled={busy}>Coba versi baru</Button>}
                    {installation.blocked?.canCancel && <Button variant="outline" onClick={cancelUpdate} disabled={busy}>Batalkan pembaruan</Button>}
                  </div>
                </> : <>
                  <p className="text-sm text-muted-foreground">{phases[installation.phase] ?? 'Menyiapkan pembaruan'}{busy ? '...' : '.'}</p>
                  <Button onClick={() => advance(true)} disabled={busy}>Lanjutkan pembaruan <ArrowRight data-icon="inline-end" /></Button>
                </>}
              </>}
              {installation?.phase === 'expired' && <>
                <Alert variant="destructive"><AlertTitle>Waktu pemasangan habis</AlertTitle><AlertDescription>Pemasangan tidak dapat dilanjutkan. Resource {installation.name} mungkin sudah dibuat di Cloudflare dan tidak akan dihapus oleh installer. Periksa resource tersebut sebelum memulai ulang.</AlertDescription></Alert>
                <Button variant="outline" onClick={resetExpired} disabled={busy}>Mulai pemasangan baru</Button>
              </>}
              {installation?.phase === 'done' && <>
                <div className="flex items-center gap-3"><span className="flex size-9 items-center justify-center rounded-full bg-secondary"><Check aria-hidden="true" className="size-5" /></span><p className="font-medium">Rekap sudah terpasang.</p></div>
                <p className="text-sm leading-relaxed text-muted-foreground">Masuk dengan akun pemilik, lalu tambahkan profil dan chat Telegram. Matikan privacy mode di BotFather agar bot dapat membaca catatan di grup.</p>
                {installation.notice && <p className="text-sm text-muted-foreground">Menu perintah bot yang sudah ada tidak diubah.</p>}
                {installation.orphanWorkers?.length ? <Alert variant="destructive"><AlertTitle>Pembersihan belum selesai</AlertTitle><AlertDescription>Installer belum dapat menghapus Worker sementara: {installation.orphanWorkers.join(', ')}. Pilih Periksa lagi untuk mencoba pembersihan lagi.</AlertDescription></Alert> : null}
                {installation.orphanVersionTags?.length ? <Alert variant="destructive"><AlertTitle>Versi tidak dipakai</AlertTitle><AlertDescription>Tag versi ini mungkin memiliki versi yang tidak dipakai: {installation.orphanVersionTags.join(', ')}. Jangan hapus versi aktif. Periksa daftar versi Worker di Cloudflare.</AlertDescription></Alert> : null}
                <Button asChild><a href={installation.appUrl} target="_blank" rel="noreferrer">Buka Rekap <ExternalLink data-icon="inline-end" /></a></Button>
                {installation.updateAvailable && <><p className="text-sm text-muted-foreground">Versi baru tersedia. Pembaruan tidak mengganti database atau koneksi Telegram.</p><Button variant="outline" onClick={beginUpdate} disabled={busy}>Perbarui Rekap <ArrowRight data-icon="inline-end" /></Button></>}
              </>}
            </>}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
