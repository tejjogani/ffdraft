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
  worker: {
    // The kernel's Worker is an ES module with code-split WASM loaders.
    format: 'es',
    // rhino3dm (the kernel's .3dm exporter) requires `ws` only when running under Node.
    rolldownOptions: { external: ['ws'] },
  },
  build: {
    rolldownOptions: {
      // As for the Worker above: `@pave/kernel`'s entry also reaches rhino3dm's Node-only `ws`.
      external: ['ws'],
      // Dependencies change less often than app code; a separate chunk keeps them cached.
      output: { advancedChunks: { groups: [{ name: 'vendor', test: /node_modules/ }] } },
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: false } },
  },
})
