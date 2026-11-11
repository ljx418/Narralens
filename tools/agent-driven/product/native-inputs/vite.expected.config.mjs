import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const entryRoot = dirname(fileURLToPath(import.meta.url));
const nativeTools = resolve(entryRoot, '../../../managed-native-observation/source/packages/openfilm');
export default {
  root: resolve(entryRoot, '..'),
  cacheDir: resolve(entryRoot, '../../vite-cache'),
  resolve: { alias: { react: resolve(nativeTools, 'node_modules/react') } },
  build: {
    outDir: resolve(entryRoot, '../../dist'), emptyOutDir: true, target: 'node22', minify: false, sourcemap: false,
    lib: { entry: resolve(entryRoot, 'native-pure.entry.ts'), formats: ['es'], fileName: () => 'native-pure-library.mjs' },
    rollupOptions: { external: (id) => id.startsWith('node:'), treeshake: { moduleSideEffects: false }, output: { inlineDynamicImports: true } },
  },
};
