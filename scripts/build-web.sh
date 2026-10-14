#!/usr/bin/env bash
# Собирает папку www/ для Android-приложения из файлов веб-версии.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf www
mkdir -p www
cp index.html styles.css app.js config.js districts.js i18n.js sw.js manifest.webmanifest \
   icon.svg icon-192.png icon-512.png www/
echo "www/ готова: $(ls www | wc -l) файлов"
