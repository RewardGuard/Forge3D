// Parse the circuit agent's JSON answer as forgivingly as possible: direct
// parse, fence-stripped, balanced-brace slice, and finally truncation repair
// (cut to the last complete action and close the brackets). Returns null only
// if nothing JSON-like is recoverable.
export function parseAgentJson(raw) {
  const text = String(raw || '').replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
  const attempts = [];
  attempts.push(text);
  const start = text.indexOf('{');
  if (start >= 0) {
    // balanced-brace scan (ignores braces inside strings)
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end > start) attempts.push(text.slice(start, end + 1));
    // truncation repair: close whatever was left open (string, then brackets)
    attempts.push(repairTruncated(text.slice(start)));
  }
  for (const candidate of attempts) {
    try {
      const obj = JSON.parse(candidate);
      if (obj && typeof obj === 'object') return obj;
    } catch { /* try next */ }
  }
  return null;
}

// Make a truncated JSON string parseable: finish the open string, drop a
// dangling key/comma, then close every bracket still on the stack.
function repairTruncated(s) {
  const stack = [];
  let inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let out = s;
  if (inStr) out += '"';
  out = out.replace(/[\s,]+$/, '');       // dangling comma/whitespace
  out = out.replace(/"[^"]*"\s*:\s*$/, ''); // dangling key with no value
  out = out.replace(/[\s,]+$/, '');
  while (stack.length) out += stack.pop() === '{' ? '}' : ']';
  return out;
}
