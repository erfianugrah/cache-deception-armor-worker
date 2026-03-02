import { describe, it, expect } from 'vitest';
import mime from 'mime';
import { isContentTypeMismatch, isCacheableExtension, getExpectedMime, CF_CACHEABLE_EXTENSIONS } from './mime-check';

// ── Exhaustive MIME coverage ────────────────────────────────────────────────
// Every CF cacheable extension, grouped by the MIME category that `mime` returns.
// These are used for parameterized tests below.

const NULL_EXTENSIONS = ['ejs', 'pict', 'zst'] as const;

const TEXT_EXTENSIONS: Record<string, string> = {
	css: 'text/css',
	csv: 'text/csv',
	js: 'text/javascript',
};

const APPLICATION_EXTENSIONS: Record<string, string> = {
	'7z': 'application/x-7z-compressed',
	apk: 'application/vnd.android.package-archive',
	bin: 'application/octet-stream',
	bz2: 'application/x-bzip2',
	class: 'application/java-vm',
	doc: 'application/msword',
	docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	dmg: 'application/octet-stream',
	eot: 'application/vnd.ms-fontobject',
	eps: 'application/postscript',
	exe: 'application/octet-stream',
	gz: 'application/gzip',
	iso: 'application/octet-stream',
	jar: 'application/java-archive',
	pdf: 'application/pdf',
	pls: 'application/pls+xml',
	ppt: 'application/vnd.ms-powerpoint',
	pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
	ps: 'application/postscript',
	rar: 'application/vnd.rar',
	swf: 'application/x-shockwave-flash',
	tar: 'application/x-tar',
	xls: 'application/vnd.ms-excel',
	xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	zip: 'application/zip',
};

const IMAGE_EXTENSIONS: Record<string, string> = {
	avif: 'image/avif',
	bmp: 'image/bmp',
	gif: 'image/gif',
	ico: 'image/vnd.microsoft.icon',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	svg: 'image/svg+xml',
	svgz: 'image/svg+xml',
	tif: 'image/tiff',
	tiff: 'image/tiff',
	webp: 'image/webp',
};

const AUDIO_EXTENSIONS: Record<string, string> = {
	flac: 'audio/x-flac',
	mid: 'audio/midi',
	midi: 'audio/midi',
	mp3: 'audio/mpeg',
	ogg: 'audio/ogg',
};

const VIDEO_EXTENSIONS: Record<string, string> = {
	avi: 'video/x-msvideo',
	mkv: 'video/x-matroska',
	mp4: 'video/mp4',
	webm: 'video/webm',
};

const FONT_EXTENSIONS: Record<string, string> = {
	otf: 'font/otf',
	ttf: 'font/ttf',
	woff: 'font/woff',
	woff2: 'font/woff2',
};

// Extensions whose canonical MIME is application/octet-stream (bin, dmg, exe, iso).
// These always pass because octet-stream is universally safe.
const OCTET_STREAM_EXTENSIONS = Object.entries(APPLICATION_EXTENSIONS)
	.filter(([, m]) => m === 'application/octet-stream')
	.map(([ext]) => ext);

// All extensions with a known MIME type (excludes null and octet-stream)
const KNOWN_NON_OCTET_EXTENSIONS = {
	...TEXT_EXTENSIONS,
	...Object.fromEntries(
		Object.entries(APPLICATION_EXTENSIONS).filter(([, m]) => m !== 'application/octet-stream')
	),
	...IMAGE_EXTENSIONS,
	...AUDIO_EXTENSIONS,
	...VIDEO_EXTENSIONS,
	...FONT_EXTENSIONS,
};

// ── isContentTypeMismatch ───────────────────────────────────────────────────

describe('isContentTypeMismatch', () => {

	// ── Exhaustive: every known extension served as its correct MIME passes ──

	describe('every CF extension served as correct MIME passes', () => {
		for (const [ext, expectedMime] of Object.entries(KNOWN_NON_OCTET_EXTENSIONS)) {
			it(`.${ext} served as ${expectedMime}`, () => {
				expect(isContentTypeMismatch(ext, expectedMime)).toBe(false);
			});
		}

		for (const ext of OCTET_STREAM_EXTENSIONS) {
			it(`.${ext} served as application/octet-stream (canonical)`, () => {
				expect(isContentTypeMismatch(ext, 'application/octet-stream')).toBe(false);
			});
		}
	});

	// ── Exhaustive: every known extension served as text/html is detected ────

	describe('every CF extension served as text/html is blocked (cache deception)', () => {
		for (const [ext, expectedMime] of Object.entries(KNOWN_NON_OCTET_EXTENSIONS)) {
			it(`.${ext} (expects ${expectedMime}) served as text/html`, () => {
				expect(isContentTypeMismatch(ext, 'text/html')).toBe(true);
			});
		}
	});

	// ── Exhaustive: every known extension served as text/html;charset=utf-8 ──

	describe('text/html with charset parameter is still blocked', () => {
		for (const [ext] of Object.entries(KNOWN_NON_OCTET_EXTENSIONS)) {
			it(`.${ext} served as text/html; charset=utf-8`, () => {
				expect(isContentTypeMismatch(ext, 'text/html; charset=utf-8')).toBe(true);
			});
		}
	});

	// ── text/* intra-category mismatches (must block) ────────────────────────

	describe('text/* intra-category mismatches (exact match required)', () => {
		it('css served as text/plain', () => {
			expect(isContentTypeMismatch('css', 'text/plain')).toBe(true);
		});

		it('css served as text/html', () => {
			expect(isContentTypeMismatch('css', 'text/html')).toBe(true);
		});

		it('css served as text/csv', () => {
			expect(isContentTypeMismatch('css', 'text/csv')).toBe(true);
		});

		it('csv served as text/css', () => {
			expect(isContentTypeMismatch('csv', 'text/css')).toBe(true);
		});

		it('js served as text/css', () => {
			expect(isContentTypeMismatch('js', 'text/css')).toBe(true);
		});

		it('js served as text/plain', () => {
			expect(isContentTypeMismatch('js', 'text/plain')).toBe(true);
		});
	});

	// ── application/* intra-category mismatches (must block) ─────────────────

	describe('application/* intra-category mismatches (exact match required)', () => {
		it('pdf served as application/zip', () => {
			expect(isContentTypeMismatch('pdf', 'application/zip')).toBe(true);
		});

		it('zip served as application/pdf', () => {
			expect(isContentTypeMismatch('zip', 'application/pdf')).toBe(true);
		});

		it('doc served as application/javascript', () => {
			expect(isContentTypeMismatch('doc', 'application/javascript')).toBe(true);
		});

		it('jar served as application/pdf', () => {
			expect(isContentTypeMismatch('jar', 'application/pdf')).toBe(true);
		});

		it('7z served as application/zip', () => {
			expect(isContentTypeMismatch('7z', 'application/zip')).toBe(true);
		});

		it('tar served as application/gzip', () => {
			expect(isContentTypeMismatch('tar', 'application/gzip')).toBe(true);
		});

		it('xls served as application/pdf', () => {
			expect(isContentTypeMismatch('xls', 'application/pdf')).toBe(true);
		});

		it('rar served as application/zip', () => {
			expect(isContentTypeMismatch('rar', 'application/zip')).toBe(true);
		});

		it('ppt served as application/json', () => {
			expect(isContentTypeMismatch('ppt', 'application/json')).toBe(true);
		});

		it('eps served as application/pdf', () => {
			expect(isContentTypeMismatch('eps', 'application/pdf')).toBe(true);
		});
	});

	// ── Cross-category attacks (binary extension served as text/json) ────────

	describe('cross-category attacks on binary types', () => {
		it('jpg served as application/json', () => {
			expect(isContentTypeMismatch('jpg', 'application/json')).toBe(true);
		});

		it('png served as text/plain', () => {
			expect(isContentTypeMismatch('png', 'text/plain')).toBe(true);
		});

		it('mp4 served as text/html', () => {
			expect(isContentTypeMismatch('mp4', 'text/html')).toBe(true);
		});

		it('woff2 served as text/css', () => {
			expect(isContentTypeMismatch('woff2', 'text/css')).toBe(true);
		});

		it('flac served as application/json', () => {
			expect(isContentTypeMismatch('flac', 'application/json')).toBe(true);
		});

		it('pdf served as image/png', () => {
			expect(isContentTypeMismatch('pdf', 'image/png')).toBe(true);
		});
	});

	// ── Binary category fuzzy match (same category, different subtype) ───────

	describe('binary category fuzzy match (should return false)', () => {
		// image/* intra-category
		it('jpg served as image/webp (CDN transcoding)', () => {
			expect(isContentTypeMismatch('jpg', 'image/webp')).toBe(false);
		});

		it('png served as image/avif (CDN transcoding)', () => {
			expect(isContentTypeMismatch('png', 'image/avif')).toBe(false);
		});

		it('webp served as image/png', () => {
			expect(isContentTypeMismatch('webp', 'image/png')).toBe(false);
		});

		it('bmp served as image/png', () => {
			expect(isContentTypeMismatch('bmp', 'image/png')).toBe(false);
		});

		it('tif served as image/png', () => {
			expect(isContentTypeMismatch('tif', 'image/png')).toBe(false);
		});

		it('ico served as image/png', () => {
			expect(isContentTypeMismatch('ico', 'image/png')).toBe(false);
		});

		it('svg served as image/png', () => {
			expect(isContentTypeMismatch('svg', 'image/png')).toBe(false);
		});

		it('svgz served as image/png', () => {
			expect(isContentTypeMismatch('svgz', 'image/png')).toBe(false);
		});

		// audio/* intra-category
		it('mp3 served as audio/ogg', () => {
			expect(isContentTypeMismatch('mp3', 'audio/ogg')).toBe(false);
		});

		it('flac served as audio/mpeg', () => {
			expect(isContentTypeMismatch('flac', 'audio/mpeg')).toBe(false);
		});

		it('mid served as audio/ogg', () => {
			expect(isContentTypeMismatch('mid', 'audio/ogg')).toBe(false);
		});

		it('ogg served as audio/mpeg', () => {
			expect(isContentTypeMismatch('ogg', 'audio/mpeg')).toBe(false);
		});

		// video/* intra-category
		it('mp4 served as video/webm', () => {
			expect(isContentTypeMismatch('mp4', 'video/webm')).toBe(false);
		});

		it('avi served as video/mp4', () => {
			expect(isContentTypeMismatch('avi', 'video/mp4')).toBe(false);
		});

		it('mkv served as video/webm', () => {
			expect(isContentTypeMismatch('mkv', 'video/webm')).toBe(false);
		});

		it('webm served as video/mp4', () => {
			expect(isContentTypeMismatch('webm', 'video/mp4')).toBe(false);
		});

		// font/* intra-category
		it('woff2 served as font/woff', () => {
			expect(isContentTypeMismatch('woff2', 'font/woff')).toBe(false);
		});

		it('ttf served as font/otf', () => {
			expect(isContentTypeMismatch('ttf', 'font/otf')).toBe(false);
		});

		it('otf served as font/ttf', () => {
			expect(isContentTypeMismatch('otf', 'font/ttf')).toBe(false);
		});

		it('woff served as font/woff2', () => {
			expect(isContentTypeMismatch('woff', 'font/woff2')).toBe(false);
		});
	});

	// ── Cross-category overrides ────────────────────────────────────────────

	describe('cross-category overrides (should return false)', () => {
		// gif -> video (animated gif re-encoding)
		it('gif served as video/webm', () => {
			expect(isContentTypeMismatch('gif', 'video/webm')).toBe(false);
		});

		it('gif served as video/mp4', () => {
			expect(isContentTypeMismatch('gif', 'video/mp4')).toBe(false);
		});

		// fonts -> application (misconfigured origins)
		it('woff served as application/font-woff', () => {
			expect(isContentTypeMismatch('woff', 'application/font-woff')).toBe(false);
		});

		it('woff2 served as application/font-woff2', () => {
			expect(isContentTypeMismatch('woff2', 'application/font-woff2')).toBe(false);
		});

		it('ttf served as application/x-font-ttf', () => {
			expect(isContentTypeMismatch('ttf', 'application/x-font-ttf')).toBe(false);
		});

		it('otf served as application/x-font-opentype', () => {
			expect(isContentTypeMismatch('otf', 'application/x-font-opentype')).toBe(false);
		});

		it('eot served as application/vnd.ms-fontobject (exact match)', () => {
			expect(isContentTypeMismatch('eot', 'application/vnd.ms-fontobject')).toBe(false);
		});

		// image -> image overrides (CDN transcoding, these also pass via category match)
		it('jpg served as image/webp (override + category)', () => {
			expect(isContentTypeMismatch('jpg', 'image/webp')).toBe(false);
		});

		it('avif served as image/webp (override + category)', () => {
			expect(isContentTypeMismatch('avif', 'image/webp')).toBe(false);
		});
	});

	// ── application/octet-stream universal safe ─────────────────────────────

	describe('application/octet-stream (universally safe)', () => {
		it('text extension served as octet-stream', () => {
			expect(isContentTypeMismatch('css', 'application/octet-stream')).toBe(false);
			expect(isContentTypeMismatch('js', 'application/octet-stream')).toBe(false);
			expect(isContentTypeMismatch('csv', 'application/octet-stream')).toBe(false);
		});

		it('image extension served as octet-stream', () => {
			expect(isContentTypeMismatch('jpg', 'application/octet-stream')).toBe(false);
			expect(isContentTypeMismatch('png', 'application/octet-stream')).toBe(false);
		});

		it('application extension served as octet-stream', () => {
			expect(isContentTypeMismatch('pdf', 'application/octet-stream')).toBe(false);
			expect(isContentTypeMismatch('zip', 'application/octet-stream')).toBe(false);
			expect(isContentTypeMismatch('exe', 'application/octet-stream')).toBe(false);
		});

		it('font extension served as octet-stream', () => {
			expect(isContentTypeMismatch('woff', 'application/octet-stream')).toBe(false);
			expect(isContentTypeMismatch('woff2', 'application/octet-stream')).toBe(false);
			expect(isContentTypeMismatch('ttf', 'application/octet-stream')).toBe(false);
		});

		it('audio/video extension served as octet-stream', () => {
			expect(isContentTypeMismatch('mp3', 'application/octet-stream')).toBe(false);
			expect(isContentTypeMismatch('mp4', 'application/octet-stream')).toBe(false);
		});
	});

	// ── Extensions with null MIME (mime library unknown) ─────────────────────

	describe('unknown extensions (mime returns null) always pass', () => {
		for (const ext of NULL_EXTENSIONS) {
			it(`.${ext} served as text/html passes (cannot validate)`, () => {
				expect(isContentTypeMismatch(ext, 'text/html')).toBe(false);
			});

			it(`.${ext} served as application/json passes`, () => {
				expect(isContentTypeMismatch(ext, 'application/json')).toBe(false);
			});

			it(`.${ext} served as image/png passes`, () => {
				expect(isContentTypeMismatch(ext, 'image/png')).toBe(false);
			});
		}
	});

	// ── Edge cases ──────────────────────────────────────────────────────────

	describe('edge cases', () => {
		it('empty content-type string', () => {
			// Empty string after split/trim is "", not a valid MIME
			// Should be a mismatch for any known extension
			expect(isContentTypeMismatch('css', '')).toBe(true);
			expect(isContentTypeMismatch('jpg', '')).toBe(true);
		});

		it('content-type with only parameters (no type)', () => {
			expect(isContentTypeMismatch('css', '; charset=utf-8')).toBe(true);
		});

		it('content-type case insensitivity', () => {
			expect(isContentTypeMismatch('css', 'TEXT/CSS')).toBe(false);
			expect(isContentTypeMismatch('jpg', 'IMAGE/JPEG')).toBe(false);
			expect(isContentTypeMismatch('pdf', 'APPLICATION/PDF')).toBe(false);
		});

		it('content-type with charset on exact match', () => {
			expect(isContentTypeMismatch('css', 'text/css; charset=utf-8')).toBe(false);
			expect(isContentTypeMismatch('js', 'text/javascript; charset=utf-8')).toBe(false);
		});

		it('content-type with multiple parameters', () => {
			expect(isContentTypeMismatch('css', 'text/css; charset=utf-8; boundary=something')).toBe(false);
		});
	});

	// ── Verify test data matches mime library ───────────────────────────────

	describe('test data integrity: extension maps match mime library output', () => {
		const allMaps = {
			...TEXT_EXTENSIONS,
			...APPLICATION_EXTENSIONS,
			...IMAGE_EXTENSIONS,
			...AUDIO_EXTENSIONS,
			...VIDEO_EXTENSIONS,
			...FONT_EXTENSIONS,
		};

		for (const [ext, expectedMime] of Object.entries(allMaps)) {
			it(`.${ext} maps to ${expectedMime}`, () => {
				expect(mime.getType(ext)).toBe(expectedMime);
			});
		}

		for (const ext of NULL_EXTENSIONS) {
			it(`.${ext} returns null from mime`, () => {
				expect(mime.getType(ext)).toBeNull();
			});
		}
	});
});

// ── isCacheableExtension ────────────────────────────────────────────────────

describe('isCacheableExtension', () => {
	it('recognizes common cacheable extensions', () => {
		expect(isCacheableExtension('css')).toBe(true);
		expect(isCacheableExtension('js')).toBe(true);
		expect(isCacheableExtension('jpg')).toBe(true);
		expect(isCacheableExtension('png')).toBe(true);
		expect(isCacheableExtension('woff2')).toBe(true);
		expect(isCacheableExtension('svg')).toBe(true);
	});

	it('rejects non-cacheable extensions', () => {
		expect(isCacheableExtension('html')).toBe(false);
		expect(isCacheableExtension('php')).toBe(false);
		expect(isCacheableExtension('asp')).toBe(false);
		expect(isCacheableExtension('json')).toBe(false);
		expect(isCacheableExtension('xml')).toBe(false);
	});

	it('is case-sensitive (caller must lowercase)', () => {
		expect(isCacheableExtension('CSS')).toBe(false);
		expect(isCacheableExtension('Jpg')).toBe(false);
	});
});

// ── getExpectedMime ─────────────────────────────────────────────────────────

describe('getExpectedMime', () => {
	it('returns correct MIME for known extensions', () => {
		expect(getExpectedMime('css')).toBe('text/css');
		expect(getExpectedMime('jpg')).toBe('image/jpeg');
		expect(getExpectedMime('png')).toBe('image/png');
		expect(getExpectedMime('js')).toBe('text/javascript');
		expect(getExpectedMime('svg')).toBe('image/svg+xml');
	});

	it('returns null for unknown extensions', () => {
		expect(getExpectedMime('ejs')).toBeNull();
		expect(getExpectedMime('pict')).toBeNull();
		expect(getExpectedMime('zst')).toBeNull();
	});
});

// ── CF_CACHEABLE_EXTENSIONS ─────────────────────────────────────────────────

describe('CF_CACHEABLE_EXTENSIONS', () => {
	it('contains all expected Cloudflare default extensions', () => {
		const expected = [
			'7z', 'avi', 'avif', 'apk', 'bin', 'bmp', 'bz2', 'class', 'css', 'csv',
			'doc', 'docx', 'dmg', 'ejs', 'eot', 'eps', 'exe', 'flac', 'gif', 'gz',
			'ico', 'iso', 'jar', 'jpg', 'jpeg', 'js', 'mid', 'midi', 'mkv', 'mp3',
			'mp4', 'ogg', 'otf', 'pdf', 'pict', 'pls', 'png', 'ppt', 'pptx', 'ps',
			'rar', 'svg', 'svgz', 'swf', 'tar', 'tif', 'tiff', 'ttf', 'webm', 'webp',
			'woff', 'woff2', 'xls', 'xlsx', 'zip', 'zst',
		];
		for (const ext of expected) {
			expect(CF_CACHEABLE_EXTENSIONS.has(ext), `missing: ${ext}`).toBe(true);
		}
		expect(CF_CACHEABLE_EXTENSIONS.size).toBe(expected.length);
	});
});
