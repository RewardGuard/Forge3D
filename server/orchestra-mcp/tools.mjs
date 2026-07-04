// Tool definitions for the Forge3D Orchestra MCP plugin.
//
// These MIRROR the in-app Orchestra action API (src/lib/orchestraTools.js) so a
// remote Claude drives Forge3D with the exact same vocabulary the in-app
// director uses. The MCP server forwards each call to the local Forge3D bridge,
// which runs `runTool(name, args)` in the live renderer.
//
// Keep this list in sync with src/lib/orchestraTools.js.

const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });
const bool = (description) => ({ type: 'boolean', description });

export const TOOL_DEFS = [
  { name: 'get_state', description: 'Read a compact snapshot of the scene + circuit + sim state.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_netlist', description: 'Read the circuit as a text netlist (parts, pins, wires, loose pins).', inputSchema: { type: 'object', properties: {} } },
  { name: 'parts_catalog', description: 'List every valid partId you may reference. Call once.', inputSchema: { type: 'object', properties: {} } },
  { name: 'add_primitive', description: 'Add a primitive shape (box, sphere, cylinder, cone, pyramid, torus, capsule, plane, tetrahedron, icosahedron) to the 3D scene — with REAL millimetre dimensions per axis via size_mm (e.g. a 157×121×29 mm radiator: {"kind":"box","size_mm":{"w":157,"h":29,"d":121}}).', inputSchema: { type: 'object', properties: { kind: str('primitive kind'), label: str('display label'), color: str('#hex (optional)'), size_mm: { type: 'object', description: '{w,h,d} or {r,h} in real millimetres — exact per-axis sizing (optional)', properties: { w: num('width mm'), h: num('height mm'), d: num('depth mm'), r: num('radius mm') } }, position_mm: { type: 'array', items: num(), description: '[x,y,z] in millimetres (optional)' }, rotation: { type: 'array', items: num(), description: '[x,y,z] radians (optional)' } }, required: ['kind'] } },
  { name: 'gen_mesh', description: 'Generate a 3D model from a prompt with the active generator (Meshy/HF/mock) and add it to the scene.', inputSchema: { type: 'object', properties: { prompt: str('what to generate'), style: str('realistic|sculpture|cartoon') }, required: ['prompt'] } },
  { name: 'search_thingiverse', description: 'Search Thingiverse for real printable parts (radiators, cold plates, pumps, brackets, enclosures…). Returns candidates to import with import_thingiverse. Needs a Thingiverse token in the app Settings.', inputSchema: { type: 'object', properties: { query: str('what to search for, e.g. "120mm radiator"') }, required: ['query'] } },
  { name: 'import_thingiverse', description: 'Import a Thingiverse model (STL) into the 3D scene AT ITS REAL SIZE — the STL is measured in native millimetres, so a real 157 mm radiator arrives as 157 mm. Override with size_mm (longest dimension) if needed.', inputSchema: { type: 'object', properties: { thingId: num('id from search_thingiverse'), label: str('display name (optional)'), size_mm: num('force the longest dimension to this many mm (optional; default = native size)'), position_mm: { type: 'array', items: num(), description: '[x,y,z] millimetres (optional)' } }, required: ['thingId'] } },
  { name: 'move_mesh', description: 'Reposition / rotate / resize an existing object by id. size_mm resizes to exact real millimetres per axis; scale accepts a number or [x,y,z] array.', inputSchema: { type: 'object', properties: { id: str('mesh id'), position: { type: 'array', items: num(), description: '[x,y,z] scene units' }, position_mm: { type: 'array', items: num(), description: '[x,y,z] millimetres' }, rotation: { type: 'array', items: num(), description: '[x,y,z] radians' }, scale: { description: 'number (uniform) or [x,y,z] per-axis' }, size_mm: { type: 'object', description: '{w,h,d} or {r,h} millimetres — exact per-axis resize', properties: { w: num('width mm'), h: num('height mm'), d: num('depth mm'), r: num('radius mm') } } }, required: ['id'] } },
  { name: 'attach_motor', description: 'Mount one object onto another so they move as a unit; if one is a motor part it spins the other when powered.', inputSchema: { type: 'object', properties: { childId: str('mesh mounted on parent'), parentId: str('mesh id, or null to detach'), drives: bool('spin when powered (default true)') }, required: ['childId'] } },
  { name: 'set_material', description: 'Set what an object is made of (drives Life Sim durability).', inputSchema: { type: 'object', properties: { id: str('mesh id'), materialKey: str('e.g. steel, abs, aluminum, wood') }, required: ['id', 'materialKey'] } },
  { name: 'group', description: 'Group several objects so they select/move/fall as one assembly.', inputSchema: { type: 'object', properties: { ids: { type: 'array', items: str(), description: 'mesh ids (>= 2)' } }, required: ['ids'] } },
  { name: 'add_part', description: 'Drop a single electronic part onto the circuit canvas by partId.', inputSchema: { type: 'object', properties: { partId: str('valid partId') }, required: ['partId'] } },
  { name: 'build_circuit', description: 'Hand a plain-language wiring request to the circuit agent; its add/remove edits are applied automatically. Use this instead of wiring pins by hand.', inputSchema: { type: 'object', properties: { prompt: str('wiring request in plain language') }, required: ['prompt'] } },
  { name: 'gen_code', description: 'Ask the code agent to write firmware for a microcontroller node and load it into the sim.', inputSchema: { type: 'object', properties: { nodeId: str('MCU node id'), prompt: str('what the firmware should do') }, required: ['nodeId', 'prompt'] } },
  { name: 'project_circuit_3d', description: 'Push circuit parts into the 3D scene as real-scale bodies for the Life Sim.', inputSchema: { type: 'object', properties: {} } },
  { name: 'set_tab', description: 'Switch the visible workspace (design|circuit|export|lifesim|orchestra).', inputSchema: { type: 'object', properties: { tab: str('workspace name') }, required: ['tab'] } },
  { name: 'run_sim', description: 'Switch to the Life Sim and start it (powers the circuit + gravity + spinning motors).', inputSchema: { type: 'object', properties: {} } },
  { name: 'pause_sim', description: 'Pause the Life Sim.', inputSchema: { type: 'object', properties: {} } },
  { name: 'set_joystick', description: 'Move a joystick input. x/y are 0..1 (0.5 center, 1 up/right).', inputSchema: { type: 'object', properties: { nodeId: str('joystick node id (optional)'), x: num('0..1'), y: num('0..1'), sw: bool('press stick button') } } },
  { name: 'set_input', description: 'Drive a button (true/false), switch (true/false) or potentiometer (0..1).', inputSchema: { type: 'object', properties: { nodeId: str('input node id'), value: { description: 'bool or 0..1' } }, required: ['nodeId', 'value'] } },
  { name: 'get_sim_report', description: 'Read the latest Life Sim physics report (temperature, integrity, status per object).', inputSchema: { type: 'object', properties: {} } },
  { name: 'look', description: 'Capture the live viewport and ask the vision model about it. Returns the model\'s text verdict and the screenshot.', inputSchema: { type: 'object', properties: { question: str('what to check in the image') }, required: ['question'] } },
  { name: 'screenshot', description: 'Capture the live 3D viewport and return it as an image so YOU can see the current design directly. Use this to check your work before moving on.', inputSchema: { type: 'object', properties: {} } },

  // ---- starter builds + engineering validation (mirror src/lib/orchestraTools.js) ----
  { name: 'build_blueprint', description: 'Place a correctly-proportioned starter build for a known archetype (chassis, wheels laid flat, etc.). Replaces existing design shapes — use first for a recognized project, then customize.', inputSchema: { type: 'object', properties: { archetype: str('car|robot|lamp') }, required: ['archetype'] } },
  { name: 'design_structure', description: 'Compose a full structural product (house/enclosure) from a goal: real-scale geometry with CSG cutouts (doors/windows/ports) PLUS electronics mounted on it and wired by function. Use for non-vehicle builds.', inputSchema: { type: 'object', properties: { goal: str('plain-language project description') }, required: ['goal'] } },
  { name: 'check_geometry', description: 'Validate the 3D geometry (wheel orientation, floating parts, proportions) and auto-fix what is safe. Returns the issues found.', inputSchema: { type: 'object', properties: { archetype: str('car|robot|lamp|generic (optional)') } } },
  { name: 'check_circuit', description: 'Functionally validate the circuit (power, ground, driver, whether motors actually turn when driven). Returns concrete deficiencies — empty means it works.', inputSchema: { type: 'object', properties: { archetype: str('car|robot|lamp|generic (optional)') } } },
  { name: 'check_motors', description: 'Run the electrical sim with inputs driven (joystick forward) and report whether each motor is active and its direction.', inputSchema: { type: 'object', properties: {} } },
  { name: 'check_indicators', description: 'With the button pressed, report whether each indicator LED actually turns on (functional electrical check).', inputSchema: { type: 'object', properties: {} } },
  { name: 'validate_structure', description: 'Engineer-grade physical check: mass, center of mass, support (no floating parts), tip-over stability and interference. Auto-fixes what is safe; returns the rest.', inputSchema: { type: 'object', properties: {} } },
  { name: 'validate_manufacture', description: 'Check the last composed structure for FDM printability (min wall, bed fit), part-fit tolerances, and a BOM + feasibility report. Run design_structure first.', inputSchema: { type: 'object', properties: {} } },
  { name: 'validate_integration', description: 'Check that each electronic is mounted on a real exterior face, indicators face outward, and nothing is buried in a wall. Run design_structure first.', inputSchema: { type: 'object', properties: {} } },
  { name: 'done', description: 'Finish: provide a short summary of what was built.', inputSchema: { type: 'object', properties: { summary: str('what was built') } } },

  { name: 'orchestrate', description: 'Hand a full high-level goal to the in-app Orchestra director and let it run the whole multi-step build autonomously. Returns the final status + a step timeline.', inputSchema: { type: 'object', properties: { goal: str('the whole project to build') }, required: ['goal'] } },
];

// ---------------------------------------------------------------------------
// MCP tool annotations — REQUIRED by Claude's connector-directory review: every
// tool needs a human `title` plus accurate read-only / destructive hints so the
// client can reason about safety. (See server/cloud-mcp/SUBMIT.md.)
// ---------------------------------------------------------------------------
const TITLES = {
  get_state: 'Read scene & circuit state', get_netlist: 'Read circuit netlist', parts_catalog: 'List part catalog',
  add_primitive: 'Add primitive shape', gen_mesh: 'Generate 3D model', move_mesh: 'Move / rotate / scale object',
  attach_motor: 'Attach object to a motor/parent', set_material: 'Set object material', group: 'Group objects',
  add_part: 'Add electronic part', build_circuit: 'Build / repair circuit', gen_code: 'Write firmware',
  project_circuit_3d: 'Project circuit into 3D', set_tab: 'Switch workspace tab', run_sim: 'Start Life Sim',
  pause_sim: 'Pause Life Sim', set_joystick: 'Set joystick input', set_input: 'Set input value',
  get_sim_report: 'Read Life Sim report', look: 'Capture viewport & ask vision', screenshot: 'Capture viewport image',
  search_thingiverse: 'Search Thingiverse parts', import_thingiverse: 'Import Thingiverse STL (real size)',
  build_blueprint: 'Place starter build (replaces shapes)', design_structure: 'Compose full structure',
  check_geometry: 'Check & auto-fix geometry', check_circuit: 'Check circuit (report)', check_motors: 'Check motors run (report)',
  check_indicators: 'Check indicator LEDs (report)', validate_structure: 'Validate & auto-fix structure',
  validate_manufacture: 'Validate manufacturability', validate_integration: 'Validate part integration',
  done: 'Finish run', orchestrate: 'Build whole project autonomously',
};
// pure reads (no scene/state change)
const READ_ONLY = new Set(['get_state', 'get_netlist', 'parts_catalog', 'get_sim_report', 'look', 'screenshot', 'check_circuit', 'check_motors', 'check_indicators', 'validate_manufacture', 'validate_integration', 'done', 'search_thingiverse']);
// replace/reset existing work
const DESTRUCTIVE = new Set(['orchestrate', 'build_blueprint', 'design_structure']);
for (const t of TOOL_DEFS) {
  const ro = READ_ONLY.has(t.name);
  t.annotations = { title: TITLES[t.name] || t.name, readOnlyHint: ro, destructiveHint: ro ? false : DESTRUCTIVE.has(t.name) };
}
