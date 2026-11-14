# Spotaple para Android

El APK incluye la interfaz de Spotaple adaptada al teléfono y ejecuta el motor de escritorio en el propio dispositivo. La biblioteca, los ajustes, el historial, la cola y las descargas se guardan en Android.

## Instalar el APK

1. En GitHub, abrí la ejecución exitosa de **Actions → APK de prueba de Android** y descargá **Spotaple-Android-preview** desde **Artifacts**.
2. Extraé el ZIP, pasá `Spotaple-Android-preview.apk` al teléfono y abrilo desde la app de archivos. Si Android te pide habilitar la instalación desde esa app, aceptá para seguir.
3. Abrí **Spotaple**, buscá una canción y tocá el botón de reproducción. Probá guardar una favorita, crear una playlist y abrir la cola.

El APK usa el identificador `com.alexis.spotaple.preview` y una firma de prueba. Para Jam por internet, podés unirte con una invitación, configurar un relé con tu cuenta de Cloudflare o guardar la dirección de un relé existente. En **Biblioteca → Abrir audio del teléfono** también podés reproducir archivos locales. Las actualizaciones de Android se buscan en GitHub Releases. Para ofrecer una actualización, adjuntá `Spotaple-Android.apk` a un release con el tag `android-vX.Y.Z` y usá el mismo identificador y firma con un `versionCode` mayor.

Al publicar el release de Android, dejá desactivada la opción **Set as the latest release** para que GitHub conserve la última versión de Windows como principal.

## Generar otro APK

El flujo se ejecuta al abrir o actualizar un PR con cambios de Android o del motor compartido. También se puede ejecutar desde **Actions → APK de prueba de Android → Run workflow**. Compila el motor y la interfaz, verifica el APK y abre la app en un emulador.

Expo Go abre la pantalla de reproducción local de la primera prueba. Para probar el motor compartido usá el APK generado por Actions.

## APK firmado de producción

Es la versión para distribuir. Usa el identificador `com.alexis.spotaple` y una clave propia, así que Android la instala como una app aparte: el APK de prueba (`.preview`) no se actualiza a ella. Se actualiza sola desde GitHub Releases con los tags `android-stable-vX.Y.Z`; el APK de prueba sigue usando `android-vX.Y.Z`.

1. Subí `version` y `versionCode` en `mobile/app.json`, y `version` en `mobile/package.json`, y llevá los cambios a `main`.
2. En GitHub, abrí **Actions → APK firmado de Android → Run workflow** y seleccioná `main`. El flujo compila, firma, comprueba que la firma sea la de Spotaple y crea el borrador `android-stable-vX.Y.Z` en **Releases** con `Spotaple-Android.apk`.
3. Revisá el borrador, descargá el APK para probarlo y tocá **Publish release** con **Set as the latest release** desactivado. Desde ese momento las instalaciones de producción con una versión menor lo ofrecen en **Ajustes → Acerca de**.

La firma usa los secretos `SPOTAPLE_ANDROID_KEYSTORE_BASE64` y `SPOTAPLE_ANDROID_KEYSTORE_PASSWORD`, y la variable `SPOTAPLE_ANDROID_CERT_SHA256` (huella SHA-256 del certificado). La clave original está en `mobile/dist/signing/`, fuera de git. GitHub no permite volver a leer los secretos: guardá una copia de `spotaple.p12` y su contraseña en un lugar seguro, porque sin esa clave no se puede publicar ninguna actualización de esta app.
