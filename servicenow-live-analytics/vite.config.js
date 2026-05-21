import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Proxy /auth and /api to the Express server during development
      '/auth': { target: 'http://localhost:3000', changeOrigin: true },
      '/api':  { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
})
