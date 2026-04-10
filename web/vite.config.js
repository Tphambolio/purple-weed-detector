import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    // Dev-only: proxy to the Python backend so we can pull cached test photos
    // for end-to-end testing. Production browser build never hits this.
    proxy: {
      '/api/image': 'http://localhost:8000',
    },
  },
})
