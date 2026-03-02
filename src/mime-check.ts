import mime from 'mime';

/**
 * MIME type validation for cache deception protection.
 *
 * Uses the `mime` library for all type lookups. The only hardcoded data is:
 *   - Cloudflare's default cacheable extensions (from their docs)
 *   - Known cross-category variations that CDNs accept (e.g. .gif -> video/webm)
 *   - Universally safe types (application/octet-stream)
 */

// ── Cloudflare's default cacheable file extensions ───────────────────────────
// Source: https://developers.cloudflare.com/cache/concepts/default-cache-behavior/#default-cached-file-extensions
// These are the extensions Cloudflare caches by default — and therefore
// the exact set an attacker would use in a cache deception URL.

export const CF_CACHEABLE_EXTENSIONS = new Set([
	'7z', 'avi', 'avif', 'apk', 'bin', 'bmp', 'bz2', 'class', 'css', 'csv',
	'doc', 'docx', 'dmg', 'ejs', 'eot', 'eps', 'exe', 'flac', 'gif', 'gz',
	'ico', 'iso', 'jar', 'jpg', 'jpeg', 'js', 'mid', 'midi', 'mkv', 'mp3',
	'mp4', 'ogg', 'otf', 'pdf', 'pict', 'pls', 'png', 'ppt', 'pptx', 'ps',
	'rar', 'svg', 'svgz', 'swf', 'tar', 'tif', 'tiff', 'ttf', 'webm', 'webp',
	'woff', 'woff2', 'xls', 'xlsx', 'zip', 'zst',
]);

// ── Known acceptable cross-category variations ──────────────────────────────
// Some responses legitimately serve a different MIME category than the extension
// implies. For example, animated GIFs re-encoded as video/webm, or fonts served
// as application/octet-stream. These would fail both exact and category checks
// but are not attacks.
//
// Format: Map<extension, Set<allowed MIME type prefixes>>

const CROSS_CATEGORY_OVERRIDES = new Map<string, Set<string>>([
	// Animated GIF -> video (re-encoding), Cloudflare explicitly allows this
	['gif', new Set(['video/'])],
	// Fonts often served as application/* by misconfigured origins
	['woff', new Set(['application/'])],
	['woff2', new Set(['application/'])],
	['ttf', new Set(['application/'])],
	['otf', new Set(['application/'])],
	['eot', new Set(['application/'])],
	// Image formats sometimes transcoded by CDNs/origins
	['jpg', new Set(['image/'])],
	['jpeg', new Set(['image/'])],
	['png', new Set(['image/'])],
	['webp', new Set(['image/'])],
	['avif', new Set(['image/'])],
]);

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Check if a response Content-Type is a mismatch for the given file extension.
 * Returns true if this looks like a cache deception attempt.
 *
 * @param ext - File extension without dot, lowercase (e.g. "css", "jpg")
 * @param contentType - Full Content-Type header value from origin response
 */
export function isContentTypeMismatch(ext: string, contentType: string): boolean {
	// Strip parameters: "text/html; charset=utf-8" -> "text/html"
	const actualMime = contentType.split(';')[0].trim().toLowerCase();

	// application/octet-stream is universally safe — signals download, not display
	if (actualMime === 'application/octet-stream') {
		return false;
	}

	// Resolve expected MIME from extension via library
	const expectedMime = mime.getType(ext);

	// If mime library doesn't know this extension, we can't validate — allow it
	// (these are rare: ejs, pict, zst from the CF list)
	if (expectedMime === null) {
		return false;
	}

	// 1. Exact match — always safe
	if (actualMime === expectedMime) {
		return false;
	}

	// 2. Category match for binary types (image, font, audio, video)
	//    e.g. .jpg (image/jpeg) served as image/webp — fine
	const expectedCategory = expectedMime.split('/')[0];
	const actualCategory = actualMime.split('/')[0];

	const BINARY_CATEGORIES = new Set(['image', 'font', 'audio', 'video']);
	if (BINARY_CATEGORIES.has(expectedCategory) && actualCategory === expectedCategory) {
		return false;
	}

	// 3. Known cross-category overrides
	const overrides = CROSS_CATEGORY_OVERRIDES.get(ext);
	if (overrides) {
		for (const prefix of overrides) {
			if (actualMime.startsWith(prefix)) {
				return false;
			}
		}
	}

	// Everything else is a mismatch
	return true;
}

/**
 * Check if a file extension is in Cloudflare's default cacheable set.
 *
 * @param ext - File extension without dot, lowercase
 */
export function isCacheableExtension(ext: string): boolean {
	return CF_CACHEABLE_EXTENSIONS.has(ext);
}

/**
 * Get the expected MIME type for an extension via the mime library.
 * Returns null if unknown.
 */
export function getExpectedMime(ext: string): string | null {
	return mime.getType(ext);
}
