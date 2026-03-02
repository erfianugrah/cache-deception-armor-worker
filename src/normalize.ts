/**
 * URL normalization for cache deception protection.
 *
 * Decodes, strips delimiters, resolves traversals, and lowercases the path
 * so that cache deception payloads are neutralized before reaching the origin.
 */

/** Repeatedly decode percent-encoding until stable (catches double/triple encoding). */
export function fullyDecode(str: string): string {
	let prev = str;
	for (let i = 0; i < 5; i++) {
		try {
			const decoded = decodeURIComponent(prev);
			if (decoded === prev) return decoded;
			prev = decoded;
		} catch {
			return prev;
		}
	}
	return prev;
}

/** RFC 3986 dot-segment resolution. */
export function resolveDotSegments(path: string): string {
	const parts = path.split('/');
	const resolved: string[] = [];
	for (const part of parts) {
		if (part === '..') {
			resolved.pop();
		} else if (part !== '.') {
			resolved.push(part);
		}
	}
	return resolved.join('/') || '/';
}

/** Extract file extension from path without the dot, e.g. "/foo/bar.css" -> "css". */
export function getExtension(path: string): string | null {
	const match = path.match(/\.(\w{2,5})$/);
	return match ? match[1] : null;
}

/**
 * Full normalization pipeline for a URL pathname.
 * Returns the cleaned, lowercase path with all attack vectors neutralized.
 */
export function normalizePath(pathname: string): string {
	let path = pathname;

	// 1a. Decode percent-encoded characters (handles double-encoding)
	path = fullyDecode(path);

	// 1b. Strip null bytes
	path = path.replace(/\0/g, '');

	// 1c. Normalize backslashes to forward slashes (IIS compat)
	path = path.replace(/\\/g, '/');

	// 1d. Strip semicolon path parameters (RFC 3986 matrix params)
	path = path.replace(/;[^/]*/g, '');

	// 1e. Strip other delimiter characters that inject fake extensions
	path = path.replace(/[!$&'()*+,:|~^`][^/]*\.\w{2,5}$/g, '');

	// 1f. Resolve dot segments (/../ and /./)
	path = resolveDotSegments(path);

	// 1g. Collapse multiple slashes
	path = path.replace(/\/\/+/g, '/');

	// 1h. Lowercase
	path = path.toLowerCase();

	// 1i. Ensure path starts with /
	if (!path.startsWith('/')) path = '/' + path;

	return path;
}
