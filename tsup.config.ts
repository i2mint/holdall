import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts', zodal: 'src/zodal.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ['@zodal/store'],
    // canonicalize is ESM-only; bundling it (0.8 KB) keeps the CJS build working on every Node.
    noExternal: ['canonicalize'],
  },
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    platform: 'node',
    noExternal: ['canonicalize'],
  },
]);
