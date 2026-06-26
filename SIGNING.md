# Signing & notarizing the macOS app (zero "damaged" warnings)

The build is already wired for this (hardened runtime + entitlements + a
`dist:signed` script). You just need an Apple Developer ID. One-time setup, then
every release is `npm run dist:signed`.

## What it costs
- **Apple Developer Program — $99/yr.** That's the only purchase. DuckDNS and the
  EC2 server are already free/running, so nothing else is needed.

## 1. Enroll ($99, ~24–48 h to approve)
1. Go to <https://developer.apple.com/programs/enroll/> and sign in with your Apple ID.
2. Enroll as an **Individual** (fastest). Pay the $99.
3. Wait for the approval email. After that you have a **Team** with a **Team ID**.
   Find it at <https://developer.apple.com/account> → Membership details → **Team ID**
   (a 10-character string like `A1B2C3D4E5`).

## 2. Get a "Developer ID Application" certificate (free, after enrollment)
Easiest, via Xcode (install from the App Store if needed):
1. Xcode → **Settings → Accounts** → add your Apple ID → select the team → **Manage Certificates…**
2. Click **+** → **Developer ID Application**. It installs into your login Keychain.

(No-Xcode path: Keychain Access → Certificate Assistant → *Request a Certificate from a CA* → save to disk; upload the CSR at developer.apple.com → Certificates → **+** → *Developer ID Application*; download the `.cer` and double-click to install.)

Verify it's there:
```bash
security find-identity -p codesigning -v | grep "Developer ID Application"
```
You should see one line — that's your signing identity.

## 3. Create an app-specific password (for notarization)
1. <https://account.apple.com> → **Sign-In and Security → App-Specific Passwords → +**.
2. Name it "forge3d notarize", copy the generated password (format `abcd-efgh-ijkl-mnop`).

## 4. Build a signed + notarized dmg
From the repo, set three env vars (your Apple ID email, the app-specific password,
the Team ID) and run the signed build. **These never go in the repo** — pass them inline:
```bash
cd ~/forge3d
export PATH="$HOME/.local-node/current/bin:$PATH"
APPLE_ID="you@example.com" \
APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop" \
APPLE_TEAM_ID="A1B2C3D4E5" \
npm run dist:signed
```
electron-builder will: sign with your Developer ID (auto-found in the Keychain) →
apply the hardened runtime + `build/entitlements.mac.plist` → upload to Apple's
notary service → wait → staple the ticket. (~3–10 min, mostly Apple's side.)

## 5. Verify it's clean
```bash
DMG=release/Forge3D-0.1.0-arm64.dmg
spctl -a -vvv -t install "$DMG"                 # → "accepted, source=Notarized Developer ID"
xcrun stapler validate "$DMG"                    # → "The validate action worked!"
```
A user who downloads this opens it with a normal double-click — **no "damaged", no `xattr`.**

## 6. Ship it
Re-upload to the GitHub release (replaces the unsigned dmg). With a signed dmg you
can drop the `xattr` workaround from the release notes + landing page, and the
`install.sh` becomes optional.

## Notes
- The unsigned `npm run dist` still works for quick local builds (no Apple account
  needed) — signing only happens in `dist:signed`.
- If electron-builder's notarize step ever errors, you can notarize the built dmg
  manually:
  ```bash
  xcrun notarytool submit "$DMG" --apple-id "$APPLE_ID" \
    --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait
  xcrun stapler staple "$DMG"
  ```
- Renewal: the $99 is annual; the cert is valid 5 years but notarization requires
  an active membership.
