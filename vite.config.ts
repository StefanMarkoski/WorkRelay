import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vitest/config'

// BASE_PATH is set in CI for project pages (e.g. /work-relay/); defaults to / locally and for custom domains.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
  test: { include: ['supabase/functions/**/*.test.ts', 'src/**/*.test.ts'] },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
})
