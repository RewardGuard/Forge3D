# Product Hunt — interactive demo storyboard

Tool-agnostic script for the optional "interactive demo" field. Works in Arcade,
Storylane, Supademo, Guideflow, etc. — they all capture a click-path and let you
attach one tooltip per step.

**Recommended tool: Arcade.** Free tier is uncapped for PH launches, the Chrome
extension records a desktop app window (Forge3D is Electron, so it captures like
any window), and the embed renders inline on the PH page instead of a link-out.

**Target: 8 steps, ~45 seconds of clicking.** Demos over ~60s get abandoned.

---

## The story

One sentence in, a printable + wired + simulated device out. That's the whole
pitch, and it's the only thing the demo needs to prove. Do NOT tour the UI —
tabs, panels and settings are not the product, the pipeline is.

Record against **v0.1.14** so the discount field reads "Enter code".

---

## Steps

Each step: what to capture · exact tooltip copy (keep it ≤ 14 words).

**1 — Hook: the projects home**
Capture the home screen with 3–4 real projects in *In Development*.
> Forge3D turns a sentence into a 3D-printable gadget. Start here.

**2 — The ask**
Type into the Orchestra prompt, slowly enough to read:
`Make a car that drives with a joystick`
> Describe the thing you want. Plain English. No CAD experience.

**3 — The body**
The Design tab with the generated chassis + wheels on the build plate. Orbit
once before capturing so it reads as 3D, not a picture.
> Orchestra models the geometry — parametric, watertight, print-ready.

**4 — The circuit**
Circuit tab, showing the auto-wired joystick → driver → motors.
> It wires the electronics too. Every pin mapped, every net checked.

**5 — Physics**
Hit Run. Capture mid-motion with the wheels actually turning.
> Real rigid-body physics. Watch it drive before you spend filament.

**6 — The payoff**
Export tab with STL / BOM / firmware visible.
> Export STL, bill of materials, and the firmware that runs it.

**7 — The differentiator**
The "Connect to Claude" panel, connected state.
> Or drive the whole thing from Claude. Forge3D is an MCP server.

**8 — CTA**
Download screen.
> Free to download. Mac and Windows. → forge3d.design

---

## Recording notes

- **Close the second Forge3D window first.** Two instances are running from
  mounted DMGs; the demo should be one clean window.
- Sign in as a **Pro** account so the ad strip is hidden — it makes the product
  look finished, and it's the state most viewers will be in anyway.
- Use a project that already looks good. A demo that generates something ugly
  live is worse than no demo.
- Full-screen the window, hide the menu bar, and turn off notifications
  (Focus mode) — a Slack toast mid-capture is unrecoverable.
- Arcade lets you re-record a single step. If step 5 doesn't look good, redo
  step 5, don't redo the demo.

## What to skip

Settings, API keys, provider pickers, storage, billing. None of it sells the
product in 45 seconds, and the API-key screens risk showing a real key on
camera.
