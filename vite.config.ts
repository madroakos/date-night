import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  resolve: { tsconfigPaths: true },
  optimizeDeps: { exclude: ['maplibre-gl'] },
  plugins: [
    devtools(),
    tailwindcss(),
    tanstackStart({ prerender: { enabled: true, failOnError: true } }),
    viteReact(),
  ],
})

export default config
