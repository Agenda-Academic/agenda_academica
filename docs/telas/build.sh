#!/usr/bin/env bash
# Junta as partes de src/ no protótipo final (um único arquivo HTML).
set -euo pipefail
cd "$(dirname "$0")"
cat src/*.html > agenda-academica-telas.html
echo "ok: agenda-academica-telas.html ($(wc -c < agenda-academica-telas.html) bytes)"
