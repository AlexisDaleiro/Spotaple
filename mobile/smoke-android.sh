#!/usr/bin/env bash
set -euo pipefail

app=com.alexis.spotaple.preview
diagnostics() {
  adb shell dumpsys media_session || true
  adb shell cat /sdcard/spotaple-view.xml || true
  adb logcat -d -t 1500 | grep -Ei 'Spotaple|AndroidRuntime|linker|chromium' || true
}
trap diagnostics ERR
adb install -r mobile/dist/Spotaple-Android-preview.apk
adb shell am start -W -n "$app/.MainActivity"
wait_for_ui() {
  for _ in {1..20}; do
    if adb shell uiautomator dump /sdcard/spotaple-view.xml >/dev/null 2>&1 &&
      adb shell cat /sdcard/spotaple-view.xml | grep -F "$1" >/dev/null; then return; fi
    sleep 2
  done
  return 1
}
wait_for_ui 'Tu música empieza acá'

# Se prepara una biblioteca sin depender de la red ni del catálogo en el emulador.
fixture=$(mktemp -d)
node mobile/smoke-playback.mjs "$fixture"
adb shell am force-stop "$app"
adb root
adb wait-for-device
test "$(adb shell id -u | tr -d '\r')" = 0
data="/data/user/0/$app/files"
owner=$(adb shell stat -c '%u:%g' "$data/spotaple.db" | tr -d '\r')
label=$(adb shell ls -Z "$data/spotaple.db" | awk '{ print $1 }')
adb shell rm -f "$data/spotaple.db-wal" "$data/spotaple.db-shm"
adb push "$fixture/spotaple.db" "$data/spotaple.db"
for track in smokeTrack1 smokeTrack2; do
  adb push "$fixture/offline/$track.webm" "$data/offline/$track.webm"
done
for file in "$data/spotaple.db" "$data/offline/smokeTrack1.webm" "$data/offline/smokeTrack2.webm"; do
  adb shell chown "$owner" "$file"
  adb shell chcon "$label" "$file"
done
adb shell am start -W -n "$app/.MainActivity"
wait_for_ui 'Spotaple primera prueba'
coords=$(adb shell cat /sdcard/spotaple-view.xml | python3 -c '
import re, sys, xml.etree.ElementTree as ET
matches = []
for node in ET.parse(sys.stdin).iter("node"):
    if "Reproducir" in (node.get("text"), node.get("content-desc")):
        x1, y1, x2, y2 = map(int, re.findall(r"\d+", node.get("bounds")))
        if x2 > x1 and y2 > y1:
            matches.append(((y1 + y2) // 2, (x1 + x2) // 2))
y, x = max(matches)
print(x, y)
')
read -r x y <<< "$coords"
adb shell input tap "$x" "$y"

wait_for_playing() {
  for _ in {1..30}; do
    local state
    state=$(adb shell dumpsys media_session)
    if grep -F "description=$1" <<< "$state" >/dev/null &&
      grep -E "$2" <<< "$state" >/dev/null; then return; fi
    sleep 1
  done
  return 1
}
wait_for_playing 'Spotaple primera prueba' 'state=3, position='
adb shell input keyevent KEYCODE_SLEEP
wait_for_playing 'Spotaple segunda prueba' 'state=3, position=[1-9][0-9]{3,}'
adb shell input keyevent KEYCODE_WAKEUP
echo 'Spotaple avanzó a la segunda canción y siguió reproduciendo con la pantalla apagada.'
