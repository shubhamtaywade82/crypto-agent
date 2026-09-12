import { type Server } from 'node:http';
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
export declare function createApiServer(options?: ApiServerOptions): Server;
/**
 * Start the API server. Returns a promise that resolves when listening.
 */
export declare function startApiServer(options?: ApiServerOptions): Promise<Server>;
//# sourceMappingURL=server.d.ts.map