// ============================================================================
// Forge3D Cloud — interactive setup wizard.
//
//   npm run setup     configure everything (writes a local, gitignored .env)
//   npm run doctor    check a running/deployed server is healthy
//
// IMPORTANT: this runs on YOUR machine and prompts YOU. Secrets you type go
// straight into ./.env (chmod 600) — they are never printed back in full and
// never leave your computer. It also tells you WHERE to get each value.
// ============================================================================
import readline from 'node:readline';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '.env');
const tty = Boolean(process.stdin.isTTY);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const C = { b: (s) => `\x1b[1m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, grn: (s) => `\x1b[32m${s}\x1b[0m`, cyn: (s) => `\x1b[36m${s}\x1b[0m`, yel: (s) => `\x1b[33m${s}\x1b[0m` };
const ask = (q, def = '') => new Promise((res) => rl.question(def ? `${q} ${C.dim(`[${def}]`)}: ` : `${q}: `, (a) => res((a || '').trim() || def)));
const yn = async (q, def = false) => /^y/i.test(await ask(`${q} ${C.dim(def ? '(Y/n)' : '(y/N)')}`, def ? 'y' : 'n'));
function askSecret(q) {
  return new Promise((res) => {
    if (!tty) return rl.question(`${q}: `, (a) => res((a || '').trim()));
    process.stdout.write(`${q}: `);
    const orig = rl._writeToOutput?.bind(rl);
    rl._writeToOutput = () => {}; // hide typed characters
    rl.question('', (a) => { rl._writeToOutput = orig; process.stdout.write('\n'); res((a || '').trim()); });
  });
}
const gen = () => crypto.randomBytes(24).toString('hex');
const mask = (v) => (v ? v.slice(0, 4) + '••••••' + v.slice(-2) : '(unset)');
const where = (lines) => lines.forEach((l) => console.log('   ' + C.dim('↳ ' + l)));

function loadEnv() {
  const out = {};
  try { for (const line of fs.readFileSync(ENV_PATH, 'utf-8').split('\n')) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, ''); } } catch {}
  return out;
}
function saveEnv(env) {
  const f = (k) => `${k}=${env[k] || ''}`;
  const body = `# Forge3D Cloud — written by \`npm run setup\`. Gitignored. chmod 600.
# --- server ---
${f('PORT')}
${f('FORGE3D_PUBLIC_URL')}
# --- single-tenant secrets ---
${f('FORGE3D_API_TOKEN')}
${f('FORGE3D_PAIR_TOKEN')}
# --- OAuth 2.1 (directory listing; blank = single-tenant) ---
${f('FORGE3D_OAUTH_ISSUER')}
${f('FORGE3D_OAUTH_JWKS')}
`;
  fs.writeFileSync(ENV_PATH, body, { mode: 0o600 });
  try { fs.chmodSync(ENV_PATH, 0o600); } catch {}
}

const IDPS = {
  auth0: ['Sign up: https://auth0.com/signup → create a tenant.', 'Applications → APIs → Create API; set Identifier = your FORGE3D_PUBLIC_URL.', 'Tenant Settings → Advanced → enable "OIDC Dynamic Application Registration".', 'Issuer = https://YOUR_TENANT.us.auth0.com/  ·  JWKS = <issuer>.well-known/jwks.json'],
  stytch: ['Sign up: https://stytch.com → Dashboard → Connected Apps (OAuth 2.1 + Dynamic Client Registration).', 'Issuer + JWKS are shown in the Connected Apps / API settings.'],
  workos: ['Sign up: https://workos.com → AuthKit; enable OAuth + Dynamic Client Registration.', 'Issuer + JWKS are in the AuthKit/OIDC configuration.'],
  clerk: ['Sign up: https://clerk.com → enable OAuth/OIDC.', 'Find the Issuer + JWKS in the OIDC/well-known configuration.'],
  keycloak: ['Self-host on your EC2 box (Docker). Create a realm + client with DCR enabled.', 'Issuer = https://YOUR_HOST/realms/REALM  ·  JWKS = <issuer>/protocol/openid-connect/certs'],
};

// Non-interactive: keep existing values, fill from process.env, generate missing
// tokens. Used when run without a terminal (pipes/CI) or with --yes.
function setupNonInteractive() {
  const env = loadEnv();
  env.PORT = process.env.PORT || env.PORT || '8788';
  env.FORGE3D_PUBLIC_URL = process.env.FORGE3D_PUBLIC_URL || env.FORGE3D_PUBLIC_URL || 'https://mcp.forge3d.app';
  env.FORGE3D_API_TOKEN = process.env.FORGE3D_API_TOKEN || env.FORGE3D_API_TOKEN || gen();
  env.FORGE3D_PAIR_TOKEN = process.env.FORGE3D_PAIR_TOKEN || env.FORGE3D_PAIR_TOKEN || gen();
  env.FORGE3D_OAUTH_ISSUER = process.env.FORGE3D_OAUTH_ISSUER || env.FORGE3D_OAUTH_ISSUER || '';
  env.FORGE3D_OAUTH_JWKS = process.env.FORGE3D_OAUTH_JWKS || env.FORGE3D_OAUTH_JWKS || (env.FORGE3D_OAUTH_ISSUER ? env.FORGE3D_OAUTH_ISSUER.replace(/\/$/, '') + '/.well-known/jwks.json' : '');
  saveEnv(env);
  console.log(C.grn(`✓ wrote ${path.relative(process.cwd(), ENV_PATH)} (non-interactive)`) + C.dim(`  API=${mask(env.FORGE3D_API_TOKEN)} PAIR=${mask(env.FORGE3D_PAIR_TOKEN)} oauth=${env.FORGE3D_OAUTH_ISSUER ? 'on' : 'off'}`));
  console.log(C.dim('Run `npm run setup` in a real terminal for the guided, "where-to-get-it" version.'));
  rl.close();
}

async function setup() {
  if (!tty || process.argv.includes('--yes')) return setupNonInteractive();
  const env = loadEnv();
  console.log(C.b('\nForge3D Cloud — setup'));
  console.log(C.dim('Press Enter to keep an existing value. Secrets are hidden as you type.\n'));

  console.log(C.cyn('1) Server'));
  env.PORT = await ask('Port', env.PORT || '8788');
  where(['Your public HTTPS URL. A subdomain you own with a DNS A-record → your server\'s public IP.', 'e.g. https://mcp.forge3d.app  (see DEPLOY.md to set the server host)']);
  env.FORGE3D_PUBLIC_URL = await ask('Public URL', env.FORGE3D_PUBLIC_URL || 'https://mcp.forge3d.app');

  console.log(C.cyn('\n2) Single-tenant secrets') + C.dim('  (just you + your own desktop)'));
  where(['API token = the Bearer you paste when ADDING the connector in Claude.', 'Leave blank to auto-generate a strong one.']);
  env.FORGE3D_API_TOKEN = (await askSecret(`API token ${C.dim(env.FORGE3D_API_TOKEN ? '(set — Enter to keep, or type new)' : '(Enter = generate)')}`)) || env.FORGE3D_API_TOKEN || gen();
  where(['Pairing token = paste into Forge3D → Settings → Orchestra AI → Forge3D Cloud.', 'Leave blank to auto-generate.']);
  env.FORGE3D_PAIR_TOKEN = (await askSecret(`Pairing token ${C.dim(env.FORGE3D_PAIR_TOKEN ? '(set — Enter to keep)' : '(Enter = generate)')}`)) || env.FORGE3D_PAIR_TOKEN || gen();

  console.log(C.cyn('\n3) OAuth 2.1') + C.dim('  (only needed to LIST in Claude\'s directory — skip for private/self use)'));
  if (await yn('Configure OAuth now?', Boolean(env.FORGE3D_OAUTH_ISSUER))) {
    const p = (await ask(`Provider ${C.dim('auth0 / stytch / workos / clerk / keycloak / other')}`, 'auth0')).toLowerCase();
    if (IDPS[p]) { console.log(C.yel(`   How to set up ${p}:`)); where(IDPS[p]); }
    else where(['Use any OAuth 2.1 IdP that supports Dynamic Client Registration.']);
    env.FORGE3D_OAUTH_ISSUER = await ask('Issuer URL', env.FORGE3D_OAUTH_ISSUER || '');
    const jwksDefault = env.FORGE3D_OAUTH_JWKS || (env.FORGE3D_OAUTH_ISSUER ? env.FORGE3D_OAUTH_ISSUER.replace(/\/$/, '') + '/.well-known/jwks.json' : '');
    where(['Verifies access tokens. Usually <issuer>/.well-known/jwks.json — confirm in your IdP discovery doc.']);
    env.FORGE3D_OAUTH_JWKS = await ask('JWKS URL', jwksDefault);
    console.log(C.dim('   Then finish the code swap in SUBMIT.md (authOwner → verify JWT). `jose` is the only extra dep.'));
  } else { console.log(C.dim('   Skipped — running single-tenant with the API token above.')); }

  saveEnv(env);
  console.log(C.grn(`\n✓ wrote ${path.relative(process.cwd(), ENV_PATH)} (chmod 600)`));
  console.log('  ' + ['PORT=' + env.PORT, 'PUBLIC_URL=' + env.FORGE3D_PUBLIC_URL, 'API_TOKEN=' + mask(env.FORGE3D_API_TOKEN), 'PAIR_TOKEN=' + mask(env.FORGE3D_PAIR_TOKEN), 'OAUTH=' + (env.FORGE3D_OAUTH_ISSUER ? env.FORGE3D_OAUTH_ISSUER : 'off')].join('\n  '));

  console.log(C.b('\nNext steps'));
  console.log(`  ${C.cyn('Run locally:')}  node index.mjs   ${C.dim('(reads .env)')}`);
  console.log(`  ${C.cyn('Deploy:')}        see DEPLOY.md — scp up, systemd, Caddy TLS for ${env.FORGE3D_PUBLIC_URL}`);
  console.log(`  ${C.cyn('Add in Claude:')} Add connector → ${env.FORGE3D_PUBLIC_URL.replace(/\/$/, '')}/mcp  ·  Bearer = your API token`);
  console.log(`  ${C.cyn('Pair desktop:')} Forge3D → Settings → Orchestra AI → Forge3D Cloud → URL + pairing token`);
  console.log(`  ${C.cyn('Directory:')}     follow SUBMIT.md (OAuth + privacy/terms + the form)`);
  console.log(`  ${C.cyn('Verify later:')}  npm run doctor\n`);
  rl.close();
}

async function doctor() {
  const env = loadEnv();
  const base = (env.FORGE3D_PUBLIC_URL || `http://127.0.0.1:${env.PORT || 8788}`).replace(/\/$/, '');
  console.log(C.b('Forge3D Cloud — doctor'));
  try {
    const r = await fetch(base + '/health'); const j = await r.json();
    console.log(r.ok ? C.grn(`✓ ${base}/health ok`) : C.yel(`! health ${r.status}`), C.dim(JSON.stringify(j)));
  } catch (e) { console.log(C.yel(`✗ cannot reach ${base}/health — ${e.message}`)); }
  if (env.FORGE3D_OAUTH_JWKS) {
    try { const r = await fetch(env.FORGE3D_OAUTH_JWKS); const j = await r.json(); console.log(r.ok && j.keys?.length ? C.grn(`✓ JWKS reachable (${j.keys.length} key/s)`) : C.yel('! JWKS reachable but no keys')); }
    catch (e) { console.log(C.yel(`✗ JWKS unreachable — ${e.message}`)); }
  }
  console.log(C.dim(`auth=${env.FORGE3D_API_TOKEN ? 'token' : 'open'} pairing=${env.FORGE3D_PAIR_TOKEN ? 'on' : 'off'} oauth=${env.FORGE3D_OAUTH_ISSUER ? 'on' : 'off'}`));
  rl.close();
}

(process.argv.includes('--doctor') ? doctor() : setup()).catch((e) => { console.error(e); rl.close(); process.exit(1); });
