# Relé del modo Jam

Servidor que usa el modo **Internet** del Jam: las apps se conectan por WebSocket a `/<CODIGO>` y el relé reenvía los mensajes de la sala. Corre el mismo motor de sala que la app usa en red local (`src/shared/jam/`). **Nunca pasa audio**: solo código de sala, nombres e ids de canción.

Está hecho como un Worker de Cloudflare con un Durable Object por sala (`src/worker.ts`). Usa WebSockets normales, sin hibernación: el estado de cada sala vive en memoria, así que si Cloudflare evacúa el objeto la sala termina. Alcanza para una oficina; si hiciera falta más, el siguiente paso sería hibernación con el estado guardado en `storage`.

## Probarlo en tu PC (sin cuenta)

```bash
cd relay
npm install
npm run dev          # wrangler dev en http://127.0.0.1:8787
```

En otra terminal, desde la raíz del proyecto:

```bash
npm run check:jam -- url ws://127.0.0.1:8787/AAAAA
JAM_KIND=internet SPOTAPLE_JAM_RELAY=ws://127.0.0.1:8787 npm run e2e:jam
```

## Desplegarlo en Cloudflare

Hace falta una cuenta de Cloudflare (el plan gratuito alcanza; revisá los límites vigentes de Durable Objects antes de desplegar).

```bash
cd relay
npm install
npx wrangler login     # abre el navegador para iniciar sesión
npm run deploy
```

El comando imprime una URL como `https://spotaple-jam.<tu-subdominio>.workers.dev`. La app usa la misma dirección con `wss://`:

1. Poné `wss://spotaple-jam.<tu-subdominio>.workers.dev` en `JAM_RELAY_URL` de `src/shared/jam/config.ts` y volvé a compilar (`npm run build` o `npm run dist`).
2. Comprobá la conexión: `npm run check:jam -- url wss://spotaple-jam.<tu-subdominio>.workers.dev/AAAAA` debe responder `OK  ping→pong`.
3. Prueba completa: `JAM_KIND=internet SPOTAPLE_JAM_RELAY=wss://spotaple-jam.<tu-subdominio>.workers.dev npm run e2e:jam`.

Para apuntar la app a otro relé sin recompilar, definí la variable de entorno `SPOTAPLE_JAM_RELAY` al abrirla.

## Alternativa sin Cloudflare

El mismo servidor corre como script de Node en cualquier equipo con salida a internet:

```bash
npm run relay:node -- 8787      # desde la raíz del proyecto
```

Las apps se conectan con `SPOTAPLE_JAM_RELAY=ws://<ese-equipo>:8787`. Sirve para pruebas y para quien prefiera auto-hospedarlo; para uso real por internet conviene ponerle `wss://` detrás de un proxy inverso.

## Qué tener presente

- Cualquiera que tenga el código entra a la sala (no hay contraseña ni expulsión en esta versión). Los códigos son de 5 caracteres y las salas se borran tras 6 h sin actividad.
- Si el relé se cae, el modo Internet no funciona; el modo Red local sigue andando.
