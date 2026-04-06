#!/usr/bin/env bash
# Download DB-IP City Lite MMDB (CC-BY license).
# Run monthly via cron; output path default: ./data/geoip/dbip-city.mmdb
set -euo pipefail

OUTPUT_DIR="${GEOIP_DIR:-./data/geoip}"
OUTPUT_FILE="$OUTPUT_DIR/dbip-city.mmdb"
MONTH=$(date -u +%Y-%m)
URL="https://download.db-ip.com/free/dbip-city-lite-${MONTH}.mmdb.gz"

mkdir -p "$OUTPUT_DIR"
echo "Downloading $URL ..."
curl -fsSL "$URL" -o "$OUTPUT_FILE.gz"
gunzip -f "$OUTPUT_FILE.gz"
echo "Saved to $OUTPUT_FILE"
ls -lh "$OUTPUT_FILE"
