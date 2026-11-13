// Hardcoded official Eurovision 2026 final results. Used by /recap to score
// each guest's ballot against what actually happened in Vienna.
//
// Source: the JSON payload pasted into the chat on 2026-05-17 (the morning
// after the final). Persisting this into the DB is future work; for now the
// constant ships with the build.

export interface OfficialResultEntry {
  position: number;
  country_code: string;
  country_name: string;
  artist: string;
  song: string;
  total: number | null;
  jury: number | null;
  televote: number | null;
}

export const EUROVISION_2026_WINNER = {
  country_code: 'BG',
  country_name: 'Bulgaria',
  artist: 'DARA',
  song: 'Bangaranga',
  total_points: 516,
} as const;

export const EUROVISION_2026_FINAL: OfficialResultEntry[] = [
  { position: 1,  country_code: 'BG', country_name: 'Bulgaria',       artist: 'DARA',                                  song: 'Bangaranga',          total: 516,  jury: 204, televote: 312 },
  { position: 2,  country_code: 'IL', country_name: 'Israel',         artist: 'Noam Bettan',                           song: 'Michelle',            total: 343,  jury: null, televote: 220 },
  { position: 3,  country_code: 'RO', country_name: 'Romania',        artist: 'Alexandra Căpitănescu',                 song: 'Choke Me',            total: 296,  jury: null, televote: null },
  { position: 4,  country_code: 'AU', country_name: 'Australia',      artist: 'Delta Goodrem',                         song: 'Eclipse',             total: 287,  jury: null, televote: 122 },
  { position: 5,  country_code: 'IT', country_name: 'Italy',          artist: 'Sal Da Vinci',                          song: 'Per sempre sì',       total: null, jury: null, televote: null },
  { position: 6,  country_code: 'FI', country_name: 'Finland',        artist: 'Linda Lampenius x Pete Parkkonen',      song: 'Liekinheitin',        total: 138,  jury: null, televote: null },
  { position: 7,  country_code: 'DK', country_name: 'Denmark',        artist: 'Søren Torpegaard Lund',                 song: 'Før vi går hjem',     total: 78,   jury: null, televote: null },
  { position: 8,  country_code: 'MD', country_name: 'Moldova',        artist: 'Satoshi',                               song: 'Viva, Moldova!',      total: null, jury: null, televote: null },
  { position: 9,  country_code: 'UA', country_name: 'Ukraine',        artist: 'Leléka',                                song: 'Ridnym',              total: null, jury: null, televote: null },
  { position: 10, country_code: 'GR', country_name: 'Greece',         artist: 'Akylas',                                song: 'Ferto',               total: null, jury: null, televote: 147 },
  { position: 11, country_code: 'FR', country_name: 'France',         artist: 'Monroe',                                song: 'Regarde !',           total: 14,   jury: null, televote: null },
  { position: 12, country_code: 'PL', country_name: 'Poland',         artist: 'Alicja',                                song: 'Pray',                total: null, jury: null, televote: null },
  { position: 13, country_code: 'AL', country_name: 'Albania',        artist: 'Alis',                                  song: 'Nân',                 total: null, jury: null, televote: null },
  { position: 14, country_code: 'NO', country_name: 'Norway',         artist: 'Jonas Lovv',                            song: 'Ya Ya Ya',            total: null, jury: null, televote: null },
  { position: 15, country_code: 'HR', country_name: 'Croatia',        artist: 'Lelek',                                 song: 'Andromeda',           total: null, jury: null, televote: null },
  { position: 16, country_code: 'CZ', country_name: 'Czechia',        artist: 'Daniel Zizka',                          song: 'Crossroads',          total: null, jury: null, televote: null },
  { position: 17, country_code: 'RS', country_name: 'Serbia',         artist: 'Lavina',                                song: 'Kraj mene',           total: null, jury: null, televote: null },
  { position: 18, country_code: 'MT', country_name: 'Malta',          artist: 'Aidan',                                 song: 'Bella',               total: null, jury: null, televote: null },
  { position: 19, country_code: 'CY', country_name: 'Cyprus',         artist: 'Antigoni',                              song: 'Jalla',               total: null, jury: null, televote: null },
  { position: 20, country_code: 'SE', country_name: 'Sweden',         artist: 'Felicia',                               song: 'My System',           total: null, jury: null, televote: null },
  { position: 21, country_code: 'BE', country_name: 'Belgium',        artist: 'Essyla',                                song: 'Dancing on the Ice',  total: null, jury: null, televote: null },
  { position: 22, country_code: 'LT', country_name: 'Lithuania',      artist: 'Lion Ceccah',                           song: 'Sólo quiero más',     total: null, jury: null, televote: null },
  { position: 23, country_code: 'DE', country_name: 'Germany',        artist: 'Sarah Engels',                          song: 'Fire',                total: null, jury: 1,    televote: null },
  { position: 24, country_code: 'AT', country_name: 'Austria',        artist: 'Cosmó',                                 song: 'Tanzschein',          total: null, jury: 1,    televote: null },
  { position: 25, country_code: 'GB', country_name: 'United Kingdom', artist: 'Look Mum No Computer',                  song: 'Eins, Zwei, Drei',    total: null, jury: 1,    televote: 0  },
];

// Eurovision's own awarded-points scheme. A jury or televoting bloc gives
// these points to its top 10. We reuse the scheme as the "ideal ballot": if
// a guest's ballot matched the official outcome, they would have awarded
// these exact points to the actual top-10 finishers.
//
// Index = official position (1-based). Position > 10 → 0 points.
export const EUROVISION_POINTS_SCHEME: Record<number, number> = {
  1: 12,
  2: 10,
  3: 8,
  4: 7,
  5: 6,
  6: 5,
  7: 4,
  8: 3,
  9: 2,
  10: 1,
};

export const ALIGNMENT_MAX_SCORE = Object.values(EUROVISION_POINTS_SCHEME).reduce(
  (a, b) => a + b,
  0,
); // 58

/** Look up the official position of a country, or null if outside the final ranking. */
export function officialPosition(countryCode: string): number | null {
  return (
    EUROVISION_2026_FINAL.find((r) => r.country_code === countryCode)?.position ??
    null
  );
}

/** Ideal points that an Eurovision-clairvoyant juror would have awarded to a country. 0 if not in actual top 10. */
export function idealPointsFor(countryCode: string): number {
  const pos = officialPosition(countryCode);
  if (pos == null) return 0;
  return EUROVISION_POINTS_SCHEME[pos] ?? 0;
}
