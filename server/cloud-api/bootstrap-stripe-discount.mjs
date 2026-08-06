// One-time Stripe setup for the LAUNCH90 discount code — idempotent. Run ON THE
// SERVER with STRIPE_SECRET_KEY in the environment (or .env next to this file):
//   node bootstrap-stripe-discount.mjs
// Finds-or-creates a Coupon (90% off, repeating for 6 months, restricted to the
// F3D Cloud Pro product only) and a Promotion Code "LAUNCH90" that redeems it.
// Unlimited redemptions, no expiration (product decision). Never prints the
// secret key. Requires STRIPE_PRICE_ID already set (run bootstrap-stripe.mjs first).
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
const PRO_PRICE_ID = process.env.STRIPE_PRICE_ID;
if (!PRO_PRICE_ID) { console.error('STRIPE_PRICE_ID missing (run bootstrap-stripe.mjs first)'); process.exit(1); }

const COUPON_ID = 'launch90-pro-6mo';
const CODE = 'LAUNCH90';

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

// resolve the Pro product from its price, so the coupon can be restricted to it
const proPrice = await stripe('GET', `/v1/prices/${PRO_PRICE_ID}`);
const proProduct = proPrice.product;
console.log('Pro product:', proProduct);

// coupon: 90% off, repeats for 6 billing cycles, ONLY valid against the Pro product
let coupon;
try {
  coupon = await stripe('GET', `/v1/coupons/${COUPON_ID}`);
  console.log('coupon exists', coupon.id);
} catch {
  coupon = await stripe('POST', '/v1/coupons', {
    id: COUPON_ID,
    name: 'Launch — 90% off for 6 months',
    percent_off: 90,
    duration: 'repeating',
    duration_in_months: 6,
    'applies_to[products][0]': proProduct,
  });
  console.log('created coupon', coupon.id);
}

// promotion code: the human-typable "LAUNCH90" — unlimited redemptions, no expiry
const existing = await stripe('GET', `/v1/promotion_codes?code=${CODE}&limit=1`);
let promo = existing.data[0];
if (!promo) {
  promo = await stripe('POST', '/v1/promotion_codes', { coupon: coupon.id, code: CODE });
  console.log('created promotion code', promo.id, promo.code);
} else {
  console.log('promotion code exists', promo.id, promo.code, promo.active ? '(active)' : '(INACTIVE — reactivate in the Stripe dashboard)');
}

console.log(`\nDone. "${CODE}" gives 90% off F3D Cloud Pro for 6 months, unlimited uses, no expiry.`);
