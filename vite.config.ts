import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const isProduction = mode === 'production';
    const productionConfig = path.resolve(__dirname, 'api.config.example.ts');
    return {
      base: './',
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        // Credentials may be used by the legacy development server only.
        // Production credentials move to the Python sidecar in phase 4.
        'process.env.API_KEY': JSON.stringify(isProduction ? '' : env.GEMINI_API_KEY || ''),
        'process.env.GEMINI_API_KEY': JSON.stringify(isProduction ? '' : env.GEMINI_API_KEY || '')
      },
      resolve: {
        alias: [
          ...(isProduction ? [{ find: './api.config', replacement: productionConfig }] : []),
          { find: '@', replacement: path.resolve(__dirname, '.') }
        ]
      }
    };
});
