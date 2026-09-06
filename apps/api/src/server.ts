import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { pool } from './db/pool.js';

const server = createServer(createApp());

server.keepAliveTimeout = 5_000;
server.headersTimeout = 65_000;
server.requestTimeout = 180_000;

server.on('error', (error) => {
  console.error('KnowledgeHub API failed to start', error);
  process.exitCode = 1;
});

server.listen(env.API_PORT, '0.0.0.0', () => {
  console.log(`KnowledgeHub API listening on http://localhost:${env.API_PORT}`);
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);
  server.closeIdleConnections();
  const forceCloseTimer = setTimeout(() => {
    server.closeAllConnections();
  }, 8_000);
  forceCloseTimer.unref();

  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  clearTimeout(forceCloseTimer);
  await pool.end();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
