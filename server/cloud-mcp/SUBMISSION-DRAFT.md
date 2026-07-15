# Forge3D Cloud — directory submission draft

Copy-paste answers for Claude.ai → Admin settings → Directory → Submissions → New
(the 11-step portal). Fill the **[BRACKETS]** before submitting.

> ⚠️ The directory portal requires a **Team or Enterprise** Claude org, and only an
> Owner/Primary Owner can submit. On an individual (Free/Pro) plan the portal isn't
> available — you'd need a Team workspace first.

## 2 · Connection
- Server URL: `https://forge3d.design/mcp`
- Transport: **Streamable HTTP**

## 3 · Tools
All 32 tools carry `title` + `readOnlyHint`/`destructiveHint` (12 read-only;
`orchestrate`/`build_blueprint`/`design_structure` marked destructive). ✅

## 4 · Listing
- **Name** (≤100): `Forge3D`
- **Tagline** (≤55): `Design 3D-printable gadgets from a sentence`
- **Description** (≤2000):
  > Forge3D turns a plain-language goal into a complete, validated, 3D-printable
  > electromechanical design. Describe what you want — "a sumo robot with ultrasonic
  > and 4 motors", "a sensor enclosure with status LEDs and a button" — and Forge3D
  > generates the geometry, synthesizes and wires the circuit (MCU, driver, parts,
  > pins), writes firmware, and runs engineering checks: structural stability,
  > FDM printability, part-fit tolerances, and a bill of materials with costs. It
  > returns a spec you can fabricate, not a vague suggestion. Pair the free Forge3D
  > desktop app and Claude can also drive it live — building in the 3D viewport and
  > testing in the physics-based Life Sim (gravity, heat, motors).
- **Categories**: Developer Tools / Design / Engineering [pick from the list shown]
- **Documentation URL**: `https://github.com/RewardGuard/Forge3D` *(must be public; make the repo public or publish a docs page)*
- **Privacy policy URL**: `https://forge3d.design/privacy`
- **Support contact**: `giovan.ruiz.000@gmail.com`
- **Icon**: `assets/forge3d-logo.png` (the F3 mark)
- **URL slug**: `forge3d`

## 5 · Use cases
- Primary: generate a printable electromechanical design (geometry + circuit + firmware
  + BOM) from a description; optionally drive the user's own paired Forge3D desktop app
  live (3D viewport + Life Sim).
- Data read: the user's design prompts/tool arguments. Data write: none persistent
  server-side; with pairing, it controls the user's own local app.

## 6 · Company
- Company: `RewardGuard`
- Website: `https://rewardguard.dev`
- Primary contact: `giovan.ruiz.000@gmail.com`

## 7 · Authentication
- **OAuth 2.1** via `[YOUR IdP — e.g. Stytch / Auth0]` (Dynamic Client Registration enabled).
- Resource server verifies JWT signature + issuer + audience; `sub` scopes each user.

## 8 · Data handling
- API ownership: **first-party** (own engine; no third-party API proxied for the design itself).
- Health data: **No**. Sponsored content: **No**.

## 9 · Test & launch (write this for the reviewer)
- Connect URL: `https://forge3d.design/mcp` → you'll be sent through OAuth sign-in.
- Test account: `[create one in your IdP and paste credentials, OR enable Google/email
  sign-in so the reviewer can self-serve]`.
- Steps to exercise it: 1) connect & authorize; 2) ask *"design a sumo robot with
  ultrasonic, 4 motors and an arduino"* → returns a validated design + BOM; 3) (optional)
  open the Forge3D desktop app, pair it (Settings → Orchestra AI → Forge3D Cloud), and
  ask Claude to run the Life Sim to see it drive live.

## 10 · Compliance
Accept the 7 acknowledgments (security, privacy, no prohibited use, etc.).

## Notes / known review items
- **Not** financial transfers or AI-generated media (images/video/audio) → allowed category.
- `gen_mesh` uses AI mesh generation for geometry — describe it as CAD geometry generation,
  not media generation.
- Rate-limit `orchestrate` before going wide (port the limiter from `server/proxy/index.mjs`).
