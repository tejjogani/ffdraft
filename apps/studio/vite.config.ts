import { themeBootScript } from '@pave/ui/theme-boot'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'pave-theme-boot',
      transformIndexHtml: () => [
        { tag: 'script', children: themeBootScript, injectTo: 'head-prepend' },
      ],
    },
  ],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: false } },
  },
})
