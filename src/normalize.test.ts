import { describe, it, expect } from 'vitest';
import { fullyDecode, resolveDotSegments, getExtension, normalizePath } from './normalize';

// ── fullyDecode ─────────────────────────────────────────────────────────────

describe('fullyDecode', () => {
	it('returns plain strings unchanged', () => {
		expect(fullyDecode('/account/settings')).toBe('/account/settings');
	});

	it('decodes single-encoded characters', () => {
		expect(fullyDecode('/account%2fsettings')).toBe('/account/settings');
		expect(fullyDecode('/account%3bfoo.css')).toBe('/account;foo.css');
	});

	it('decodes double-encoded characters', () => {
		expect(fullyDecode('%252f')).toBe('/');
		expect(fullyDecode('%253b')).toBe(';');
		expect(fullyDecode('%252e%252e')).toBe('..');
	});

	it('decodes triple-encoded characters', () => {
		expect(fullyDecode('%25252f')).toBe('/');
	});

	it('handles invalid percent sequences gracefully', () => {
		expect(fullyDecode('%ZZ')).toBe('%ZZ');
		expect(fullyDecode('/foo%')).toBe('/foo%');
	});

	it('stops after 5 iterations to prevent infinite loops', () => {
		// 6 levels of encoding — should stop at 5
		// encodeURIComponent applied 6 times to "/"
		let encoded = '/';
		for (let i = 0; i < 6; i++) encoded = encodeURIComponent(encoded);
		const result = fullyDecode(encoded);
		// After 5 decodes, there should still be one level of encoding left
		expect(result).toBe('%2F');
	});
});

// ── resolveDotSegments ──────────────────────────────────────────────────────

describe('resolveDotSegments', () => {
	it('resolves parent traversal /../', () => {
		expect(resolveDotSegments('/a/b/../c')).toBe('/a/c');
	});

	it('resolves current dir /./', () => {
		expect(resolveDotSegments('/a/./b')).toBe('/a/b');
	});

	it('resolves multiple traversals', () => {
		expect(resolveDotSegments('/a/b/c/../../d')).toBe('/a/d');
	});

	it('does not traverse above root', () => {
		// resolveDotSegments alone may lose the leading empty segment from split,
		// but normalizePath step 1i re-adds the leading /
		expect(resolveDotSegments('/../../../a')).toBe('a');
	});

	it('returns / for empty result', () => {
		expect(resolveDotSegments('..')).toBe('/');
	});

	it('leaves normal paths alone', () => {
		expect(resolveDotSegments('/a/b/c')).toBe('/a/b/c');
	});
});

// ── getExtension ────────────────────────────────────────────────────────────

describe('getExtension', () => {
	it('extracts common extensions', () => {
		expect(getExtension('/static/style.css')).toBe('css');
		expect(getExtension('/images/photo.jpg')).toBe('jpg');
		expect(getExtension('/app/bundle.js')).toBe('js');
	});

	it('returns null for paths without extensions', () => {
		expect(getExtension('/account/settings')).toBeNull();
		expect(getExtension('/api/v1/users')).toBeNull();
	});

	it('returns null for single-char extensions (too short)', () => {
		expect(getExtension('/file.a')).toBeNull();
	});

	it('returns null for extensions longer than 5 chars', () => {
		expect(getExtension('/file.longext')).toBeNull();
	});

	it('handles dots in directory names', () => {
		// The regex matches the last .ext at end of path
		expect(getExtension('/v2.0/api')).toBeNull();
		expect(getExtension('/v2.0/style.css')).toBe('css');
	});
});

// ── normalizePath (integration) ─────────────────────────────────────────────

describe('normalizePath', () => {
	describe('delimiter attacks', () => {
		it('strips semicolon + extension', () => {
			expect(normalizePath('/account/settings;foo.CSS')).toBe('/account/settings');
		});

		it('strips semicolon + lowercase extension', () => {
			expect(normalizePath('/account/settings;foo.css')).toBe('/account/settings');
		});

		it('strips multiple semicolon params', () => {
			expect(normalizePath('/account/settings;a=b;c=d.js')).toBe('/account/settings');
		});
	});

	describe('case sensitivity', () => {
		it('lowercases uppercase extensions', () => {
			expect(normalizePath('/account/settings.CSS')).toBe('/account/settings.css');
		});

		it('lowercases mixed case extensions', () => {
			expect(normalizePath('/account/settings.JpG')).toBe('/account/settings.jpg');
		});

		it('lowercases the entire path', () => {
			expect(normalizePath('/Account/Settings')).toBe('/account/settings');
		});
	});

	describe('encoded attacks', () => {
		it('decodes encoded semicolon %3b and strips', () => {
			expect(normalizePath('/account/settings%3bfoo.css')).toBe('/account/settings');
		});

		it('strips null bytes', () => {
			// After decoding %00, the null byte is stripped
			expect(normalizePath('/account/settings\0foo.js')).toBe('/account/settingsfoo.js');
		});
	});

	describe('double encoding', () => {
		it('decodes double-encoded slash %252f', () => {
			expect(normalizePath('/account/settings%252ffoo.css')).toBe('/account/settings/foo.css');
		});

		it('decodes double-encoded semicolon %253b and strips', () => {
			expect(normalizePath('/account/settings%253bfoo.css')).toBe('/account/settings');
		});

		it('decodes double-encoded dots %252e%252e for traversal', () => {
			expect(normalizePath('/static/%252e%252e/account/settings')).toBe('/account/settings');
		});
	});

	describe('path traversal', () => {
		it('resolves encoded traversal ..%2f', () => {
			expect(normalizePath('/static/..%2faccount/settings')).toBe('/account/settings');
		});

		it('resolves literal /../', () => {
			expect(normalizePath('/assets/../account/settings')).toBe('/account/settings');
		});
	});

	describe('backslash and multi-slash', () => {
		it('normalizes backslash to forward slash', () => {
			expect(normalizePath('/account/settings%5cfoo.css')).toBe('/account/settings/foo.css');
		});

		it('collapses double slashes', () => {
			expect(normalizePath('/account//settings.css')).toBe('/account/settings.css');
		});

		it('collapses triple slashes', () => {
			expect(normalizePath('/account///settings')).toBe('/account/settings');
		});
	});

	describe('normal requests', () => {
		it('leaves clean dynamic paths unchanged', () => {
			expect(normalizePath('/account/settings')).toBe('/account/settings');
		});

		it('leaves clean static asset paths unchanged', () => {
			expect(normalizePath('/static/image.jpg')).toBe('/static/image.jpg');
		});

		it('ensures path starts with /', () => {
			// Edge case: after all transformations, path might lose leading /
			expect(normalizePath('foo/bar')).toMatch(/^\//);
		});
	});
});
