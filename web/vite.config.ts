import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Tests that render the whole app and type into it exceed the default 5s when files run in parallel.
  test: { testTimeout: 20_000 },
  server: {
    proxy: { '/api': 'http://127.0.0.1:7071' },
  },
});
