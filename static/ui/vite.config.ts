import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Forge serves Custom UI from a sub-path, so assets must be relative (base './').
// Output goes to build/, which manifest.yml points at (resources.ui).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'build', emptyOutDir: true, sourcemap: false },
});
