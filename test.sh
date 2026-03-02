#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://127.0.0.1:8795}"

run_test() {
  local label="$1"
  local path="$2"
  echo "=== $label ==="
  echo "    Path: $path"
  local result
  result=$(curl -sI "${BASE}${path}" 2>&1)
  echo "    Cleaned:  $(echo "$result" | grep -i 'x-cleaned-path' | tr -d '\r')"
  echo "    Original: $(echo "$result" | grep -i 'x-original-path' | tr -d '\r')"
  echo "    Armor:    $(echo "$result" | grep -i 'x-cache-deception-armor' | tr -d '\r')"
  echo "    Status:   $(echo "$result" | head -1 | tr -d '\r')"
  echo ""
}

echo "────────────── DELIMITER ATTACKS ──────────────"
run_test "Semicolon + uppercase ext" '/account/settings;foo.CSS'
run_test "Semicolon + lowercase ext" '/account/settings;foo.css'
run_test "Multiple semicolons"       '/account/settings;a=b;c=d.js'

echo "────────────── CASE SENSITIVITY ──────────────"
run_test "Uppercase .CSS"  '/account/settings.CSS'
run_test "Mixed case .JpG" '/account/settings.JpG'

echo "────────────── ENCODED ATTACKS ──────────────"
run_test "Encoded semicolon %3b" '/account/settings%3bfoo.css'
run_test "Encoded hash %23"      '/account/settings%23foo.css'
run_test "Null byte %00"         '/account/settings%00foo.js'

echo "────────────── DOUBLE ENCODING ──────────────"
run_test "Double-encoded slash %252f"     '/account/settings%252ffoo.css'
run_test "Double-encoded semicolon %253b" '/account/settings%253bfoo.css'
run_test "Double-encoded dots %252e%252e" '/static/%252e%252e/account/settings'

echo "────────────── PATH TRAVERSAL ──────────────"
run_test "Encoded traversal ..%2f"    '/static/..%2faccount/settings'
run_test "Dot segment /../"           '/assets/../account/settings'

echo "────────────── BACKSLASH / MULTI-SLASH ──────────────"
run_test "Backslash"    '/account/settings%5cfoo.css'
run_test "Double slash" '/account//settings.css'

echo "────────────── NORMAL REQUESTS (should pass) ──────────────"
run_test "Clean dynamic path" '/account/settings'
run_test "Real static asset"  '/static/image.jpg'
