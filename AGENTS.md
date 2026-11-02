# Repository instructions

## Scope

This repository is the Cloudflare Workers backend deployed at `ip.lucas04.top`. It serves the blog's existing IP components and the network tools adapted from [yt1988](https://github.com/yt1988): Speed Test, EgressLens, Who Are You, Unlock Check, CDN Radar, DNS Test and IPv6 Test.

It contains the backend only. Pages, probe lists, scoring, translations, shared-result pages and proxy rule files belong to the blog frontend in `lucas04-nhr/lucas04-nhr.github.io`. Do not add them here.

Add an endpoint only when a tool cannot work without a server. A measurement of the visitor's route must stay in the browser, because a Worker would measure Cloudflare's route instead. Speed Test deliberately connects directly to `speed.cloudflare.com`, so do not add speed test endpoints to this Worker. A failed run or exhausted request quota here would also break the blog's mainland China user detection, which uses the same Worker.

## Architecture

- `src/index.ts`: routing, method handling and origin enforcement.
- `src/http.ts`: origin allowlist, CORS headers and JSON and error responses.
- `src/legacy.ts`: `GET /`.
- `src/me.ts`: `GET /v1/me` and `GET /v1/whoami`, including the PTR lookup.
- `src/dns.ts`: `GET /v1/dns`.
- `src/hop.ts`: the last hop of the Unlock Check redirect chain and its target allowlist.
- `public/_redirects`: hops 25 to 2 of the redirect chain, served without running the Worker.
- `public/v1/hop.txt`: the target used to measure a browser's redirect limit.
- `test/api.test.mjs`: tests that run against the built `dist/index.js` in Node, with `request.cf` and `fetch` stubbed.
- `wrangler.jsonc`: source of truth for Worker configuration. `worker-configuration.d.ts` is generated with `npm run types`; never edit it manually.

`README.md` documents the API and maps each tool to its endpoints. Update it whenever an endpoint or its response changes.

## API contracts

`GET /` is consumed directly by `debugInfo.vue`, `rawJsonOutput.vue` and `chinaMainlandUserDetection.ts` in the blog repository. Keep its response shape compatible and its CORS behavior unchanged. Check those consumers before changing it. New functionality goes under `/v1/`.

Errors use `{ "error": { "code", "message" } }`. Only `GET`, `HEAD` on hop routes and `OPTIONS` are in use; do not add write endpoints without a clear need. Unknown paths return 404.

The redirect chain must take exactly `n` redirects from `/v1/hop/<n>/<host>/<path>` to its target, because Unlock Check infers results by counting them. `public/_redirects` handles `n` from 25 to 2 and the Worker handles `n = 1`. Keep the rules contiguous and do not add a redirect at any other point in the chain.

## Security and privacy

- Keep the last hop limited to the exact hostnames in `src/hop.ts` and the Worker's own host, so it cannot become an open redirect. Add a hostname only when a tool's probe needs it.
- Do not add general-purpose proxy or fetch endpoints. Outbound requests go to fixed upstreams, with validated input and a bounded timeout.
- Keep `originOnly` on endpoints that make outbound requests. It stops hotlinking but is not authentication, because scripts can forge `Origin`. Do not describe it as access control.
- Do not enable credentialed CORS or wildcard CORS on the API. Keep `Timing-Allow-Origin` limited to allowed origins.
- `/v1/whoami` must never return cookies or Cloudflare-added headers.
- Do not persist or log visitor IPs, request headers or queried hostnames. Workers Logs stay disabled in `wrangler.jsonc`. Platform-level request logging still exists, so do not claim the service has no logs.

## Implementation

Use strict TypeScript and two-space indentation, and follow the style of the surrounding code. Comments are sparse and written in Chinese, as are test names. Do not add `any`; the only existing use is the `request.cf` cast in `src/legacy.ts`, which reads a field missing from the generated types.

Workers cannot generate random values in global scope, and module globals must not hold request-scoped state. Keep dependencies to the existing dev tooling unless a new one is clearly justified.

When adapting more code from the upstream projects, keep the MIT notice and update the list of sources in `THIRD_PARTY_NOTICES.md`. Do not change the repository's AGPL-3.0 license. Before changing Workers APIs or configuration, consult current Cloudflare documentation and the installed Wrangler schema.

## Wrangler executable

For local Wrangler operations, explicitly use the Homebrew-installed `/opt/homebrew/bin/wrangler`. Keep the `package.json` scripts portable by calling plain `wrangler`.

## Verification

Run `npm ci`, `npm run check` and `npm test`. After changing `wrangler.jsonc`, also run `npm run types`.

The unit tests do not run in workerd and do not execute `public/_redirects`. After changing the redirect chain, static assets or streaming behavior, also check them with `wrangler dev`. It rewrites the request host to `ip.lucas04.top` because of the custom domain, so use that hostname, not `localhost`, as a self-hop target.

Local checks do not verify production behavior. State exactly what was checked, and do not claim deployment or production behavior from local results.

## Deployment and commits

Do not deploy, commit or push unless explicitly asked. A deployment overwrites the live `ip` Worker that the blog depends on, and `wrangler.jsonc` replaces its current remote settings.

Follow the Conventional Commits format: `<type>(<scope>): <description>`.

- Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`.
- Write the description in English, starting with a lowercase letter, in the imperative mood, with no trailing period.
- Keep the subject line concise, ideally under 72 characters.
