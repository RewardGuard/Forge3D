# Forge3D

**Design · Simulate · Fabricate** — a free, open-source desktop app that takes maker projects from idea to physical product:

- ✦ **Orchestra AI — the director** — describe a whole project ("make a car that drives with a joystick") and Orchestra conducts the other AIs end to end: it generates the shapes, hands the wiring to the circuit agent, writes the firmware, then tests the build in the Life Sim. It can **see** the 3D viewport (GLM-4.5V vision) and confirm each step before moving on. Every plan, tool call, result and screenshot streams into a live, observable timeline, and a **token-headroom** budget keeps runs cheap so you can use it a lot.
- 🧊 **3D Design** — AI mesh generation (multi-provider), primitives, grouping, **live boolean cuts** (negative objects carve holes), Thingiverse import, real-scale circuit part placement.
- 🔌 **Circuit Simulator** — drag-and-drop parts (Arduino, ESP32, Raspberry Pi 5, drivers, sensors…), live electrical simulation that **actually runs your sketch** (GPIO outputs light LEDs, drive motors through L298N drivers, react to buttons/joysticks), AI circuit-debugging agent with permission-gated edits.
- 🤖 **AI everywhere, bring your own key** — code generation (Arduino C++ / Raspberry Pi Python) and circuit Q&A via Gemini, Groq, Mistral, OpenRouter (free tiers) or Claude. Keys are stored locally on your machine, never bundled or transmitted anywhere else. Works fully offline in mock mode.
- 🔥 **Life Simulator** — gravity, heat, fire and material durability testing with clickable inputs.
- 🏭 **Production export** — one click packages board code, an STL for your 3D printer, an SVG for vinyl/label cutters (e.g. Silhouette Cameo PCB etching workflow), and a summary with costs, Amazon part links and the thermal breaking point.

## Install

Grab the latest `.dmg` (macOS) or `.exe` (Windows) from [Releases](../../releases).

> Builds are unsigned — on macOS right-click → Open the first time; on Windows accept the SmartScreen prompt.

## API keys (optional)

The app works out of the box in mock mode. For real AI generation, open **⚙ Settings** in the app and paste a free key from Gemini, Groq, Mistral or OpenRouter. Keys are stored in your OS user-data folder and never leave your machine except to call the provider you chose.

## Orchestra AI (the director)

Open the **✦ Orchestra** tab, type a whole project ("build a car controlled by a joystick", or "a house with exterior LEDs controlled by a button"), and press **Conduct**. Orchestra is an autonomous **engineering pipeline**, not a chatbot — it *understands the intent* and composes an **integrated electromechanical design** (it builds a house with LEDs on the outside, not a lamp), then validates it. You watch every step (plan, tool call, result and screenshot) stream into a live timeline:

1. **3D model** — lays out a correctly-proportioned build (chassis + four wheels laid flat at the corners, at the right ride height), then **validates the geometry** (wheel orientation, grounding, proportions) and auto-fixes it.
2. **See it** — captures the viewport and asks **GLM-4.5V** to confirm the design before moving on.
3. **Electronics** — wires the canonical circuit, then **functionally validates** it by running the electrical simulation (does each motor actually turn when the joystick is pushed forward?) and iterates with the circuit agent until it works.
4. **Firmware** — loads / generates the controller program.
5. **Assemble** — mounts the wheels on the motors (mechatronics).
6. **Test** — runs the Life Sim, drives the joystick, reads the result, sees it, and repairs anything that didn't work.

For **structures** (houses, enclosures) Orchestra works from a **Design Spec** (real mm units): it composes geometry with **real CSG openings** (doors/windows/ports, and a panel-mount through-hole for every LED and button), **mounts the electronics on the structure** (the LED you see on the wall *is* the LED in the netlist), and wires them **by function** (a button driving the LEDs). It then validates the design like an engineer would:

- **Structural** — mass (density × volume), center of mass over the support footprint (tip-over), grounding, support (no floating parts), interference.
- **Electrical** — the real sim confirms the LEDs light when the button is pressed.
- **Manufacturing** — FDM printability (min wall thickness, print-bed fit), part-fit tolerances (every part has a hole/cavity ≥ its size), plus a **BOM and feasibility report**.
- **Integration** — every electronic sits on the real exterior face it claims, indicators face outward, nothing is buried in a wall.

It iterates and auto-fixes what's safe, so the result is something you could actually print and assemble.

**The wiring is delegated to the circuit AI, with automatic model escalation.** Orchestra turns the spec into a wiring brief and hands it to the `build_circuit` agent, then *validates the result in the simulator* (do the LEDs light? do the motors turn?). If the call fails (quota/error) or the circuit doesn't actually work, Orchestra switches `orchestraDirector` to the next model — best key first (Claude → Gemini → Groq → GLM → Mistral → OpenRouter), with the free **base** model as the floor — and retries, until one succeeds. A deterministic **circuit synthesizer** is the last-resort offline fallback, so a run can never fail outright. The geometry and physical mounting stay deterministic; only the wiring is the AI's, and each part is mounted by reading the resulting netlist.

So `"a sumo robot with ultrasonic, 4 motors and an arduino"`, with nothing else, comes out as a printable 4-wheeled chassis (wheels laid flat at the corners, **nothing intersecting**), with the motors wired through L298N drivers, the ultrasonic and Arduino mounted and powered, firmware driving all four motors (sim-verified), structurally stable and grounded — **fully autonomously**.

The hard parts that have a known-right answer (proportions, canonical wiring, functional checks, structural physics) are deterministic engineering knowledge, so results are consistent even on a small free model; the LLM handles intent understanding and novel/generic goals.

- **Director model** (the planner) — defaults to the free Forge3D Cloud base model; switch it to Claude, Gemini, GLM, Groq, etc. in **Settings → Orchestra AI**. Orchestra routes *all* its delegated work through this one model.
- **Vision** — GLM-4.5V via the Hugging Face router; add a free [HF token](https://huggingface.co/settings/tokens) so Orchestra can confirm steps visually. Without it, it still builds — it just skips the visual check.
- **Token headroom** — Eco / Balanced / Max caps how much each run may spend (it never resends full history and downscales screenshots), so you can run it often.

The same control surface (`build_blueprint`, `build_circuit`, `check_geometry`, `check_circuit`, `check_motors`, `look`, …) is exposed to **Claude** as an MCP plugin — see [`server/orchestra-mcp/`](server/orchestra-mcp/) — so Claude (Desktop / Code) can drive Forge3D directly.

## Develop

```bash
npm install
npm run dev        # Vite + Electron with hot reload
npm run dist       # package the app for your platform
npm test           # simulation engine (23) + Orchestra engineering acceptance (28)
```

### Proving the engineering core

Orchestra's value isn't "the agent finished" — it's that the output is *correct*.
`npm run test:acceptance` runs the deterministic core (SPEC → COMPOSE → VALIDATE →
ITERATE) headless and asserts engineering criteria an actual engineer would check,
e.g.:

- **a house is still a house** — ≥4 walls + a roof, real CSG door/windows, LEDs on
  exterior faces, and pressing the button lights every LED *in the electrical sim*;
- **a car** — a coherent chassis + four wheels that lie flat and don't intersect,
  motors integrated (each wheel bolted to a motor), the joystick driving the motors;
- **a sumo robot** — four non-intersecting wheels, four motors that all run, the
  ultrasonic wired (TRIG+ECHO);
- **self-repair** — a deliberately broken design fails validation, and the iteration
  loop fixes it to a valid one;
- **autonomy** — `"a sumo robot with ultrasonic, 4 motors and an arduino"` is built
  from the goal alone, with **no human help and even when the model fails**: the
  result is checked for *conformance* (does it really have the wheels, motors and
  ultrasonic?), the model is re-asked with the exact failures, and it falls back to
  the validated template — so a correct sumo robot comes out every time;
- **any goal, no dead end** — even a goal with **no named template** (e.g. "a gadget
  with 3 LEDs, a button and a motion sensor") is built correctly: a universal
  requirement-driven builder parses what the goal asks for and produces a conformant,
  valid, printable device — so the system never drops to "I tried."

All of structural (mass, center of mass over the support polygon, support, no
interference), dimensional/manufacturing (printability, fit), and electrical
(simulated) validation must pass for a design to be reported valid.

## License

[MIT](LICENSE)
