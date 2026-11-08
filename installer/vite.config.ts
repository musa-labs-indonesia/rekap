import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [cloudflare(), tailwindcss(), react()],
  define: {
    __REKAP_ARTIFACT__: readFileSync(fileURLToPath(new URL('../.cloudflare/installer-artifact/embedded.json', import.meta.url)), 'utf8'),
  },
})
