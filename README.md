# SIMICO Warehouse Scan — Android app

A Capacitor + React implementation of the `Warehouse Scan App.dc.html` design
handoff (`project/design_handoff_warehouse_scan/README.md`). Operators scan
parcels in/out of the warehouse, capture damage photos, collect a driver's
signature on-screen, and print/share an A4 handover document — plus a real
REST API integration tab to send/receive warehouse data with an ERP.

## Status

- **App**: complete and tested (badge login → home → inbound/outbound setup →
  scan → damage → signature → confirmation → document/history/API tabs). All
  screens were built against the handoff spec's exact colors, type scale,
  spacing and copy, and smoke-tested end-to-end in a headless browser
  (badge login, scanning, duplicate handling, damage, signature capture,
  confirm, PDF generation, history search, API tab).
- **Android project**: scaffolded via `@capacitor/android`, permissions
  (camera, vibrate, internet) and branding (app icon, splash screen) wired.
- **APK binary**: **not built** in this environment — see below.

### Why there's no `.apk` file attached

Building the APK requires the Android SDK (`compileSdk` platform + build
tools), which Gradle fetches from `dl.google.com`. That host is blocked by
this environment's outbound network policy (`403` from the egress proxy,
confirmed as a deliberate policy block, not a transient failure). There is no
supported way to get the Android SDK onto this machine, so the actual `.apk`
could not be compiled here.

Everything else is done: pull this project onto a machine with Android
Studio (or any CI runner with `ANDROID_HOME` set up, e.g. GitHub Actions'
`android-actions/setup-android`) and building the APK is a single command
(below) — no code changes needed.

## Building the APK

**Option A — Android Studio**

1. Open the `android/` folder in Android Studio (it will offer to install any
   missing SDK platform/build-tools automatically).
2. Build → Build Bundle(s) / APK(s) → Build APK(s).

**Option B — command line** (needs `ANDROID_HOME` pointed at an installed SDK
with `platforms;android-35` and a recent `build-tools`):

```bash
npm install
npm run build      # bundles the React app into dist/
npx cap sync android
cd android
./gradlew assembleDebug
# output: android/app/build/outputs/apk/debug/app-debug.apk
```

For a release build, use `./gradlew assembleRelease` and sign it per the
[Capacitor Android docs](https://capacitorjs.com/docs/android/deploying-to-google-play).

## Development

```bash
npm install
npm run dev          # Vite dev server, for iterating on the UI in a browser
npm run build         # production web bundle
npx cap sync android   # copy the web bundle + plugin config into the native project
npx cap open android   # open in Android Studio
```

## Architecture

- **React 19 + Vite + Tailwind 3**, plain JS (no TypeScript, matching the
  prototype's own stack).
- **`src/state/AppContext.jsx`** — single context/provider holding all app
  state (shift, active session, history, API config) and the actions screens
  call. Chosen over Redux/Zustand since the app is a single linear flow with
  no need for cross-cutting middleware.
- **`src/lib/db.js`** — a minimal native-IndexedDB wrapper (no dependency)
  persisting confirmed sessions/documents and app settings. IndexedDB was
  used instead of `localStorage` because a session record can carry a
  base64 signature PNG and damage photos, which outgrow `localStorage`'s
  quota.
- **`src/lib/pdfDoc.js`** — builds the A4 handover document with `jspdf`
  (single page, repeating table header, proper pagination for long parcel
  lists — this was a specific complaint fixed in the design iteration) and
  hands it to `@capacitor/filesystem` + `@capacitor/share` so **Print**,
  **Download PDF** and **Email PDF** all route through the native Android
  share sheet (the broadly-compatible option, since Android has no universal
  "print" intent outside a dedicated print-service plugin).
- **`src/lib/api.js`** — a real `fetch()`-based REST client for the API tab
  (POST session, GET manifest, retry). There is no bundled server: this talks
  to whatever ERP endpoint + API key the operator configures on the API
  screen, and genuinely fails (queue shows "failed", Retry re-sends) if
  nothing answers — this is not a simulated/fake integration.
- **`src/hooks/useBarcodeScanner.js`** — optional camera-based scanning
  fallback using the browser-native `BarcodeDetector` API (no bundled
  barcode library) for phones/tablets with no hardware scan engine. The
  primary scan path everywhere (badge login, tracking ID field) is a
  focused, hardware-keyboard-wedge-first input, per the design spec — a
  Zebra scan engine or Bluetooth ring scanner just types into it and hits
  Enter.
- **`src/components/icons.jsx`** — hand-rolled icons using the exact path
  data from the design file (rather than depending on whatever lucide-react
  version happens to be installed), for pixel fidelity.

## Deviations from the design file / handoff README

- **Target stack**: the handoff README's stated target was a React *web*
  page inside the existing `Adrian140/prep-center` repo; this session's
  request was specifically an Android APK, and that repo's actual source
  wasn't available in this workspace — so this is a fresh standalone
  Capacitor project, not a drop-in to prep-center. Design tokens (colors,
  type, spacing) were taken from the handoff README, which restates them
  independent of the source repo.
- **Persistence**: the handoff suggested Supabase tables; no Supabase project
  was available, so this uses on-device IndexedDB. The API tab's payload
  shape matches the suggested schema, so wiring a real backend later is a
  matter of pointing the API tab at it.
- **Client name removed everywhere** (per the second design chat) — scanning
  only records tracking ID, never a client.
- **Badge login**: production behavior per the design is "the screen simply
  advances when the badge is scanned" — there's no real operator directory
  to resolve a badge ID to a name, so the app asks for the operator's name
  the first time a given badge is seen and remembers it from then on.
- **History filters**: tracking-ID/document search, and the Inbound/Outbound
  segmented control are fully functional; the date-range and operator chips
  are currently fixed labels (a real date-range picker and multi-operator
  awareness are natural follow-ups once there's a shared backend, since a
  single device today only ever has one signed-in operator).
- **"Email PDF"**: rather than a fake "queued to accounting@…" toast, this
  opens the real Android share sheet so the operator picks their actual mail
  app — more honest for a shipped app than a canned success message with no
  backend behind it.

## Product rules implemented

See `project/design_handoff_warehouse_scan/README.md` for the full spec this
was built against. Summary: badge scan once per shift; one session = many
scans then one signature; signature required both inbound and outbound;
hardware-scanner-first tracking input; duplicate tracking ID blocked (double
beep + "+1 box"); unknown tracking ID accepted directly; photo mandatory only
when damage is flagged; one A4 document per session with a repeating table
header and single-page layout; bottom tab nav (Home · Scan · History · Docs ·
API); accept = single beep + short vibration, reject = double beep + vibrate
pattern.
