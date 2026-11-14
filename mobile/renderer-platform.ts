import '../src/renderer/src/main';
import { artistsText, thumbUrl } from '../src/renderer/src/lib/format';
import { currentItem, dispatchPlayback, persistence, playerStore } from '../src/renderer/src/player/instance';
import { inRoom, useJam } from '../src/renderer/src/stores/jam';
import { useNav } from '../src/renderer/src/stores/nav';
import { useOffline } from '../src/renderer/src/stores/offline';
import { useUi } from '../src/renderer/src/stores/ui';
import brand from '../src/shared/assets/brand.png';

Object.assign(window, {
  spotapleBack() {
    const ui = useUi.getState();
    if (ui.dialog) ui.closeDialog();
    else if (ui.menu) ui.closeMenu();
    else if (ui.queueOpen) ui.toggleQueue();
    else if (ui.playerOpen) ui.setPlayerOpen(false);
    else {
      const nav = useNav.getState();
      if (!nav.i) return false;
      nav.back();
    }
    return true;
  },
  spotapleMedia: dispatchPlayback,
});

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!(target instanceof HTMLAnchorElement) || target.protocol !== 'https:' || !window.SpotapleAndroid) return;
  event.preventDefault();
  window.SpotapleAndroid.open(target.href);
});

window.addEventListener('spotaple:open-local', () => {
  if (inRoom(useJam.getState().view)) return;
  dispatchPlayback('pause');
  window.SpotapleAndroid?.openLocal();
});

let lastMedia = '';
const fallbackArtwork = new URL(brand, location.href).href;
playerStore.subscribe((state) => {
  const item = currentItem(state);
  const artwork = item ? thumbUrl(item.track.thumbnail, 320) ?? fallbackArtwork : undefined;
  const streaming = Boolean(item && !useOffline.getState().ids.has(item.track.id));
  const key = `${item?.uid ?? ''}:${state.status}:${state.duration}:${Math.floor(state.position / 5)}:${artwork ?? ''}:${streaming}`;
  if (key === lastMedia) return;
  lastMedia = key;
  window.SpotapleAndroid?.media(JSON.stringify({
    trackId: item?.track.id ?? '',
    recoverable: !persistence.suspended && !inRoom(useJam.getState().view),
    title: item?.track.title ?? '',
    artist: item ? artistsText(item.track.artists) : '',
    artwork,
    streaming,
    status: state.status,
    positionMs: Math.round(state.position * 1000),
    durationMs: Math.round(state.duration * 1000),
  }));
});
