// Generates manifest.json for the zero-config cloud bundle. The cloud token is
// baked into mcp_config.env so the user configures NOTHING. The token is read
// from FORGE3D_API_TOKEN at build time and the resulting manifest.json is
// gitignored (never committed). Tool list mirrors the cloud server. Run:
//   FORGE3D_API_TOKEN=... node build-manifest.mjs   (or: npm run bundle)
import { writeFileSync } from 'node:fs';
import { TOOL_DEFS } from '../orchestra-mcp/tools.mjs';

const TOKEN = process.env.FORGE3D_API_TOKEN || '';
const CLOUD_URL = process.env.FORGE3D_CLOUD_URL || 'https://forge3d.duckdns.org/mcp';
if (!TOKEN) { console.error('ERROR: set FORGE3D_API_TOKEN before building (the cloud access token).'); process.exit(1); }

const manifest = {
  $schema: 'https://raw.githubusercontent.com/anthropics/mcpb/main/dist/mcpb-manifest-v0.4.schema.json',
  manifest_version: '0.4',
  name: 'forge3d',
  display_name: 'Forge3D',
  version: '0.1.0',
  description: 'Design 3D-printable gadgets from a sentence — geometry, circuit, firmware & BOM, in the cloud.',
  long_description:
    'Forge3D turns a plain-language goal ("a sumo robot with ultrasonic and 4 motors", "a sensor enclosure with status LEDs and a button") into a complete, validated, 3D-printable electromechanical design: geometry, a wired circuit, firmware, structural + manufacturability checks, and a bill of materials. Zero setup — it runs in the Forge3D cloud. (Optionally pair the free Forge3D desktop app to drive the live 3D viewport and physics Life Sim.)',
  author: { name: 'RewardGuard', url: 'https://github.com/RewardGuard/Forge3D' },
  homepage: 'https://forge3d.duckdns.org',
  icon: 'icon.png',
  keywords: ['3d', '3d-printing', 'cad', 'electronics', 'circuits', 'maker', 'forge3d'],
  license: 'MIT',
  server: {
    type: 'node',
    entry_point: 'index.mjs',
    mcp_config: {
      command: 'node',
      args: ['${__dirname}/index.mjs'],
      env: { FORGE3D_CLOUD_URL: CLOUD_URL, FORGE3D_API_TOKEN: TOKEN },
    },
  },
  tools: TOOL_DEFS.map((t) => ({ name: t.name, description: t.description })),
  tools_generated: false,
  compatibility: { platforms: ['darwin', 'win32', 'linux'], runtimes: { node: '>=18.0.0' } },
};

writeFileSync(new URL('./manifest.json', import.meta.url), JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote manifest.json (${manifest.tools.length} tools, token baked, cloud=${CLOUD_URL})`);
