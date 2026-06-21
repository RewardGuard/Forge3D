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

## Install

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

## Status

- ✅ **MCP server** — complete and runnable; lists all tools and forwards calls.
- 🔜 **Forge3D bridge** (Phase 2) — the small local HTTP server inside the
  Electron app that actually runs `runTool()` in the live renderer. Until it is
  wired up, tool calls return a friendly "bridge offline" message. See
  [BRIDGE.md](BRIDGE.md) for the ~40-line implementation sketch.
