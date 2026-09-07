import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { spotTools, type ToolContext, type ToolDefinition } from '@nemesis-oss/binance-sdk';
import { binanceClient } from './config.js';
import { binanceRateLimiter } from './guardians/rate-limiter.js';

const formatToolList = (tools: readonly ToolDefinition[]): Tool[] =>
  tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: { type: 'object', properties: {} },
  }));

const executeToolCall = async (
  tools: readonly ToolDefinition[],
  ctx: ToolContext,
  name: string,
  rawArgs: unknown
): Promise<CallToolResult> => {
  await binanceRateLimiter.requestPermission(name);
  const tool = tools.find((t) => t.name === name);

  if (!tool) {
    return {
      content: [{ type: 'text', text: `Tool "${name}" not found.` }],
      isError: true,
    };
  }

  try {
    const args = (rawArgs ?? {}) as Record<string, unknown>;
    const result = await tool.handler(args, ctx);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown tool error';
    return {
      content: [{ type: 'text', text: `Execution failed for "${name}": ${message}` }],
      isError: true,
    };
  }
};

export const createMcpServer = (): Server => {
  const server = new Server(
    { name: 'binance-public-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  const ctx: ToolContext = {
    env: 'live',
    isSigned: Boolean(process.env.BINANCE_API_KEY),
  };
  const tools = spotTools(binanceClient);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: formatToolList(tools),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) =>
    executeToolCall(tools, ctx, req.params.name, req.params.arguments)
  );

  return server;
};

export const startMcpServer = async (): Promise<void> => {
  const server = createMcpServer();
  // Standard I/O transport is required for Claude Desktop and Cursor extensions
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('🔌 Binance MCP Server running on stdio...\n');
};

if (process.argv[1] && process.argv[1].endsWith('mcp-server.ts')) {
  startMcpServer().catch((err: unknown) => {
    process.stderr.write(`MCP server error: ${String(err)}\n`);
    process.exit(1);
  });
}
