-- Permissive anon write policies for the friends-of-friends party.
-- Approved by user 2026-05-14: "any guest with dev tools could forge writes —
-- for a 10-person party that's fine."
--
-- Apply via Supabase dashboard SQL editor at:
--   https://supabase.com/dashboard/project/euhwxkwpnskjmngjfqtd/sql
-- (Or use supabase CLI: supabase db push --linked.)

CREATE POLICY anon_write_guests
  ON guests FOR ALL TO anon
  USING (true) WITH CHECK (true);

CREATE POLICY anon_update_parties
  ON parties FOR UPDATE TO anon
  USING (true) WITH CHECK (true);

CREATE POLICY anon_write_reactions
  ON reactions FOR ALL TO anon
  USING (true) WITH CHECK (true);

CREATE POLICY anon_write_votes
  ON votes FOR ALL TO anon
  USING (true) WITH CHECK (true);

CREATE POLICY anon_write_predictions
  ON predictions FOR ALL TO anon
  USING (true) WITH CHECK (true);

CREATE POLICY anon_insert_chat
  ON chat_messages FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY anon_update_sched
  ON scheduled_commentary FOR UPDATE TO anon
  USING (true) WITH CHECK (true);

CREATE POLICY anon_write_side_bets
  ON side_bets FOR ALL TO anon
  USING (true) WITH CHECK (true);

CREATE POLICY anon_write_side_bet_picks
  ON side_bet_picks FOR ALL TO anon
  USING (true) WITH CHECK (true);

CREATE POLICY anon_write_event_timeline
  ON event_timeline FOR ALL TO anon
  USING (true) WITH CHECK (true);

CREATE POLICY anon_update_countries
  ON countries FOR UPDATE TO anon
  USING (true) WITH CHECK (true);
