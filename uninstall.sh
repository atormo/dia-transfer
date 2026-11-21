#!/bin/sh
# Removes the helper from every browser and deletes its files.
SUPPORT="$HOME/Library/Application Support"
for data in "$SUPPORT/Dia/User Data" "$SUPPORT/Arc/User Data" "$SUPPORT/Google/Chrome" \
            "$SUPPORT/BraveSoftware/Brave-Browser" "$SUPPORT/Microsoft Edge" "$SUPPORT/Chromium" "$SUPPORT/Vivaldi"; do
  rm -f "$data/NativeMessagingHosts/com.diatransfer.host.json"
done
rm -rf "$SUPPORT/DiaTransfer"
echo "Ayudante desinstalado. Quita también la extensión desde chrome://extensions."
