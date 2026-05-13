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

## Status

This is the Wave 0 scaffold. Feature work lands in Waves 1–3 (see plan).
