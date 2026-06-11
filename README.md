# Forge3D

**Design · Simulate · Fabricate** — a free, open-source desktop app that takes maker projects from idea to physical product:

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

## Develop

```bash
npm install
npm run dev        # Vite + Electron with hot reload
npm run dist       # package the app for your platform
node scripts/benchmark-sim.mjs   # simulation engine test suite
```

## License

[MIT](LICENSE)
