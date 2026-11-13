-- Romania was missing from 0002_seed_countries.sql. Add it so payloads
-- that include RO (running_order, performance) pass the countries(code) FK.
INSERT INTO countries (code, name, flag_emoji) VALUES
  ('RO', 'Romania', '🇷🇴')
ON CONFLICT (code) DO NOTHING;
