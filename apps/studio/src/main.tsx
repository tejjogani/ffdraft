import '@fontsource-variable/inter'
import '@fontsource-variable/geist-mono'
import './styles.css'
import { PaveUIProvider } from '@pave/ui'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { queryClient } from './lib/query'
import { router } from './router'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <PaveUIProvider>
        <RouterProvider router={router} />
      </PaveUIProvider>
    </QueryClientProvider>
  </StrictMode>,
)
