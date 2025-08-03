import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: process.env.PORT ? parseInt(process.env.PORT) : 8080,
    strictPort: true,
    allowedHosts: [
      'voxel-society-simulator-150662223250.us-central1.run.app',
      '.run.app', // Cloud Runの全てのホストを許可
      'localhost',
      ...(process.env.ALLOWED_HOSTS ? process.env.ALLOWED_HOSTS.split(',') : [])
    ]
  },
  optimizeDeps: {
    exclude: ['three', 'three/examples/jsm/controls/OrbitControls.js']
  }
})