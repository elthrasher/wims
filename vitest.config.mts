import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      all: true,
      exclude: ['**/*.spec.ts', 'src/wims.ts', 'src/types/**'],
      include: ['src', 'stacks'],
    },
    poolOptions: { pool: 'forks' },
    server: {
      deps: {
        inline: ['vitest-mock-process'],
      },
    },
    setupFiles: './test/setup.ts',
  },
});
