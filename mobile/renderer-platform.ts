import '../src/renderer/src/main';
import { api } from '../src/renderer/src/api';
import { artistsText, thumbUrl } from '../src/renderer/src/lib/format';
import { currentItem, player, playerStore } from '../src/renderer/src/player/instance';
import { canAdvance, inRoom, isAdmin, useJam } from '../src/renderer/src/stores/jam';
import { useNav } from '../src/renderer/src/stores/nav';
import { useUi } from '../src/renderer/src/stores/ui';
import brand from './brand.png';

Object.assign(window, {
  spotapleBack() {
    const ui = useUi.getState();
    if (ui.dialog) ui.closeDialog();
    else if (ui.menu) ui.closeMenu();
    else if (ui.queueOpen) ui.toggleQueue();
    else if (ui.mobilePlayerOpen) useUi.setState({ mobilePlayerOpen: false });
    else {
      const nav = useNav.getState();
      if (!nav.i) return false;
      nav.back();
    }
    return true;
  },
  spotapleMedia(action: 'play' | 'pause' | 'prev' | 'next' | 'seek', position?: number) {
    const p = player();
    const room = useJam.getState().view;
    const active = p.status === 'playing' || p.status === 'buffering' || p.status === 'loading';
    if (inRoom(room)) {
      if (action === 'next' && canAdvance(room)) void api.jam.send({ t: 'transport', action: 'next' });
      if (!isAdmin(room)) return;
      if (action === 'play' && !active) void api.jam.send({ t: 'transport', action: 'play' });
      if (action === 'pause' && active) void api.jam.send({ t: 'transport', action: 'pause' });
      if (action === 'seek' && Number.isFinite(position)) void api.jam.send({ t: 'transport', action: 'seek', positionSec: position });
      return;
    }
    if (action === 'pause' && p.status === 'loading') p.stop();
    else if ((action === 'play' && !active) || (action === 'pause' && active)) p.togglePlay();
    else if (action === 'prev') p.prev();
    else if (action === 'next') p.next();
    else if (action === 'seek' && Number.isFinite(position)) p.seek(position!);
  },
});

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!(target instanceof HTMLAnchorElement) || target.protocol !== 'https:' || !window.SpotapleAndroid) return;
  event.preventDefault();
  window.SpotapleAndroid.open(target.href);
});

window.addEventListener('spotaple:open-local', () => {
  if (inRoom(useJam.getState().view)) return;
  const p = player();
  if (p.status === 'playing' || p.status === 'buffering') p.togglePlay();
  window.SpotapleAndroid?.openLocal();
});

let lastMedia = '';
const fallbackArtwork = new URL(brand, location.href).href;
playerStore.subscribe((state) => {
  const item = currentItem(state);
  const artwork = item ? thumbUrl(item.track.thumbnail, 320) ?? fallbackArtwork : undefined;
  const key = `${item?.uid ?? ''}:${state.status}:${state.duration}:${Math.floor(state.position / 5)}:${artwork ?? ''}`;
  if (key === lastMedia) return;
  lastMedia = key;
  window.SpotapleAndroid?.media(JSON.stringify({
    title: item?.track.title ?? '',
    artist: item ? artistsText(item.track.artists) : '',
    artwork,
    status: state.status,
    positionMs: Math.round(state.position * 1000),
    durationMs: Math.round(state.duration * 1000),
  }));
});
