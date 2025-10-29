import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
  return {
    base: process.env.BASE_PATH ?? '/',
    plugins: [react()],
    server: {
      host: true,
      port: 5173,
      strictPort: true,
    },
    preview: {
      port: 4173,
      strictPort: true,
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('react-markdown') || id.includes('remark-') || id.includes('rehype-'))
              return 'md';
          },
        },
      },
    },
  };
});
