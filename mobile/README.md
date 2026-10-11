# GlossX for iPhone, iPad and Android

One [Capacitor](https://capacitorjs.com) app for all three platforms. It does not
run Claude Code or Codex itself: it connects to GlossX on your computer over the
local network (or a VPN such as Tailscale) and shows the same frontend, laid out
for touch screens. Agents, papers and CLIs all stay on the computer.

## Pairing

1. On the computer, open GlossX → Settings → **Mobile access**, turn on
   **Allow**, then restart GlossX. The desktop app then listens on the network
   at port 8010. (`npm start` already listens on all interfaces.)
2. Scan the QR code with the phone's camera, or type the address and pairing
   code into the app.

Requests from other devices need the pairing code; requests from the computer
itself never do. **New pairing code** signs every device out.

## Building

```bash
cd mobile
npm ci
npx cap sync
npx cap open ios       # Xcode: pick your team under Signing, then Run (iPhone or iPad)
npx cap open android   # Android Studio: Run, or ./gradlew assembleDebug in android/
```

`www/` is the app's own connect page; everything else comes from the computer,
so frontend changes reach the phone without rebuilding the app. The
**Mobile build** workflow builds a debug APK (a workflow artifact) and checks
that the iOS project compiles.

App icons and splash screens are generated from `assets/` with
`npx @capacitor/assets generate`.
