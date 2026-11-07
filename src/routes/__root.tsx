import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'

import appCss from '../styles.css?url'
import { TooltipProvider } from '@/components/ui/tooltip'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Rekap | Catatan pengeluaran',
      },
      {
        name: 'description',
        content:
          'Rekap mencatat pengeluaran dari Telegram dan menampilkannya sebagai laporan pribadi.',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      {
        rel: 'icon',
        href: '/favicon.svg',
        type: 'image/svg+xml',
      },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <head>
        <HeadContent />
      </head>
      <body>
        <TooltipProvider>{children}</TooltipProvider>

        <Scripts />
      </body>
    </html>
  )
}
