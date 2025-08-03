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
    ],
    hmr: {
      // Cloud Run環境ではHMRを無効化
      overlay: false,
      clientPort: process.env.PORT ? parseInt(process.env.PORT) : 8080
    }
  },
  optimizeDeps: {
    exclude: ['three', 'three/examples/jsm/controls/OrbitControls.js'],
    force: true // Force re-optimization to ensure import maps work
  },
  define: {
    // Cloud Run environment detection
    __IS_CLOUD_RUN__: JSON.stringify(process.env.K_SERVICE !== undefined)
  },
  esbuild: {
    // Preserve import statements for import maps
    format: 'esm',
    target: 'es2020'
  },
  // Cloud Run環境では本番ビルド使用を推奨
  build: {
    rollupOptions: {
      external: ['three', 'three/examples/jsm/controls/OrbitControls.js']
    }
  }
})