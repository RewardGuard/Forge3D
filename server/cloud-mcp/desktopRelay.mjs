// ============================================================================
// Desktop relay — routes tool calls from the cloud MCP server to a user's LIVE
// Forge3D desktop app, so the directory connector can drive the real 3D viewport
// and Life Sim, not just the headless cloud engine.
//
// Transport is HTTP LONG-POLL, deliberately: the desktop dials OUT to the cloud
// (GET /relay/next held open until work arrives, POST /relay/result to answer),
// so it works behind any home NAT/firewall with no inbound ports and no extra
// dependency (no websockets). Sessions are keyed by `owner` (the authenticated
// identity — the OAuth subject in production, or "self" single-tenant).
// ============================================================================
import crypto from 'node:crypto';

const HOLD_MS = 25_000;      // how long a desktop poll is held open
const ONLINE_MS = 45_000;    // a desktop is "online" if it polled this recently
const sessions = new Map();  // owner -> { queue, waiter, pending:Map, lastSeen }

function sess(owner) {
  let s = sessions.get(owner);
  if (!s) { s = { queue: [], waiter: null, pending: new Map(), lastSeen: 0 }; sessions.set(owner, s); }
  return s;
}

export function isOnline(owner) {
  const s = sessions.get(owner);
  return !!s && Date.now() - s.lastSeen < ONLINE_MS;
}

// Cloud → desktop: queue a call and resolve when the desktop posts its result.
export function relayCall(owner, name, args, timeoutMs = 120_000) {
  const s = sess(owner);
  const callId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => { s.pending.delete(callId); reject(new Error('paired desktop did not respond in time')); }, timeoutMs);
    s.pending.set(callId, { resolve, to });
    s.queue.push({ callId, name, args });
    if (s.waiter) { const w = s.waiter; s.waiter = null; w(); } // wake a held poll
  });
}

// Desktop long-poll: resolve with the next queued call, or null after HOLD_MS.
export function nextCall(owner) {
  const s = sess(owner);
  s.lastSeen = Date.now();
  if (s.queue.length) return Promise.resolve(s.queue.shift());
  return new Promise((resolve) => {
    const to = setTimeout(() => { if (s.waiter) s.waiter = null; resolve(null); }, HOLD_MS);
    s.waiter = () => { clearTimeout(to); resolve(s.queue.shift() || null); };
  });
}

// Desktop posts a tool result back.
export function submitResult(owner, callId, result) {
  const s = sessions.get(owner);
  const p = s && s.pending.get(callId);
  if (!p) return false;
  clearTimeout(p.to);
  s.pending.delete(callId);
  p.resolve(result);
  return true;
}

export function markSeen(owner) { sess(owner).lastSeen = Date.now(); }

export function relayStats() {
  return [...sessions.entries()].map(([owner, s]) => ({ owner, online: isOnline(owner), queued: s.queue.length, pending: s.pending.size }));
}
