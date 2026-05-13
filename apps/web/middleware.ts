import { NextResponse, type NextRequest } from 'next/server';

const COOKIE_NAME = 'eurojury_guest_id';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const existing = req.cookies.get(COOKIE_NAME)?.value;
  if (!existing) {
    res.cookies.set({
      name: COOKIE_NAME,
      value: crypto.randomUUID(),
      // The phone UI reads this from document.cookie, so it must be
      // readable by client JS.
      httpOnly: false,
      sameSite: 'lax',
      maxAge: ONE_YEAR_SECONDS,
      path: '/',
    });
  }
  return res;
}

export const config = {
  // Run on every page request but skip Next.js internals and static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sounds).*)'],
};
