# Modo Jam — diseño

Fecha: 2026-11-05 · Estado: borrador para aprobación · Proyecto: Spotaple (Electron + React + zustand, audio por YouTube.js)

## 1. Intención

En la oficina hay una persona que pone la música y el resto le va pidiendo temas; esa persona tiene que frenar lo que hace y escribir cada pedido a mano para buscarlo. El modo Jam elimina ese paso: cada uno, desde su propia PC, agrega canciones a una cola compartida y la música suena donde el admin decida. Además el grupo puede opinar (votar para saltar, aplaudir una elección) sin interrumpir a nadie.

Éxito: Mara agrega un tema desde su PC, aparece en la cola de todos en menos de 2 segundos y, cuando le toca, suena en el lugar elegido sin que el admin toque nada.

## 2. Objetivos, no objetivos y anti-objetivos

**Objetivos**
- Sala con un admin y varios miembros, sin cuentas ni registro.
- Una cola compartida a la que cualquiera agrega canciones.
- Dos modos de reproducción que el admin cambia con un switch: **Solo admin** (suena solo en su PC) y **Todas** (suena sincronizado en la PC de cada miembro).
- Votar para saltar la canción actual; dar like a una canción como señal de "buena elección".
- Dos formas de conectarse, a elección del admin: **Red local** (sin servidor externo) o **Internet** (a través de un relé).
- Funcionar en una oficina real: varios equipos Windows, posible proxy, posible aislamiento entre equipos.

**No objetivos (versión 1)**
- Cuentas, amigos, historial de salas, rankings o estadísticas.
- Chat.
- Expulsar miembros, bloquear la sala o ponerle contraseña (ver riesgos).
- Límite de canciones por persona.
- Descubrimiento automático de salas en la red local (UDP/mDNS).
- Audio viajando entre PCs: nunca. Cada PC baja su propio audio de YouTube; entre PCs solo viajan mensajes de control.
- Otros proveedores de música: igual que hoy, solo YouTube.

**Anti-objetivos (fallo aunque técnicamente funcione)**
- Que el jam degrade el uso personal: la cola personal, los favoritos y las playlists no se tocan, y al salir de la sala todo queda como estaba.
- Que en modo Todas las PCs suenen desfasadas de forma audible y sostenida (más de ~1 s), como un eco entre escritorios.
- Que un miembro con mala conexión, o una canción no disponible para él, frene a todo el grupo.
- Que una micro-desconexión haga perder la cola.

## 3. Comportamiento

### 3.1 Identidad
- No hay cuentas. La primera vez que alguien usa el jam se le pide un nombre visible (máximo 24 caracteres, editable) y la app genera un `memberId` aleatorio (UUID). Ambos se guardan en la tabla `settings` local y se recuerdan.
- El `memberId` permite reconectar: quien se cae y vuelve recupera su rol, sus votos y sus likes.
- No hay autenticación: se confía en el grupo.

### 3.2 Salas y conexión
- **Crear:** el admin elige Red local o Internet y recibe una invitación.
- **Invitación:** en Internet es un código de 5 caracteres (alfabeto de 31 símbolos sin ambiguos, por ejemplo `K7M2P`). En Red local es `ip:puerto/CODIGO` (por ejemplo `192.168.1.20:47800/K7M2P`). El campo "Unirse" acepta ambos formatos pegados. El admin tiene un botón "Copiar invitación".
- **Unirse:** pegar la invitación y confirmar el nombre.
- **Topes:** 30 miembros y 200 ítems en cola.
- **Admin:** quien crea la sala. Si se desconecta, se espera 60 s (reconectar con el mismo `memberId` recupera el rol). Pasado ese tiempo: en Internet pasa a admin el miembro conectado más antiguo; en Red local la sala termina, porque el servidor vive en la PC del admin, y los miembros ven "La sala terminó".
- Cualquier miembro puede salir. El admin puede cerrar la sala.
- **Versiones:** si la app de un miembro habla un protocolo distinto al de la sala, recibe "Actualizá Spotaple para unirte" (en una oficina puede haber versiones distintas instaladas).

### 3.3 Cola
- Ítem: `{ itemId, track, addedBy, addedAt }`. `track` es el `Track` que ya usa la app (videoId, título, artistas, portada, duración).
- Orden de llegada; agregar siempre va al final.
- El admin puede reordenar, quitar cualquier ítem, "reproducir ahora" y "reproducir a continuación".
- Cada miembro puede quitar los ítems que agregó mientras no sean el que está sonando.
- No se aceptan duplicados exactos (mismo videoId ya en la cola o sonando): se avisa al que lo intentó, "Ya está en la cola".
- Cada ítem muestra quién lo pidió.

### 3.4 Reproducción
- La sala guarda `now`: el ítem actual, su estado (cargando, sonando, pausado) y un ancla de reloj (ver 4.5).
- El reproductor del admin es la referencia ("maestro de reloj"). Pausar, mover la posición y pasar a la siguiente: solo el admin.
- Al terminar una canción, el reproductor del admin informa `ended` y la sala pasa al primer ítem de la cola. Con la cola vacía queda ociosa; cuando llega un ítem a una sala ociosa, arranca sola.
- Si el admin no puede reproducir un ítem (no disponible, región), informa `unavailable` y la sala salta al siguiente. Tras 3 fallos seguidos se detiene y avisa (mismo tope que `MAX_AUTO_SKIPS` del reproductor personal).
- Repetir y aleatorio personales no aplican dentro de la sala.

### 3.5 Modos (switch del admin)
- **Solo admin:** suena únicamente en la PC del admin. Los demás ven la cola y lo que suena, pueden pedir, votar y dar like; su reproductor queda en silencio. Es el modo por defecto.
- **Todas:** suena en la PC de cada miembro, sincronizado con la del admin. Meta: desfase menor a 1 s una vez estabilizado.
- Cada miembro conserva su volumen y silencio locales.
- El cambio de modo es inmediato y se refleja en todas las PCs.

### 3.6 Votos y likes
- **Saltar:** cada miembro conectado vota una vez por canción. Se salta cuando los votos superan la mitad de los miembros conectados (admin incluido). El admin salta sin votar, y quien pidió la canción también. Los votos se reinician al cambiar de canción y el umbral se recalcula si alguien se va o entra.
- **Like:** botón de "buena elección" sobre la canción que suena; una vez por miembro, se puede quitar. Muestra un contador y suma a quien pidió la canción; el total de likes recibidos por cada miembro se ve junto a su nombre en el panel de la sala. No toca los favoritos de nadie.

### 3.7 Tu reproductor personal mientras estás en una sala
- Entrar a una sala toma el reproductor: la cola personal se guarda y se restaura exactamente al salir. Mientras estás dentro se suspende el guardado de `player_state`, para no pisarla con la cola de la sala.
- Dentro de la sala, "Reproducir", "Agregar a la cola" y "Reproducir a continuación" (desde búsqueda, álbum, artista, playlist y menú contextual) significan "pedir a la sala": agregan a la cola compartida y muestran un aviso. Para el admin, "Reproducir ahora" y "a continuación" actúan sobre la cola de la sala.
- "Escuchado recientemente" registra lo que suena en tu PC; en modo Solo admin los miembros no registran nada.

### 3.8 Casos borde
- **Desconexión breve:** el cliente reconecta solo, con espera creciente, recibe el estado completo y en modo Todas se resincroniza.
- **Desconexión larga de un miembro:** ve "Reconectando…" y su reproductor se pausa; al volver se reengancha.
- **Canción no disponible solo en una PC (modo Todas):** aviso local; el resto no se entera ni se frena.
- **Admin desconectado en Internet:** el ancla de reloj se congela (la sala queda como pausada) hasta que vuelve o se traspasa el rol.
- **Dos instancias en una misma PC:** ya lo impide el lock de instancia única; las pruebas e2e usan carpetas de datos distintas (`SPOTAPLE_USER_DATA`).
- **Reloj de la PC desfasado:** no importa, solo se usa el reloj de la sala.

## 4. Arquitectura (decisiones mías)

### 4.1 Motor de sala puro
`src/shared/jam/`, TypeScript sin dependencias de Electron ni de Node:
- `engine.ts`: función pura `reduce(state, event, nowMs) → { state, effects }`. Estado: miembros, admin, modo, cola, `now`, votos, likes. Eventos: entrar/salir, agregar/quitar/mover ítem, votar salto, like, cambiar modo, transporte (admin), `ended`, `unavailable`, `tick` (vencimiento de la gracia del admin).
- `protocol.ts`: tipos de mensaje, validadores y `PROTOCOL = 1`.
- `clock.ts`: estimación de offset y posición esperada.

La misma lógica corre en el host local (main de Electron) y en el relé de internet, y se prueba con vitest sin red.

### 4.2 Protocolo
JSON sobre WebSocket.
- Cliente → sala: `hello`, `queue.add`, `queue.remove`, `queue.move`, `vote.skip`, `like.toggle`, `mode.set`, `transport`, `ended`, `unavailable`, `playing {itemId, positionSec}`, `ping`.
- Sala → cliente: `state` (instantánea completa), `pong {serverTime}`, `error {code}`.
- Cada cambio envía la instantánea completa: las salas son chicas (≤30 miembros, ≤200 ítems), así no hay diferencias que se desincronicen y reconectar no necesita lógica especial.
- Todo mensaje entrante se valida (tipos, largos, `Track` saneado, límites). Los inválidos se descartan y se cuentan; hay límite de tasa por conexión.

### 4.3 Dos hosts, un motor
- **Host local** (`src/main/jam/local-host.ts`): servidor WebSocket con el paquete `ws` (dependencia nueva, más `@types/ws`) en el proceso main del admin. Puerto por defecto 47800 (si está ocupado, uno libre), escucha en `0.0.0.0`. Las IPs que se muestran salen de `os.networkInterfaces()` (IPv4 no interna, priorizando rangos privados). El admin se conecta a su propio servidor como un cliente más (`127.0.0.1`): no hay camino especial. La sala vive en memoria mientras la app del admin siga abierta. Windows muestra el aviso de firewall la primera vez y hay que permitir redes privadas; la interfaz lo explica cuando nadie logra conectarse.
- **Relé de internet** (`relay/`, se despliega aparte): Cloudflare Worker + Durable Object (uno por código de sala) con WebSockets hibernables, ejecutando el mismo motor. Acordado con vos: va en Cloudflare, por su plan gratuito y porque no exige un servidor propio. Se despliega con tu cuenta de Cloudflare y `wrangler deploy`; confirmar los límites vigentes del plan gratuito al desplegar. La sala se borra tras 6 h sin actividad. Los códigos son 5 caracteres de 31 símbolos (sin 0, O, 1, I, L); el relé rechaza crear un código que ya existe. La URL del relé es una constante en `src/shared/jam/config.ts`, sobrescribible con la variable de entorno `SPOTAPLE_JAM_RELAY` (pruebas, o una oficina con su propio relé). El mismo relé debe poder correr también como script de Node (reutilizando el host de `ws`), para pruebas y para quien prefiera auto-hospedarlo.
- El cliente es el mismo en ambos casos; solo cambia la URL.

### 4.4 Cliente en el proceso main + IPC
- La conexión vive en main (`src/main/jam/client.ts`), con el `WebSocket` global de Node (confirmar la versión de Node que trae Electron 45; es estable desde Node 22). No vive en el renderer para no relajar la CSP (`connect-src 'self'`, que hoy impide toda red directa desde la interfaz) y para respetar el patrón actual: el renderer solo habla por el puente.
- Nuevos canales en `IPC` (`src/shared/api.ts`): `jam:create`, `jam:join`, `jam:leave`, `jam:send`. Además hace falta un canal main→renderer para el estado de la sala (hoy no existe ninguno): `webContents.send` + una suscripción de superficie limitada en el preload. `window.spotapleBridge.jam` se agrega al contrato `SpotapleApi`. En el renderer, `stores/jam.ts` (zustand) refleja la sala y la conexión.
- **Riesgo conocido:** el `WebSocket` de Node no usa el proxy del sistema (por eso la app ya manda YouTube por `net.fetch`). Si la oficina sale a internet solo por proxy, el modo Internet podría fallar. Contingencia: transporte alternativo por HTTP (POST + SSE o long-poll) sobre `net.fetch`, que sí respeta el proxy. Se decide con la sonda del paso 0, antes de construir.

### 4.5 Sincronización de reloj
- Cada cliente estima su `offset` contra el reloj de la sala con ping/pong: unas 5 muestras al conectar, se elige la de menor RTT, y se repite cada ~30 s.
- `now.anchor` es el instante de la sala en que habría ocurrido la posición 0. Lo fija la sala cuando el reproductor del admin informa `playing {itemId, positionSec}` (el audio ya suena realmente, así no se cuenta la latencia de carga). En pausa se guarda la posición congelada.
- Posición esperada en un miembro = `roomNow − anchor`, o la posición congelada si está en pausa. Al cargar un ítem o cambiar de modo, el miembro carga, hace seek a la posición esperada y luego corrige desvíos mayores a 0,5 s, revisando cada ~5 s.
- El reproductor ya sabe empezar en un segundo dado (`go(index, { startAt })`) pero `playTracks` no lo expone: hace falta una acción `playAt(track, startSec)`.

### 4.6 Integración con el código actual
- `src/renderer/src/player/player.ts`: `createPlayer(deps)` recibe un gancho opcional `jam` (¿activa?, pedir pistas). Con la sala activa, `playTracks`, `addToQueue` y `playNext` se enrutan a la sala. Hay 25 llamadas a `player().*` repartidas en 10 archivos de interfaz; una sola intercepción dentro del store evita tocarlas.
- `src/renderer/src/player/jam-sync.ts` (nuevo): conduce el audio con una cola de un solo ítem (la canción `now`) y traduce eventos del audio (`playing`, `ended`, error `unavailable`) en mensajes a la sala.
- `src/renderer/src/player/instance.ts`, `startPlayerPersistence`: suspender el guardado dentro de la sala y restaurar la cola personal al salir.
- `src/main/validate.ts`: `sanitizeTrack` depende de `MusicError` (propio de main). Hay que extraer una versión pura a `src/shared/` para que el relé la reutilice.
- `src/main/db/store.ts`: la tabla `settings` (clave-valor) ya existe; guardar ahí `jam_member_id`, `jam_name` y `jam_last_mode`. No hace falta tabla nueva.
- Audio: sin cambios. `spotaple-audio://track/<videoId>` ya resuelve el audio en cada PC.

## 5. Interfaz (restricciones; el diseño visual se hace con mockups antes de construir)
- Un control "Jam" siempre visible. Fuera de sala: Crear y Unirse. Dentro: estado de la sala a la vista.
- Switch deslizante "Solo admin ⇄ Todas", visible para el admin sin abrir menús. Los miembros lo ven como indicador de solo lectura ("Suena en: la PC del admin / todas las PCs").
- Panel de sala: miembros (con marca de admin), invitación copiable, ayuda de firewall en red local.
- Cola de la sala: reutilizar la cola actual mostrando quién pidió cada ítem; el admin puede reordenar y quitar.
- En la barra del reproductor: canción actual, quién la pidió, botón Saltar con contador de votos (n de umbral) y botón Like con contador. Para miembros no admin, pausa y posición quedan deshabilitadas con una explicación.
- Estados con mensaje accionable en español (voseo): conectando, reconectando, sala terminada, sala llena, código inexistente, versión incompatible, sin conexión.
- Accesibilidad al nivel actual del proyecto: botones con etiqueta, el switch con rol `switch` y `aria-checked`, foco visible; `npm run a11y` debe seguir pasando con el panel abierto.

## 6. Verificación
- **Unitarias (vitest, sin red):** motor con reloj inyectado (cola, votos con distintos umbrales y salidas de miembros, likes idempotentes, traspaso de admin, duplicados, límites, `ended` repetido u obsoleto), validadores de protocolo y matemática de reloj.
- **Integración (vitest):** host local real con 3 clientes falsos por WebSocket: reconexión, mensajes inválidos, versión incompatible.
- **E2E real** (extender `scripts/`, estilo `e2e-ui.mjs`): dos instancias de Electron con `SPOTAPLE_USER_DATA` distinto. El admin crea una sala local, el miembro se une por `127.0.0.1`, pide una canción y suena en la PC del admin; voto de salto; like; cambio a "Todas" y comprobación de que el segundo reproductor suena a ≤1 s del primero; el miembro cierra, reabre y recupera su estado. La misma batería contra el relé corriendo como script de Node.
- **Sonda de red (paso 0):** `scripts/jam-probe.mjs`, al estilo de `check:youtube`, para correr en la oficina real: (a) LAN, una PC escucha y otra conecta; (b) handshake WebSocket al relé a través del proxy de la oficina.
- **Manual, antes de dar por terminado:** 3 PCs reales de la oficina, en modo local y en modo internet.

## 7. Orden de construcción sugerido
0. Sonda de red y decisión de transporte (WebSocket de Node o HTTP); confirmar que el firewall y la red de la oficina permiten LAN.
1. Motor, protocolo y reloj (carpeta `shared`) con sus pruebas.
2. Host local, cliente en main, IPC, store del renderer y `jam-sync`: modo local funcionando de punta a punta, con una interfaz mínima.
3. Mockups y UI definitiva.
4. Relé de internet (Worker + Durable Object y script de Node), despliegue y documentación del despliegue.
5. Endurecimiento: reconexión, traspaso de admin, límites, mensajes de error, e2e completo y prueba en la oficina.

## 8. Riesgos y preguntas abiertas
- **Proxy y firewall de la oficina** (el mayor): lo resuelve la sonda del paso 0.
- **Sala abierta por código** (Internet): sin contraseña ni expulsión, cualquiera con el código entra. Unos 28 millones de códigos más la expiración lo hacen poco adivinable; un miembro molesto solo se maneja quitando sus ítems. Si importa, lo primero a agregar es "bloquear sala" y "expulsar".
- **Dependencia del relé:** si cae, Internet no anda y Local sí. Si cambia de URL hay que sacar una versión nueva de la app (por eso existe `SPOTAPLE_JAM_RELAY`).
- **Cuenta de Cloudflare:** el relé va en Cloudflare (acordado). Hace falta una cuenta tuya y ejecutar `wrangler deploy` una vez; yo dejo el relé listo y documentado, pero el despliegue y el login los hacés vos. Si algún día se cambia de hosting, el relé también corre como script de Node.
- **Latencia en modo Todas:** cada PC baja su audio de YouTube y puede arrancar en tiempos distintos; la meta de <1 s es alcanzable pero depende de la red de cada PC.

## 9. Decisiones mías para revisar
- Sin cuentas: nombre + `memberId` local.
- Invitación: código de 5 caracteres (Internet) y `ip:puerto/CODIGO` (Local); sin descubrimiento automático en la v1.
- Admin = creador; gracia de 60 s; traspaso al miembro más antiguo solo en Internet; la sala local termina con el admin.
- Saltar: más de la mitad de los conectados; el admin y quien pidió la canción saltan directo.
- Like: solo sobre la canción que suena, una vez por miembro, suma a quien la pidió.
- Sin duplicados en la cola.
- Modo por defecto: Solo admin.
- Topes: 30 miembros, 200 ítems; expiración de 6 h en el relé.
- Red en el proceso main con `WebSocket` de Node; contingencia por HTTP si el proxy lo exige.
- El relé también corre como script de Node (pruebas y auto-hospedaje); en producción va en Cloudflare Workers + Durable Objects, acordado con vos.
- La cola de la sala está separada de la personal; el reproductor toca de a un ítem.

## 10. Decisiones de interfaz (Task 14, tomadas por Claude por delegación: "Decidí vos", 2026-11-05)

Sin mockups visuales: son decisiones mías, revisables viendo la app. Las clases CSS son las que usan los e2e.

- **Entrada:** ítem "Jam" en la barra lateral (ícono `Radio`, clase `.jam-entry`) que abre una página propia (`{ page: 'jam' }`). Con una sala viva muestra un punto de estado y el código. Se descarta el diálogo para Crear/Unirse: los formularios van en la página, que es más accesible y no obliga a inventar un tipo de diálogo nuevo.
- **Página fuera de sala:** un campo "Tu nombre" (recuerda el último) y dos tarjetas. "Crear una sala": opciones "Red local" (para quienes están en la misma red, sin servidor externo) e "Internet" (funciona aunque la red de la oficina no deje conectar PCs entre sí), botón "Crear sala". "Unirse a una sala": campo de invitación y botón "Unirse". Los errores salen en línea con `role="alert"`.
- **Página dentro de la sala (`.jam-panel`):** encabezado "Sala K7M2P" con la modalidad; estado "Conectando…" o "Reconectando…" (`role="status"`); invitación de solo lectura (`.jam-invite`) con "Copiar invitación"; el switch de modo; la lista de miembros (`.jam-member`) con la marca "Admin", "(desconectada)" y los likes recibidos; botones "Salir de la sala" y, solo para el admin, "Cerrar sala" con confirmación; ayuda de firewall en red local si a los 30 s sigue solo el admin.
- **Switch (`.jam-switch`):** para el admin, botón con `role="switch"`, `aria-checked` verdadero = "Todas" y etiqueta "Reproducir en todas las PCs"; para los miembros, texto "Suena en: la PC del admin" o "Suena en: todas las PCs".
- **Barra del reproductor en sala:** título, portada y artistas salen de la canción de la sala (el reproductor local de un miembro en "Solo admin" está vacío). `.jam-req` ("Pedida por Mara") bajo los artistas; antes del botón de la cola, `.jam-skip` ("Votar para saltar (1 de 3)", ícono `Vote`, contador n/umbral) y `.jam-like` ("Me gusta esta elección", ícono `ThumbsUp`, `aria-pressed`, contador). Aleatorio, repetir y anterior quedan deshabilitados para todos; pausa, posición y siguiente solo para el admin (siguiente envía `transport next`). A los miembros se les explica con el título "Solo el admin controla la reproducción".
- **Cola de la sala (`QueuePanel`):** "Reproduciendo ahora" con la canción de la sala y "A continuación" con la cola, cada fila con "Pedida por X". El admin reordena (arrastrar o menú) y quita; un miembro quita solo lo suyo. Los textos de menú pasan a "Pedir a la sala" y, solo para el admin, "Pedir como siguiente" mientras hay sala.
