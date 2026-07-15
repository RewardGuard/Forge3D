# Cutover runbook — forge3d.duckdns.org → **forge3d.design**

Full switch (per product decision): forge3d.design becomes the one domain for the
**MCP connector**, the **downloads** (dmg/exe landing page), and **Stripe payments**.
The old duckdns host is left only as a browser redirect. Already-installed apps that
point at duckdns will stop reaching the cloud until users install the new build — expected.

Box: `ubuntu@18.222.194.21` (key `~/.ssh/rewardguard-db-key`). Services: `caddy`,
`forge3d-proxy` (:8787 billing/accounts), `forge3d-cloud` (:8788 MCP + landing + downloads).

## 1. DNS (at your registrar, once forge3d.design is bought)
Create an **A record**: `forge3d.design` → `18.222.194.21` (and optionally `www` → same).
Wait for it: `dig +short forge3d.design` must return `18.222.194.21` before step 2
(Caddy needs it resolving to issue the TLS cert).

## 2. Run the cutover script (Caddy + env + restarts + verify)
```bash
scp -i ~/.ssh/rewardguard-db-key \
  server/deploy/deploy-forge3d-design.sh \
  server/deploy/Caddyfile.forge3d-design \
  ubuntu@18.222.194.21:~/
ssh -i ~/.ssh/rewardguard-db-key ubuntu@18.222.194.21 'bash ~/deploy-forge3d-design.sh'
```
This backs up + installs the new Caddyfile, flips `PUBLIC_URL`/`FORGE3D_PUBLIC_URL`
to `https://forge3d.design`, restarts both services, and curls `/f3d-api/health`,
`/mcp`, and `/` on the new domain.

## 3. Stripe webhook re-point (manual — live Stripe write)
```bash
ssh -i ~/.ssh/rewardguard-db-key ubuntu@18.222.194.21
cd ~/forge3d-proxy
node bootstrap-stripe.mjs https://forge3d.design   # creates the webhook at the new URL, prints STRIPE_WEBHOOK_SECRET
# put that secret into ~/forge3d-proxy/.env (replace the old STRIPE_WEBHOOK_SECRET), then:
sudo systemctl restart forge3d-proxy
```
`STRIPE_PRICE_ID` (Pro) and `STRIPE_STORAGE_PRICE_ID` ($3 storage) do **not** change —
only the success/cancel/webhook URLs move to forge3d.design. Optionally delete the old
`forge3d.duckdns.org/f3d-api/billing/webhook` endpoint in the Stripe dashboard.

## 4. App + installers (already point at forge3d.design in code)
The Electron default `PROXY_URL`, the cloud-bundle `FORGE3D_CLOUD_URL`, the landing
page, `install.sh` and docs are already switched to `forge3d.design` in this repo.
Push a version tag to build+publish both installers via CI:
```bash
npm version patch -m 'v%s — forge3d.design + F3D Storage'   # bumps package.json, tags
git push && git push --tags
```
`.github/workflows/build.yml` builds the **mac .dmg** and **Windows .exe (nsis)** on the
`v*` tag and attaches them to the GitHub release. The landing page at
`https://forge3d.design` links to those release assets + `install.sh`.

## 5. Rebuild + redeploy the cloud .mcpb bundle (baked cloud URL)
```bash
cd server/cloud-bundle
FORGE3D_API_TOKEN=$(ssh -i ~/.ssh/rewardguard-db-key ubuntu@18.222.194.21 'grep ^FORGE3D_API_TOKEN ~/forge3d-cloud/server/cloud-mcp/.env | cut -d= -f2') npm run bundle
scp -i ~/.ssh/rewardguard-db-key forge3d-cloud.mcpb ubuntu@18.222.194.21:~/forge3d-cloud/server/cloud-mcp/public/download/
```

## Verify
- `curl https://forge3d.design/f3d-api/health` → `{"ok":true,"billing":true,"storageBilling":true,...}`
- `curl -o /dev/null -w '%{http_code}' https://forge3d.design/mcp` → `401`
- Open `https://forge3d.design/` → landing page + Add-to-Claude / install one-liner.
- A test Pro/Storage checkout opens `checkout.stripe.com` and returns to `https://forge3d.design/billing/done`.
