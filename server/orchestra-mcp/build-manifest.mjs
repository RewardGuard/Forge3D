// Generates manifest.json for the Forge3D Orchestra MCP Bundle (.mcpb).
// The tool list is read from tools.mjs so the manifest never drifts. Run:
//   node build-manifest.mjs   (or: npm run manifest)
//
// A .mcpb bundle is what makes this plugin installable from Claude Desktop's
// "+" → Connectors menu with one click (no editing claude_desktop_config.json).
// Spec: https://github.com/anthropics/mcpb/blob/main/MANIFEST.md
import { writeFileSync } from 'node:fs';
import { TOOL_DEFS } from './tools.mjs';

const manifest = {
  $schema: 'https://raw.githubusercontent.com/anthropics/mcpb/main/dist/mcpb-manifest-v0.4.schema.json',
  manifest_version: '0.4',
  name: 'forge3d-orchestra',
  display_name: 'Forge3D Orchestra',
  version: '0.1.0',
  description: 'Let Claude drive Forge3D — design 3D parts, wire circuits, write firmware and run the Life Sim.',
  long_description:
    'Connects Claude to the running Forge3D desktop app through its local control bridge. ' +
    'Claude can generate and arrange 3D geometry, hand wiring to the circuit agent, write firmware, ' +
    'capture and SEE the viewport, run the Life Sim, and hand whole goals to the Orchestra director. ' +
    'Enable the bridge first in Forge3D: Settings → Orchestra AI → "Let Claude control Forge3D".',
  author: { name: 'RewardGuard', url: 'https://github.com/RewardGuard/Forge3D' },
  repository: { type: 'git', url: 'https://github.com/RewardGuard/Forge3D' },
  homepage: 'https://github.com/RewardGuard/Forge3D',
  icon: 'icon.png',
  keywords: ['3d', '3d-printing', 'cad', 'electronics', 'circuits', 'simulation', 'maker', 'forge3d'],
  license: 'MIT',
  server: {
    type: 'node',
    entry_point: 'index.mjs',
    mcp_config: {
      command: 'node',
      args: ['${__dirname}/index.mjs'],
      env: {
        FORGE3D_BRIDGE: '${user_config.bridge_url}',
        FORGE3D_BRIDGE_TOKEN: '${user_config.bridge_token}',
      },
    },
  },
  tools: TOOL_DEFS.map((t) => ({ name: t.name, description: t.description })),
  tools_generated: false,
  user_config: {
    bridge_url: {
      type: 'string',
      title: 'Forge3D bridge URL',
      description: 'Where the Forge3D desktop app exposes its control bridge. Leave the default unless you changed the port.',
      default: 'http://127.0.0.1:8765',
      required: false,
    },
    bridge_token: {
      type: 'string',
      title: 'Bridge token (optional)',
      description: 'Only needed if you generated a token in Forge3D → Settings → Orchestra AI. Paste the same token here.',
      default: '',
      sensitive: true,
      required: false,
    },
  },
  compatibility: {
    platforms: ['darwin', 'win32', 'linux'],
    runtimes: { node: '>=18.0.0' },
  },
};

writeFileSync(new URL('./manifest.json', import.meta.url), JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote manifest.json (${manifest.tools.length} tools)`);
