export const DEFAULT_SITE = 'https://free-llm-apis.pages.dev';

// Pages build to `<route>/index.html`, so the canonical form of every page URL ends in '/'
// (matching @astrojs/sitemap output and the static host's redirects). Paths with a file
// extension (robots.txt, *.xml, *.json) are left untouched. Query strings and fragments are dropped.
export function canonicalPath(path = '/') {
  const pathname = path.split(/[?#]/)[0] || '/';
  const absolute = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return absolute.endsWith('/') || /\.[a-z0-9]+$/i.test(absolute) ? absolute : `${absolute}/`;
}

export function siteURL(site: URL | string | undefined, path = '/') {
  return new URL(canonicalPath(path), site || DEFAULT_SITE).href;
}
