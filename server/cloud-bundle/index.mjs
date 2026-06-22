#!/usr/bin/env node
// ============================================================================
// Forge3D — Claude Desktop bundle (zero-config cloud).
//
// A tiny stdio MCP server that PROXIES to the hosted Forge3D Cloud connector
// (forge3d.duckdns.org/mcp). The cloud URL + access token are baked in via the
// bundle manifest, so a user just double-clicks the .mcpb, clicks Install, and
// it works — no Forge3D app, no account, no configuration.
//
// Claude Desktop ──stdio──▶ this proxy ──HTTPS (MCP)──▶ Forge3D Cloud
// ============================================================================
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const CLOUD_URL = process.env.FORGE3D_CLOUD_URL || 'https://forge3d.duckdns.org/mcp';
const TOKEN = process.env.FORGE3D_API_TOKEN || '';

// Lazily connect to the cloud (so the connector shows up even if the network
// blips), and reconnect transparently if the upstream drops.
let upstream = null;
async function getUpstream() {
  if (upstream) return upstream;
  const c = new Client({ name: 'forge3d-cloud-bundle', version: '0.1.0' }, { capabilities: {} });
  const t = new StreamableHTTPClientTransport(new URL(CLOUD_URL), {
    requestInit: { headers: TOKEN ? { authorization: 'Bearer ' + TOKEN } : {} },
  });
  await c.connect(t);
  c.onclose = () => { if (upstream === c) upstream = null; };
  upstream = c;
  return c;
}
async function withUpstream(fn) {
  try { return await fn(await getUpstream()); }
  catch (e) { upstream = null; throw e; }
}

const server = new Server({ name: 'forge3d', version: '0.1.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => withUpstream((c) => c.listTools()));
server.setRequestHandler(CallToolRequestSchema, async (req) => withUpstream((c) => c.callTool(req.params)));

await server.connect(new StdioServerTransport());
console.error('Forge3D cloud bundle ready → ' + CLOUD_URL);
