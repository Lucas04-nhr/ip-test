# IP Test Worker

A Cloudflare Worker deployed at `ip.lucas04.top` that serves as the shared backend for the blog's network tools. This repository contains the backend only; the pages are being rebuilt in the blog repository.

The tools are adapted from Speed Test, EgressLens, Who Are You, Unlock Check, CDN Radar, DNS Test and IPv6 Test by [yt1988](https://github.com/yt1988). Most of their measurements must run in the visitor's browser, because a server would measure Cloudflare's route rather than the visitor's. This Worker therefore provides only what genuinely needs a server.

## Endpoints

| Endpoint | Description | Origin restricted |
| --- | --- | --- |
| `GET /` | Full connection details. The response shape is unchanged because existing blog components depend on it. `?headers=0` omits the request headers | No |
| `GET /v1/me` | Compact connection details: `ip version country region city lat lon asn org colo http` | No |
| `GET /v1/whoami` | `{ ip, v, cf, h, ptr, at }`: Cloudflare's data, the headers the browser sent (without cookies), the PTR record and the server clock | No |
| `GET /v1/dns?name=<host>` | Resolves a hostname from the edge: `{ cnames, ips }`, cacheable for 5 minutes | Yes |
| `GET /v1/hop/<n>/<host>/<path>` | Redirects `n` times (1 to 25), ending at `https://<host>/<path>` | Target allowlist |
| `GET /v1/hop.txt` | The redirect chain's probe target, used to measure a browser's redirect limit | No |

Origin-restricted endpoints return 403 unless the request has an `Origin` of `*.lucas04.top`, `localhost:8080` or `127.0.0.1:8080`. This stops hotlinking, but not scripts that forge the header.

All errors use the format `{ "error": { "code", "message" } }`.

## What each tool uses

Upstream reaches its backend through same-origin paths. In the blog, replace those paths with the cross-origin endpoints below.

| Tool | Upstream path | This Worker | Still called directly from the browser |
| --- | --- | --- | --- |
| Speed Test | `/_ms/me` | `/v1/me` | `speed.cloudflare.com` (`/__down`, `/__up`, `/meta`), M-Lab |
| EgressLens | `/_ms/me`, `/cdn-cgi/trace` | `/v1/me` | Exit probes, STUN, `api.ip.sb` |
| Who Are You | `/api/me`, `/cdn-cgi/trace` | `/v1/whoami`, plus `/v1/me` for timing latency | STUN, `edns.ip-api.com`, other sites' traces |
| Unlock Check | `/h/<n>/...`, `/hop.txt`, `/_ms/me` | `/v1/hop/<n>/...`, `/v1/hop.txt`, `/v1/me` | Each service's probe URLs |
| CDN Radar | `/geo`, `/dns` | `/v1/me` (read `country` instead of `cc`), `/v1/dns` | Each CDN's probe URLs |
| DNS Test | `/_ms/me` | `/v1/me` | DoH resolvers |
| IPv6 Test | `/_ms/me`, `/cdn-cgi/trace` | `/v1/me` | IPv4 and IPv6 probe URLs |

### Porting notes

- **`/cdn-cgi/trace`:** A Worker can't read fields such as `kex`, `sni` and `warp`, so request `https://ip.lucas04.top/cdn-cgi/trace` directly. It returns `Access-Control-Allow-Origin: *` but no `Timing-Allow-Origin`, so detailed cross-origin timing is unavailable. Time latency against `/v1/me` instead.
- **Redirect chain:** Send requests with `mode: "no-cors"` to `https://ip.lucas04.top/v1/hop/<n>/<host><path><search>`. When measuring the redirect limit, the target is `https://ip.lucas04.top/v1/hop.txt`.
- **IPv6 Test:** The probes use `ipv6.1ms.dog`, which is upstream's own domain. Replace it with your own.

### Upstream features not in this repository

- **Shared result pages (`/r/<code>`):** Upstream rewrites the page title and preview metadata on the server. This depends on the pages, so it should be handled along with the blog.
- **Proxy rule files (`/rules/*`):** These are static files and belong in the blog.
- **DNS Test command-line tool distribution:** `/i`, `/v` and `/dl/*`.

## Development

```sh
npm install
npm run dev      # wrangler dev
npm run check    # tsc
npm test         # builds, then runs test/*.test.mjs
npm run deploy
```

In `public/_redirects`, the static asset layer handles hops 25 to 2, which don't count as Worker requests. The last hop reaches the Worker, which validates the target. To allow another hostname, edit `src/hop.ts`.

With a custom domain configured, `wrangler dev` rewrites the request host to `ip.lucas04.top`, so `localhost` can't be used as a redirect target locally.

## License

[AGPL-3.0](LICENSE). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party notices.
