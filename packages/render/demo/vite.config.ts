import { defineConfig } from 'vite'

// Serves the three.js backend demo: `pnpm --filter @pave/render demo`.
export default defineConfig({ server: { port: 5199, host: '127.0.0.1' } })
