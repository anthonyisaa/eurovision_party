// Re-export the Supabase-generated database types so app code can import a single
// canonical Database type from @eurojury/shared.
export type { Database, Json } from '@eurojury/db/types';

// IDs ---------------------------------------------------------------------
export type GuestId = string;
export type PartyId = string;

// Show timeline -----------------------------------------------------------
export type EventCategory =
  | 'opening'
  | 'performance'
  | 'interval'
  | 'voting'
  | 'result';

export type Phase = 'lobby' | 'live' | 'voting' | 'reveal' | 'closed';

export type Speaker = 'nala' | 'evee';

export interface CurrentEvent {
  idx: number;
  category: EventCategory;
  description: string;
  countryCode: string | null;
  startSeconds: number;
  endSeconds: number | null;
  songIdx: number | null;
}
