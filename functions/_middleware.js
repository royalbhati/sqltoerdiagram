// One canonical host. Cloudflare Pages also serves this site on
// sqltoerdiagram.pages.dev, which search engines index as a duplicate and
// which was outranking the real domain. Send that host (and www, once it is
// attached to the project) to https://sqltoerdiagram.com with a permanent
// redirect, keeping the path and query. Preview deployments
// (<hash>.sqltoerdiagram.pages.dev) are left alone.
//
// public/_routes.json keeps static assets out of this function, so only page
// requests invoke it.
const CANONICAL = 'sqltoerdiagram.com';
const ALIASES = new Set(['sqltoerdiagram.pages.dev', 'www.sqltoerdiagram.com']);

export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  if (ALIASES.has(url.hostname)) {
    url.hostname = CANONICAL;
    url.protocol = 'https:';
    url.port = '';
    return Response.redirect(url.toString(), 301);
  }
  return next();
}
