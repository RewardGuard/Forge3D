// The prompts behind the three AI features that are not Orchestra — code
// generation, the circuit agent and Q&A. One copy, used by the Electron main
// process (electron/main.js) and by the browser preview (src/App.jsx) when it talks to
// Forge3D Cloud directly, so the two can never drift apart.

export function codeGenPrompt({ prompt, context, target } = {}) {
  const system =
    target === 'rpi5'
      ? 'You are an expert Raspberry Pi / Linux engineer. The board is a Raspberry Pi 5 running ' +
        'Raspberry Pi OS (Linux) — it is a full computer, NOT an Arduino. Write a single, complete, ' +
        'runnable Python 3 program for the described task and wiring. Prefer the gpiozero library ' +
        '(fall back to RPi.GPIO) for GPIO, and standard Python libraries otherwise. Use the exact ' +
        'BCM GPIO pin numbers provided. Add brief inline comments and a shebang. ' +
        'Respond with ONLY the Python code — no markdown fences, no prose.'
      : 'You are an expert Arduino/embedded engineer. Generate a single, complete, ' +
        'compilable Arduino sketch (C++) for the described board and wiring. ' +
        'Use the exact pin names/numbers provided. Add brief inline comments. ' +
        'Respond with ONLY the code — no markdown fences, no prose.';
  const userText =
    (context ? `Circuit context:\n${context}\n\n` : '') +
    `Task: ${prompt || (target === 'rpi5' ? 'Blink an LED on a GPIO pin.' : 'Blink the onboard LED.')}`;
  return { system, userText };
}

export function circuitAgentPrompt({ prompt, netlist, catalog } = {}) {
  const system =
    'You are an expert electronics engineer debugging an Arduino/breadboard circuit. ' +
    'You are given a NETLIST (parts with their pins, and the wires between them) and a user request. ' +
    'Diagnose issues (missing power/ground, unpowered parts, wrong/missing connections) and propose concrete edits. ' +
    'Reference pins EXACTLY as "nodeId.pin" from the netlist, e.g. "n1.+", "n2.VIN". ' +
    'To add a new part, use op "addPart" with a valid partId from the AVAILABLE PARTS list and an optional "ref" alias; ' +
    'you may then wire that alias, e.g. ref "x1" -> "x1.+". ' +
    'Respond with ONLY valid JSON (no markdown, no prose) in EXACTLY this shape: ' +
    '{"summary": string, "actions": [{"op": "addWire"|"removeWire"|"addPart"|"removePart", ' +
    '"from"?: string, "to"?: string, "partId"?: string, "ref"?: string, "node"?: string, "why"?: string}]}. ' +
    'Keep summary short and plain. Keep "why" under 8 words or omit it. ' +
    'If nothing should change, return an empty actions array and say why in summary.';
  const userText =
    `NETLIST:\n${netlist || '(empty circuit)'}\n\n` +
    `AVAILABLE PARTS (partId — name — pins):\n${catalog || '(none)'}\n\n` +
    `USER REQUEST: ${prompt || 'Find and fix problems in this circuit.'}`;
  return { system, userText };
}

export function askPrompt({ question, netlist } = {}) {
  const system =
    'You are a friendly electronics & embedded-systems assistant inside a circuit simulator. ' +
    'Answer the user\'s question clearly and concisely in plain text (no markdown headings). ' +
    'Use the circuit netlist for context when relevant.';
  const userText =
    (netlist ? `Circuit netlist:\n${netlist}\n\n` : '') + `Question: ${question || ''}`;
  return { system, userText };
}
