// Eurojury Electron orchestrator.
//
// Spawns two BrowserWindows on the same display:
//   1. YouTube — fullscreen, frameless, signed-in (persist:youtube partition).
//   2. Overlay — transparent, always-on-top, click-through. Loads /tv?electron=1.
//
// Every 2s the YouTube preload script reports `video.currentTime` via IPC.
// The main process then:
//   a) Upserts parties.{yt_current_seconds, yt_last_update_at, yt_player_state}
//      via the Supabase service-role key.
//   b) Calls the fire_due_commentary RPC, which atomically flips scheduled
//      rows whose trigger_seconds <= current and returns them. Each returned
//      row becomes a chat_messages INSERT, which the /tv overlay subscribes
//      to and renders as a speech bubble.
//
// Per architect D1: the laptop is the single source of truth for playback
// time. No web `/api/yt-state` route — main process writes directly.

import { app, BrowserWindow, ipcMain, session } from 'electron';
import dotenv from 'dotenv';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// `__dirname` is provided natively under CommonJS (our tsconfig emits CJS).
// After build the layout is:
//   apps/electron/
//     .env                  ← we want this file
//     dist/main.js          ← __dirname points here
// `.env` is the parent directory of dist/.
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_ANON_KEY,
  PARTY_ID,
  YT_VIDEO_ID,
  WEB_URL = 'http://localhost:3000',
} = process.env;

// Prefer service-role if set (bypasses RLS); fall back to anon. After
// the 0008_anon_writes migration the anon key is sufficient for the
// writes this process performs (parties update, scheduled_commentary
// update via RPC, chat_messages insert).
const supabaseKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !supabaseKey || !PARTY_ID || !YT_VIDEO_ID) {
  console.error(
    '[eurojury] Missing required env vars in apps/electron/.env:',
  );
  console.error(
    '  SUPABASE_URL, (SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY), PARTY_ID, YT_VIDEO_ID',
  );
  process.exit(1);
}

// Untyped client — we deliberately don't import @eurojury/db/types here so
// the cross-workspace .ts file doesn't get pulled into Electron's dist/.
// All SQL is small and well-scoped; the trade-off is acceptable.
const supabase: SupabaseClient = createClient(
  SUPABASE_URL,
  supabaseKey,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// Local mirror of the fire_due_commentary RPC return shape. Keep in sync
// with packages/db/migrations/0007_fire_due_commentary.sql.
interface DueRow {
  id: string;
  speaker: string;
  content: string;
  event_idx: number | null;
}

// Single rolling lock to guarantee we never run two ticks concurrently.
// If a tick takes >2s (slow Supabase round-trip), we drop subsequent ticks
// until the first one completes — playback time keeps advancing on its own.
let tickInFlight = false;

async function handleTick(currentTime: number) {
  if (tickInFlight) return;
  tickInFlight = true;
  try {
    const seconds = Math.floor(currentTime);

    // 1. Write the latest playhead.
    const { error: updErr } = await supabase
      .from('parties')
      .update({
        yt_current_seconds: seconds,
        yt_last_update_at: new Date().toISOString(),
        yt_player_state: 'playing',
      })
      .eq('id', PARTY_ID!);
    if (updErr) {
      console.error('[eurojury] update parties failed:', updErr.message);
    }

    // 2. Fire any scheduled commentary that has come due. The RPC's UPDATE
    //    .. RETURNING is atomic; we just iterate the returned rows.
    const { data: due, error: rpcErr } = await supabase.rpc(
      'fire_due_commentary',
      { p_party_id: PARTY_ID!, p_seconds: seconds },
    );
    if (rpcErr) {
      console.error('[eurojury] fire_due_commentary failed:', rpcErr.message);
      return;
    }
    const rows = (due ?? []) as DueRow[];
    if (rows.length === 0) return;

    for (const row of rows) {
      const { error: chatErr } = await supabase.from('chat_messages').insert({
        party_id: PARTY_ID!,
        is_commentator: true,
        speaker: row.speaker,
        content: row.content,
        event_idx_at_post: row.event_idx,
        kind: 'scheduled',
      });
      if (chatErr) {
        console.error(
          '[eurojury] chat_messages insert failed for',
          row.id,
          chatErr.message,
        );
      } else {
        console.log(
          `[eurojury] fired @${seconds}s: ${row.speaker}: ${row.content.slice(0, 60)}`,
        );
      }
    }
  } finally {
    tickInFlight = false;
  }
}

async function createWindows() {
  // Persistent partition keeps the user signed into YouTube across launches.
  // The first run will require a manual login — overlay window is separate
  // so the user can interact with YouTube freely (since the overlay is
  // click-through).
  const ytSession = session.fromPartition('persist:youtube');

  const ytWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    frame: false,
    fullscreen: true,
    backgroundColor: '#000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: 'persist:youtube',
      preload: path.join(__dirname, 'preload-youtube.js'),
      // Allow autoplay even without a user gesture — relies on YT Premium.
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  // Touch the session var to keep TS happy (it's used implicitly by the
  // partition string above; reference here makes the intent explicit).
  void ytSession;

  await ytWindow.loadURL(
    `https://www.youtube.com/watch?v=${YT_VIDEO_ID}`,
  );

  const overlayWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    frame: false,
    transparent: true,
    fullscreen: true,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Make every click pass through to the YT window underneath. `forward: true`
  // means mousemove events still fire (handy if we ever add hover effects);
  // mouse buttons go to the layer below.
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');

  const overlayUrl = `${WEB_URL}/tv?party=${PARTY_ID}&electron=1`;
  await overlayWindow.loadURL(overlayUrl);

  console.log(`[eurojury] YT window:      ${YT_VIDEO_ID}`);
  console.log(`[eurojury] Overlay window: ${overlayUrl}`);

  return { ytWindow, overlayWindow };
}

app.whenReady().then(async () => {
  // IPC handler — preload sends `yt:tick` every 2s with the video's
  // currentTime in seconds. We don't care which window sent it; all
  // ticks feed the same upsert + RPC.
  ipcMain.on('yt:tick', (_e, currentTime: number) => {
    if (typeof currentTime !== 'number' || !Number.isFinite(currentTime)) {
      return;
    }
    void handleTick(currentTime);
  });

  await createWindows();

  app.on('activate', () => {
    // macOS: re-create windows if dock icon is clicked and none open.
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindows();
    }
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
