#!/bin/bash
# VerseDay automatic weekly DB export for Claude Cowork.
#
# Writes a CONSISTENT full snapshot (sqlite3 VACUUM INTO) of the live VerseDay
# database into the Cowork-connected folder, atomically, under a STABLE
# filename so the scheduled Cowork run always reads the exact same path.
#
# Scheduled by the launchd agent ~/Library/LaunchAgents/com.verseday.autoexport.plist
# (Fridays 09:25 — must live in LaunchAgents; it points here). The in-app
# manual "Export database" button is unaffected — it still writes timestamped
# copies to the Desktop.
set -euo pipefail

DB="$HOME/Library/Application Support/com.verseday.app/verseday.db"
OUT_DIR="$HOME/VerseDay/Auto Exports"
DEST="$OUT_DIR/verseday-latest.db"
TMP="$OUT_DIR/.verseday-latest.$$.tmp"

stamp() { date '+%Y-%m-%d %H:%M:%S'; }

mkdir -p "$OUT_DIR"

if [ ! -f "$DB" ]; then
  echo "$(stamp) ERROR: VerseDay DB not found at $DB" >&2
  exit 1
fi

# VACUUM INTO requires the destination not exist; write to a unique temp then
# atomically move it into place so a reader never sees a partial file.
rm -f "$TMP"
/usr/bin/sqlite3 "$DB" "VACUUM INTO '$TMP'"
mv -f "$TMP" "$DEST"

echo "$(stamp) OK: exported $DB -> $DEST ($(du -h "$DEST" | cut -f1))"
