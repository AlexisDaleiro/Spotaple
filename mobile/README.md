# Spotaple para Android

El APK incluye la interfaz de Spotaple adaptada al teléfono y ejecuta el motor de escritorio en el propio dispositivo. La biblioteca, los ajustes, el historial, la cola y las descargas se guardan en Android.

## Instalar el APK

1. En GitHub, abrí la ejecución exitosa de **Actions → APK de prueba de Android** y descargá **Spotaple-Android-preview** desde **Artifacts**.
2. Extraé el ZIP, pasá `Spotaple-Android-preview.apk` al teléfono y abrilo desde la app de archivos. Si Android te pide habilitar la instalación desde esa app, aceptá para seguir.
3. Abrí **Spotaple**, buscá una canción y tocá el botón de reproducción. Probá guardar una favorita, crear una playlist y abrir la cola.

El APK usa el identificador `com.alexis.spotaple.preview` y una firma de prueba. Para Jam por internet, podés unirte con una invitación o guardar la dirección de tu Worker al crear una sala. Las actualizaciones de Android se buscan en GitHub Releases. Para ofrecer una actualización, adjuntá `Spotaple-Android.apk` a un release con el tag `android-vX.Y.Z` y usá el mismo identificador y firma con un `versionCode` mayor.

## Generar otro APK

El flujo se ejecuta al abrir o actualizar un PR con cambios de Android o del motor compartido. También se puede ejecutar desde **Actions → APK de prueba de Android → Run workflow**. Compila el motor y la interfaz, verifica el APK y abre la app en un emulador.

Expo Go abre la pantalla de reproducción local de la primera prueba. Para probar el motor compartido usá el APK generado por Actions.
