import { driftAction, positionAt } from '@shared/jam/clock';
import type { ClientMsg, JamNow, JamView } from '@shared/jam/types';
import type { PersistedPlayerState } from '@shared/types';
import { inRoom, isAdmin } from '../stores/jam';
import type { JamHook, PlayerState, PlayerStore } from './player';

/** Lo que la interfaz le manda a la sala (todo menos el saludo, que es cosa de main). */
export type JamOutMsg = Exclude<ClientMsg, { t: 'hello' }>;

export interface JamSyncDeps {
  player: PlayerStore;
  getView(): JamView | null;
  subscribe(cb: (view: JamView | null) => void): () => void;
  send(msg: JamOutMsg): void;
  /** Reloj local en ms (`Date.now` por defecto). */
  now?: () => number;
  /** Mientras hay sala, la cola del reproductor es la de la sala y no se debe guardar como cola personal. */
  setPersistenceSuspended(suspended: boolean): void;
  /** Cada cuánto un seguidor revisa su desvío (5 s por defecto). */
  driftEveryMs?: number;
}

/** Si el audio real del admin se desvía tanto de lo anclado (salto manual, corte de buffer), la sala se reancla. */
const ADMIN_RESEEK_S = 1.5;
const sounding = (status: PlayerState['status']) => status === 'playing' || status === 'buffering';
/** Cuántos pedidos salen de una vez y cada cuánto sale el resto (20 + ~16 por segundo, bajo el límite de 30). */
const BURST = 20;
const SPACING_MS = 60;

/**
 * Conductor de la sala: hace que el reproductor de esta PC suene lo que la sala dice (si le toca) y, si esta PC
 * es la del admin, le cuenta a la sala lo que realmente pasa en su audio. Mientras hay sala el reproductor toca
 * una cola de un solo ítem (la canción actual); la cola real vive en la sala y la personal se guarda aparte.
 */
export function startJamSync(d: JamSyncDeps): { stop(): void } {
  const { player } = d;
  const clock = d.now ?? Date.now;
  let inside = false;
  let personal: PersistedPlayerState | null = null;
  /** Ítem de la sala cuyo audio está cargado: evita reiniciar la canción cuando solo cambia el estado de la sala. */
  let loadedItemId: string | null = null;
  let lastSeekSent = 0;

  const expected = (now: JamNow, v: JamView) => positionAt(now, clock() + v.offsetMs);
  const pauseIfSounding = () => {
    const p = player.getState();
    if (sounding(p.status)) p.togglePlay();
  };

  function enter() {
    inside = true;
    loadedItemId = null;
    personal = player.getState().snapshot();
    d.setPersistenceSuspended(true);
    pauseIfSounding();
    // Cola vacía y repetir/aleatorio apagados: con una cola de un ítem, "repetir una" haría que `ended` nunca llegue.
    player.getState().hydrate({ ...personal, queue: [], index: 0, positionSec: 0, repeat: 'off', shuffle: false });
  }

  function leaveRoom() {
    inside = false;
    loadedItemId = null;
    pauseIfSounding();
    const cur = player.getState();
    if (personal) cur.hydrate({ ...personal, volume: cur.volume, muted: cur.muted });
    personal = null;
    d.setPersistenceSuspended(false);
  }

  function drift(now: JamNow, v: JamView) {
    const p = player.getState();
    if (p.status !== 'playing') return;
    const want = expected(now, v);
    if (driftAction(p.position, want) === 'seek') p.seek(want);
  }

  function followerSync(now: JamNow, v: JamView) {
    if (now.status === 'paused') return pauseIfSounding();
    if (now.status !== 'playing') return; // loading: el admin todavía no suena
    const p = player.getState();
    if (p.status === 'paused') p.togglePlay();
    drift(now, v);
  }

  function reconcile(v: JamView) {
    const s = v.state!;
    const admin = isAdmin(v);
    if (v.status === 'reconnecting') {
      // El admin sigue con su audio mientras reconecta (no se reinicia la canción); un seguidor se pausa.
      if (!admin) pauseIfSounding();
      return;
    }
    const now = s.now;
    if (!now || !(admin || s.mode === 'everyone')) {
      pauseIfSounding();
      loadedItemId = null;
      return;
    }
    if (loadedItemId !== now.item.itemId) {
      loadedItemId = now.item.itemId;
      player.getState().playAt(now.item.track, admin ? 0 : expected(now, v));
      return;
    }
    if (!admin) followerSync(now, v);
  }

  function apply(v: JamView | null) {
    const live = inRoom(v);
    if (live && !inside) enter();
    else if (!live && inside) leaveRoom();
    if (inside && v) reconcile(v);
  }

  /** Solo el admin: lo que pasa en su audio se cuenta a la sala, que lo difunde a los demás. */
  function onPlayer(cur: PlayerState, prev: PlayerState) {
    const v = d.getView();
    if (!v || !isAdmin(v) || v.status !== 'connected') return;
    const now = v.state?.now;
    if (!now || loadedItemId !== now.item.itemId || cur.items[cur.index]?.track.id !== now.item.track.id) return;
    const itemId = now.item.itemId;

    if (cur.status === 'playing' && prev.status !== 'playing') {
      d.send({ t: 'playing', itemId, positionSec: cur.position });
    } else if (cur.status === 'ended' && prev.status !== 'ended') {
      d.send({ t: 'ended', itemId });
    } else if (cur.status === 'error' && prev.status !== 'error' && (cur.error?.code === 'unavailable' || cur.error?.code === 'region')) {
      d.send({ t: 'unavailable', itemId });
    } else if (cur.status === 'paused' && sounding(prev.status) && now.status === 'playing') {
      // El audio también se pausa justo antes de terminar la canción: se confirma que el estado final sigue siendo "pausa".
      queueMicrotask(() => player.getState().status === 'paused' && d.send({ t: 'transport', action: 'pause' }));
    }

    if (cur.position !== prev.position && clock() - lastSeekSent > 1000) {
      const anchoredAt = now.status === 'playing' && cur.status === 'playing' ? expected(now, v) : now.status === 'paused' && cur.status === 'paused' ? now.pausedAtSec : null;
      if (anchoredAt !== null && Math.abs(cur.position - anchoredAt) > ADMIN_RESEEK_S) {
        lastSeekSent = clock();
        d.send({ t: 'transport', action: 'seek', positionSec: cur.position });
      }
    }
  }

  const unsubView = d.subscribe(apply);
  const unsubPlayer = player.subscribe((cur, prev) => inside && onPlayer(cur, prev));
  const timer = setInterval(() => {
    const v = d.getView();
    const now = v?.state?.now;
    if (inside && v && now?.status === 'playing' && v.status === 'connected' && !isAdmin(v)) drift(now, v);
  }, d.driftEveryMs ?? 5000);
  apply(d.getView());

  return {
    stop() {
      unsubView();
      unsubPlayer();
      clearInterval(timer);
      if (inside) leaveRoom();
    },
  };
}

/** Gancho del reproductor: pedir canciones dentro de una sala las manda a la sala en vez de a la cola propia. */
export function createJamHook(d: { getView(): JamView | null; send(msg: JamOutMsg): void }): JamHook {
  return {
    active: () => inRoom(d.getView()),
    request(tracks, how) {
      const admin = isAdmin(d.getView());
      // Un miembro siempre pide al final. El admin puede pedir "next"/"now": cada "next" va al frente, así que se envían al revés.
      const msgs: JamOutMsg[] =
        !admin || how === 'end'
          ? tracks.map((track) => ({ t: 'queue.add', track }))
          : how === 'next'
            ? [...tracks].reverse().map((track) => ({ t: 'queue.add', track, at: 'next' as const }))
            : [
                { t: 'queue.add', track: tracks[0]!, at: 'now' as const },
                ...tracks
                  .slice(1)
                  .reverse()
                  .map((track) => ({ t: 'queue.add' as const, track, at: 'next' as const })),
              ];
      // El servidor corta a quien manda más de 30 mensajes por segundo: lo que pasa de BURST se reparte en el tiempo.
      msgs.forEach((m, i) => void (i < BURST ? d.send(m) : setTimeout(() => d.send(m), (i - BURST + 1) * SPACING_MS)));
    },
  };
}
