/// <reference types="vitest/config" />
import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// `npm run dev:vr` (mode "vr") serves over HTTPS on the LAN: WebXR needs a secure
// context, and the Quest browser reaches the dev machine by its IP address.
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'vr' ? [basicSsl()] : [])],
  build: {
    // three.js + R3F + the game are ~1.75 MB minified (≈510 KB gzip).
    chunkSizeWarningLimit: 1900,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}))
