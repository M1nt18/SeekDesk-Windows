#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

source_app="$PWD/dist/SeekDesk.app"
installed_app="/Applications/SeekDesk.app"
bundle_id="com.seekdesk.client"

read_info() {
    /usr/bin/plutil -extract "$2" raw "$1/Contents/Info.plist"
}

if [[ "$(read_info "$source_app" CFBundleIdentifier)" != "$bundle_id" ]]; then
    echo "Build SeekDesk before installing it." >&2
    exit 1
fi
/usr/bin/codesign --verify --deep --strict "$source_app"
new_build="$(read_info "$source_app" CFBundleVersion)"
[[ "$new_build" =~ ^[1-9][0-9]*$ ]] || { echo "Invalid SeekDesk build number." >&2; exit 1; }

if [[ -e "$installed_app" || -L "$installed_app" ]]; then
    if [[ -L "$installed_app" || "$(read_info "$installed_app" CFBundleIdentifier)" != "$bundle_id" ]]; then
        echo "Refusing to replace an unrelated application at $installed_app." >&2
        exit 1
    fi
    old_build="$(read_info "$installed_app" CFBundleVersion)"
    if [[ "$old_build" =~ ^[1-9][0-9]*$ ]] && (( old_build > new_build )); then
        echo "The installed SeekDesk build is newer than the build in dist." >&2
        exit 1
    fi
fi

process_status=0
/usr/bin/pgrep -x SeekDesk >/dev/null || process_status=$?
case "$process_status" in
    0) echo "Quit SeekDesk before replacing it." >&2; exit 1 ;;
    1) ;;
    *) echo "Could not verify that SeekDesk has quit." >&2; exit 1 ;;
esac

stage="$(/usr/bin/mktemp -d /Applications/.seekdesk-install.XXXXXX)"
previous="$stage/previous.app"
rollback() {
    local result=$?
    if [[ -d "$previous" ]]; then
        if [[ -e "$installed_app" ]]; then /bin/mv "$installed_app" "$stage/failed.app" || return "$result"; fi
        /bin/mv "$previous" "$installed_app" || return "$result"
    fi
    /bin/rm -rf -- "$stage"
    return "$result"
}
trap rollback EXIT

/usr/bin/ditto "$source_app" "$stage/SeekDesk.app"
/usr/bin/codesign --verify --deep --strict "$stage/SeekDesk.app"
if [[ -d "$installed_app" ]]; then /bin/mv "$installed_app" "$previous"; fi
/bin/mv "$stage/SeekDesk.app" "$installed_app"
trap - EXIT
/bin/rm -rf -- "$stage"
printf 'Installed SeekDesk %s (build %s) at %s\n' "$(read_info "$installed_app" CFBundleShortVersionString)" "$new_build" "$installed_app"
