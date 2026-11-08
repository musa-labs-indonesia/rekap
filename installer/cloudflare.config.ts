import { bindings, defineConfig, exports as workerExports } from 'cf/config'

export default defineConfig({
  worker: {
    name: 'rekap-installer',
    entrypoint: './index.ts',
    compatibilityDate: '2026-11-08',
    domains: process.env.INSTALLER_ORIGIN === 'https://install-rekap-musalabs.ptpcp.id' ? ['install-rekap-musalabs.ptpcp.id'] : undefined,
    workersDev: process.env.INSTALLER_ORIGIN !== 'https://install-rekap-musalabs.ptpcp.id',
    observability: { enabled: false, traces: { enabled: false } },
    exports: {
      InstallerSession: workerExports.durableObject({ storage: 'sqlite' }),
      InstallerJob: workerExports.durableObject({ storage: 'sqlite' }),
    },
    env: {
      SESSION: bindings.durableObject({ worker: 'rekap-installer', exportName: 'InstallerSession' }),
      INSTALL: bindings.durableObject({ worker: 'rekap-installer', exportName: 'InstallerJob' }),
      SESSION_KEY: bindings.secret(),
      OAUTH_CLIENT_ID: bindings.text(process.env.OAUTH_CLIENT_ID ?? ''),
      INSTALLER_ORIGIN: bindings.text(process.env.INSTALLER_ORIGIN ?? ''),
    },
  },
})
