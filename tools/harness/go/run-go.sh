#!/bin/sh
# Smoke-test a plugin folder with the REAL MyGo Music plugin loader (0.1.22,
# MIT source) without touching the checkout: copy the source tree to a temp
# dir, inject tools/harness/go/harness_test.go.tmpl, run TestHarnessPlugin.
#
# Usage: tools/harness/go/run-go.sh [plugin-dir]   (default: the repo root)
#        MYGO_SRC=/path/to/mygo-music tools/harness/go/run-go.sh .
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
PLUGIN=${1:-"$HERE/../../.."}
MYGO_SRC=${MYGO_SRC:-/tmp/qsresearch/mygo-music}

if [ ! -f "$MYGO_SRC/go.mod" ] || [ ! -d "$MYGO_SRC/internal/plugin" ]; then
  echo "run-go.sh: MYGO_SRC=$MYGO_SRC does not look like the mygo-music source tree" >&2
  echo "            pass MYGO_SRC=/path/to/mygo-music" >&2
  exit 2
fi
if [ ! -f "$PLUGIN/plugin.json" ]; then
  echo "run-go.sh: $PLUGIN/plugin.json not found" >&2
  exit 2
fi
command -v go >/dev/null 2>&1 || { echo "run-go.sh: go is not installed" >&2; exit 2; }

PLUGIN_ABS=$(cd "$PLUGIN" && pwd)
TMP=$(mktemp -d "${TMPDIR:-/tmp}/mygo-harness.XXXXXX")
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT INT TERM

echo "run-go.sh: copying $MYGO_SRC -> $TMP/mygo"
cp -R "$MYGO_SRC" "$TMP/mygo"
cp "$HERE/harness_test.go.tmpl" "$TMP/mygo/internal/plugin/harness_test.go"

echo "run-go.sh: plugin=$PLUGIN_ABS"
cd "$TMP/mygo"
HARNESS_PLUGIN="$PLUGIN_ABS" go test ./internal/plugin -run '^TestHarnessPlugin$' -v -count=1
