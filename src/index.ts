import { isContentTypeMismatch, isCacheableExtension, getExpectedMime } from './mime-check';
import { normalizePath, getExtension } from './normalize';

/**
 * Hardened Cache Deception protection — Cloudflare Worker
 *
 * Defense layers:
 *   1. URL normalization (decode, strip delimiters, resolve traversals, lowercase)
 *   2. Content-Type vs extension mismatch check (via mime-check module)
 *
 * All settings are configurable via wrangler.jsonc vars.
 * Reference: PortSwigger "Gotta Cache 'em All" (Black Hat 2024)
 */

// ── Types ────────────────────────────────────────────────────────────────────

type CacheTtlByStatus = Record<string, number>;

// Widen the generated literal types so comparisons work regardless of config values.
interface Env {
	CACHE_TTL: string;
	BROWSER_TTL: string;
	BLOCK_MODE: string;
	DEBUG: string;
	// Set via .dev.vars for local dev only. In production the worker runs on
	// the route — fetch() goes to the origin automatically, no ORIGIN needed.
	ORIGIN?: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_CACHE_TTL: CacheTtlByStatus = {
	'200-299': 86400,
	'304': 86400,
	'404': 60,
	'400-403': 0,
	'500-599': 0,
};

// ── Worker ───────────────────────────────────────────────────────────────────

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const cacheTtl = resolveCacheTtl(env.CACHE_TTL);
		const browserTtl = parseInt(env.BROWSER_TTL, 10) || 0;
		const blockMode = env.BLOCK_MODE !== 'false';
		const debug = env.DEBUG === 'true';

		const url = new URL(request.url);
		const originalPath = url.pathname;

		// ── Step 1: Normalize URL ──────────────────────────────────────────

		url.pathname = normalizePath(url.pathname);

		// ── Step 2: Fetch with cleaned path ────────────────────────────────
		// In production the worker runs on the route, so fetch() goes to the
		// origin automatically. ORIGIN (.dev.vars) is only for local dev.

		if (env.ORIGIN) {
			const origin = new URL(env.ORIGIN);
			url.hostname = origin.hostname;
			url.protocol = origin.protocol;
			url.port = '';
		}

		const cleanedReq = new Request(url, request);

		const ext = getExtension(url.pathname);
		const cacheable = ext !== null && isCacheableExtension(ext);

		const response = await fetch(cleanedReq, {
			cf: cacheable
				? { cacheEverything: true, cacheTtlByStatus: cacheTtl }
				: { cacheTtl: 0 },
		});

		const contentType = (response.headers.get('content-type') || '').toLowerCase();

		// ── Step 3: Content-Type vs extension check (Armor) ────────────────

		if (cacheable && ext) {
			// 3a. Missing Content-Type — treat as mismatch (origin didn't declare type)
			const hasContentType = contentType !== '';

			// 3b. Content-Type mismatch check
			const mismatch = !hasContentType || isContentTypeMismatch(ext, contentType);

			if (mismatch) {
				const expectedMime = getExpectedMime(ext);

				if (blockMode) {
					return new Response('Not Found', {
						status: 404,
						headers: {
							'cache-control': 'no-store',
							...(debug && {
								'x-cache-deception-armor': 'blocked',
								'x-original-path': originalPath,
								'x-cleaned-path': url.pathname,
								'x-expected-type': expectedMime ?? 'unknown',
								'x-actual-type': contentType || '(missing)',
								'x-block-reason': !hasContentType ? 'missing-content-type' : 'mime-mismatch',
							}),
						},
					});
				}

				// Soft block: return response but prevent caching
				const res = new Response(response.body, response);
				res.headers.set('cache-control', 'no-store');
				if (debug) {
					res.headers.set('x-cache-deception-armor', 'blocked-soft');
					res.headers.set('x-original-path', originalPath);
					res.headers.set('x-cleaned-path', url.pathname);
					res.headers.set('x-block-reason', !hasContentType ? 'missing-content-type' : 'mime-mismatch');
				}
				return res;
			}

			// 3c. Respect origin Cache-Control: no-store, private, no-cache
			//     cacheEverything overrides these, so we must enforce manually.
			const originCacheControl = (response.headers.get('cache-control') || '').toLowerCase();
			const originForbidsCache = /\b(no-store|private|no-cache)\b/.test(originCacheControl);

			// 3d. Detect Set-Cookie (should never be in a shared cache)
			const hasSetCookie = response.headers.has('set-cookie');

			if (originForbidsCache || hasSetCookie) {
				const res = new Response(response.body, response);
				res.headers.set('cache-control', 'no-store');
				// CDN-Cache-Control tells CF edge not to cache (in case cacheEverything already stored it)
				res.headers.set('cdn-cache-control', 'no-store');
				if (hasSetCookie) {
					res.headers.delete('set-cookie');
				}
				if (debug) {
					res.headers.set('x-cache-deception-armor', 'pass-no-cache');
					res.headers.set('x-original-path', originalPath);
					res.headers.set('x-cleaned-path', url.pathname);
					res.headers.set('x-no-cache-reason',
						[originForbidsCache && 'origin-cache-control', hasSetCookie && 'set-cookie']
							.filter(Boolean).join(', '));
				}
				return res;
			}
		}

		// ── Step 4: Return response ────────────────────────────────────────

		const res = new Response(response.body, response);

		if (cacheable) {
			// Legit static asset — set browser cache TTL
			if (browserTtl > 0) {
				res.headers.set('cache-control', `public, max-age=${browserTtl}`);
			}
			// Strip Set-Cookie from cached static responses (belt-and-suspenders)
			res.headers.delete('set-cookie');
		} else {
			// Dynamic path (no cacheable extension) — force no-store to prevent
			// upstream cache rules or page rules from accidentally caching it.
			res.headers.set('cache-control', 'no-store');
			res.headers.set('cdn-cache-control', 'no-store');
		}

		if (debug) {
			res.headers.set('x-original-path', originalPath);
			res.headers.set('x-cleaned-path', url.pathname);
			res.headers.set('x-cache-deception-armor', cacheable ? 'pass' : 'dynamic');
			if (ext) res.headers.set('x-detected-extension', ext);
		}

		return res;
	},
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Merge cache TTL: defaults <- global env. */
function resolveCacheTtl(globalEnv: string | undefined): CacheTtlByStatus {
	let global: CacheTtlByStatus = {};
	if (globalEnv) {
		try {
			global = JSON.parse(globalEnv);
		} catch {
			// Malformed JSON, use defaults
		}
	}
	return { ...DEFAULT_CACHE_TTL, ...global };
}
