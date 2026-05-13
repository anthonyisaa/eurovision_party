-- Eurojury initial schema
-- Applied to Supabase project euhwxkwpnskjmngjfqtd via MCP on 2026-05-13.
-- Source of truth: packages/db/types.ts (generated from this schema).
--
-- Notes:
--  - guests has TWO assigned_country columns (per plan: 2 random countries per guest)
--  - scheduled_commentary uses UUID PK and a category column ('scheduled' or 'roast')
--    so the same table holds both timed commentary and the roast pool
--  - parties.reveal_step drives the 10-step reveal sequence across all clients

CREATE TABLE countries (
  code              TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  flag_emoji        TEXT NOT NULL,
  artist            TEXT,
  song_title        TEXT,
  running_order     INT,
  semi_or_final     TEXT,
  spotify_url       TEXT,
  youtube_url       TEXT,
  fun_fact          TEXT,
  vibe_blurb        TEXT
);

CREATE TABLE parties (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  contest_year      INT NOT NULL DEFAULT 2026,
  phase             TEXT NOT NULL DEFAULT 'lobby',
  host_guest_id     UUID,
  cohost_guest_id   UUID,
  commentator_tone  NUMERIC(3,2) NOT NULL DEFAULT 0.5,
  yt_video_id       TEXT,
  yt_player_state   TEXT DEFAULT 'idle',
  yt_current_seconds INT DEFAULT 0,
  yt_last_update_at TIMESTAMPTZ,
  manual_event_idx  INT,
  party_paused      BOOLEAN NOT NULL DEFAULT FALSE,
  party_pause_reason TEXT,
  party_paused_at   TIMESTAMPTZ,
  highest_event_idx_reached INT NOT NULL DEFAULT 0,
  reveal_step       INT NOT NULL DEFAULT 0,
  actual_results    JSONB,
  fake_broadcast    BOOLEAN NOT NULL DEFAULT FALSE,
  fake_broadcast_started_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT parties_phase_check CHECK (phase IN ('lobby','live','voting','reveal','closed'))
);

CREATE TABLE guests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id          UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  display_name      TEXT NOT NULL,
  assigned_country_1 TEXT REFERENCES countries(code),
  assigned_country_2 TEXT REFERENCES countries(code),
  joined_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT guests_two_distinct_countries CHECK (
    assigned_country_1 IS NULL
    OR assigned_country_2 IS NULL
    OR assigned_country_1 <> assigned_country_2
  )
);

CREATE UNIQUE INDEX guests_party_country1_unique
  ON guests (party_id, assigned_country_1) WHERE assigned_country_1 IS NOT NULL;
CREATE UNIQUE INDEX guests_party_country2_unique
  ON guests (party_id, assigned_country_2) WHERE assigned_country_2 IS NOT NULL;

CREATE TABLE event_timeline (
  party_id          UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  idx               INT NOT NULL,
  category          TEXT NOT NULL,
  start_seconds     INT NOT NULL,
  end_seconds       INT,
  description       TEXT NOT NULL,
  country_code      TEXT REFERENCES countries(code),
  song_idx          INT,
  PRIMARY KEY (party_id, idx),
  CONSTRAINT event_timeline_category_check
    CHECK (category IN ('opening','performance','interval','voting','result'))
);

CREATE TABLE reactions (
  guest_id          UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  country_code      TEXT NOT NULL REFERENCES countries(code),
  rating            INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  cast_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guest_id, country_code)
);

CREATE TABLE votes (
  guest_id          UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  country_code      TEXT NOT NULL REFERENCES countries(code),
  points            INT NOT NULL CHECK (points IN (1,2,3,4,5,6,7,8,10,12)),
  cast_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guest_id, country_code),
  UNIQUE (guest_id, points)
);

CREATE TABLE predictions (
  guest_id          UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  country_code      TEXT NOT NULL REFERENCES countries(code),
  position          INT NOT NULL CHECK (position IN (1,2,3)),
  cast_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guest_id, position),
  UNIQUE (guest_id, country_code)
);

CREATE TABLE chat_messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id          UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  guest_id          UUID REFERENCES guests(id) ON DELETE SET NULL,
  is_commentator    BOOLEAN NOT NULL DEFAULT FALSE,
  speaker           TEXT,
  content           TEXT NOT NULL,
  event_idx_at_post INT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chat_speaker_check CHECK (speaker IS NULL OR speaker IN ('nala','evee'))
);

CREATE INDEX chat_messages_party_created ON chat_messages (party_id, created_at DESC);

CREATE TABLE scheduled_commentary (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id          UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  category          TEXT NOT NULL DEFAULT 'scheduled',
  trigger_seconds   INT,
  speaker           TEXT NOT NULL,
  content           TEXT NOT NULL,
  event_idx         INT,
  fired             BOOLEAN NOT NULL DEFAULT FALSE,
  fired_at          TIMESTAMPTZ,
  CONSTRAINT sched_category_check CHECK (category IN ('scheduled','roast')),
  CONSTRAINT sched_speaker_check  CHECK (speaker IN ('nala','evee')),
  CONSTRAINT sched_scheduled_has_trigger CHECK (
    category <> 'scheduled' OR trigger_seconds IS NOT NULL
  )
);

CREATE INDEX scheduled_commentary_party_trigger
  ON scheduled_commentary (party_id, trigger_seconds)
  WHERE category = 'scheduled' AND fired = FALSE;
CREATE INDEX scheduled_commentary_roast_pool
  ON scheduled_commentary (party_id, event_idx)
  WHERE category = 'roast' AND fired = FALSE;

CREATE TABLE side_bets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id          UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  question          TEXT NOT NULL,
  bet_type          TEXT NOT NULL,
  options_json      JSONB NOT NULL,
  resolved_value    TEXT,
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE side_bet_picks (
  bet_id            UUID NOT NULL REFERENCES side_bets(id) ON DELETE CASCADE,
  guest_id          UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  pick              TEXT NOT NULL,
  placed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bet_id, guest_id)
);

ALTER TABLE countries             ENABLE ROW LEVEL SECURITY;
ALTER TABLE parties               ENABLE ROW LEVEL SECURITY;
ALTER TABLE guests                ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_timeline        ENABLE ROW LEVEL SECURITY;
ALTER TABLE reactions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE predictions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_commentary  ENABLE ROW LEVEL SECURITY;
ALTER TABLE side_bets             ENABLE ROW LEVEL SECURITY;
ALTER TABLE side_bet_picks        ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_read_countries        ON countries            FOR SELECT TO anon USING (true);
CREATE POLICY anon_read_parties          ON parties              FOR SELECT TO anon USING (true);
CREATE POLICY anon_read_guests           ON guests               FOR SELECT TO anon USING (true);
CREATE POLICY anon_read_event_timeline   ON event_timeline       FOR SELECT TO anon USING (true);
CREATE POLICY anon_read_reactions        ON reactions            FOR SELECT TO anon USING (true);
CREATE POLICY anon_read_votes            ON votes                FOR SELECT TO anon USING (true);
CREATE POLICY anon_read_predictions      ON predictions          FOR SELECT TO anon USING (true);
CREATE POLICY anon_read_chat             ON chat_messages        FOR SELECT TO anon USING (true);
CREATE POLICY anon_read_sched            ON scheduled_commentary FOR SELECT TO anon USING (true);
CREATE POLICY anon_read_side_bets        ON side_bets            FOR SELECT TO anon USING (true);
CREATE POLICY anon_read_side_bet_picks   ON side_bet_picks       FOR SELECT TO anon USING (true);
