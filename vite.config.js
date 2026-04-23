import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

const root = path.resolve('.');
const worksDir = path.join(root, 'works');

function worksPlugin() {
  return {
    name: 'prompt-atlas-works',
    configureServer(server) {
      server.middlewares.use('/works', (req, res, next) => {
        const pathname = decodeURIComponent((req.url || '').split('?')[0]);
        const file = path.normalize(path.join(worksDir, pathname));
        if (!file.startsWith(worksDir)) return next();
        if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return next();
        res.setHeader('Cache-Control', 'no-store');
        fs.createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      const outDir = path.join(root, 'dist', 'works');
      fs.rmSync(outDir, { recursive: true, force: true });

      function copyFiltered(src, dst) {
        for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
          const sourcePath = path.join(src, entry.name);
          const targetPath = path.join(dst, entry.name);

          if (entry.isDirectory()) {
            fs.mkdirSync(targetPath, { recursive: true });
            copyFiltered(sourcePath, targetPath);
            continue;
          }

          const ext = path.extname(entry.name).toLowerCase();
          if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') continue;

          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          fs.copyFileSync(sourcePath, targetPath);
        }
      }

      copyFiltered(worksDir, outDir);
    },
  };
}

export default defineConfig({
  root,
  base: './',
  publicDir: 'public',
  plugins: [worksPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
