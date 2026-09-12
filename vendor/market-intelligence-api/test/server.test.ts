import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:http';

import { createApiServer } from '../src/server.js';
import { createStrategyRegistry } from '@nemesis-oss/strategy-registry';
import { createResearchMemory } from '@nemesis-oss/research-memory';

async function fetchJson(server: Server, path: string): Promise<{ status: number; body: unknown }> {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Server not listening or unix socket');
  }
  const port = address.port;
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  const body = await res.json();
  return { status: res.status, body };
}

describe('market-intelligence-api / server', () => {
  let servers: Server[] = [];

  afterEach(async () => {
    for (const s of servers) {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
    servers = [];
  });

  it('responds to /health', async () => {
    const server = createApiServer({ port: 0 });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve()),
    );

    const { status, body } = await fetchJson(server, '/health');
    expect(status).toBe(200);
    expect((body as { status: string }).status).toBe('ok');
  });

  it('responds to /strategies', async () => {
    const registry = createStrategyRegistry();
    const server = createApiServer({ port: 0, registry });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve()),
    );

    const { status, body } = await fetchJson(server, '/strategies');
    expect(status).toBe(200);
    expect((body as { strategies: unknown[] }).strategies).toEqual([]);
    expect((body as { count: number }).count).toBe(0);
  });

  it('responds to /research', async () => {
    const memory = createResearchMemory();
    const server = createApiServer({ port: 0, memory });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve()),
    );

    const { status, body } = await fetchJson(server, '/research');
    expect(status).toBe(200);
    expect((body as { experiments: number }).experiments).toBe(0);
  });

  it('returns 404 for unknown paths', async () => {
    const server = createApiServer({ port: 0 });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve()),
    );

    const { status } = await fetchJson(server, '/unknown');
    expect(status).toBe(404);
  });

  it('returns 405 for non-GET methods', async () => {
    const server = createApiServer({ port: 0 });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve()),
    );

    const address = server.address();
    const port = (address as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/health`, { method: 'POST' });
    expect(res.status).toBe(405);
  });
});
