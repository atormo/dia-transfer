#!/bin/sh
# Doble clic para instalar. Prepara todo y te deja la carpeta lista para arrastrar.
cd "$(dirname "$0")" || exit 1
./install.sh || { echo; read -r -p "Pulsa Enter para cerrar" _; exit 1; }
EXT="$HOME/Library/Application Support/DiaTransfer/extension"
printf '%s' "$EXT" | pbcopy
open -R "$EXT"
cat <<MSG
──────────────────────────────────────────────
 Último paso (solo una vez, en el perfil destino):

 1. En Dia escribe en la barra:  chrome://extensions
 2. Activa "Modo de desarrollador" (arriba a la derecha)
 3. Pulsa "Cargar descomprimida", luego Cmd+Shift+G,
    pega (Cmd+V) y pulsa Abrir.
    (La ruta ya está copiada y la carpeta abierta en el Finder.)

 Después solo pulsa el icono de Dia Transfer 🔁 en la barra.
──────────────────────────────────────────────
MSG
read -r -p "Pulsa Enter para cerrar" _
