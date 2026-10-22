import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://rental:rental_dev_password@localhost:5432/equipment_rental',
      JWT_SECRET: 'test-secret-test-secret-test-secret-123',
      CLIENT_ORIGIN: 'http://localhost:5173',
    },
  },
});
