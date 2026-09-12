import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { URL } from 'node:url';

import type { MarketStream } from '@nemesis-oss/market-stream';
import type { StrategyRegistry } from '@nemesis-oss/strategy-registry';
import type { ResearchMemory } from '@nemesis-oss/research-memory';

/**
 * Configuration for the market intelligence API server.
 */
export interface ApiServerOptions {
  readonly port?: number;
  readonly host?: string;
  readonly stream?: MarketStream | undefined;
  readonly registry?: StrategyRegistry | undefined;
  readonly memory?: ResearchMemory | undefined;
}

/**
 * Minimal HTTP API server that exposes the market intelligence platform.
 *
 * Endpoints:
 *  GET /health           — health check
 *  GET /markets          — list active market streams
 *  GET /state/:symbol/:timeframe — current MarketState for a stream
 *  GET /events           — all active events across all streams
 *  GET /strategies       — all registered strategies
 *  GET /strategies/:status — strategies filtered by status
 *  GET /research         — stored experiments from research memory
 *  GET /datasets         — stored datasets from research memory
 *
 * All responses are JSON. Errors return 4xx/5xx with { error: string }.
 */
export function createApiServer(options: ApiServerOptions = {}): Server {
  const port = options.port ?? 8080;
  const host = options.host ?? '0.0.0.0';

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? '/', `http://${host}:${port}`);
      const path = url.pathname;
      const segments = path.split('/').filter(Boolean);

      // CORS headers for browser consumers.
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }

      // Route
      if (path === '/health') {
        sendJson(res, 200, { status: 'ok', timestamp: Date.now() });
        return;
      }

      if (path === '/markets' && options.stream) {
        const markets = options.stream.streams.map((key) => ({
          symbol: key.symbol,
          timeframe: key.timeframe,
          alive: options.stream!.isAlive(key),
        }));
        sendJson(res, 200, { markets });
        return;
      }

      if (segments[0] === 'state' && segments.length === 3 && options.stream) {
        const symbol = segments[1]!;
        const timeframe = segments[2]!;
        const state = options.stream.getState({ symbol, timeframe: timeframe as never });
        if (!state) {
          sendJson(res, 404, { error: `No state for ${symbol} ${timeframe}` });
          return;
        }
        sendJson(res, 200, state);
        return;
      }

      if (path === '/events' && options.stream) {
        const allEvents: unknown[] = [];
        for (const key of options.stream.streams) {
          const state = options.stream.getState(key);
          if (state) {
            for (const event of state.activeEvents) {
              allEvents.push({
                event,
                symbol: key.symbol,
                timeframe: key.timeframe,
              });
            }
          }
        }
        sendJson(res, 200, { events: allEvents, count: allEvents.length });
        return;
      }

      if (path === '/strategies' && options.registry) {
        const status = url.searchParams.get('status');
        const strategies = status
          ? options.registry.byStatus(status as never)
          : options.registry.list();
        sendJson(res, 200, { strategies, count: strategies.length });
        return;
      }

      if (path === '/research' && options.memory) {
        sendJson(res, 200, {
          experiments: options.memory.experimentCount,
          strategies: options.memory.strategyCount,
        });
        return;
      }

      if (path === '/datasets' && options.memory) {
        sendJson(res, 200, { datasets: options.memory.listDatasets() });
        return;
      }

      sendJson(res, 404, { error: `Not found: ${path}` });
    } catch (err) {
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : 'Internal server error',
      });
    }
  });

  return server;
}

/**
 * Start the API server. Returns a promise that resolves when listening.
 */
export function startApiServer(options: ApiServerOptions = {}): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createApiServer(options);
    const port = options.port ?? 8080;
    const host = options.host ?? '0.0.0.0';
    server.on('error', reject);
    server.listen(port, host, () => {
      resolve(server);
    });
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}
