import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '*.spec.js',
  use: { baseURL: 'http://127.0.0.1:8877' },
  webServer: { command: '.venv/bin/python -m http.server 8877 --bind 127.0.0.1 --directory extension', port: 8877 }
});
