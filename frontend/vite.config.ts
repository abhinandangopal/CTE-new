import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // 🟢 ALLOW DOCKER ACCESS
    port: 5173,
    watch: {
      usePolling: true // 🟢 FIX FOR WINDOWS DOCKER FILE SYNC
    }
  }
})