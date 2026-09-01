import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/socket.io': { target: 'http://127.0.0.1:8787', ws: true },
    },
  },
  build: { outDir: 'dist/client' },
})
