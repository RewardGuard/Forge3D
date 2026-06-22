# Forge3D Cloud — remote MCP connector

The **directory-listable** version of the Forge3D plugin. Where the local bundle
([../orchestra-mcp](../orchestra-mcp)) runs on the user's machine and talks to
`127.0.0.1`, this one is **hosted** and reachable by any Claude user over HTTPS.

```
Claude ──HTTPS (Streamable HTTP MCP)──▶  Forge3D Cloud
                                          ├─ desktop paired & online ──▶ relay to the LIVE app (3D + Life Sim)
                                          └─ otherwise                ──▶ Cloud Orchestra (headless engine → files)
```

Same 32-tool vocabulary as the local plugin. The difference is **reach**:

- **No install?** `orchestrate "a sumo robot with ultrasonic, 4 motors and an arduino"` runs the
  real engineering engine ([orchestraCore.js](../../src/lib/orchestraCore.js)) server-side and returns a
  **validated** design: spec geometry, netlist, firmware and a BOM + feasibility report.
- **Desktop paired?** Every tool (mesh gen, the running Life Sim, vision…) drives your **live** app.
  The desktop dials *out* to this server (outbound long-poll), so there's no inbound port to open.

## Run locally

```bash
cd server/cloud-mcp
npm install
PORT=8788 node index.mjs
# health: curl localhost:8788/health
```

Point a local Claude Code at it via `.mcp.json`:

```json
{ "mcpServers": { "forge3d-cloud": { "url": "http://127.0.0.1:8788/mcp" } } }
```

## Configure with the wizard (recommended)

```bash
npm run setup     # asks you for each value, says where to get it, writes ./.env (chmod 600)
npm run doctor    # checks a running/deployed server + your JWKS are reachable
```

`setup` runs **on your machine and prompts you** — secrets you type go straight
into `.env` and are never printed back or sent anywhere. It auto-generates the API
and pairing tokens, and walks you through OAuth only if you're listing in the
directory. (Run without a terminal, e.g. CI, and it fills defaults + generates
tokens non-interactively; real env vars always override.)

## Configuration (env)

Set by the wizard, or edit `.env` by hand (see `.env.example`).

| Var | Purpose |
|-----|---------|
| `PORT` | listen port (default 8788) |
| `FORGE3D_PUBLIC_URL` | public base URL (used in OAuth metadata) |
| `FORGE3D_API_TOKEN` | if set, MCP clients must send `Authorization: Bearer <it>` (single-tenant). Unset = open (put it behind your own auth). |
| `FORGE3D_PAIR_TOKEN` | enables desktop pairing; the desktop app must present the same token |
| `FORGE3D_OAUTH_ISSUER` | set to your IdP to advertise OAuth discovery (for the directory) |

> **Single-tenant** (you, your own desktop): set `FORGE3D_API_TOKEN` **and** `FORGE3D_PAIR_TOKEN`.
> Both map to one owner, so your Claude and your app meet. **Multi-tenant** (a public product):
> verify a real OAuth token in `authOwner()` and key pairing per user — see [SUBMIT.md](SUBMIT.md).

## Pair your desktop

In the Forge3D app: **Settings → Orchestra AI → Forge3D Cloud** — set the server URL +
the pairing token and click **Save & connect**. Status shows `online` when the relay is live.

## Test (no Electron, no Claude)

```bash
npm test   # smoke.mjs
```

Spins up the server, drives it with a real MCP-over-HTTP client, asserts the cloud
design path **and** a simulated paired-desktop relay round-trip.

## Files

- `index.mjs` — HTTP server: MCP (Streamable HTTP) + relay endpoints + auth seam + health/OAuth discovery.
- `cloudOrchestra.mjs` — headless engine runner (reuses orchestraCore + the cloud-safe tools).
- `desktopRelay.mjs` — long-poll relay session/queue management.
- `smoke.mjs` — end-to-end test of both routes.
- [DEPLOY.md](DEPLOY.md) · [SUBMIT.md](SUBMIT.md)
