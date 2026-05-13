# Eurojury

A LAN party app for Eurovision night: phones are dumb input devices, the TV is the focal point.

## Stack

- **Monorepo:** pnpm workspaces
- **Web:** Next.js 15 (App Router, React 19) + Tailwind + shadcn
- **Realtime / DB:** Supabase (postgres + realtime + row-level security)
- **Native TV surface:** Electron (transparent BrowserWindow overlaying YouTube)
- **Shared types:** `packages/db/types.ts` (generated from Supabase) + `packages/shared`

## Workspaces

```
apps/
  web/            Next.js app — phone routes + /tv overlay surface
  electron/       Native shell that hosts YouTube + the /tv overlay
packages/
  db/             Supabase generated types + migrations (DO NOT EDIT types.ts)
  shared/         Shared TS types between web & electron
```

## Quick start

```sh
pnpm install
cp apps/web/.env.example apps/web/.env.local   # then paste real values
pnpm dev                                       # next dev on :3000
```

## Scripts

- `pnpm dev` — Next dev server
- `pnpm dev:electron` — Electron stub
- `pnpm build` — build every workspace
- `pnpm typecheck` — typecheck every workspace
- `pnpm lint` — lint web

## Launching the Electron TV surface

The Electron app drives playback (writes `yt_current_seconds` every 2s) and
fires due `scheduled_commentary` via the `fire_due_commentary` RPC. It also
hosts the transparent `/tv?electron=1` overlay on top of a fullscreen YouTube
window.

### One-time setup

1. Populate `apps/electron/.env` (copy from `.env.example`). You need:
   - `SUPABASE_URL` — same as `apps/web/.env.local`.
   - `SUPABASE_SERVICE_ROLE_KEY` — bypasses RLS so the laptop can write
     `parties.yt_current_seconds` and insert into `chat_messages`. Get it
     from the Supabase dashboard → Settings → API.
   - `PARTY_ID` — the party UUID (same value as `NEXT_PUBLIC_PARTY_ID`).
   - `YT_VIDEO_ID` — the 11-char video id to load fullscreen.
   - `WEB_URL` — origin where Next is serving `/tv`. Defaults to
     `http://localhost:3000` for local dev.
2. From the repo root: `pnpm install` (electron deps + workspace deps).

### Launch sequence (day-of)

In two terminals:

```sh
# Terminal 1: web app
pnpm --filter @eurojury/web dev          # serves /tv at :3000

# Terminal 2: Electron orchestrator
pnpm --filter @eurojury/electron dev     # compiles TS then launches
```

The first run opens a fullscreen YouTube window — sign into your Google
account once. The persistent partition (`persist:youtube`) retains the
session across relaunches. The overlay window appears on top and is
click-through, so all clicks reach YouTube underneath.

On macOS run `caffeinate -d` in a separate terminal to keep the laptop
awake for the duration of the show.

To deploy, the typical commands are:

```sh
pnpm --filter @eurojury/web build      # production build of web
pnpm --filter @eurojury/electron build # compile main.ts + preload-youtube.ts
```

## Status

Wave 2 complete: reveal sequence (Agent D), `/tv` overlay + Electron app
(Agent E). Wave 3 is the dress-rehearsal integration pass.
