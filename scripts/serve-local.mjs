import http from 'node:http';
import { createReadStream, appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await realpath(path.join(project, 'dist'));
const artifacts = path.join(project, 'artifacts');
mkdirSync(artifacts, { recursive: true });
const logPath = path.join(artifacts, 'localhost-server.log');
const log = message => appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`);
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  '.bin': 'application/octet-stream', '.wasm': 'application/wasm'
};

async function respond(request, response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'no-cache');
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/__local_health') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify({
        app: 'lunar-horizon-local', pid: process.pid, root, hosts: ['127.0.0.1', '::1'], port: 4173
      }));
      return;
    }
    let target = path.resolve(root, `.${pathname.replaceAll('\\', '/')}`);
    const inside = candidate => candidate === root || candidate.startsWith(root + path.sep);
    if (!inside(target)) { response.writeHead(403).end(); return; }
    target = await realpath(target);
    if (!inside(target)) { response.writeHead(403).end(); return; }
    let info = await stat(target);
    if (info.isDirectory()) {
      target = await realpath(path.join(target, 'index.html'));
      if (!inside(target)) { response.writeHead(403).end(); return; }
      info = await stat(target);
    }
    if (!info.isFile()) { response.writeHead(404).end(); return; }
    response.writeHead(200, {
      'Content-Type': types[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Content-Length': info.size
    });
    if (request.method === 'HEAD') { response.end(); return; }
    const stream = createReadStream(target);
    stream.on('error', error => { log(error.stack); response.destroy(); });
    stream.pipe(response);
  } catch (error) {
    if (!response.headersSent) response.writeHead(error instanceof URIError ? 400 : 404);
    response.end();
  }
}

const servers = [];
for (const host of ['127.0.0.1', '::1']) {
  const server = http.createServer((request, response) => { void respond(request, response); });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen({ port: 4173, host, ipv6Only: host === '::1' }, resolve);
    });
    server.on('error', error => log(error.stack));
    servers.push(server);
    log(`Listening at http://${host === '::1' ? '[::1]' : host}:4173/ (PID ${process.pid})`);
  } catch (error) {
    // IPv6 may be unavailable on some machines; IPv4 remains usable explicitly.
    if (host === '::1' && ['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) {
      log(`IPv6 unavailable: ${error.code}`);
      continue;
    }
    log(`Cannot bind ${host}: ${error.stack}`);
    for (const running of servers) running.close();
    process.exitCode = 1;
    break;
  }
}
if (!process.exitCode) {
  writeFileSync(path.join(artifacts, 'localhost-server.json'), JSON.stringify({
    pid: process.pid, started: new Date().toISOString(), root, port: 4173
  }, null, 2));
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log(`Stopping (${signal})`);
    for (const server of servers) server.close();
  });
}
