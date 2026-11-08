#!/usr/bin/env bash
set -euo pipefail

app=com.alexis.spotaple.preview
adb install -r mobile/dist/Spotaple-Android-preview.apk
adb shell am start -W -n "$app/.MainActivity"
for _ in {1..20}; do
  if adb shell uiautomator dump /sdcard/spotaple-view.xml >/dev/null 2>&1 &&
    adb shell cat /sdcard/spotaple-view.xml | grep -F 'Tu música empieza acá' >/dev/null; then
    echo 'Spotaple abrió la pantalla de inicio desde el APK.'
    exit 0
  fi
  sleep 2
done

adb shell cat /sdcard/spotaple-view.xml || true
adb logcat -d -t 1500 | grep -Ei 'Spotaple|AndroidRuntime|linker|chromium' || true
exit 1
