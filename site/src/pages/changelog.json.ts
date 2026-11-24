import type { APIRoute } from 'astro';
import changelog from '../data/changelog.json';

// Machine-readable changelog feed (/changelog.json): the bundled changelog that /changelog renders on the
// server, newest first. It depends only on build-time data, so it is prerendered in both catalog modes.
export const prerender = true;

export const GET: APIRoute = () => {
  const entries = [...changelog].sort((a, b) => b.date.localeCompare(a.date));
  return new Response(JSON.stringify(entries, null, 2) + '\n', {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
