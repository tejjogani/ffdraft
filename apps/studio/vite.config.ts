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
      output: {
        advancedChunks: {
          // A group holds only what it matches; the app's own modules it imports (the schema)
          // stay where the app needs them.
          includeDependenciesRecursively: false,
          groups: [
            // The 3D stack loads with the screens that draw (Design, Render), not with every
            // route: it is most of the dependency weight.
            {
              name: 'three',
              test: /node_modules[\\/](three|three-mesh-bvh|camera-controls)[\\/]|packages[\\/]render[\\/]src[\\/]three[\\/]/,
              priority: 2,
            },
            // Dependencies change less often than app code; a separate chunk keeps them cached.
            { name: 'vendor', test: /node_modules/, priority: 1 },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: false } },
  },
})
