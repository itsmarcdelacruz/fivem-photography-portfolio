import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'worker',
          environment: 'node',
          include: ['worker/test/**/*.test.js']
        }
      },
      {
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['src/**/*.test.js', 'test/**/*.test.js']
        }
      }
    ]
  }
});
