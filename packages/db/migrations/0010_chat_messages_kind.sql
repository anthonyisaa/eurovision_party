-- Add a kind column to chat_messages so /tv can style bubbles by category.
-- Existing rows have NULL kind (treated as 'scheduled' by the UI fallback).
ALTER TABLE chat_messages ADD COLUMN kind TEXT
  CHECK (kind IS NULL OR kind IN ('scheduled','roast','celebrate'));
