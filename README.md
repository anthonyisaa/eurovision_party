# Eurojury

A LAN party app for Eurovision night: phones are dumb input devices, the TV is the focal point.

## Stack

- **Monorepo:** pnpm workspaces
- **Web:** Next.js 15 (App Router, React 19) + Tailwind + shadcn + framer-motion
- **Realtime / DB:** Supabase (postgres + realtime + RLS, region `ap-southeast-1`)
- **Native TV surface:** Electron (transparent BrowserWindow overlaying YouTube)
- **Shared types:** `packages/db/types.ts` (generated) + `packages/shared`

## Workspaces

```
apps/
  web/            Next.js app — phone routes (/, /lobby, /live, /vote),
                  host routes (/admin, /admin/setup),
                  TV surface (/tv, /reveal)
  electron/       Native shell hosting YouTube + the /tv overlay
packages/
  db/             Supabase generated types + migrations (do not edit types.ts)
  shared/         Shared TS types & pure libs (e.g. derive-event)
```

---

## Day-of playbook 🎤

A condensed sequence for the host. Read top-to-bottom on party day.

### Pre-show prep (do once, in advance)

1. **Service-role key** — paste real value into BOTH files:
   - `apps/web/.env.local` → `SUPABASE_SERVICE_ROLE_KEY=...`
   - `apps/electron/.env`  → `SUPABASE_SERVICE_ROLE_KEY=...`

   Get it from <https://supabase.com/dashboard/project/euhwxkwpnskjmngjfqtd/settings/api>.

2. **Producer JSON for the show** — three external LLMs feed into the final payload:

   - **Step 2a (Gemini): video info only.** Gemini watches the YouTube recording and returns performances + other_events with timestamps. No commentary, no reactions.
   - **Step 2b (Grok): commentary sentiment & cues.** Grok pulls recent X/Twitter sentiment per song and produces roast angles + celebrate angles.
   - **Step 2c (ChatGPT): combine into the final ingest JSON.** ChatGPT marries the two outputs, applies Nala (catty/over-it) and Evee (enthusiastic/unhinged) personalities, and emits the schema `/admin/setup` expects.

   The reaction pool entries are tagged `kind: "roast"` or `kind: "celebrate"` so guests can do either (or both — one of each per performance). The phone shows two buttons; the TV color-codes the bubbles (🔥 roast = rose, 🎉 celebrate = gold).

   See the **Producer prompts** section near the bottom of this README for the exact prompts to copy into Gemini, Grok, and ChatGPT.

   Final payload shape pasted into `/admin/setup`:

   ```json
   {
     "yt_video_id": "Yy510SZZDw4",
     "performances": [
       { "running_order": 1, "country_code": "MD", "artist": "Satoshi",
         "song_title": "Viva, Moldova!", "start_seconds": 788, "end_seconds": 990,
         "vibe_blurb": "1-sentence camp roast", "fun_fact": "1-sentence trivia" }
     ],
     "other_events": [
       { "category": "opening",  "start_seconds": 0,    "description": "Hosts welcome" },
       { "category": "interval", "start_seconds": 5400, "description": "Interval act" },
       { "category": "voting",   "start_seconds": 7200, "description": "Lines open" },
       { "category": "result",   "start_seconds": 9000, "description": "Results begin" }
     ],
     "scheduled_commentary": [
       { "trigger_seconds": 815, "speaker": "nala",
         "content": "Oh Moldova, you came dressed as a disco ball that's seen things.",
         "event_idx": 1 }
     ],
     "reaction_pool": [
       { "event_idx": 1, "kind": "roast",     "speaker": "evee",
         "content": "If they win, I'm shaving my eyebrows." },
       { "event_idx": 1, "kind": "celebrate", "speaker": "nala",
         "content": "Camp icon behaviour. I'm in love." }
     ]
   }
   ```

   - All `_seconds` are offsets from the start of the YouTube video.
   - `category` for `other_events` must be one of `opening|interval|voting|result`.
   - Speakers are `nala` or `evee`. Reaction kinds are `roast` or `celebrate`.
   - Aim for 2–3 `scheduled_commentary` lines per performance, spaced 30–50s apart.
   - Aim for 1–2 of each reaction kind per performance (≈3–4 `reaction_pool` entries per song).

3. **Boot the web app locally:**

   ```sh
   pnpm install
   pnpm --filter @eurojury/web dev   # serves on :3000
   ```

4. **Claim host + paste the JSON.** From your laptop browser, visit:
   - `http://localhost:3000/` → enter your name → join. You get assigned 2 random countries.
   - `http://localhost:3000/admin` → tap "Claim host role".
   - `http://localhost:3000/admin/setup` → paste the JSON → "Ingest payload". Confirm green success toast with counts.
   - On the same page, paste actual results (a JSON array of `{ position, country_code }`) if available. You can also paste this later from /admin/setup.
   - Bulk-create any side bets (e.g. "Who will win the home jury?", "Will the UK score above 20?").

5. **Boot the Electron app** in a second terminal:

   ```sh
   pnpm --filter @eurojury/electron dev
   ```

   - First run opens a fullscreen YouTube window. Sign into your Google (Premium) account.
   - On macOS, in a third terminal: `caffeinate -d` (prevents sleep).
   - The overlay window appears on top and is click-through — clicks reach YouTube.

6. **Set up the join URL for guests.** Visit `http://localhost:3000/tv?party=5c21d5a7-4784-4f84-9e4c-c54b16809196` on the laptop browser BEFORE the Electron app loads. The lobby phase shows a big QR code linking to `/` — point your phone at it to test that join works.
   - If your guests are on a different network than your laptop, deploy to Vercel (see below) and use the Vercel URL.

### During the show

1. **Lobby phase** (before pressing play): guests scan the QR, join, see their team card with 2 country flags, place top-3 predictions, place side-bet picks. You see them appear in the /tv lobby roster live.

2. **Live phase**: tap **Phase → live** on `/admin`. Then start the YouTube video. Now:
   - Electron writes `yt_current_seconds` every 2s.
   - Scheduled commentary fires at its `trigger_seconds`, appearing as a Nala/Evee speech bubble on /tv.
   - When a performance is currently playing, phones show a "react!" widget with 5 emoji buttons. Guests tap their gut reaction.
   - Phones also show a "🎤 Roast" button if there's an unconsumed roast for the current event. Tap → it inserts a roast message into /tv.

3. **Pause anytime**: top of /admin has a big pause button. Bio breaks, pizza arrival, etc. The /tv overlay shows a "Paused" pill.

4. **Force current event**: if the YouTube timestamps drift, use the "Force current event" dropdown on /admin to jump to a specific event.

5. **Voting phase**: when the show's voting portion starts, tap **Phase → voting** on /admin. Phones show a drag-and-drop /vote page where guests rank their top 10. The /tv shows "JURY IS DELIBERATING" with progress.

6. **Reveal phase**: once all guests have locked, tap **Phase → reveal** on /admin. Then click the giant "Next reveal step ▶" button on /admin to advance through the 10-step animated reveal on /tv:
   1. Title card
   2. Bottom 5 (boos)
   3. Mid-pack scroll
   4. Top 5 ceremony
   5. Winner reveal + confetti
   6. Room vs. actual side-by-side (needs actual results pasted in /admin/setup)
   7. Predictions leaderboard
   8. Side-bet leaderboard
   9. Per-guest summary cycle
   10. Closing card

7. **Closed**: phase advances to closed automatically (or tap it on /admin) — /tv shows final standings.

---

## Fake-broadcast dress rehearsal (no YouTube needed)

You can run the full flow without the Electron app — useful for testing and for actually rehearsing.

1. Make sure the JSON payload is ingested in /admin/setup (timestamps need to exist).
2. On /admin, flip **Fake broadcast** to ON. This sets `parties.fake_broadcast=true` and `fake_broadcast_started_at=NOW()`.
3. While the /admin page is open, it sends a tick every 2s with the elapsed-since-start seconds — same as Electron would.
4. Advance phase to `live`. Watch the now-playing flag on /tv flip when the elapsed time crosses each `start_seconds`.
5. To test reveal: skip ahead with manual override or jump to the voting phase manually, lock test votes, then advance to reveal.

This is also the recommended way to test the full app on day-of before the actual party starts — you can validate everything without a YouTube video playing.

---

## Deploying to Vercel

**Live URL: <https://eurojury.vercel.app/>** (production deployment).

Re-deploy after changes:

```sh
scripts/deploy-vercel.sh
```

The script flattens the pnpm workspace via `pnpm deploy --legacy` into `/tmp/eurojury-deploy`, inlines `packages/db` + `packages/shared` as `file:` deps, and deploys via the Vercel CLI. This avoids the Vercel monorepo Root-Directory dashboard config that's not settable from `vercel.json`.

Production env vars are already set on the Vercel project:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_PARTY_ID`

(All set with `--no-sensitive` so Next can read them at build time.)

The Electron app stays on your laptop and points at the same Supabase project. Update `apps/electron/.env` `WEB_URL` to `https://eurojury.vercel.app` so the /tv overlay loads from prod (avoids needing the laptop's web app for guest joins on cellular).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Phones can't join — `assign_guest` errors | Service-role key not set (in web `.env.local`). Or party is full (40 countries / 2 per guest = max 20 guests). |
| Commentary not firing on /tv | Check Electron is running and writing `yt_current_seconds` (query `parties` row in Supabase). Confirm `scheduled_commentary` has rows with `fired=false`. |
| Vote ranking won't save | Service-role key not set. Or guest tried to vote for own country. |
| /reveal seems frozen | All clients sync on `parties.reveal_step`. Host must advance from /admin "Next step ▶". |
| YouTube ads or paywall in Electron | Sign into your YT Premium account in the YouTube window. Persistent partition retains it. |
| Skipped commentary after fast-forward | `fire_due_commentary` RPC fires every row whose `trigger_seconds <= current AND fired=false`. If you scrub 5 minutes forward, expect 2–3 bubbles to burst at once. Backward scrubs don't re-fire (rows stay `fired=true`). |
| "Look at the TV" on phone during voting | Expected. Phones are dumb. The /tv shows the actual deliberation progress. |

---

## Producer prompts (Gemini → Grok → ChatGPT)

Run these in order after the broadcast YouTube recording is available. Each prompt assumes you'll paste its JSON output into the next prompt's "Inputs" block.

### Prompt 1 — Gemini (video info only)

> You are a Eurovision logistics analyst. I'm going to give you a YouTube video of the Eurovision 2026 Grand Final (or a semi-final). Watch it and produce a JSON object describing the structural events of the broadcast. **Do not invent commentary, jokes, or reactions** — that comes from a separate pass.
>
> **Output schema (return ONLY this JSON, no prose):**
>
> ```json
> {
>   "yt_video_id": "<the 11-character video id>",
>   "performances": [
>     {
>       "running_order": <int starting at 1>,
>       "country_code": "<ISO 3166-1 alpha-2, uppercase>",
>       "artist": "<as announced on stage>",
>       "song_title": "<as announced on stage>",
>       "start_seconds": <video offset where the performance begins>,
>       "end_seconds": <video offset where applause/cut-away ends>,
>       "vibe_blurb": "<one sentence describing the staging/genre, neutral tone>",
>       "fun_fact": "<one sentence of trivia about the act or song>"
>     }
>   ],
>   "other_events": [
>     { "category": "opening",  "start_seconds": <int>, "description": "<short>" },
>     { "category": "interval", "start_seconds": <int>, "description": "<short>" },
>     { "category": "voting",   "start_seconds": <int>, "description": "<short>" },
>     { "category": "result",   "start_seconds": <int>, "description": "<short>" }
>   ]
> }
> ```
>
> Rules:
> - `category` is exactly one of `opening | interval | voting | result`. Use `result` for the points-reveal portion.
> - Performances must be ordered by `start_seconds` ascending. No duplicate `country_code`s.
> - If you cannot determine an exact `_seconds` value, round to the nearest second; never make up a value.
> - Output ONLY the JSON object. No backticks. No commentary about the show.
>
> Video: `<paste YouTube URL>`

### Prompt 2 — Grok (commentary sentiment + roast/celebrate cues)

> You have live access to X (Twitter). I'm going to give you a list of Eurovision performances from a recent show. For each one, return commentary cues drawn from the actual public reaction in the last 48 hours. Be tonally accurate — if a song was widely roasted, surface that; if it was beloved, surface that too. **Roast and celebrate angles are separate; both must be filled even for divisive songs.**
>
> **Inputs (paste this from Prompt 1's output):**
>
> ```json
> { "yt_video_id": "...", "performances": [ ... ] }
> ```
>
> **Output schema (return ONLY this JSON):**
>
> ```json
> {
>   "songs": [
>     {
>       "running_order": <int>,
>       "country_code": "<2-letter>",
>       "sentiment": "<love | divisive | meme | snoozy | dark-horse | universal-hate — one word>",
>       "talking_points": [
>         "<short cue, e.g. 'rumored political subtext'>",
>         "<short cue, e.g. 'choreography reportedly stolen from K-pop group X'>"
>       ],
>       "roast_cues": [
>         "<sharp, specific, drawn from real online reaction>",
>         "<another roast angle, ideally non-overlapping>"
>       ],
>       "celebrate_cues": [
>         "<genuine praise angle, also drawn from real reaction>",
>         "<another celebrate angle>"
>       ]
>     }
>   ]
> }
> ```
>
> Rules:
> - Every performance gets at least 2 `roast_cues` and 2 `celebrate_cues`, even if the public lean is one-sided — find dissent for the unloved and skepticism for the beloved.
> - Cues are short, punchy, party-friendly. No URLs, no usernames, no slurs.
> - Output ONLY the JSON object. No prose.

### Prompt 3 — ChatGPT (combine + apply Nala/Evee personalities)

> You are the head writer for two fictional Eurovision commentators:
> - **Nala** — catty, over-it cat-lady; deadpan; ages everything; gives points only grudgingly.
> - **Evee** — manic chaos goblin; unhinged enthusiasm; loves everything sincerely or sarcastically; never neutral.
>
> Combine the two inputs below into one ingest payload for the Eurojury party app. Apply the Nala/Evee voices to every line, alternating who speaks.
>
> **Inputs:**
>
> ```json
> // Output of Prompt 1 (Gemini): video info
> { "yt_video_id": "...", "performances": [...], "other_events": [...] }
> ```
>
> ```json
> // Output of Prompt 2 (Grok): commentary cues
> { "songs": [...] }
> ```
>
> **Output schema (return ONLY this JSON; this is what gets pasted into /admin/setup):**
>
> ```json
> {
>   "yt_video_id": "<from Gemini>",
>   "performances": [ /* exactly as Gemini returned, unchanged */ ],
>   "other_events":  [ /* exactly as Gemini returned, unchanged */ ],
>   "scheduled_commentary": [
>     {
>       "trigger_seconds": <int, within the performance window>,
>       "speaker": "nala" | "evee",
>       "content": "<one or two sentence line in that speaker's voice, drawing on Grok's talking_points>",
>       "event_idx": <performance running_order>
>     }
>   ],
>   "reaction_pool": [
>     {
>       "event_idx": <performance running_order>,
>       "kind": "roast" | "celebrate",
>       "speaker": "nala" | "evee",
>       "content": "<single-sentence line, drawing on Grok's roast_cues or celebrate_cues>"
>     }
>   ]
> }
> ```
>
> Rules:
> - For each performance produce:
>   - **2–3 `scheduled_commentary` lines** spaced 30–50 seconds apart inside its `start_seconds`–`end_seconds` window, alternating speakers.
>   - **1–2 `roast` reactions** drawn from `roast_cues`.
>   - **1–2 `celebrate` reactions** drawn from `celebrate_cues`.
> - Sentiment from Grok shapes tone: a `universal-hate` song gets sharper roasts, a `love` song gets sincere celebrate lines.
> - Each line is one or two sentences max. No URLs, no hashtags, no @mentions.
> - Speakers alternate naturally; don't let one dominate within a single song.
> - `scheduled_commentary` must be ordered by `trigger_seconds` ascending across the whole array.
> - Performances and other_events arrays from Gemini pass through verbatim.
> - Output ONLY the JSON object.

---

## Architecture decisions (for future you)

- **Phones are dumb.** Only display the bare minimum needed to push input. All commentary, animations, and reveal happen on /tv.
- **Pre-written commentary.** No runtime LLM calls. The /admin/setup JSON ingest is where the commentator content lives. Tweak Nala/Evee personalities via the external Gemini/Grok prompt, not in code.
- **Electron is the single writer for playback state.** No other client touches `yt_current_seconds`. This avoids races.
- **2 home countries per guest.** Random at signup, race-safe via the `assign_guest` Postgres function. Can't vote for either.
- **All mutations go through `SECURITY DEFINER` RPCs or server actions using the service-role key.** Anon role can only read.

---

## Scripts

- `pnpm dev` — Next dev server on :3000
- `pnpm dev:electron` — Electron app
- `pnpm build` — build every workspace
- `pnpm typecheck` — typecheck every workspace
- `pnpm test` — run unit tests (vitest)

---

## Status

Wave 0–2 complete. App is built end-to-end. Outstanding for Wave 3:
- User pastes `SUPABASE_SERVICE_ROLE_KEY` into both `.env` files
- User pastes Semi 1 JSON into /admin/setup for the dress rehearsal
- User does a full end-to-end fake-broadcast walk-through with 2+ test browser tabs
- (Optional) deploy to Vercel for off-LAN guests
