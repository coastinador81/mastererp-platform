import {createReadStream, existsSync, statSync} from 'node:fs';
import {createServer} from 'node:http';
import {request} from 'node:https';
import {extname, join, normalize} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const upstream = new URL('https://btqqku792c.execute-api.us-west-1.amazonaws.com');
const port = 4173;
const types = {'.css':'text/css','.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.ttf':'font/ttf','.webp':'image/webp'};

function proxy(req, res) {
  const path = req.url.slice('/dev-api'.length) || '/';
  const headers = {...req.headers, host: upstream.host};
  delete headers.origin;
  delete headers.referer;
  const forwarded = request(upstream, {method:req.method, path, headers}, response => {
    res.writeHead(response.statusCode || 502, response.headers);
    response.pipe(res);
  });
  forwarded.on('error', () => {
    res.writeHead(502, {'content-type':'application/json'});
    res.end(JSON.stringify({error:{message:'No se pudo conectar con la API DEV.'}}));
  });
  req.pipe(forwarded);
}

function staticFile(req, res) {
  const requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const relative = normalize(requested).replace(/^[/\\]+/, '');
  let file = join(root, relative || 'index.html');
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  res.writeHead(200, {'content-type':types[extname(file)] || 'application/octet-stream'});
  createReadStream(file).pipe(res);
}

createServer((req, res) => req.url.startsWith('/dev-api/') ? proxy(req, res) : staticFile(req, res))
  .listen(port, '127.0.0.1', () => console.log(`Storefront local: http://127.0.0.1:${port}`));
