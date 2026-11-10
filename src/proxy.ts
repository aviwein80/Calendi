import { NextResponse, type NextRequest } from 'next/server';

// A quick first check so signed-out visitors get a clean redirect instead of a
// half-drawn admin screen. This only looks for the cookie; every admin page and
// action still verifies the session properly (see lib/session.ts).

export function proxy(request: NextRequest) {
  if (!request.cookies.has('calendi_session')) {
    return NextResponse.redirect(new URL('/admin/login', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/((?!login|setup).*)'],
};
