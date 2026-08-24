import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolvePublicBase } from './src/config/publicBase.js';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_');

  return {
    base: resolvePublicBase(env.VITE_PUBLIC_BASE),
    plugins: [react()],
  };
});
