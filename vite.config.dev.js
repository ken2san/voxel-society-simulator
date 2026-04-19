import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: process.env.PORT ? parseInt(process.env.PORT) : 3000,
    strictPort: false,
    allowedHosts: ['localhost']
  },
  // Docker dev environment: use node_modules Three.js
  optimizeDeps: {
    include: ['three', 'three/examples/jsm/controls/OrbitControls.js']
  }
})
