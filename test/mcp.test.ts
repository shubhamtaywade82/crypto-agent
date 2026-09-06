import { describe, it, expect } from 'vitest';
import { createMcpServer } from '../src/mcp-server.js';

describe('MCP Server Bridge', () => {
  it('creates MCP server with tools capability', () => {
    const server = createMcpServer();
    expect(server).toBeDefined();
  });
});
