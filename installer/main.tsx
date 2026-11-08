import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowRight, Check, ExternalLink, LockKeyhole, WalletCards } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import './styles.css'

type Account = { id: string; name: string }
type Installation = { phase: string; name: string; bot: string; verificationUrl?: string; appUrl?: string; notice?: string }
type Details = { botToken: string; username: string; password: string }

const emptyDetails = { botToken: '', username: '', password: '' }
const phases: Record<string, string> = {
  database: 'Menyiapkan database', database_pending: 'Memeriksa database', migrations: 'Menyiapkan tabel',
  worker: 'Mengunggah aplikasi', worker_pending: 'Memeriksa aplikasi', domain: 'Mengaktifkan alamat',
  health: 'Memeriksa aplikasi', webhook: 'Menghubungkan Telegram', commands: 'Menyiapkan menu bot',
}
const errors: Record<string, string> = {
  'Bot already has a webhook': 'Bot ini sudah terhubung ke webhook lain. Gunakan bot baru agar koneksi lama tidak berubah.',
  'Bot cannot be used': 'Bot tidak bisa bergabung ke grup. Periksa pengaturan bot di BotFather.',
  'No valid workers.dev subdomain': 'Buat subdomain workers.dev di akun Cloudflare ini, lalu coba lagi.',
  'An installation already exists for this account': 'Akun ini sudah memiliki proses pemasangan. Muat ulang halaman untuk melanjutkan.',
  'Installation is busy or missing': 'Pemasangan sedang berjalan atau tidak ditemukan. Coba lagi sebentar.',
  'Database creation is unresolved; check Cloudflare before retrying': 'Pembuatan database belum pasti. Periksa nama resource di Cloudflare sebelum melanjutkan.',
  'Worker upload is unresolved; check Cloudflare before retrying': 'Pengunggahan Worker belum pasti. Periksa nama resource di Cloudflare sebelum melanjutkan.',
  'App is not ready yet': 'Aplikasi belum merespons. Tunggu sebentar, lalu lanjutkan.',
  'Bot webhook changed during installation': 'Webhook bot berubah selama pemasangan. Periksa koneksi bot sebelum melanjutkan.',
  'Invalid installation details': 'Periksa token bot, nama pengguna, dan kata sandi.',
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
      } while (run && current.phase !== 'done' && current.phase !== 'expired' && current.phase !== 'verify')
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
          {accounts && <Button variant="ghost" onClick={disconnect} disabled={busy}>Putuskan koneksi</Button>}
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
              {installation && installation.phase !== 'verify' && installation.phase !== 'done' && installation.phase !== 'expired' && <>
                <p className="text-sm leading-relaxed">Resource baru akan dibuat dengan nama <strong>{installation.name}</strong> di akun <strong>{account.name}</strong>.</p>
                <p className="text-sm text-muted-foreground">{phases[installation.phase] ?? 'Menyiapkan pemasangan'}{busy ? '...' : '.'}</p>
                <Button onClick={() => advance(true)} disabled={busy}>{installation.phase === 'database' ? 'Mulai pemasangan' : 'Lanjutkan pemasangan'} <ArrowRight data-icon="inline-end" /></Button>
                <p className="text-sm text-muted-foreground">Proses dapat dilanjutkan setelah halaman ditutup, selama waktu pemasangan 30 menit belum habis.</p>
              </>}
              {installation?.phase === 'expired' && <>
                <Alert variant="destructive"><AlertTitle>Waktu pemasangan habis</AlertTitle><AlertDescription>Pemasangan tidak dapat dilanjutkan. Resource {installation.name} mungkin sudah dibuat di Cloudflare dan tidak akan dihapus oleh installer. Periksa resource tersebut sebelum memulai ulang.</AlertDescription></Alert>
                <Button variant="outline" onClick={resetExpired} disabled={busy}>Mulai pemasangan baru</Button>
              </>}
              {installation?.phase === 'done' && <>
                <div className="flex items-center gap-3"><span className="flex size-9 items-center justify-center rounded-full bg-secondary"><Check aria-hidden="true" className="size-5" /></span><p className="font-medium">Rekap sudah terpasang.</p></div>
                <p className="text-sm leading-relaxed text-muted-foreground">Masuk dengan akun pemilik, lalu tambahkan profil dan chat Telegram. Matikan privacy mode di BotFather agar bot dapat membaca catatan di grup.</p>
                {installation.notice && <p className="text-sm text-muted-foreground">Menu perintah bot yang sudah ada tidak diubah.</p>}
                <Button asChild><a href={installation.appUrl} target="_blank" rel="noreferrer">Buka Rekap <ExternalLink data-icon="inline-end" /></a></Button>
              </>}
            </>}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
