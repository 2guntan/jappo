import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/main.ts', 'src/cli.ts', 'src/worker-main.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  noExternal: [/^@jappo\//],
});
