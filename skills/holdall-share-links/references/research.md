# Research extract: URL state and share links

Extract of holdall's research report on URL state (dated 2026-09-29), keeping the parts that back the `holdall-share-links` skill. Ratios are compressed-URL-chars over raw JSON bytes on synthetic data (5 / 50 / 500 records), so treat them as directional and re-measure on real payloads. Claims marked UNVERIFIED rest on secondary sources.

## 1. Compressing JSON into a URL

| Option | Size (min / gz) | Ratio (5 / 50 / 500 records) | Notes |
|---|---|---|---|
| naive percent-encoded JSON | n/a | 164-167% | baseline: grows |
| lz-string `compressToEncodedURIComponent` | 5.3 KB / 1.7 KB | 77% / 39% / 22% | frozen since 2023; `+` becomes a space in query strings; fine in a fragment; returns `null` on bad input |
| fflate `deflateSync` + base64url (holdall's `z1`) | 9.1 KB / 4.5 KB | 50% / 22% / 15% | MIT, zero deps, sync, maintained [1] |
| pako deflate + base64url | 41 KB / 12.5 KB | same algorithm | used by Excalidraw and Mermaid Live [2][4]; 3x larger than fflate |
| native `CompressionStream('deflate-raw')` | 0 | 50% / 21% / 14% | async only; Chrome 103, Firefox 113, Safari 16.4 [5] |
| native `CompressionStream('brotli')` | 0 | 41% / 18% / 12% | not portable: no Chrome support at time of writing [5] |
| msgpack or CBOR, then deflate | 6-10 KB | 49% / 22% / 15% | gain over plain deflate 1-2%: not worth it |

Readable-parameter formats for small filter-like state (jsurl, rison, urlon) are unmaintained; a plain flat query string was the shortest (57 chars on the test object versus 76-86 for those formats).

Decision: base64url(deflate-raw(UTF-8 JSON)) behind a codec prefix, with `fflate` as the default so it works in Node for agents and tests too. Security: cap decompressed size when decoding untrusted links, and validate every decoded payload with a schema.

## 2. Practical URL length limits

Browsers: Chromium 2 MB URL; Firefox effectively unlimited for navigation (address bar display stops at 65,536); Safari about 80,000 (UNVERIFIED); legacy IE 2,083. Safe cross-everything figure: 2,048 [6][7].

Servers and proxies only matter for URLs that are sent, so not for the fragment: nginx default 8 KB request line (414 beyond) [8]; Node 16 KiB headers (431) [9]; Cloudflare URL 16 KB [10]; CloudFront URL 8,192 bytes [11].

Messengers and email (weakest evidence; none of the vendors publish a URL limit):

| Channel | What is known |
|---|---|
| Slack | message cap 40,000 chars, docs advise 4,000 for posted messages; bot-posted URLs over ~4,000 bytes were split across two messages [12][13]. One project reported 10-40 KB share links truncated in Slack and other messengers [14]. Human-pasted behavior UNVERIFIED. |
| Discord | 2,000-char message limit (4,000 with Nitro) [15] |
| Outlook desktop | old hyperlink limit 2,083 (SafeLinks truncated at 2,048); raised to 8,192 in a later build [16] |
| Unfurlers | fetch the URL server side and never see the fragment, so hash state gives a generic preview |

Derived budgets (configurable, `DEFAULT_LINK_BUDGET`): 2,000 portable, 4,000 chat-safe, 8,000 email and CDN safe, above that offer a file or a stored payload.

## 3. Fragment versus query

| Aspect | Fragment | Query |
|---|---|---|
| Sent to your server, CDN, access logs | No [17] | Yes, and subject to the server limits above |
| In `Referer` to other sites | Never: the Referrer Policy strips the fragment [18] | Same-origin requests carry the full URL; cross-origin depends on policy |
| Per-state link preview or server rendering | Impossible | Possible |
| Visible to page JavaScript (analytics, error reporters, session replay, extensions) | Yes; vendor handling varies, e.g. GA4 fragment handling needs explicit config [19] | Yes |
| Visible to the chat or mail provider carrying the link | Yes | Yes |
| Router conflicts | hash routers, `#anchor` scrolling, text fragments `#:~:text=` | app query params |
| History writes | `hashchange`; `replaceState` avoids history spam | `replaceState`; Safari throttles it (nuqs throttles URL writes 50 ms, 120 ms on Safari) [21] |

The fragment hides state from your server, not from the chat app, email provider, browser sync, browser history or third-party scripts. It is not a secret store. For confidentiality use ciphertext elsewhere with the key in the fragment, and accept that whoever holds the whole link holds the key [2].

## 4. Typed URL-state libraries (for the readable-query case)

| Library | Notes |
|---|---|
| nuqs (MIT) | React frameworks and SPAs; built-in parsers; `parseAsJson` takes any Standard Schema; `clearOnDefault`; throttling; parsers do not validate shape by themselves [20][21][22] |
| TanStack Router `validateSearch` (MIT) | Standard Schema (Zod 4, Valibot, ArkType); JSON-first serialization; `stripSearchParams` prunes defaults; compression is not built in, supply `stringifySearch`/`parseSearch` yourself [23] |
| use-query-params / serialize-query-params (ISC) | param objects rather than schemas; serialize-query-params is the only headless one |

Nothing here handles a single compressed opaque payload; that is what holdall's link module does. Use these libraries for ordinary typed params and holdall for payloads.

## 5. Versioning a payload

Two layers, following Mermaid Live and Excalidraw [3][4]: an outer codec prefix that names the byte encoding and its version (`z1.`, `j1.`, `e1.`), and an inner envelope `{app, kind, version, data}` whose integer version selects the migration chain. Mermaid treats an unprefixed payload as a named legacy format and throws on an unknown prefix; Excalidraw stamps a container version and throws on a higher one. Never reuse a prefix, keep every decoder, test with golden links. `.` and `_` survive chat autolinkers and Markdown after `#`; avoid trailing punctuation and `)`.

## 6. Prior art

- Excalidraw: link is `#json=<id>,<key>`; the client generates an AES-GCM key, deflates the scene, encrypts, uploads the ciphertext and keeps the key in the fragment. The 2019 write-up used an all-zero IV with a "never reuse the key" warning; use a random IV per message instead. Too big yields an error rather than a fallback [2][3][4].
- Mermaid Live Editor: `#pako:<base64url(deflate level 9 of JSON)>`; the cleanest example of a prefixed codec with a legacy path [3].
- One small OSS review tool hit exactly the wall the tiers plan for: 10-40 KB links truncated in messengers, leading to a proposal for short ids from a paste service while keeping old hash links working [14].

## REFERENCES

1. [fflate repository](https://github.com/101arrowz/fflate)
2. [Excalidraw blog: End-to-End Encryption in the Browser](https://plus.excalidraw.com/blog/end-to-end-encryption)
3. [Mermaid Live Editor source: serde.ts](https://github.com/mermaid-js/mermaid-live-editor/blob/develop/src/lib/util/serde.ts)
4. [Excalidraw source: packages/excalidraw/data/encode.ts](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/data/encode.ts) and [excalidraw-app/data/index.ts](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/data/index.ts)
5. [MDN: CompressionStream() constructor](https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream/CompressionStream)
6. [Microsoft IEInternals: URL Length Limits](https://learn.microsoft.com/en-us/archive/blogs/ieinternals/url-length-limits)
7. [GeeksforGeeks: Maximum length of a URL in different browsers](https://www.geeksforgeeks.org/maximum-length-of-a-url-in-different-browsers/) (secondary)
8. [nginx docs: ngx_http_core_module (large_client_header_buffers)](https://nginx.org/en/docs/http/ngx_http_core_module.html)
9. [Node.js issue 27645: Increase HTTP_MAX_HEADER_SIZE to 16kb](https://github.com/nodejs/node/issues/27645)
10. [Cloudflare docs: Connection and request limits](https://developers.cloudflare.com/fundamentals/reference/connection-limits/)
11. [AWS CloudFront quotas](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-limits.html)
12. [Kibana issue 158262: URLs longer than 4K bytes are split in Slack and email messages](https://github.com/elastic/kibana/issues/158262)
13. [Slack changelog: Truncating really long messages](https://api.slack.com/changelog/2018-04-truncating-really-long-messages)
14. [Plannotator issue 187: share URLs too large for Slack and messaging apps](https://github.com/backnotprop/plannotator/issues/187)
15. [Discord community: Message Max Length](https://support.discord.com/hc/en-us/community/posts/360031093812-Message-Max-Lenght)
16. [Microsoft Q&A: Outlook for Microsoft 365 truncating long URLs](https://learn.microsoft.com/en-us/answers/questions/1063670/outlook-for-microsoft-365-truncating-long-urls)
17. [MDN: URI fragment](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment)
18. [W3C Referrer Policy](https://www.w3.org/TR/referrer-policy/)
19. [Analytics Playbook: Track URLs with fragments in GA4 with GTM](https://kpplaybook.com/resources/track-urls-with-fragments-hash-mark-in-ga4-with-gtm/)
20. [nuqs repository](https://github.com/47ng/nuqs)
21. [nuqs docs: Options (history, throttling, clearOnDefault)](https://nuqs.dev/docs/options)
22. [nuqs docs: Built-in parsers (parseAsJson with Standard Schema)](https://nuqs.dev/docs/parsers/built-in)
23. [TanStack Router docs: Search params](https://tanstack.com/router/latest/docs/framework/react/guide/search-params)
