import { fileURLToPath, URL } from 'node:url'

import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    // React Compiler — auto-memoizes pure components and hooks so we don't
    // hand-write useMemo / useCallback / React.memo for re-render perf.
    // Stable since 1.0 (April 2025). `@vitejs/plugin-react` v6 dropped the
    // built-in Babel option and exposes `reactCompilerPreset` instead,
    // wired through `@rolldown/plugin-babel`. The
    // `eslint-plugin-react-compiler` rule warns on Rules of React
    // violations that would disable the compiler for a given component.
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // ESM-safe: __dirname is undefined in ESM, so derive the src dir from import.meta.url.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    // In Docker, nginx forwards requests with Host: localhost but the container
    // hostname Vite sees is "frontend". Disable the host check — we're behind
    // a reverse proxy in dev and not exposed publicly.
    allowedHosts: true,
    // Allow reading `docs/` at the repo root (one level up from frontend/)
    // so the in-app docs viewer can `import.meta.glob` the markdown files
    // there. Vite's default fs.allow is the project root, which excludes
    // anything above `frontend/`. Production builds inline the markdown
    // (eager glob) so this setting only matters in dev.
    fs: {
      allow: ['..'],
    },
    // Direct fallback proxy when running Vite without nginx in front.
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
      '/_allauth': { target: 'http://localhost:8000', changeOrigin: true },
      '/admin': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
})
