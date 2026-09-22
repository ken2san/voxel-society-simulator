import { defineConfig } from 'vite'

export default defineConfig({
  optimizeDeps: {
    exclude: ['three', 'three/examples/jsm/controls/OrbitControls.js'],
    force: true // Force re-optimization to ensure import maps work
  },
  esbuild: {
    // Preserve import statements for import maps
    format: 'esm',
    target: 'es2020'
  },
  build: {
    rollupOptions: {
      external: ['three', 'three/examples/jsm/controls/OrbitControls.js']
    }
  }
})