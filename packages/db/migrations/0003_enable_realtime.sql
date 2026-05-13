-- Enable Realtime broadcast for tables that drive live UI updates
ALTER PUBLICATION supabase_realtime ADD TABLE parties;
ALTER PUBLICATION supabase_realtime ADD TABLE guests;
ALTER PUBLICATION supabase_realtime ADD TABLE reactions;
ALTER PUBLICATION supabase_realtime ADD TABLE votes;
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE side_bets;
ALTER PUBLICATION supabase_realtime ADD TABLE side_bet_picks;
ALTER PUBLICATION supabase_realtime ADD TABLE event_timeline;
