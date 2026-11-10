#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

mode="${1:-preview}"
version="${SEEKDESK_VERSION:-$(cat VERSION)}"
build="${SEEKDESK_BUILD:-$(cat BUILD_NUMBER)}"
output="$PWD/dist"
app="$output/SeekDesk.app"

case "$mode" in
    preview|unsigned|release) ;;
    *) echo "Usage: $0 [preview|unsigned|release]" >&2; exit 2 ;;
esac
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && "$build" =~ ^[1-9][0-9]*$ ]] || {
    echo "Set a three-part SEEKDESK_VERSION and a positive SEEKDESK_BUILD." >&2
    exit 2
}
if [[ "$mode" == release ]]; then
    : "${SEEKDESK_SIGN_IDENTITY:?Set your Developer ID Application identity}"
    : "${SEEKDESK_NOTARY_PROFILE:?Set your notarytool keychain profile}"
    [[ "$SEEKDESK_SIGN_IDENTITY" == "Developer ID Application:"* ]] || {
        echo "Release requires a Developer ID Application identity." >&2
        exit 2
    }
fi
if [[ -n "${SEEKDESK_FEED_URL:-}${SEEKDESK_UPDATE_PUBLIC_KEY:-}" ]]; then
    [[ "$mode" == release && "${SEEKDESK_FEED_URL:-}" == https://* ]] || {
        echo "Sparkle updates require a notarized release and HTTPS feed." >&2; exit 2;
    }
    : "${SEEKDESK_UPDATE_PUBLIC_KEY:?Set the Sparkle EdDSA public key}"
    [[ "$(printf '%s' "$SEEKDESK_UPDATE_PUBLIC_KEY" | /usr/bin/base64 -D | wc -c | tr -d ' ')" == 32 ]] || {
        echo "The Sparkle public key must decode to 32 bytes." >&2
        exit 2
    }
fi

mkdir -p .build/module-cache "$output"
export CLANG_MODULE_CACHE_PATH="$PWD/.build/module-cache"
export SWIFTPM_MODULECACHE_OVERRIDE="$CLANG_MODULE_CACHE_PATH"
args=(--arch arm64 -c release -Xswiftc -module-cache-path -Xswiftc "$CLANG_MODULE_CACHE_PATH")
if [[ "${SEEKDESK_SWIFTPM_DISABLE_SANDBOX:-0}" == 1 ]]; then args+=(--disable-sandbox); fi
if [[ -n "${SEEKDESK_BUILD_SYSTEM:-}" ]]; then args+=(--build-system "$SEEKDESK_BUILD_SYSTEM"); fi
swift build "${args[@]}"
bin_dir="$(swift build "${args[@]}" --show-bin-path)"
if [[ -n "${SEEKDESK_SPARKLE_XCFRAMEWORK:-}" ]]; then
    sparkle="$SEEKDESK_SPARKLE_XCFRAMEWORK"
else
    sparkle="$(find .build/artifacts -type d -name Sparkle.xcframework -print -quit)"
fi
framework="$sparkle/macos-arm64_x86_64/Sparkle.framework"
[[ -d "$framework" ]] || { echo "Sparkle framework not found." >&2; exit 1; }

stage="$(mktemp -d "$output/.build.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
staged_app="$stage/SeekDesk.app"
plist="$staged_app/Contents/Info.plist"
mkdir -p "$staged_app/Contents/"{MacOS,Frameworks,Resources}
cp "$bin_dir/SeekDesk" "$staged_app/Contents/MacOS/SeekDesk"
ditto "$framework" "$staged_app/Contents/Frameworks/Sparkle.framework"
cp Distribution/Info.plist "$plist"
cp LICENSE Distribution/Sparkle-LICENSE.txt "$staged_app/Contents/Resources/"
ditto Distribution/Icons "$staged_app/Contents/Resources/Icons"
ditto Distribution/DockIcons "$staged_app/Contents/Resources/DockIcons"
partner_resources="$staged_app/Contents/Resources/Partners"
mkdir -p "$partner_resources"
for logo in Distribution/Partners/*.png; do
    sips -Z 144 "$logo" --out "$partner_resources/${logo##*/}" >/dev/null
done
plutil -replace CFBundleShortVersionString -string "$version" "$plist"
plutil -replace CFBundleVersion -string "$build" "$plist"

if [[ -f Distribution/AppIcon.png ]]; then
    iconset="$stage/AppIcon.iconset"
    mkdir "$iconset"
    for side in 16 32 128 256 512; do
        sips -z "$side" "$side" Distribution/AppIcon.png --out "$iconset/icon_${side}x${side}.png" >/dev/null
        sips -z "$((side * 2))" "$((side * 2))" Distribution/AppIcon.png --out "$iconset/icon_${side}x${side}@2x.png" >/dev/null
    done
    iconutil -c icns "$iconset" -o "$staged_app/Contents/Resources/AppIcon.icns"
    plutil -insert CFBundleIconFile -string AppIcon "$plist"
fi

for wordmark in Distribution/Wordmark*.png Distribution/Logos/*.png; do
    if [[ -f "$wordmark" ]]; then
        sips -Z 600 "$wordmark" --out "$staged_app/Contents/Resources/${wordmark##*/}" >/dev/null
    fi
done

if [[ -n "${SEEKDESK_FEED_URL:-}" ]]; then
    plutil -insert SUFeedURL -string "$SEEKDESK_FEED_URL" "$plist"
    plutil -insert SUPublicEDKey -string "$SEEKDESK_UPDATE_PUBLIC_KEY" "$plist"
    plutil -insert SUVerifyUpdateBeforeExtraction -bool true "$plist"
    plutil -insert SURequireSignedFeed -bool true "$plist"
    plutil -insert SUSignedFeedFailureExpirationInterval -integer 0 "$plist"
    plutil -insert SUAllowsAutomaticUpdates -bool false "$plist"
fi

if [[ "$mode" == release ]]; then
    sign() {
        codesign --force --options runtime --timestamp --sign "$SEEKDESK_SIGN_IDENTITY" "$1"
    }
    embedded="$staged_app/Contents/Frameworks/Sparkle.framework"
    resources="$embedded/Versions/Current"
    sign "$resources/Autoupdate"
    sign "$resources/Updater.app"
    sign "$resources/XPCServices/Downloader.xpc"
    sign "$resources/XPCServices/Installer.xpc"
    sign "$embedded"
    sign "$staged_app"
else
    codesign --force --deep --sign - "$staged_app"
fi
codesign --verify --deep --strict "$staged_app"

volume="$stage/volume"
mkdir "$volume"
ditto "$staged_app" "$volume/SeekDesk.app"
ln -s /Applications "$volume/Applications"
suffix=""
if [[ "$mode" == preview ]]; then suffix="-preview"; fi
if [[ "$mode" == unsigned ]]; then suffix="-unsigned"; fi
dmg="$output/SeekDesk-${version}-macOS-arm64${suffix}.dmg"
staged_dmg="$stage/$(basename "$dmg")"
hdiutil create -fs HFS+ -volname SeekDesk -srcfolder "$volume" -format UDZO "$staged_dmg"
if [[ "$mode" == release ]]; then
    codesign --force --timestamp --sign "$SEEKDESK_SIGN_IDENTITY" "$staged_dmg"
    xcrun notarytool submit "$staged_dmg" --keychain-profile "$SEEKDESK_NOTARY_PROFILE" --wait
    xcrun stapler staple "$staged_dmg"
    xcrun stapler validate "$staged_dmg"
    spctl --assess --type open --context context:primary-signature "$staged_dmg"
fi
hdiutil verify "$staged_dmg"
# Keep the previous delivery until the complete new app and DMG are verified.
rm -rf "$app"
mv "$staged_app" "$app"
mv -f "$staged_dmg" "$dmg"
(
    cd "$output"
    shasum -a 256 "$(basename "$dmg")" > "$(basename "$dmg").sha256"
)
printf 'Installer: %s\n' "$dmg"
