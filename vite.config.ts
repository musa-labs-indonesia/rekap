import { defineConfig } from 'vite'

import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  server: { port: 3000 },
  plugins: [cloudflare({ viteEnvironment: { name: 'ssr' } }), tailwindcss(), tanstackStart(), viteReact()],
})

export default config
