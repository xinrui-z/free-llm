# Redirect for the old Pages URL

After the site moves to dynamic mode on Workers, the old Cloudflare Pages project `free-llm-apis`
(https://free-llm-apis.pages.dev) serves only this directory. `_redirects` sends every path to the same path
on https://free-llm-site.free-llm-status.workers.dev with a 301. `index.html` is a fallback for clients that
ignore the redirect.

Deploy it once by hand at cutover, after the Worker site is live (CI does not deploy it):

```sh
cd redirect
npx wrangler pages deploy . --project-name=free-llm-apis --branch=main
```

Once this is deployed, the static deploy in `.github/workflows/deploy.yml` must stay off
(repository variable `CATALOG_MODE=dynamic`), or the next static deploy would replace the redirect.
