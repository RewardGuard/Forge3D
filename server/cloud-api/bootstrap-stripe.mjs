// One-time Stripe setup for F3D Cloud Pro — idempotent. Run ON THE SERVER with
// STRIPE_SECRET_KEY in the environment (or .env next to this file):
//   node bootstrap-stripe.mjs [public-base-url]
// Finds-or-creates the "F3D Cloud Pro" product, its $5/month price, and (if a
// public https URL is given) the webhook endpoint. Prints the ids to append to
// .env — it NEVER prints the secret key.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
try {
  const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf-8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* env only */ }

const KEY = process.env.STRIPE_SECRET_KEY;
if (!KEY) { console.error('STRIPE_SECRET_KEY missing'); process.exit(1); }
const publicUrl = (process.argv[2] || process.env.PUBLIC_URL || '').replace(/\/$/, '');

async function stripe(method, pathname, params) {
  const opts = { method, headers: { authorization: `Bearer ${KEY}` } };
  if (params) {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) body.append(k, String(v));
    opts.body = body.toString();
    opts.headers['content-type'] = 'application/x-www-form-urlencoded';
  }
  const res = await fetch(`https://api.stripe.com${pathname}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Stripe ${res.status}`);
  return data;
}

// product
const products = await stripe('GET', '/v1/products?limit=100&active=true');
let product = products.data.find((p) => p.name === 'F3D Cloud Pro');
if (!product) {
  product = await stripe('POST', '/v1/products', { name: 'F3D Cloud Pro', description: 'All F3D Cloud AIs in Forge3D — monthly subscription.' });
  console.log('created product', product.id);
} else console.log('product exists', product.id);

// $5/month price
const prices = await stripe('GET', `/v1/prices?product=${product.id}&active=true&limit=100`);
let price = prices.data.find((p) => p.unit_amount === 500 && p.currency === 'usd' && p.recurring?.interval === 'month');
if (!price) {
  price = await stripe('POST', '/v1/prices', { product: product.id, unit_amount: 500, currency: 'usd', 'recurring[interval]': 'month' });
  console.log('created price', price.id);
} else console.log('price exists', price.id);

// webhook endpoint (needs a public https URL — e.g. behind Caddy)
let whsecLine = '';
if (publicUrl.startsWith('https://')) {
  const hooks = await stripe('GET', '/v1/webhook_endpoints?limit=100');
  const target = `${publicUrl}/billing/webhook`;
  let hook = hooks.data.find((h) => h.url === target);
  if (!hook) {
    hook = await stripe('POST', '/v1/webhook_endpoints', {
      url: target,
      'enabled_events[0]': 'checkout.session.completed',
      'enabled_events[1]': 'customer.subscription.updated',
      'enabled_events[2]': 'customer.subscription.deleted',
    });
    console.log('created webhook', hook.id);
    whsecLine = `STRIPE_WEBHOOK_SECRET=${hook.secret}`; // only shown on creation
  } else console.log('webhook exists', hook.id, '(secret only shown at creation — reuse your saved one)');
} else {
  console.log('no https PUBLIC_URL given — skipping webhook endpoint (pass e.g. https://cloud.example.com)');
}

console.log('\nAppend to .env:');
console.log(`STRIPE_PRICE_ID=${price.id}`);
if (whsecLine) console.log(whsecLine);
