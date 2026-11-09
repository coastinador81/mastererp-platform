// Local preview of Platform's canonical static Agent Center source and shared assets.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const agentsWeb = path.join(root, 'frontend/modules/2.6-agent-center/agents-web');
const at = process.argv.indexOf('--port');
const port = at < 0 ? 5183 : Number(process.argv[at + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid preview port');

const mimeByExt = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const files = new Map([
  ['/shared/uonify-isotipo.svg', ['frontend/modules/2.2-finance/src/assets/brands/uonify-isotipo.svg', 'image/svg+xml']],
  ['/', ['frontend/modules/2.6-agent-center/agents-web/index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['frontend/modules/2.6-agent-center/agents-web/index.html', 'text/html; charset=utf-8']],
  ['/crear-agente.html', ['frontend/modules/2.6-agent-center/agents-web/crear-agente.html', 'text/html; charset=utf-8']],
  ['/configuracion.html', ['frontend/modules/2.6-agent-center/agents-web/configuracion.html', 'text/html; charset=utf-8']],
  ['/shared/module-launcher.mjs', ['frontend/shared/module-launcher/module-launcher.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/Inter-latin-variable.woff2', ['frontend/modules/2.2-finance/src/assets/fonts/Inter-latin-variable.woff2', 'font/woff2']],
  ['/shared/Inter-OFL.txt', ['frontend/modules/2.2-finance/public/fonts/Inter-OFL.txt', 'text/plain; charset=utf-8']],
]);

async function resolveEntry(pathname) {
  const fixed = files.get(pathname);
  if (fixed) return fixed;
  if (pathname.startsWith('/agents-web/')) {
    const rel = pathname.slice('/agents-web/'.length);
    if (!rel || rel.includes('..')) return null;
    const ext = path.extname(rel);
    const type = mimeByExt[ext];
    if (!type) return null;
    return [`frontend/modules/2.6-agent-center/agents-web/${rel}`, type];
  }
  if (pathname.startsWith('/0-uonify/0.3-nexus/')) {
    const rel = pathname.slice('/0-uonify/0.3-nexus/'.length);
    if (!rel || rel.includes('..')) return null;
    const ext = path.extname(rel);
    const type = mimeByExt[ext];
    if (!type) return null;
    return [`frontend/modules/0-uonify/0.3-nexus/${rel}`, type];
  }
  return null;
}

http
  .createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const entry = await resolveEntry(pathname);
    if (!entry) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    try {
      const bytes = await readFile(path.join(root, entry[0]));
      res.writeHead(200, { 'Content-Type': entry[1], 'Cache-Control': 'no-store' });
      res.end(bytes);
    } catch {
      res.writeHead(500);
      res.end('Preview asset unavailable');
    }
  })
  .listen(port, '127.0.0.1', () => console.log(`Agent Center preview: http://127.0.0.1:${port}/`));
