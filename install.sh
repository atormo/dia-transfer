#!/bin/sh
# Dia Transfer: installs the small local helper (native messaging host)
# for every Chromium browser it finds on this Mac. Nothing is installed system-wide.
set -e

HOST_NAME="com.diatransfer.host"
EXT_ID="igninmfomapgemelieneadccdejgifkl"
HERE="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$HOME/Library/Application Support/DiaTransfer"
SUPPORT="$HOME/Library/Application Support"

if [ "$(uname)" != "Darwin" ]; then
  echo "Por ahora Dia Transfer solo funciona en macOS." >&2; exit 1
fi

PY="$(command -v python3 || true)"
if [ -z "$PY" ] || ! "$PY" -c 'import json' >/dev/null 2>&1; then
  echo "Necesitas Python 3. Instálalo con:  xcode-select --install" >&2; exit 1
fi

mkdir -p "$APP_DIR"
cp "$HERE/host/host.py" "$APP_DIR/host.py"
# Keep a copy of the extension in a fixed place, so the downloaded folder can be deleted.
rm -rf "$APP_DIR/extension" && cp -R "$HERE/extension" "$APP_DIR/extension"
chmod 755 "$APP_DIR/host.py"

found=0
install_for() { # $1 = name, $2 = "User Data" folder
  name="$1"; data="$2"
  [ -f "$data/Local State" ] || return 0
  slug="$(echo "$name" | tr 'A-Z ' 'a-z-')"
  runner="$APP_DIR/run-$slug.sh"
  printf '#!/bin/sh\nexec "%s" "%s" "%s" "$@"\n' "$PY" "$APP_DIR/host.py" "$data" > "$runner"
  chmod 755 "$runner"
  mkdir -p "$data/NativeMessagingHosts"
  cat > "$data/NativeMessagingHosts/$HOST_NAME.json" <<JSON
{
  "name": "$HOST_NAME",
  "description": "Dia Transfer helper (reads other profiles, read-only)",
  "path": "$runner",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
JSON
  echo "  ✓ $name"
  found=$((found + 1))
}

echo "Instalando el ayudante para:"
install_for "Dia"      "$SUPPORT/Dia/User Data"
install_for "Arc"      "$SUPPORT/Arc/User Data"
install_for "Chrome"   "$SUPPORT/Google/Chrome"
install_for "Brave"    "$SUPPORT/BraveSoftware/Brave-Browser"
install_for "Edge"     "$SUPPORT/Microsoft Edge"
install_for "Chromium" "$SUPPORT/Chromium"
install_for "Vivaldi"  "$SUPPORT/Vivaldi"

if [ "$found" -eq 0 ]; then
  echo "No he encontrado ningún navegador compatible." >&2; exit 1
fi

cat <<MSG

Listo. Ahora carga la extensión en el perfil DESTINO (solo una vez):
  1. Abre  chrome://extensions  en ese perfil
  2. Activa "Modo de desarrollador" (arriba a la derecha)
  3. Pulsa "Cargar descomprimida" y elige esta carpeta:
     $APP_DIR/extension
  4. Haz clic en el icono de Dia Transfer en la barra.

MSG
