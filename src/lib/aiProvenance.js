// Provenance and availability for Orchestra.
//
// THE BUG THIS EXISTS TO KILL
// Orchestra's circuit builder ended with a "deterministic synthesizer (never
// fails)" fallback. When every model was unreachable — no key, no credits,
// rate limited — the run still finished with status "done" and the UI said
// nothing about who actually did the work. A user watching that screen would
// reasonably conclude an AI reasoned about their design. It did not.
//
// Presets and synthesizers are legitimate and often better than a weak model.
// What is not legitimate is letting them wear the AI's name. Every result that
// crosses into the UI carries a Provenance, and the UI renders it.

export const PROVENANCE = {
  ai: {
    id: 'ai',
    label: 'AI-generated',
    short: 'AI',
    detail: 'A language model reasoned about this specific design.',
  },
  preset: {
    id: 'preset',
    label: 'Built-in preset',
    short: 'Preset',
    detail: 'A validated template chosen by keyword. No AI reasoning was involved.',
  },
  deterministic: {
    id: 'deterministic',
    label: 'Deterministic solver',
    short: 'Rule-based',
    detail: 'Produced by fixed engineering rules — repeatable, but it did not reason about intent.',
  },
  hybrid: {
    id: 'hybrid',
    label: 'AI + deterministic',
    short: 'AI+rules',
    detail: 'A model proposed the design; deterministic solvers corrected and completed it.',
  },
};

// Why the AI could not be used. Each carries what the user can actually do.
export const AI_UNAVAILABLE = {
  no_credits: {
    id: 'no_credits',
    title: 'AI credits exhausted',
    explain: 'Your Forge3D Cloud AI allowance is used up for this period.',
    actions: ['Continue manually', 'Use deterministic CAD tools', 'Use a local model if configured', 'Wait until credits refresh, or upgrade'],
  },
  rate_limit: {
    id: 'rate_limit',
    title: 'Rate limited',
    explain: 'The provider is throttling requests. This is temporary.',
    actions: ['Continue manually', 'Use deterministic CAD tools', 'Retry in a minute', 'Switch to a different Director model'],
  },
  auth: {
    id: 'auth',
    title: 'Authentication failed',
    explain: 'The API key was rejected — it may be wrong, revoked, or expired.',
    actions: ['Continue manually', 'Use deterministic CAD tools', 'Check the key in Settings → Orchestra AI', 'Sign in again'],
  },
  no_key: {
    id: 'no_key',
    title: 'No AI provider configured',
    explain: 'No API key or Forge3D Cloud account is set, so there is no model to call.',
    actions: ['Continue manually', 'Use deterministic CAD tools', 'Add a provider key in Settings → Orchestra AI', 'Use a local model if configured'],
  },
  network: {
    id: 'network',
    title: 'Network unavailable',
    explain: 'Forge3D could not reach the AI provider.',
    actions: ['Continue manually', 'Use deterministic CAD tools', 'Use a local model if configured', 'Check your connection'],
  },
  model_unavailable: {
    id: 'model_unavailable',
    title: 'Model unavailable',
    explain: 'The selected model is not available to this account or has been retired.',
    actions: ['Continue manually', 'Use deterministic CAD tools', 'Pick a different Director model in Settings'],
  },
  server_error: {
    id: 'server_error',
    title: 'Provider error',
    explain: 'The AI provider returned an error. This is on their side, not yours.',
    actions: ['Continue manually', 'Use deterministic CAD tools', 'Retry', 'Switch to a different Director model'],
  },
  bad_output: {
    id: 'bad_output',
    title: 'Model output unusable',
    explain: 'The model replied, but its design failed validation and it could not correct it.',
    actions: ['Continue manually', 'Use deterministic CAD tools', 'Try a stronger Director model', 'Rephrase the goal with explicit dimensions'],
  },
  unknown: {
    id: 'unknown',
    title: 'AI unavailable',
    explain: 'Orchestra could not complete an AI call.',
    actions: ['Continue manually', 'Use deterministic CAD tools', 'Retry', 'Check Settings → Orchestra AI'],
  },
};

// Map a thrown error / failed response onto a reason. Deliberately checks
// status codes before message text, because provider prose is unstable.
export function classifyAiError(err) {
  if (!err) return AI_UNAVAILABLE.unknown;
  const status = Number(err.status ?? err.statusCode ?? err.code);
  const text = String(err?.message ?? err?.error ?? err ?? '').toLowerCase();

  if (/no api key|missing key|not configured|no provider|sign in/.test(text)) return AI_UNAVAILABLE.no_key;

  if (status === 429 || /rate.?limit|too many requests|slow down/.test(text)) {
    // Providers overload 429 for both throttling and spend caps.
    if (/credit|quota|billing|balance|insufficient|exceeded your current/.test(text)) return AI_UNAVAILABLE.no_credits;
    return AI_UNAVAILABLE.rate_limit;
  }
  if (/insufficient|no credit|out of credit|quota exceeded|balance|billing|payment required/.test(text) || status === 402) {
    return AI_UNAVAILABLE.no_credits;
  }
  if (status === 401 || status === 403 || /unauthor|forbidden|invalid.*key|authentication/.test(text)) {
    return AI_UNAVAILABLE.auth;
  }
  if (status === 404 || /model.*(not found|unavailable|retired|deprecated)|unknown model/.test(text)) {
    return AI_UNAVAILABLE.model_unavailable;
  }
  if (/fetch failed|network|enotfound|econnrefused|etimedout|dns|offline|abort/.test(text)) {
    return AI_UNAVAILABLE.network;
  }
  if (status >= 500 || /server error|internal error|bad gateway|unavailable|overloaded/.test(text)) {
    return AI_UNAVAILABLE.server_error;
  }
  return AI_UNAVAILABLE.unknown;
}

// The record the UI renders. `attempts` is the per-model trail so a user can
// see exactly what was tried and why each one dropped out.
export function makeProvenance(kind, { reason = null, model = null, attempts = [], note = '' } = {}) {
  const p = PROVENANCE[kind] || PROVENANCE.deterministic;
  return {
    kind: p.id,
    label: p.label,
    short: p.short,
    detail: p.detail,
    usedAi: p.id === 'ai' || p.id === 'hybrid',
    model: p.id === 'ai' || p.id === 'hybrid' ? model : null,
    unavailable: reason ? { ...reason } : null,
    attempts,
    note,
  };
}

// One line a human can read at a glance. Never says "done" on its own.
export function provenanceSummary(p) {
  if (!p) return 'Source unknown';
  if (p.usedAi) return `${p.label}${p.model ? ` · ${p.model}` : ''}`;
  if (p.unavailable) return `${p.label} — AI unavailable: ${p.unavailable.title}`;
  return p.label;
}

// True when the run must NOT be presented as an Orchestra AI success.
export function shouldWarnNoAi(p) {
  return Boolean(p && !p.usedAi);
}
