# Spotaple para Android

La primera versión de prueba reproduce archivos de audio del teléfono. Podés abrir un archivo, pausarlo, reanudarlo y ver el progreso.

## Instalar el APK

1. En GitHub, abrí la ejecución exitosa de **Actions → APK de prueba de Android** y descargá **Spotaple-Android-preview** desde **Artifacts**.
2. Extraé el ZIP, pasá `Spotaple-Android-preview.apk` al teléfono y abrilo desde la app de archivos. Si Android te pide habilitar la instalación desde esa app, aceptá para seguir.
3. Abrí **Spotaple**, tocá **Elegir audio**, seleccioná un MP3 y tocá **Reproducir**.

El APK incluye el código de la app y se puede usar sin Expo Go ni una computadora conectada. Usa el identificador `com.alexis.spotaple.preview` y una firma de prueba. El catálogo, Jam y la reproducción en segundo plano quedan pendientes.

## Generar otro APK

El flujo se ejecuta al abrir o actualizar un PR con cambios de Android. Una vez integrado el flujo en la rama principal, también se puede ejecutar desde **Actions → APK de prueba de Android → Run workflow**.
