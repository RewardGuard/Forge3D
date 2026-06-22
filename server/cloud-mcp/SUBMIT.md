# Getting Forge3D into Claude's connector directory

The in-app **directory** is for **remote** MCP servers any Claude user can enable;
Anthropic reviews and lists them.

## Current state (2026-06-22) — engineering is DONE

| Requirement | Status |
|---|---|
| HTTPS remote MCP server (Streamable HTTP) | ✅ `https://forge3d.duckdns.org/mcp` (Caddy + Let's Encrypt) |
| OAuth 2.1 token verification | ✅ implemented in `authOwner()` (jose: sig + iss + aud → `sub`); tested by `npm run test:oauth` |
| Protected-resource discovery | ✅ `/.well-known/oauth-protected-resource` (live once `FORGE3D_OAUTH_ISSUER` is set) |
| Per-user routing to paired desktop | ✅ verified (token `sub` → that user's desktop) |
| Privacy policy + Terms | ✅ https://forge3d.duckdns.org/privacy · /terms |

**Two things only YOU can do** (I can't create accounts, accept third-party terms, or submit authenticated forms):
1. **Create an OAuth IdP tenant** (Auth0 / Stytch / WorkOS / Clerk / Keycloak) with **Dynamic Client Registration** enabled.
2. **Submit the application** to Anthropic (their form/developer program).

### Turn OAuth ON once you have the IdP (issuer + JWKS are public, not secrets)

```bash
ssh -i ~/.ssh/rewardguard-db-key ubuntu@18.222.194.21 \
  "cd ~/forge3d-cloud/server/cloud-mcp && \
   printf '\nFORGE3D_OAUTH_ISSUER=%s\nFORGE3D_OAUTH_JWKS=%s\nFORGE3D_OAUTH_AUDIENCE=%s\n' \
     'https://YOUR_TENANT/' 'https://YOUR_TENANT/.well-known/jwks.json' 'https://forge3d.duckdns.org' >> .env && \
   sudo systemctl restart forge3d-cloud"
# verify it flipped to OAuth mode:
ssh -i ~/.ssh/rewardguard-db-key ubuntu@18.222.194.21 "journalctl -u forge3d-cloud -n1 --no-pager"
# -> auth=oauth(https://YOUR_TENANT/)
```

The code already falls back to single-tenant token auth when those vars are unset, so
the server keeps working until you flip OAuth on. (Just send me the issuer + JWKS URLs
— they're public — and I'll set them on the box and verify end-to-end.)

> Verify Anthropic's current submission process on their site before applying — the
> form and exact requirements evolve.

## What the directory requires

1. **A hosted remote MCP server over HTTPS** using the Streamable HTTP transport.
   ✅ Done — that's this server ([DEPLOY.md](DEPLOY.md)).
2. **OAuth 2.1 user authorization** — users sign in; you must not rely on a shared
   secret. The server advertises discovery and Claude runs the OAuth flow.
3. **Discovery metadata** — `/.well-known/oauth-protected-resource` (served here when
   `FORGE3D_OAUTH_ISSUER` is set) pointing at your authorization server, which itself
   serves `/.well-known/oauth-authorization-server` (your IdP) and supports
   **Dynamic Client Registration**.
4. **Product surface** — name, icon, short + long description, a **privacy policy**
   and **terms** URL, and a support contact. (Reuse `assets/forge3d-logo.png`.)

## Code: go from single-tenant to OAuth multi-tenant

The whole auth surface is one function — `authOwner(req)` in `index.mjs`. Today it
accepts a shared `FORGE3D_API_TOKEN` and returns the owner `"self"`. To list in the
directory, swap it for real token verification:

```js
// index.mjs — production authOwner
import { createRemoteJWKSet, jwtVerify } from 'jose';
const JWKS = createRemoteJWKSet(new URL(process.env.FORGE3D_OAUTH_JWKS));
async function authOwner(req) {
  try {
    const { payload } = await jwtVerify(bearer(req), JWKS, {
      issuer: process.env.FORGE3D_OAUTH_ISSUER,
      audience: process.env.FORGE3D_PUBLIC_URL,
    });
    return payload.sub; // the per-user owner key — routes to THAT user's desktop
  } catch { return null; }
}
```

Then make `authOwner` `await`-ed where it's called, and key desktop pairing per user:
issue each user a personal pairing token (in your account UI) that `pairOwner()` maps
to the same `sub`. After that, the relay already routes each user to their own app —
no other changes needed (sessions in `desktopRelay.mjs` are keyed by `owner`).

An IdP that gives you OAuth 2.1 + Dynamic Client Registration with little work:
Auth0, Stytch, WorkOS, Clerk, or Keycloak (self-hosted on the same EC2 box).

## Submission checklist

- [ ] HTTPS remote server live (`https://mcp.forge3d.app/mcp`) and stable
- [ ] OAuth 2.1 + DCR working; `authOwner` verifies real tokens
- [ ] `/.well-known/oauth-protected-resource` returns your issuer
- [ ] Connect end-to-end from a fresh Claude account (no shared secret)
- [ ] Privacy policy + terms + support email published
- [ ] Name, icon (`assets/forge3d-logo.png`), descriptions ready
- [ ] Apply via Anthropic's connector/developer submission form

## Don't want to run OAuth + hosting?

Ship the **`.mcpb` bundle** ([../orchestra-mcp](../orchestra-mcp)) instead — it's a
real, shareable product (one-click install, GitHub release / your site) and needs no
backend. The directory is only worth it once you want *in-app discoverability* and
are ready to operate a hosted, authenticated service.
