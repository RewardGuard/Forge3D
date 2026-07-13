# Headroom compression (optional) — cut F3D Cloud token usage 60–95%

The cloud service can route any provider's upstream through a **Headroom** proxy
(github.com/RewardGuard/headroom) to compress prompts before they reach the AI —
fewer input tokens ⇒ lower spend on the shared keys ⇒ users' 5,000 free tokens
last much longer. It's **off by default** and fully guarded: if Headroom is
unreachable, calls fall back to the provider directly, so it can never take the
live free tier down.

## Enable

Headroom is a Python + Rust + ML proxy — do **not** run it on the accounts box
(`18.222.194.21`, 911 MB RAM / 3.4 GB disk: far too small; it would OOM the live
billing service). Run it on a host with real capacity (≥2 GB RAM, a few GB disk),
then point one env var per provider at it:

```bash
# on the Headroom host
pip install "headroom-ai[all]"
headroom proxy --host 0.0.0.0 --port 8787     # mirrors /v1/chat/completions, /v1/messages

# in ~/forge3d-proxy/.env on the accounts server, add the providers you want compressed:
HEADROOM_URL_GLM=https://<headroom-host>/v1/chat/completions
HEADROOM_URL_CLAUDE=https://<headroom-host>/v1/messages
# (HEADROOM_URL_GROQ, _GEMINI, _MISTRAL, _OPENROUTER work the same)
sudo systemctl restart forge3d-proxy
```

Each provider id maps to `HEADROOM_URL_<ID>` (uppercased). Unset = that provider
goes direct. Metering is unaffected — we still read `usage` from the (compressed)
response, so the numbers just get smaller.

## How the seam works

`callProvider()` computes `upstreamFor(p, direct)` = `HEADROOM_URL_<ID>` or the
real URL, and `upstreamFetch()` retries direct on a connection error. That's the
whole integration — Headroom stays a drop-in that you turn on with an env var.
