// Installs a thin `window.fetch` interceptor that prepends the backend's
// public origin to every relative `/api/*` request, when the frontend and
// backend are deployed as two separate services (e.g. two Railway services
// on two different *.up.railway.app domains).
//
// Why this exists: every relative call — both the generated react-query
// hooks in @workspace/api-client-react (which funnel through `customFetch`,
// which itself calls the global `fetch`) AND direct `fetch()` calls made by
// pages/components/stores (SharedMarketSelector, brokerStore, alerts.tsx,
// CustomChart, etc.) — resolve `/api/...` against `window.location.origin`.
// If the backend lives on a different origin, that request lands on the
// FRONTEND's own static server instead, which has no such route and falls
// back to serving `index.html` for any unmatched path (standard SPA
// fallback). The caller then tries to `JSON.parse("<!DOCTYPE html>...")`
// and blows up with `SyntaxError: Unexpected token '<' ... is not valid
// JSON` — exactly the "Failed to load market catalog" error.
//
// `VITE_API_BASE_URL` (documented in RAILWAY_DEPLOY.md) is the intended
// fix, but nothing previously read it — this installs it as a single global
// interception point, the same pattern `installMockFetch.ts` already uses,
// so every existing call site (relative-path hooks and raw fetches alike)
// is covered without having to touch 25+ files individually.
//
// No-op when `VITE_API_BASE_URL` is unset (same-origin deployments, local
// dev, single-service setups) — relative paths resolve exactly as before.

let installed = false;

function resolvePath(input: RequestInfo | URL): string | null {
  try {
    const url = typeof input === "string" ? input
      : input instanceof URL ? input.toString()
      : input.url;
    return new URL(url, window.location.origin).pathname;
  } catch {
    return null;
  }
}

export function installApiBaseUrl(): void {
  if (installed) return;

  const rawBase = import.meta.env.VITE_API_BASE_URL as string | undefined;
  let base = rawBase?.trim().replace(/\/+$/, "");
  if (!base) return; // same-origin deployment — nothing to rewrite

  // Guard against the single most common misconfiguration: pasting just the
  // Railway domain (e.g. "my-api-production-xxxx.up.railway.app") without
  // a "https://" scheme. Without a scheme, `new Request(absolute, ...)`
  // below treats the string as a *relative* path instead of an absolute
  // URL, so the request silently falls back to same-origin — producing the
  // exact same "Unexpected token '<'" SPA-fallback failure this file exists
  // to prevent, just one layer further down and much harder to spot.
  if (!/^https?:\/\//i.test(base)) {
    base = `https://${base}`;
  }

  installed = true;
  const realFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const path = resolvePath(input);
    if (!path || !path.startsWith("/api")) return realFetch(input, init);

    const absolute = `${base}${path}${(() => {
      try {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
          window.location.origin,
        );
        return url.search;
      } catch {
        return "";
      }
    })()}`;

    if (typeof input === "string" || input instanceof URL) {
      return realFetch(absolute, init);
    }
    // Request object: rebuild with the absolute URL, preserving its own init
    return realFetch(new Request(absolute, input), init);
  };

  // eslint-disable-next-line no-console
  console.info(`[api-base-url] Routing relative /api/* requests to ${base}`);
}
