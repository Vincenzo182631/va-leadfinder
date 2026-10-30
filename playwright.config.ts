import { defineConfig, devices } from '@playwright/test';

// Isolated e2e stack: fresh database vlf_e2e, API on 8788, web on 5174.
const E2E_ADMIN_ID = '00000000-0000-4000-8000-0000000e2e01';
const apiEnv = {
  APP_ENV: 'development',
  DATABASE_URL: 'postgres://postgres@127.0.0.1:54329/vlf_e2e',
  AUTH_MODE: 'local',
  LOCAL_AUTH_JWT_SECRET: 'e2e-local-secret-0123456789abcdef0123456789',
  PAYMONGO_MODE: 'mock',
  PAYMONGO_WEBHOOK_SECRET: 'e2e-webhook-secret-0123456789',
  ADMIN_USER_IDS: E2E_ADMIN_ID,
  TRANSACTIONAL_EMAIL_PROVIDER: 'console',
  API_PORT: '8788',
  CORS_ORIGINS: 'http://localhost:5174',
  APP_BASE_URL: 'http://localhost:5174',
};

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  globalSetup: './tests/e2e/global-setup.ts',
  use: { baseURL: 'http://localhost:5174', trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
  webServer: [
    {
      command: 'bash scripts/db-local.sh reset vlf_e2e >/dev/null && pnpm --filter @vlf/api exec tsx src/node.ts',
      url: 'http://127.0.0.1:8788/api/health',
      env: apiEnv,
      timeout: 90_000,
      reuseExistingServer: false,
    },
    {
      command: 'pnpm --filter @vlf/web exec vite --port 5174 --strictPort',
      url: 'http://localhost:5174',
      env: { VITE_PROXY_TARGET: 'http://127.0.0.1:8788', VITE_AUTH_MODE: 'local' },
      timeout: 60_000,
      reuseExistingServer: false,
    },
  ],
});
