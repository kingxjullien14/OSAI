/** Pure URL-or-search heuristics for the browser pane's address bar.
 *
 *  `normalizeUrl` turns whatever the user typed into something navigable:
 *    - explicit scheme (`https://x.dev/path`, `file:///…`, `about:blank`) → as-is
 *    - dev/loopback shapes → DIRECT navigation with `http://` (local dev servers
 *      rarely have TLS, and these must never fall through to a web search):
 *        · bare `localhost[:port]`
 *        · `127.0.0.1[:port]` (any 127.x.x.x), `0.0.0.0[:port]`, `[::1][:port]`
 *        · raw IPv4, with or without port (`192.168.1.10:3000`)
 *        · mDNS hosts: `*.local[:port]` (`myapp.local`)
 *        · any bare `host:port` with a numeric port (`myapp:8080`)
 *    - a host with a dot and no spaces (`example.com`, `sub.domain.dev/path`) →
 *      `https://` prepended
 *    - everything else (`how to cook rice`) → search engine query
 *
 *  Kept pure (no React, no Tauri) so it's unit-testable in isolation. Adapted
 *  from upstream/aios-superapp@1023914 (2026-06-14). */

// Hosts that are dev/loopback → treat as a URL (not a search) AND default to
// http://. `localhost`, any `127.x.x.x`, `[::1]`, and `0.0.0.0` qualify.
const LOOPBACK_HOST = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0)(?::\d+)?(?:[/?#]|$)/i;
// `something:1234` or `1.2.3.4:8080` — a bare host with an explicit numeric
// port, no scheme. These are almost always dev servers → URL, http://.
const HOST_PORT = /^[\w.-]+:\d{1,5}(?:[/?#]|$)/;
// A bare IPv4 (with optional port) → URL, http:// (LAN boxes rarely have TLS).
const BARE_IP = /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:[/?#]|$)/;
// mDNS / Bonjour hosts (`myapp.local`, `raspberrypi.local:8080`) → URL, http://.
// `.local` is reserved for link-local mDNS (RFC 6762) — never a public TLD, so
// the generic dotted-host https:// rule must not claim it.
const DOT_LOCAL = /^[\w-]+(?:\.[\w-]+)*\.local(?::\d+)?(?:[/?#]|$)/i;
// A dotted public host, optional port/path — must consume the WHOLE input with
// no whitespace ("example.com is down" is a search, not a navigation).
const DOTTED_HOST = /^[\w-]+(?:\.[\w-]+)+(?::\d+)?(?:[/?#]\S*)?$/;

/** True when the input matches one of the no-scheme URL shapes above. */
function isBareUrlShape(t: string): { url: boolean; scheme: "http" | "https" } {
  if (LOOPBACK_HOST.test(t) || BARE_IP.test(t) || DOT_LOCAL.test(t)) {
    return { url: true, scheme: "http" };
  }
  if (HOST_PORT.test(t)) return { url: true, scheme: "http" };
  if (DOTTED_HOST.test(t)) return { url: true, scheme: "https" };
  return { url: false, scheme: "https" };
}

export function normalizeUrl(input: string): string {
  const t = input.trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  // file:// / about: / other explicit schemes pass through untouched.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^about:/i.test(t)) return t;
  const shape = isBareUrlShape(t);
  if (shape.url) return `${shape.scheme}://${t}`;
  return `https://www.google.com/search?q=${encodeURIComponent(t)}`;
}

/** True when the input would be sent to the search engine (drives the omnibox
 *  "search google" row). Mirror image of `normalizeUrl`'s URL branches. */
export function isLikelySearch(input: string): boolean {
  const t = input.trim();
  if (!t) return false;
  if (/^https?:\/\//i.test(t)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^about:/i.test(t)) return false;
  return !isBareUrlShape(t).url;
}
