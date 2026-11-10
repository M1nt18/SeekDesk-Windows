#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

output="$(mktemp -d "${TMPDIR:-/tmp}/seekdesk-regressions.XXXXXX")"
trap 'rm -rf "$output"' EXIT
mkdir -p .build/module-cache
sources=()
for source in Sources/SeekDesk/*.swift; do
    case "${source##*/}" in
        SeekDeskApp.swift|WorkspaceView.swift|PreferencesPane.swift|WorkspaceSearchField.swift) ;;
        *) sources+=("$source") ;;
    esac
done
swiftc -parse-as-library -module-cache-path "$PWD/.build/module-cache" \
    "${sources[@]}" Tests/Regression/FixesChecks.swift -o "$output/SeekDeskRegressions"
"$output/SeekDeskRegressions"
