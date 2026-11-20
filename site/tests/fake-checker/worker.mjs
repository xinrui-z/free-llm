// Test-only stand-in for the free-llm-checker Worker. The dynamic e2e build runs it as an auxiliary Worker
// so the site reaches the catalog through its real CHECKER service binding; it forwards each request to the
// fake catalog server (tests/catalog-server.mjs) and marks it so the specs can tell the binding was used.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = new Headers(request.headers);
    headers.set('X-Test-Via', 'checker-binding');
    return fetch(`${env.CATALOG_UPSTREAM.replace(/\/$/, '')}${url.pathname}${url.search}`, { method: request.method, headers });
  },
};
