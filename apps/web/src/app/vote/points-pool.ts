// Standard Eurovision points pool. Order matters — index 0 == position 1 == 12 pts.
// Lives outside the server-action file so it can be imported by the client too;
// a 'use server' module is only allowed to export async functions.
export const POINTS_POOL = [12, 10, 8, 7, 6, 5, 4, 3, 2, 1] as const;
