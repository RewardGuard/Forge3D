# Connect Forge3D to Claude

Three free ways to use Forge3D from Claude — no directory listing, no paid plan.

## A · Claude Desktop — the one-click bundle (best for sharing)

Each person runs their **own** Forge3D app; the bundle drives it locally. Nothing
shared, no server cost, no account.

1. In Forge3D: **Settings → Orchestra AI → "Let Claude control Forge3D"** → On.
2. Build the bundle: `cd server/orchestra-mcp && npm install && npm run bundle`
   → produces `forge3d-orchestra.mcpb`.
3. Claude Desktop → **Settings → Extensions** → drag in the `.mcpb` → **Install**.
4. Ask Claude: *"design a sumo robot"* — it builds in your live app.

Share the `.mcpb` file (or a GitHub release) and anyone can do the same.

## B · Claude Code — the cloud connector by URL (your personal remote)

For driving things from the CLI, or designing in the cloud with no app installed.
Add to `.mcp.json` (get the token: `ssh … sudo cat …/cloud-mcp/.env`):

```json
{
  "mcpServers": {
    "forge3d": {
      "url": "https://forge3d.duckdns.org/mcp",
      "headers": { "Authorization": "Bearer YOUR_FORGE3D_API_TOKEN" }
    }
  }
}
```

> The cloud server uses a **single shared token**, so treat this as *your* personal
> access — don't publish the token. (Public, multi-user access is the OAuth +
> directory path in [server/cloud-mcp/SUBMIT.md](server/cloud-mcp/SUBMIT.md), for later.)

## C · Drive your LIVE app from the cloud (pair the desktop)

So a cloud request controls your real 3D viewport + Life Sim from anywhere:

- Forge3D → **Settings → Orchestra AI → Forge3D Cloud** →
  URL `https://forge3d.duckdns.org`, paste your **pairing token** → **Save & connect**.
- Status goes `online`. Now `look`, `run_sim`, etc. drive your live app; without a
  paired desktop, the cloud still designs headlessly and returns the spec + BOM.

## What's where

- **Local bundle** (per-user, offline): [server/orchestra-mcp](server/orchestra-mcp)
- **Cloud connector** (remote, your box): [server/cloud-mcp](server/cloud-mcp) · live at `https://forge3d.duckdns.org`
- **Directory listing** (public, needs OAuth + Team plan): [server/cloud-mcp/SUBMIT.md](server/cloud-mcp/SUBMIT.md)
