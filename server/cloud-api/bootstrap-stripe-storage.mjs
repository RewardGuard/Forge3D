// One-time Stripe setup for F3D Storage — idempotent. Run ON THE SERVER with
// STRIPE_SECRET_KEY in the environment (or .env next to this file):
//   node bootstrap-stripe-storage.mjs
// Finds-or-creates the "F3D Storage" product and its $3/month price. Prints the
// price id to append to .env — it NEVER prints the secret key. (The webhook
// endpoint is shared with Pro; bootstrap-stripe.mjs already created it.)
//
// ⚠️ Your live sk_live was exposed previously — rotate it in Stripe first, put
// the new key in .env, THEN run this.
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
let product = products.data.find((p) => p.name === 'F3D Storage');
if (!product) {
  product = await stripe('POST', '/v1/products', { name: 'F3D Storage', description: '500GB of cloud storage for Forge3D projects and files — monthly subscription.' });
  console.log('created product', product.id);
} else console.log('product exists', product.id);

// $3/month price
const prices = await stripe('GET', `/v1/prices?product=${product.id}&active=true&limit=100`);
let price = prices.data.find((p) => p.unit_amount === 300 && p.currency === 'usd' && p.recurring?.interval === 'month');
if (!price) {
  price = await stripe('POST', '/v1/prices', { product: product.id, unit_amount: 300, currency: 'usd', 'recurring[interval]': 'month' });
  console.log('created price', price.id);
} else console.log('price exists', price.id);

console.log('\nAppend to .env:');
console.log(`STRIPE_STORAGE_PRICE_ID=${price.id}`);
