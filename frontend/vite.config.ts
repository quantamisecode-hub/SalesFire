import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/__tests__/setup.ts',
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/components', 'src/features', 'src/hooks', 'src/api', 'src/services', 'src/utils'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
  server: {
    port: 5173,
    // CSP delivered via HTTP headers (the correct mechanism — directives like
    // frame-ancestors are ignored in <meta> tags). 'unsafe-inline' for script-src
    // is REQUIRED in dev: Vite's react-refresh preamble is an inline module script,
    // and a meta-tag script-src 'self' blocks it, blanking the whole app.
    // NOTE: In production, serve a strict CSP (without 'unsafe-inline') as an
    // HTTP header from the Node backend / reverse proxy serving the built files.
    headers: {
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' http://localhost:8000 ws://localhost:5173 ws://localhost:8000; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    },
    proxy: {
      '/api': 'http://localhost:8000',
      '/socket.io': { target: 'http://localhost:8000', ws: true, changeOrigin: false },
    },
  },
})
