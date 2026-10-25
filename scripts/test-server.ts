// Isolated browser-test server. This file never reads .dev.vars or a Neon credential.
import { createServer } from 'node:http';
import { createServer as createViteServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createApp } from '../src/server/index';
import { createTestDatabase } from '../tests/integration/database';

const isolated = await createTestDatabase();
const app = createApp(() => isolated.database);
const vite = await createViteServer({
  configFile: false,
  plugins: [react(), tailwindcss()],
  server: { middlewareMode: true },
  appType: 'spa',
});
const server = createServer(async (req, res) => {
  if (!req.url?.startsWith('/api')) {
    vite.middlewares(req, res);
    return;
  }
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers))
      if (value) headers.set(key, Array.isArray(value) ? value.join(',') : value);
    const body = Buffer.concat(chunks);
    const request = new Request(`http://127.0.0.1:4174${req.url}`, {
      method: req.method,
      headers,
      ...(body.length ? { body: body.toString('utf8') } : {}),
    });
    const response = await app.fetch(request, { DATABASE_URL: '' });
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        error: { code: 'TEST_SERVER_ERROR', message: 'Isolated test server failed.' },
      }),
    );
  }
});
server.listen(4174, '127.0.0.1', () =>
  console.log('Isolated PostgreSQL browser test server: http://127.0.0.1:4174'),
);
async function close() {
  server.close();
  await vite.close();
  await isolated.close();
  process.exit(0);
}
process.on('SIGTERM', () => {
  void close();
});
process.on('SIGINT', () => {
  void close();
});
