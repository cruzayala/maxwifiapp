#!/usr/bin/env bash
# Sube al volumen de Railway (/data/agent-downloads) los instaladores que nombran los
# manifiestos de agent-downloads/: la APK de Android y el ONU Studio de Windows.
#
# Por que existe: los instaladores pesan ~160 MB y viajaban en cada "railway up" por una
# subida lenta. Ahora .railwayignore los deja fuera y el servidor los lee del volumen
# (installerFile en server.js). Este script solo sube lo que cambio y verifica el SHA-256
# en el servidor antes de dejarlo visible.
#
# Uso: bash scripts/publish-installers.sh   (despues de scripts/build-android-private.ps1
#      o de copiar un ONU Studio nuevo y su manifest.json a agent-downloads/)
set -euo pipefail
cd "$(dirname "$0")/.."

SERVICE="ISP max"
ENVIRONMENT="production"
REMOTE_DIR="/data/agent-downloads"

remote() {
  railway ssh --service "$SERVICE" --environment "$ENVIRONMENT" -- sh -c "$1" 2>&1 \
    | grep -v "Config as Code\|Migrate\|keep working\|Using SSH key" || true
}

manifest_file() {
  node -e "const m = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8').replace(/^﻿/, '')); process.stdout.write(String(m.fileName || ''))" "$1"
}

for manifest in agent-downloads/manifest.json agent-downloads/android-manifest.json; do
  file=$(manifest_file "$manifest")
  case "$file" in
    ""|*/*|*..*) echo "Manifiesto $manifest sin fileName valido"; exit 1 ;;
  esac
  local_path="agent-downloads/$file"
  [ -f "$local_path" ] || { echo "Falta $local_path (lo nombra $manifest)"; exit 1; }
  sha=$(sha256sum "$local_path" | cut -d' ' -f1)

  current=$(remote "sha256sum '$REMOTE_DIR/$file' 2>/dev/null | cut -d' ' -f1" | tail -1)
  if [ "$current" = "$sha" ]; then
    echo "$file ya esta en el volumen"
    continue
  fi

  echo "Subiendo $file ($(du -h "$local_path" | cut -f1))..."
  railway ssh --service "$SERVICE" --environment "$ENVIRONMENT" -- \
    sh -c "mkdir -p '$REMOTE_DIR' && cat > '$REMOTE_DIR/$file.part'" < "$local_path" 2>&1 \
    | grep -v "Config as Code\|Migrate\|keep working\|Using SSH key" || true

  uploaded=$(remote "sha256sum '$REMOTE_DIR/$file.part' 2>/dev/null | cut -d' ' -f1" | tail -1)
  if [ "$uploaded" != "$sha" ]; then
    remote "rm -f '$REMOTE_DIR/$file.part'" >/dev/null
    echo "La copia de $file en el servidor no coincide (esperado $sha, llego ${uploaded:-nada}). Reintenta."
    exit 1
  fi
  remote "mv '$REMOTE_DIR/$file.part' '$REMOTE_DIR/$file'" >/dev/null
  echo "$file publicado ($sha)"
done
remote "ls -l '$REMOTE_DIR'"
