import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig} from '@shipfox/vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    cssCodeSplit: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/build-css-entry.ts'),
      output: {
        entryFileNames: 'css-entry.js',
        assetFileNames: 'styles.css',
      },
    },
  },
  css: {
    minify: true,
  },
});
