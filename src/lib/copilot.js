// The engineering copilot: natural language in, a validated PROPOSAL out.
//
// Two planners, and the proposal always says which one made it:
//   AI      the Director model reads the model context and the operation
//           catalogue and returns { operation, args, rationale }. Its choice
//           still goes through planOperation, which validates — the model
//           picks, it never mutates.
//   PARSER  a deterministic phrase matcher for the operations Forge3D has.
//           Works offline. Labelled 'deterministic', because it is.
//
// Both hand back the same shape, so the UI renders one card either way and
// the user accepts, rejects or undoes with the same buttons.

import { planOperation, applyProposal, revertProposal, operationCatalog } from './cadIntent.js';
import { buildModelContext, contextToPrompt } from './modelContext.js';
import { makeProvenance, classifyAiError, AI_UNAVAILABLE } from './aiProvenance.js';
import { parseAgentJson } from './agentJson.js';
import { MATERIALS } from './materials.js';

// ── Deterministic intent parser ───────────────────────────────────────────
const MAT_ALIASES = {
  aluminum: 'aluminum', aluminium: 'aluminum', alu: 'aluminum', steel: 'steel', titanium: 'titanium', copper: 'copper',
  pla: 'pla', abs: 'abs', petg: 'petg', nylon: 'nylon', resin: 'resin', rubber: 'rubber', glass: 'glass',
};
const ROLE_WORDS = { mount: 'mounting', mounting: 'mounting', boss: 'mounting', bosses: 'mounting', hole: 'mounting', holes: 'mounting',
                     electronic: 'electronic', electronics: 'electronic', structural: 'structural', rib: 'structural', ribs: 'structural' };

export function parseIntent(text, ctx) {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return null;
  const preserve = [];
  const keep = t.match(/(?:keep|preserve|maintain|don'?t (?:touch|change|modify)|without (?:changing|touching|moving))\s+(?:the\s+)?([a-z\s,]+?)(?:\s+(?:the same|unchanged|intact|as is|in place)|[.,;]|$)/);
  if (keep) for (const w of keep[1].split(/[\s,]+/)) if (ROLE_WORDS[w]) preserve.push(ROLE_WORDS[w]);
  if (/mount/.test(t)) preserve.push('mounting');
  const preserveArg = preserve.length ? [...new Set([...preserve, 'electronic'])] : undefined;

  // lighten: "20% lighter", "reduce mass by 15%", "cut weight 30 percent"
  const pct = t.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)/);
  if (pct && /(light|weight|mass|reduce|cut|shave|slim)/.test(t)) {
    const strategy = /(?:swap|change|different|other)\s+material|material/.test(t) ? 'material' : /(shrink|scale|smaller)/.test(t) ? 'scale' : 'auto';
    return { operation: 'lighten', args: { targetPct: Number(pct[1]), strategy, ...(preserveArg ? { preserve: preserveArg } : {}) }, matched: 'lighten by percent' };
  }

  // round / fillet / chamfer: "round the corners 2mm", "fillet all edges 3 mm", "chamfer 1.5mm"
  const mm = t.match(/(\d+(?:\.\d+)?)\s*mm/);
  if (/(chamfer|bevel)/.test(t)) {
    return { operation: 'round_corners', args: { radius_mm: mm ? Number(mm[1]) : 1, style: 'chamfer', ...(preserveArg ? { preserve: preserveArg } : {}) }, matched: 'chamfer' };
  }
  if (/(round|fillet|soften|smooth)/.test(t) && /(corner|edge|rim)/.test(t)) {
    if (/\b(this|that|selected|these)\s+(edge|edges)\b/.test(t) || /\bonly\b/.test(t)) {
      return { operation: 'fillet_edges', args: { radius_mm: mm ? Number(mm[1]) : 2 }, matched: 'fillet selected edges' };
    }
    return { operation: 'round_corners', args: { radius_mm: mm ? Number(mm[1]) : 2, style: 'round', ...(preserveArg ? { preserve: preserveArg } : {}) }, matched: 'round corners' };
  }

  // material: "make it aluminum", "switch to steel", "use PETG"
  for (const [alias, key] of Object.entries(MAT_ALIASES)) {
    if (new RegExp(`\\b${alias}\\b`).test(t) && /(make|switch|change|use|set|in)\b/.test(t)) {
      const ids = (ctx?.bodies || []).filter((b) => !preserveArg || !preserveArg.includes(b.role)).map((b) => b.id);
      return { operation: 'set_material', args: { bodyIds: ids, material: key }, matched: `material → ${MATERIALS[key].name}` };
    }
  }

  // load-driven: honest refusal path
  if (/(\d+)\s*n\b/.test(t) && /(deform|deflect|bend|stress|stiff|strong|load|break)/.test(t)) {
    const n = t.match(/(\d+)\s*n\b/);
    return { operation: 'optimize_under_load', args: { load_N: Number(n[1]), keepFootprint: /footprint/.test(t) }, matched: 'load case' };
  }
  return null;
}

// ── AI planner ────────────────────────────────────────────────────────────
const SYSTEM = `You are Forge3D's engineering copilot. You choose ONE validated CAD operation for the user's request.
Reply with ONLY a JSON object: {"operation": "<id>", "args": {...}, "rationale": "<one sentence, engineering reasoning>"}.
Rules: pick from the catalogue only; never invent operations; if the request needs an analysis Forge3D cannot do (stress, thermal, RF), pick "optimize_under_load" or reply {"operation": null, "rationale": "<why>"}.
Preserve mounting features unless the user says otherwise (preserve: ["mounting","electronic"]).`;

export async function planWithAi(text, ctx) {
  const catalogue = operationCatalog().map((o) => `${o.id}: ${o.label} — params ${JSON.stringify(o.params)}`).join('\n');
  const userText = `MODEL:\n${contextToPrompt(ctx)}\n\nOPERATIONS:\n${catalogue}\n\nREQUEST: ${text}`;
  let res;
  try {
    res = await window.forge.orchestra.think({ system: SYSTEM, userText, maxTokens: 400 });
  } catch (e) {
    return { ok: false, reason: classifyAiError(e), error: e };
  }
  if (res.mock) return { ok: false, reason: AI_UNAVAILABLE.no_key };
  const parsed = parseAgentJson(res.text || '');
  if (!parsed || typeof parsed !== 'object') return { ok: false, reason: AI_UNAVAILABLE.bad_output, raw: res.text };
  return { ok: true, operation: parsed.operation, args: parsed.args || {}, rationale: parsed.rationale || '', model: res.provider };
}

// ── The entry point ───────────────────────────────────────────────────────
/**
 * Plan a change from natural language. Returns
 *   { ok:true,  proposal, provenance, rationale, matched }
 *   { ok:false, refused, reason, alternatives, provenance }   (the operation refused)
 *   { ok:false, unknown:true, reason }                         (nobody understood it)
 */
export async function planFromText(text, { useAi = true } = {}) {
  const ctx = buildModelContext();
  if (!ctx.bodyCount) return { ok: false, unknown: true, reason: 'There is nothing in the model to change yet.' };

  let choice = null, provenance = null, rationale = '', attempts = [];
  if (useAi) {
    const ai = await planWithAi(text, ctx);
    if (ai.ok && ai.operation) {
      choice = { operation: ai.operation, args: ai.args, matched: 'AI' };
      rationale = ai.rationale;
      provenance = makeProvenance('ai', { model: ai.model });
    } else if (ai.ok && !ai.operation) {
      return { ok: false, unknown: true, reason: ai.rationale || 'The model could not map this to an operation.', provenance: makeProvenance('ai', { model: ai.model }) };
    } else {
      attempts.push({ model: 'director', reason: ai.reason?.id, title: ai.reason?.title });
    }
  }
  if (!choice) {
    const parsed = parseIntent(text, ctx);
    if (!parsed) {
      return {
        ok: false, unknown: true,
        reason: attempts.length
          ? `AI unavailable (${attempts[0].title}) and the built-in parser did not recognise the request.`
          : 'The built-in parser did not recognise the request.',
        provenance: makeProvenance('deterministic', { reason: attempts.length ? AI_UNAVAILABLE[attempts[0].reason] : null, attempts }),
        hint: 'Try: "make it 20% lighter, keep the mounting bosses" · "round the corners 2 mm" · "chamfer 1 mm" · "make it aluminum"',
      };
    }
    choice = parsed;
    rationale = `Matched "${parsed.matched}" by the built-in parser.`;
    provenance = makeProvenance('deterministic', { reason: attempts.length ? AI_UNAVAILABLE[attempts[0].reason] : null, attempts });
  }

  const proposal = planOperation(choice.operation, choice.args, ctx);
  if (!proposal.ok) {
    return { ok: false, refused: Boolean(proposal.refused), reason: proposal.reason, wouldNeed: proposal.wouldNeed, alternatives: proposal.alternatives || [], operation: choice.operation, provenance, rationale };
  }
  return { ok: true, proposal, provenance, rationale, operation: choice.operation, args: choice.args };
}

export { applyProposal, revertProposal };
