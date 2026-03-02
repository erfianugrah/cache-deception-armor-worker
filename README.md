# Cache Deception Armor — Hardened Cloudflare Worker

## Background

Web Cache Deception (WCD) attacks trick a CDN into caching personalized/sensitive responses by appending a static-looking extension to a dynamic URL. For example:

```
https://example.com/account/settings;foo.CSS
```

The origin ignores the `;foo.CSS` suffix and serves the user's account page (`text/html`). The CDN sees a path ending in `.CSS`, treats it as a cacheable static asset, and stores it. Anyone who visits the same URL gets the cached response — including sensitive data.

### Why Cloudflare's Built-in Cache Deception Armor Isn't Enough

Cloudflare's Cache Deception Armor checks whether the response `Content-Type` matches the URL's file extension. It has known gaps:

- **Case-sensitive extension matching**: `.CSS` (uppercase) bypasses the check; only `.css` (lowercase) is caught.
- **No delimiter awareness**: Semicolons (`;`), encoded characters (`%3b`, `%23`), null bytes (`%00`), and other delimiters are not stripped before evaluation.
- **Overridable**: `Cache-Control` headers from the origin or Edge Cache TTL rules can override the protection entirely.
- **Extension-only**: Does not protect against directory-based or filename-based cache rules.

## Solution

This worker implements two layers of defense that run at the edge before cache evaluation.

### Layer 1: URL Normalization (primary defense)

Removes attack payloads so the URL never looks like a static asset:

| Step | What it does | Example |
|------|-------------|---------|
| Full decode | Recursively decodes percent-encoding (catches double/triple encoding) | `%253b` -> `%3b` -> `;` |
| Strip null bytes | Removes `\0` characters | `/acct%00foo.js` -> `/acctfoo.js` |
| Backslash normalization | Converts `\` to `/` (IIS compatibility) | `/acct\foo.css` -> `/acct/foo.css` |
| Semicolon stripping | Removes `;param` path parameters (RFC 3986 matrix params) | `/acct;foo.CSS` -> `/acct` |
| Delimiter stripping | Removes `!$&'()*+,:\|~^\`` followed by fake extensions | `/acct$foo.css` -> `/acct` |
| Dot segment resolution | Resolves `/../` and `/./` traversals | `/static/../acct` -> `/acct` |
| Slash collapsing | Merges `//` into `/` | `/path//acct.css` -> `/path/acct.css` |
| Lowercase | Normalizes case | `.CSS` -> `.css` |

### Layer 2: Content-Type Mismatch Check (fallback defense)

If an extension survives normalization, the worker checks the origin's `Content-Type` against the expected type for that extension using the [`mime`](https://www.npmjs.com/package/mime) library. The set of protected extensions is [Cloudflare's default cacheable file extensions](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/#default-cached-file-extensions).

Matching rules:
- **Exact match**: `text/css` for `.css` — pass
- **Fuzzy category match** for binary types: `image/webp` for `.jpg` — pass (same `image/*` category)
- **Strict match** for `text/*` and `application/*`: `text/html` for `.css` — **blocked** (prevents the `text/html` vs `text/css` same-category bypass)
- **Cross-category overrides**: known acceptable variations like `.gif` served as `video/webm`
- **`application/octet-stream`**: always allowed (signals download, not display)

Mismatches result in a `404` with `Cache-Control: no-store`.

### Request Flow

```
Incoming request
       |
       v
+---------------------+
| 1. NORMALIZE URL    |  decode -> strip nulls -> normalize \ -> strip ; params
|                     |  -> strip delimiters -> resolve ../ -> collapse // -> lowercase
+----------+----------+
           |
           v
+---------------------+
| 2. FETCH ORIGIN     |  forward cleaned request to origin
|                     |  origin returns response + Content-Type
+----------+----------+
           |
           v
+---------------------+
| 3. ARMOR CHECK      |  does cleaned path have a cacheable extension?
|                     |  if yes: does Content-Type match? (via mime library)
|                     |  mismatch -> 404 (no-store)
+----------+----------+
           |
           v
      Return response
```

Normalization is the primary defense — it removes the attack payload before it hits origin or cache. The Armor check is the safety net for anything that slips through.

## Project Structure

```
cache-deception-test/
  src/
    index.ts              # Worker entry point — fetch + armor check
    normalize.ts          # URL normalization module (decode, strip, resolve, lowercase)
    mime-check.ts         # MIME validation module (uses `mime` library + CF cacheable extensions)
    normalize.test.ts     # Unit tests for URL normalization (36 tests)
    mime-check.test.ts    # Unit tests for MIME matching (283 tests)
  test.sh                 # Integration test suite — 17 attack vectors against live edge
  vitest.config.mts       # Vitest config using @cloudflare/vitest-pool-workers
  wrangler.jsonc          # Wrangler config (vars, environments)
  .dev.vars               # Local dev overrides (gitignored)
  .gitignore
  tsconfig.json
  package.json
```

## Configuration

Settings are in `wrangler.jsonc`:

```jsonc
{
  "vars": {
    // Cache TTL as JSON cacheTtlByStatus overrides (merged on top of defaults)
    // Set to "{}" to use defaults only
    "CACHE_TTL": "{}",

    // Browser cache TTL in seconds (Cache-Control: max-age) for legit static assets
    // Set to 0 to let origin control browser caching
    "BROWSER_TTL": "3600",

    // "true": blocked responses return 404 (hard block)
    // "false": return the response but with Cache-Control: no-store (soft block)
    "BLOCK_MODE": "true",

    // Enable debug response headers — MUST be "false" in production
    "DEBUG": "true"
  }
}
```

### Environments

```bash
wrangler dev                    # Dev (DEBUG=true)
wrangler dev --env staging      # Staging (no browser caching, DEBUG=true)
wrangler deploy --env production # Production (DEBUG=false)
```

| Setting | Dev | Staging | Production |
|---------|-----|---------|------------|
| `CACHE_TTL` | `{}` (defaults) | `{}` (defaults) | `{}` (defaults) |
| `BROWSER_TTL` | 3600 | 0 (origin controls) | 3600 |
| `BLOCK_MODE` | true | true | true |
| `DEBUG` | true | true | **false** |

### Cache TTL behavior

`CACHE_TTL` is a JSON string matching Cloudflare's `cacheTtlByStatus` format. It's merged on top of built-in defaults:

```json
{ "200-299": 86400, "304": 86400, "404": 60, "400-403": 0, "500-599": 0 }
```

The Armor check runs **before** caching, so only responses with matching Content-Type are cached.

`BROWSER_TTL` sets `Cache-Control: public, max-age=<value>` on responses that pass the Armor check and have a cacheable extension. Set to `0` to preserve the origin's headers.

### Local development

The worker runs on the route in production, so `fetch()` goes to the origin automatically. For local dev with `wrangler dev`, set `ORIGIN` in `.dev.vars` (gitignored):

```
ORIGIN=https://example.com
```

For remote dev on Cloudflare's edge:

```bash
wrangler dev --remote
```

## Running the Tests

### Unit tests (vitest)

Runs in Cloudflare's `workerd` runtime via `@cloudflare/vitest-pool-workers`. 319 tests covering URL normalization and MIME matching:

```bash
npm test           # single run
npm run test:watch # watch mode
```

**Coverage breakdown:**

| Module | Tests | What's covered |
|--------|-------|----------------|
| `normalize.ts` | 36 | `fullyDecode` (single/double/triple encoding, invalid sequences, iteration limit), `resolveDotSegments` (traversal, current dir, above-root), `getExtension` (valid, too short/long, dots in dirs), `normalizePath` integration (all 17 attack vectors as pure functions) |
| `mime-check.ts` | 283 | All 53 known CF extensions vs correct MIME (exact match), all 49 non-octet-stream extensions vs `text/html` (cache deception detection), all 49 vs `text/html; charset=utf-8`, `text/*` intra-category mismatches (6), `application/*` intra-category mismatches (10), binary category fuzzy match across all 4 categories (22), cross-category overrides (9), `application/octet-stream` universal safe (5 groups), null-MIME extensions 3x3 (9), edge cases (empty CT, params-only, case insensitivity, multi-param), test data integrity check against `mime` library (56) |

### Integration tests (test.sh)

Runs 17 attack vectors against a live worker on Cloudflare's edge:

```bash
# Terminal 1: start the worker
wrangler dev --remote --port 8795

# Terminal 2: run the test suite
bash test.sh
```

Override the base URL if needed:

```bash
BASE="http://127.0.0.1:9000" bash test.sh
```

## Test Results

### Attack Vectors — All Blocked

| Category | Test | Original Path | Cleaned Path | Defense |
|----------|------|---------------|--------------|---------|
| Delimiter | Semicolon + uppercase | `/settings;foo.CSS` | `/settings` | Normalization (semicolon stripped) |
| Delimiter | Semicolon + lowercase | `/settings;foo.css` | `/settings` | Normalization (semicolon stripped) |
| Delimiter | Multiple semicolons | `/settings;a=b;c=d.js` | `/settings` | Normalization (all stripped) |
| Case | Uppercase `.CSS` | `/settings.CSS` | `/settings.css` | Armor (`text/html` != `text/css`) |
| Case | Mixed `.JpG` | `/settings.JpG` | `/settings.jpg` | Armor (`text/html` != `image/jpeg`) |
| Encoding | Encoded semicolon `%3b` | `/settings%3bfoo.css` | `/settings` | Normalization (decoded + stripped) |
| Encoding | Encoded hash `%23` | `/settings%23foo.css` | `/settings%23foo.css` | Armor (`text/html` != `text/css`) |
| Encoding | Null byte `%00` | `/settings%00foo.js` | `400 Bad Request` | Cloudflare edge rejects null bytes |
| Double enc. | Double slash `%252f` | `/settings%252ffoo.css` | `/settings/foo.css` | Armor (`text/html` != `text/css`) |
| Double enc. | Double semicolon `%253b` | `/settings%253bfoo.css` | `/settings` | Normalization (double-decoded + stripped) |
| Double enc. | Double dots `%252e%252e` | `/static/%252e%252e/...` | `/account/...` | Normalization (traversal resolved) |
| Traversal | `..%2f` | `/static/..%2f.../settings` | `/account/settings` | Normalization (decoded + resolved) |
| Traversal | `/../` | `/assets/../account/settings` | `/account/settings` | Normalization (resolved) |
| Backslash | `%5c` | `/settings%5cfoo.css` | `/settings/foo.css` | Armor (`text/html` != `text/css`) |
| Multi-slash | `//` | `//settings.css` | `/settings.css` | Armor (`text/html` != `text/css`) |

### Legitimate Requests — All Pass

| Test | Path | Result |
|------|------|--------|
| Clean dynamic path | `/account/settings` | pass (no cacheable extension) |
| Real static asset | `/static/image.jpg` | pass (Content-Type matches `image/*`) |

## Deploying to Production

### As a Cloudflare Worker (recommended)

Add a route binding in `wrangler.jsonc`:

```jsonc
"routes": [
  { "pattern": "example.com/*", "zone_name": "example.com" }
]
```

Then deploy:

```bash
wrangler deploy --env production
```

### As a Cloudflare Snippet

1. Go to **Rules > Snippets** in the Cloudflare dashboard.
2. Adapt the code from `src/index.ts` — replace `env.*` references with hardcoded values (Snippets don't support wrangler vars).
3. Remove debug headers.
4. Set the snippet rule expression to scope which requests it runs on, e.g. `true` for all requests.

### Simpler Alternative (partial protection)

If you only need the case-sensitivity fix, a **Transform Rule** with `lower(http.request.uri.path)` handles it with zero code. But it won't protect against semicolons, encoded characters, path traversal, or other vectors.

## Attack Vector Reference

Based on PortSwigger's "Gotta Cache 'em All" (Black Hat USA 2024) and the `wcDetect` / `CacheDecepHound` tools.

### Delimiter Characters to Test

```
;  :  !  $  &  '  (  )  *  +  ,  |  ~  ^  `  @  %00  %0a  %23  %3b  %3f
```

### Encoding Variants

| Technique | Example | Decodes to |
|-----------|---------|------------|
| Single encoding | `%3b` | `;` |
| Double encoding | `%253b` | `%3b` -> `;` |
| Overlong UTF-8 | `%c0%ae` | `.` (on some Java servers) |
| Fullwidth Unicode | `%ef%bc%8e` | `.` (on some servers) |

### Path Traversal Patterns

```
/static/..%2f<dynamic>              # Encoded slash
/static/%2e%2e/<dynamic>            # Encoded dots
/static/%252e%252e/<dynamic>        # Double-encoded dots
/static/%c0%ae%c0%ae%c0%af<dynamic> # Overlong UTF-8 (Java)
```

### Key References

- [PortSwigger: Gotta Cache 'em All (Black Hat 2024)](https://portswigger.net/research/gotta-cache-em-all)
- [PortSwigger: Web Cache Deception](https://portswigger.net/web-security/web-cache-deception)
- [Cloudflare: Cache Deception Armor](https://developers.cloudflare.com/cache/cache-security/cache-deception-armor/)
- [Cloudflare: URL Normalization](https://developers.cloudflare.com/rules/normalization/how-it-works/)
- [Omer Gil: Web Cache Deception Attack (Black Hat 2017)](https://omergil.blogspot.com/2017/02/web-cache-deception-attack.html)
- [GitHub: c0dejump/wcDetect](https://github.com/c0dejump/wcDetect)
- [GitHub: g4nkd/CacheDecepHound](https://github.com/g4nkd/CacheDecepHound)
