#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

output="$(mktemp -d "${TMPDIR:-/tmp}/seekdesk-tests.XXXXXX")"
trap 'rm -rf "$output"' EXIT

mkdir -p .build/module-cache
swiftc -module-cache-path "$PWD/.build/module-cache" \
    Sources/SeekDesk/{Forum,ForumFeed,ForumThread,ForumReaction,ForumAccountData,NodeImageUpload,DeskIcon,MarkdownEdit,MarkdownPreviewDocument,ForumStickers,NewDiscussion,Workspace,DeskExtensions,KeywordNotification,RulingClient,RemainingValue,ExchangeRates,ForumReportSizing}.swift \
    Tests/Session/{main,WorkspaceChecks,ForumReplyChecks,AccountAndEditorChecks,RemainingValueChecks,DiscussionChecks,ReportSizingChecks}.swift \
    -o "$output/SeekDeskTests"
"$output/SeekDeskTests"
