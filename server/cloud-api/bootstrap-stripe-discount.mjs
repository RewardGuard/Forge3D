// One-time Stripe setup for the LAUNCH90 discount code — idempotent. Run ON THE
// SERVER with STRIPE_SECRET_KEY in the environment (or .env next to this file):
//   node bootstrap-stripe-discount.mjs
//
// Creates a Coupon (90% off, repeating for 6 months, NO product restriction so it
// works on both F3D Cloud Pro and F3D Storage) and a Promotion Code "LAUNCH90".
// Unlimited redemptions, no expiration.
//
// NOTE: a coupon's `applies_to` is IMMUTABLE in Stripe. The first version of this
// script restricted the coupon to the Pro product, which made the code unusable
// on Storage ("This coupon cannot be redeemed because it does not apply to
// anything in this order"). Since it can't be edited, this script deactivates any
// existing LAUNCH90 promotion code and issues a fresh one on an unrestricted
// coupon — Stripe only requires the code string to be unique among ACTIVE codes.
// Existing subscriptions keep the discount they were created with.
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

const COUPON_ID = 'launch90-all-6mo';   // unrestricted: Pro AND Storage
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

// 1. the unrestricted coupon
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
    // deliberately NO applies_to → valid on every product
  });
  console.log('created coupon', coupon.id, '(no product restriction)');
}

// 2. free the code string: deactivate any active LAUNCH90 on another coupon
const existing = await stripe('GET', `/v1/promotion_codes?code=${CODE}&limit=10`);
let promo = null;
for (const p of existing.data || []) {
  if (p.coupon?.id === COUPON_ID && p.active) { promo = p; continue; }
  if (p.active) {
    await stripe('POST', `/v1/promotion_codes/${p.id}`, { active: false });
    console.log('deactivated old promotion code', p.id, `(coupon ${p.coupon?.id} — restricted)`);
  }
}

// 3. the code itself
if (!promo) {
  promo = await stripe('POST', '/v1/promotion_codes', { coupon: coupon.id, code: CODE });
  console.log('created promotion code', promo.id, promo.code);
} else {
  console.log('promotion code already on the unrestricted coupon', promo.id);
}

// 4. prove it covers both products
const verify = await stripe('GET', `/v1/coupons/${COUPON_ID}?expand[]=applies_to`);
console.log(`\n"${CODE}": ${verify.percent_off}% off, ${verify.duration} ${verify.duration_in_months} months`);
console.log('applies_to:', verify.applies_to ? JSON.stringify(verify.applies_to) : 'ALL PRODUCTS (Pro + Storage) ✓');
