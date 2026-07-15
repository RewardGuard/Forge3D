#!/usr/bin/env bash
# Forge3D — cut the live infra over to forge3d.design.
# RUN ON THE BOX (ubuntu@18.222.194.21) AFTER the A record forge3d.design → 18.222.194.21
# has propagated (check: `dig +short forge3d.design`). Idempotent-ish; backs up first.
#
#   scp -i ~/.ssh/rewardguard-db-key server/deploy/{deploy-forge3d-design.sh,Caddyfile.forge3d-design} ubuntu@18.222.194.21:~/
#   ssh -i ~/.ssh/rewardguard-db-key ubuntu@18.222.194.21 'bash ~/deploy-forge3d-design.sh'
#
# The Stripe webhook re-point is deliberately NOT automated (it writes to live
# Stripe + prints a new secret) — do it by hand at the end, per the printed steps.
set -euo pipefail

NEW_DOMAIN="forge3d.design"
PROXY_ENV="$HOME/forge3d-proxy/.env"
CLOUD_ENV="$HOME/forge3d-cloud/server/cloud-mcp/.env"
CADDYFILE_SRC="$HOME/Caddyfile.forge3d-design"
TS="$(date +%Y%m%d-%H%M%S)"

echo "== 0. sanity: does $NEW_DOMAIN resolve to this box? =="
dig +short "$NEW_DOMAIN" || true
echo "   (if that isn't 18.222.194.21, stop and fix DNS first — Caddy can't get a cert otherwise)"

echo "== 1. Caddy =="
sudo cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak-$TS"
sudo cp "$CADDYFILE_SRC" /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
echo "   Caddyfile installed + reloaded (backup: /etc/caddy/Caddyfile.bak-$TS)"

echo "== 2. server env: PUBLIC_URL → https://$NEW_DOMAIN =="
set_env() { # file KEY value
  local f="$1" k="$2" v="$3"
  [ -f "$f" ] || { echo "   (skip $f — not found)"; return; }
  cp "$f" "$f.bak-$TS"
  if grep -q "^$k=" "$f"; then
    sed -i "s#^$k=.*#$k=$v#" "$f"
  else
    echo "$k=$v" >> "$f"
  fi
  echo "   $f: $k set"
}
set_env "$PROXY_ENV" PUBLIC_URL "https://$NEW_DOMAIN"
set_env "$CLOUD_ENV" FORGE3D_PUBLIC_URL "https://$NEW_DOMAIN"

echo "== 3. restart services =="
sudo systemctl restart forge3d-proxy forge3d-cloud
sleep 2
systemctl is-active forge3d-proxy forge3d-cloud

echo "== 4. verify over the new domain =="
curl -fsS "https://$NEW_DOMAIN/f3d-api/health" && echo
curl -fsS -o /dev/null -w "mcp: %{http_code}\n" "https://$NEW_DOMAIN/mcp" || true   # 401 expected (needs token)
curl -fsS -o /dev/null -w "landing: %{http_code}\n" "https://$NEW_DOMAIN/"

cat <<EOF

== 5. Stripe webhook — DO THIS BY HAND (writes to live Stripe) ==
  cd ~/forge3d-proxy
  node bootstrap-stripe.mjs https://$NEW_DOMAIN
  # copy the printed STRIPE_WEBHOOK_SECRET into ~/forge3d-proxy/.env (replace the old one), then:
  sudo systemctl restart forge3d-proxy
  # optional: delete the old forge3d.duckdns.org webhook in the Stripe dashboard.
  # (STRIPE_PRICE_ID + STRIPE_STORAGE_PRICE_ID stay the same — only success/cancel/webhook URLs move.)

Cutover done. Checkout success/cancel URLs now point at https://$NEW_DOMAIN/billing/done.
EOF
