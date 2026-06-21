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
  { name: 'add_primitive', description: 'Add a built-in primitive shape (box, sphere, cylinder, cone, pyramid, torus, capsule, plane, tetrahedron, icosahedron) to the 3D scene.', inputSchema: { type: 'object', properties: { kind: str('primitive kind'), label: str('display label'), color: str('#hex (optional)') }, required: ['kind'] } },
  { name: 'gen_mesh', description: 'Generate a 3D model from a prompt with the active generator (Meshy/HF/mock) and add it to the scene.', inputSchema: { type: 'object', properties: { prompt: str('what to generate'), style: str('realistic|sculpture|cartoon') }, required: ['prompt'] } },
  { name: 'move_mesh', description: 'Reposition / rotate / rescale an existing object by id.', inputSchema: { type: 'object', properties: { id: str('mesh id'), position: { type: 'array', items: num(), description: '[x,y,z]' }, rotation: { type: 'array', items: num(), description: '[x,y,z] radians' }, scale: num('uniform scale') }, required: ['id'] } },
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
  { name: 'orchestrate', description: 'Hand a full high-level goal to the in-app Orchestra director and let it run the whole multi-step build autonomously.', inputSchema: { type: 'object', properties: { goal: str('the whole project to build') }, required: ['goal'] } },
];
