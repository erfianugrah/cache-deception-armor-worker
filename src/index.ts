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
			const mismatch = isContentTypeMismatch(ext, contentType);

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
								'x-actual-type': contentType,
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
				}
				return res;
			}
		}

		// ── Step 4: Return response ────────────────────────────────────────

		const res = new Response(response.body, response);

		// Set browser cache TTL for legit static assets
		if (browserTtl > 0 && cacheable) {
			res.headers.set('cache-control', `public, max-age=${browserTtl}`);
		}

		if (debug) {
			res.headers.set('x-original-path', originalPath);
			res.headers.set('x-cleaned-path', url.pathname);
			res.headers.set('x-cache-deception-armor', 'pass');
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
