// Helpers for reading/writing the guest_id cookie.
//
// The cookie itself is issued by `middleware.ts` on first visit, so by the
// time any page renders the cookie should already exist. These helpers are
// thin readers so client + server components share one cookie name.

export const GUEST_ID_COOKIE = 'eurojury_guest_id';

/** Read the guest_id cookie from `document.cookie` (client only). */
export const getGuestIdClient = (): string | null => {
  if (typeof document === 'undefined') return null;
  const prefix = `${GUEST_ID_COOKIE}=`;
  const match = document.cookie
    .split('; ')
    .find((c) => c.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : null;
};

/**
 * Read the guest_id cookie on the server. Pulls in `next/headers` lazily so
 * this file can also be imported by client components (the client branch
 * never executes the dynamic import).
 */
export const getGuestIdServer = async (): Promise<string | null> => {
  const { cookies } = await import('next/headers');
  const store = await cookies();
  return store.get(GUEST_ID_COOKIE)?.value ?? null;
};
