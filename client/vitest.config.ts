import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Form tests type into several fields and open antd Selects and drawers. On their
    // own they take 2–8s, but in a full parallel run (70+ files) the heaviest reach
    // ~16s, too close to 20s; 30s leaves room without hiding a genuinely stuck test.
    testTimeout: 30000,
  },
});
