import { fileURLToPath, URL } from 'node:url'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
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
