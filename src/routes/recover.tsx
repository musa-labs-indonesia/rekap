import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'

export const Route = createFileRoute('/recover')({ component: Recover })

function Recover() {
  const [result, setResult] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    if (form.get('password') !== form.get('confirm')) { setResult('Kata sandi tidak sama.'); return }
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token')
    const response = await fetch('/api/recover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password: form.get('password') }) })
    if (response.ok) { window.history.replaceState(null, '', '/recover'); setResult('Kata sandi berhasil diubah. Silakan masuk.') }
    else setResult('Tautan tidak valid atau sudah kedaluwarsa. Kata sandi harus 12 sampai 128 karakter.')
  }
  return <main className="auth-wrap"><div className="auth-mark">Rekap</div><h1>Atur ulang kata sandi.</h1><p>Gunakan kata sandi baru yang sulit ditebak.</p><form onSubmit={submit}><FieldGroup><Field><FieldLabel htmlFor="password">Kata sandi baru</FieldLabel><Input id="password" name="password" type="password" minLength={12} maxLength={128} required /></Field><Field><FieldLabel htmlFor="confirm">Ulangi kata sandi</FieldLabel><Input id="confirm" name="confirm" type="password" minLength={12} maxLength={128} required /></Field><Button type="submit">Simpan kata sandi</Button></FieldGroup></form>{result && <p role="status">{result}</p>}<a href="/">Kembali ke masuk</a></main>
}
