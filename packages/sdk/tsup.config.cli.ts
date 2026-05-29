import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/cli.ts'],
    format: ['cjs'],
    banner: {
      js: '#!/usr/bin/env node',
    },
    clean: false,
  },
  {
    entry: ['src/author-cli.ts'],
    format: ['cjs'],
    banner: {
      js: '#!/usr/bin/env node',
    },
    clean: false,
  },
]);
