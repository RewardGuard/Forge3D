# Forge3D Orchestra — Claude plugin (MCP)

Let **Claude** drive Forge3D the same way you would: generate 3D objects, hand
wiring to the circuit agent, write firmware, and test the build in the Life Sim
— all through tool calls. It exposes the **same Orchestra action API** the in-app
director uses (`src/lib/orchestraTools.js`), so the vocabulary is identical.

```
Claude ──stdio(MCP)──▶ forge3d-orchestra ──HTTP──▶ Forge3D bridge ──▶ runTool()
```

## Tools

`get_state`, `get_netlist`, `parts_catalog`, `add_primitive`, `gen_mesh`,
`move_mesh`, `attach_motor`, `set_material`, `group`, `add_part`,
`build_circuit`, `gen_code`, `project_circuit_3d`, `set_tab`, `run_sim`,
`pause_sim`, `set_joystick`, `set_input`, `get_sim_report`, `look`, and
`orchestrate` (hand a whole goal to the in-app director). `look` returns the
viewport screenshot as an image block, so Claude can **see** the design.

## Install — one click (recommended)

Ship it as an **MCP Bundle** (`.mcpb`) so it appears in Claude Desktop's
**`+` → Connectors** menu with a toggle — no editing `claude_desktop_config.json`.

```bash
cd server/orchestra-mcp
npm install            # bundles the SDK into the .mcpb
npm run bundle         # → forge3d-orchestra.mcpb (icon + manifest + server)
```

Then in **Claude Desktop → Settings → Extensions** (or Connectors), drag in
`forge3d-orchestra.mcpb` (or double-click it) and click **Install**. It shows up
in the menu like Gmail/Drive do; the install dialog asks for the bridge URL
(default `http://127.0.0.1:8765`) and an optional token. Flip it on and chat.

> The bundle is the prebuilt single-file form of the manual install below — same
> server, same tools. `manifest.json` (generated from the live tool list by
> `npm run manifest`) is what lets Claude Desktop install it directly.

### Getting it into Claude's official directory ("so Anthropic puts it there")

The in-app **Connectors directory** lists **remote** MCP servers (hosted, with
OAuth) — Anthropic reviews and adds those. This plugin is **local** (it talks to
`127.0.0.1`), so the directory isn't the right channel; the `.mcpb` above is how
people install a local connector. To pursue a directory listing you'd host the
server remotely with OAuth and apply via Anthropic's connector-submission form
(<https://www.anthropic.com> → developer/connectors). Forge3D drives the user's
own desktop, so the local bundle is the intended distribution.

## Install — manual (developer)

```bash
cd server/orchestra-mcp
npm install
```

### Claude Desktop — `claude_desktop_config.json`

```json
{
  "mcpServers": {
    "forge3d-orchestra": {
      "command": "node",
      "args": ["/absolute/path/to/forge3d/server/orchestra-mcp/index.mjs"]
    }
  }
}
```

### Claude Code — `.mcp.json`

```json
{
  "mcpServers": {
    "forge3d-orchestra": {
      "command": "node",
      "args": ["./server/orchestra-mcp/index.mjs"]
    }
  }
}
```

The bridge URL defaults to `http://127.0.0.1:8765` (override with the
`FORGE3D_BRIDGE` env var).

## Turn it on

The bridge is **off by default**. In the Forge3D desktop app open
**Settings → Orchestra AI → "Let Claude control Forge3D (MCP plugin)"** and flip
it **On**. The panel shows the listening address and a copy-paste config snippet;
optionally generate a shared token and mirror it into the plugin's
`FORGE3D_BRIDGE_TOKEN` env var. Restart Claude, then just ask it to build something.

## Status

- ✅ **MCP server** — complete; lists all 32 tools and forwards calls (now sends an
  optional `Authorization: Bearer` token and surfaces `screenshot` as an image).
- ✅ **Forge3D bridge** (Phase 2) — the localhost HTTP server in the Electron main
  process runs `runTool()` / `runOrchestra()` in the live renderer. Off by default
  behind a Settings toggle. See [BRIDGE.md](BRIDGE.md).
- 🧪 `npm test` — drives the real MCP server against a mock bridge (no Electron
  needed): tool list, token forwarding, results, and image surfacing.
