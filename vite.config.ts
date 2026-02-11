import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (!id.includes('node_modules')) return;

              if (id.includes('firebase') || id.includes('@firebase')) return 'firebase-vendor';
              if (id.includes('react') || id.includes('scheduler')) return 'react-vendor';
              if (id.includes('lucide-react')) return 'icons-vendor';

              return 'vendor';
            },
          },
        },
      },
    };
});
