import { describe, it, expect } from 'vitest';
import type { ToolDefinition } from '@nemesis-oss/binance-sdk';
import { createMcpServer, selectPublicTools } from '../src/mcp-server.js';
import { assertPublicBinanceOnly, PUBLIC_BINANCE_TOOL_NAMES } from '../src/config.js';

describe('MCP Server Bridge', () => {
  it('creates MCP server with tools capability', () => {
    const server = createMcpServer();
    expect(server).toBeDefined();
  });

  it('exposes only public market-data tools, dropping signed and account tools', () => {
    const names = ['spot_ticker_price', 'spot_klines', 'spot_new_order', 'spot_account', 'spot_ws_start_user_stream'];
    const tools = names.map((name) => ({
      name, description: name, inputSchema: {}, handler: async () => ({}),
    })) as unknown as ToolDefinition[];
    expect(selectPublicTools(tools).map((t) => t.name)).toEqual(['spot_ticker_price', 'spot_klines']);
  });
});

describe('Binance public-only guard', () => {
  it('starts with no credentials and with empty credential values', () => {
    expect(() => assertPublicBinanceOnly({})).not.toThrow();
    expect(() => assertPublicBinanceOnly({ BINANCE_API_KEY: '', BINANCE_API_SECRET: '' })).not.toThrow();
  });

  it('refuses to start when any Binance credential is present', () => {
    expect(() => assertPublicBinanceOnly({ BINANCE_API_KEY: 'k' })).toThrow(/BINANCE_API_KEY set/);
    expect(() => assertPublicBinanceOnly({ BINANCE_API_KEY: 'k', BINANCE_API_SECRET: 's' }))
      .toThrow(/BINANCE_API_KEY, BINANCE_API_SECRET set/);
  });

  it('the shared public tool list contains market data only', () => {
    expect(PUBLIC_BINANCE_TOOL_NAMES).not.toContain('spot_new_order');
    expect(PUBLIC_BINANCE_TOOL_NAMES.every((name) => name.startsWith('spot_'))).toBe(true);
  });
});
