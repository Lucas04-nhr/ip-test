# ip

部署在 `ip.lucas04.top` 的 Cloudflare Worker，是博客网络工具的统一后端。本仓库只有后端，页面在博客仓库中重构。

工具逻辑来自 [yt1988](https://github.com/yt1988) 的 Speed Test、EgressLens、Who Are You、Unlock Check、CDN Radar、DNS Test 和 IPv6 Test。这些工具的测量大多必须在访客浏览器里完成，服务器代测得到的是 Cloudflare 的线路，而不是访客的线路。所以这里只提供确实需要服务端的部分。

## 接口

| 接口 | 说明 | 来源限制 |
| --- | --- | --- |
| `GET /` | 完整的连接信息。结构不变，博客现有组件依赖它；`?headers=0` 省略请求头 | 否 |
| `GET /v1/me` | 精简的连接信息：`ip version country region city lat lon asn org colo http` | 否 |
| `GET /v1/whoami` | `{ ip, v, cf, h, ptr, at }`：Cloudflare 数据、浏览器发送的请求头（不含 cookie）、PTR、服务器时钟 | 否 |
| `GET /v1/dns?name=<host>` | 由边缘解析：`{ cnames, ips }`，可缓存 5 分钟 | 是 |
| `GET /v1/hop/<n>/<host>/<path>` | 跳转 n 次（1 到 25）后到达 `https://<host>/<path>` | 目标白名单 |
| `GET /v1/hop.txt` | 跳转链的探测目标，用来测浏览器的跳转上限 | 否 |

“来源限制”指请求必须带 `*.lucas04.top` 或 `localhost:8080`、`127.0.0.1:8080` 的 `Origin`，否则返回 403。这只能挡住盗链，挡不住伪造请求头的脚本。

错误统一为 `{ "error": { "code", "message" } }`。

## 各工具用到什么

上游通过同源路径访问的接口，在博客里要改成下面的跨域地址。

| 工具 | 上游路径 | 本 Worker | 继续由浏览器直连 |
| --- | --- | --- | --- |
| Speed Test | `/_ms/me` | `/v1/me` | `speed.cloudflare.com`（`/__down`、`/__up`、`/meta`）、M-Lab |
| EgressLens | `/_ms/me`、`/cdn-cgi/trace` | `/v1/me` | 各出口探针、STUN、`api.ip.sb` |
| Who Are You | `/api/me`、`/cdn-cgi/trace` | `/v1/whoami`，时延改测 `/v1/me` | STUN、`edns.ip-api.com`、各站点 trace |
| Unlock Check | `/h/<n>/...`、`/hop.txt`、`/_ms/me` | `/v1/hop/<n>/...`、`/v1/hop.txt`、`/v1/me` | 各服务的探测地址 |
| CDN Radar | `/geo`、`/dns` | `/v1/me`（`cc` 改读 `country`）、`/v1/dns` | 各 CDN 的探测地址 |
| DNS Test | `/_ms/me` | `/v1/me` | 各 DoH 解析器 |
| IPv6 Test | `/_ms/me`、`/cdn-cgi/trace` | `/v1/me` | 各 IPv4、IPv6 探测地址 |

### 移植时要注意

- **`/cdn-cgi/trace`**：`kex`、`sni`、`warp` 这些字段 Worker 读不到，请直接请求 `https://ip.lucas04.top/cdn-cgi/trace`。它返回 `Access-Control-Allow-Origin: *`，但没有 `Timing-Allow-Origin`，跨域时读不到详细时序，所以测时延要改用 `/v1/me`。
- **跳转链**：请求要用 `mode: "no-cors"`，地址写成 `https://ip.lucas04.top/v1/hop/<n>/<host><path><search>`。测上限时的目标是 `https://ip.lucas04.top/v1/hop.txt`。
- **IPv6 Test**：探测里的 `ipv6.1ms.dog` 是上游自己的域名，要换成你自己的。

### 不在本仓库的上游功能

- 分享结果页 `/r/<code>`：上游在服务端改写页面标题和预览信息，它依赖页面本身，应随博客一起考虑。
- `/rules/*` 代理规则文件：是静态文件，放到博客。
- DNS Test 命令行工具的分发（`/i`、`/v`、`/dl/*`）。

## 开发

```sh
npm install
npm run dev      # wrangler dev
npm run check    # tsc
npm test         # 构建后运行 test/*.test.mjs
npm run deploy
```

`public/_redirects` 中 n 从 25 到 2 的跳转由静态资源层处理，不计 Worker 请求数；最后一跳进入 Worker 校验目标。新增白名单域名请改 `src/hop.ts`。

配置了 custom domain 后，`wrangler dev` 里的请求 host 会变成 `ip.lucas04.top`，所以本地无法用 `localhost` 作为跳转目标。

## 许可证

[AGPL-3.0](LICENSE)。第三方代码的声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
