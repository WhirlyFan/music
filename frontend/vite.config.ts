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
  build: {
    // Disable the modulepreload polyfill so Vite never injects an inline
    // <script> bootstrap into index.html. Without this, the moment we add
    // code-splitting (route-based lazy load, dynamic import()), Vite would
    // emit <link rel="modulepreload"> tags AND an inline polyfill script —
    // which would trip the strict `script-src 'self'` CSP.
    //
    // `polyfill: false` is the documented option but historically broken
    // (vitejs/vite#11889). The community-validated workaround is to override
    // `resolveDependencies` to return no dependencies, which short-circuits
    // the same code path. All evergreen browsers + Safari 16.4+ support
    // modulepreload natively, so the polyfill is no longer load-bearing.
    modulePreload: { resolveDependencies: () => [] },
    // Raise Vite's default 500 KB warning. That threshold is the raw,
    // pre-compression size — a heuristic that's tight for a modern React +
    // TanStack + shadcn stack. The bundle today is ~693 KB raw / ~222 KB
    // gzipped, which is well inside the "good first-load" range (industry
    // benchmark: < 300 KB gzipped). The route splitter already pulls
    // heavy deps (the markdown renderer, per-route components) into
    // separate chunks — there's no accidental bloat to fix.
    //
    // 1 MB stays a useful tripwire (~320 KB gzipped — that's when "good"
    // starts shading into "concerning"), so a future heavy dep that's
    // imported eagerly will still warn.
    chunkSizeWarningLimit: 1000,
  },
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
    // Direct fallback proxy when running Vite without nginx in front.
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
      '/_allauth': { target: 'http://localhost:8000', changeOrigin: true },
      '/admin': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
})
