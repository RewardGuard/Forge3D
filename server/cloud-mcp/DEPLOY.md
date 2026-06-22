# Deploy Forge3D Cloud (remote connector)

## Status — LIVE over HTTPS (2026-06-22)

Public endpoint: **`https://forge3d.duckdns.org/mcp`** (DuckDNS → `18.222.194.21`).

- systemd **`forge3d-cloud`** (Node v20) on port **8788**, fronted by **Caddy** (TLS on 443, Let's Encrypt cert auto-issued/renewed).
- runtime deps: **`zustand` + `three` only** (*not* electron/vite/react, and *not* `three-bvh-csg` — only in the CSG bake path the cloud never loads).
- secrets in `~/forge3d-cloud/server/cloud-mcp/.env` (chmod 600): `FORGE3D_API_TOKEN`, `FORGE3D_PAIR_TOKEN`.
- SG inbound open: 80, 443, 8788 (0.0.0.0/0); 8787 proxy; 22 + 5432 restricted. **Verified end-to-end over TLS:** 401 without token, 32 tools with token, `orchestrate` returns validated designs (lamp via generic fallback, sumo robot via template).

Retrieve tokens: `ssh -i ~/.ssh/rewardguard-db-key ubuntu@18.222.194.21 'sudo cat ~/forge3d-cloud/server/cloud-mcp/.env'`

Optional hardening: now that TLS is up, you can remove the **8788** SG rule (everything goes through 443) and **rotate the DuckDNS token** you shared.

Retrieve the tokens when you need them (they were never printed to chat):

```bash
ssh -i ~/.ssh/rewardguard-db-key ubuntu@18.222.194.21 'sudo cat ~/forge3d-cloud/server/cloud-mcp/.env'
```

---

## How it was deployed (reproduce / update)

```bash
HOST=ubuntu@18.222.194.21
KEY=~/.ssh/rewardguard-db-key

# 1. sync code (no node_modules), from the repo root
rsync -az --exclude node_modules --exclude '*.mcpb' --exclude '.env' \
  -e "ssh -i $KEY" src server $HOST:~/forge3d-cloud/

# 2. minimal runtime deps + the MCP SDK
ssh -i $KEY $HOST 'cd ~/forge3d-cloud && \
  printf "{\"type\":\"module\",\"dependencies\":{\"zustand\":\"^4.5.5\",\"three\":\"^0.169.0\"}}" > package.json && \
  npm install --omit=dev --no-audit --no-fund && \
  cd server/cloud-mcp && npm install --omit=dev --no-audit --no-fund && \
  node smoke.mjs'        # 5/5 proves the engine runs on the box
```

`.env` + the systemd unit were created on the box (service reads `./.env` automatically
via `WorkingDirectory`). To update code later: re-run the `rsync` then
`ssh -i $KEY $HOST 'sudo systemctl restart forge3d-cloud'`.

## 3. Open the port (Security Group — your step)

The service listens on `0.0.0.0:8788` but EC2's firewall blocks it. In the AWS console
→ **EC2 → Security Groups → (this instance's SG) → Inbound rules → Edit**:

- For **desktop pairing now**: allow **TCP 8788** from your IP (or `0.0.0.0/0` if you'll add TLS next).
- For **TLS/Claude** (§4): allow **TCP 443** and **TCP 80** (80 is for the Let's Encrypt challenge).

Then from your machine: `curl http://18.222.194.21:8788/health` should return ok.

## 4. TLS + domain (required for Claude / the directory)

Point a subdomain (e.g. `mcp.forge3d.app`) **A record → 18.222.194.21**, then:

```bash
ssh -i $KEY $HOST 'sudo apt install -y caddy && \
  echo "mcp.forge3d.app { reverse_proxy 127.0.0.1:8788 }" | sudo tee /etc/caddy/Caddyfile && \
  sudo systemctl restart caddy'
# update the public URL the server reports:
ssh -i $KEY $HOST "sed -i s#FORGE3D_PUBLIC_URL=.*#FORGE3D_PUBLIC_URL=https://mcp.forge3d.app# ~/forge3d-cloud/server/cloud-mcp/.env && sudo systemctl restart forge3d-cloud"
curl https://mcp.forge3d.app/health
```

Caddy auto-issues a Let's Encrypt cert (needs 80+443 open and DNS pointing at the box).

## 5. Use it

- **In Claude** → Add connector → Remote MCP → `https://mcp.forge3d.app/mcp`, bearer = your
  `FORGE3D_API_TOKEN`. (For the public directory, swap the token for OAuth — see [SUBMIT.md](SUBMIT.md).)
- **Pair your desktop** → Forge3D → Settings → Orchestra AI → Forge3D Cloud → URL +
  `FORGE3D_PAIR_TOKEN` → Save & connect. Now cloud calls drive your live viewport + Life Sim.

## Notes

- Relay is per-`owner`; single-tenant maps everyone to `"self"` — keep the tokens private.
- `orchestrate` in the cloud is CPU work (~1s). Port the per-IP rate limit from
  `server/proxy/index.mjs` before opening it wide.
