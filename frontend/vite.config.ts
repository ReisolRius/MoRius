import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules/')) {
            return undefined
          }

          const modulePath = id.split('node_modules/')[1] ?? ''
          const parts = modulePath.split('/')
          const packageName =
            parts[0]?.startsWith('@') && parts[1] ? `${parts[0]}/${parts[1]}` : (parts[0] ?? '')

          if (packageName === '@react-oauth/google') {
            return 'vendor-auth'
          }
          if (packageName === 'react' || packageName === 'react-dom' || packageName === 'scheduler') {
            return 'vendor-react'
          }
          if (packageName.startsWith('@mui') || packageName.startsWith('@emotion')) {
            return 'vendor-ui'
          }
          return 'vendor'
        },
      },
    },
  },
})
