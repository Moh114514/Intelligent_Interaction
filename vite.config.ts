import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production';
  const productionConfig = path.resolve(__dirname, 'api.config.example.ts');
  return {
    base: './',
    server: {
      port: 3000,
      host: '0.0.0.0'
    },
    plugins: [react()],
    resolve: {
      alias: [
        ...(isProduction ? [{ find: './api.config', replacement: productionConfig }] : []),
        { find: '@', replacement: path.resolve(__dirname, '.') }
      ]
    }
  };
});