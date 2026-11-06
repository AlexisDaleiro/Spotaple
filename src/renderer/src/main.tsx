import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/jam.css';
import { App } from './App';
import { api, bridgeAvailable } from './api';
import { persistence, playerStore, startMediaSession, startPlayerPersistence } from './player/instance';
import { startJamSync } from './player/jam-sync';
import { startJamBridge, useJam } from './stores/jam';

const root = createRoot(document.getElementById('root')!);

if (!bridgeAvailable) {
  root.render(
    <div className="fatal" role="alert">
      <h1>Spotaple no pudo conectarse con su proceso local</h1>
      <p>Cerrá la aplicación y volvé a abrirla. Si el problema sigue, reinstalá o reconstruí el proyecto.</p>
    </div>,
  );
} else {
  // Primero se restaura la cola personal; recién después el jam puede tomar el reproductor (y guardarla aparte).
  void startPlayerPersistence().then(async () => {
    startMediaSession();
    await startJamBridge();
    startJamSync({
      player: playerStore,
      getView: () => useJam.getState().view,
      subscribe: (cb) => useJam.subscribe((s) => cb(s.view)),
      send: (m) => void api.jam.send(m).catch(() => undefined),
      setPersistenceSuspended: (v) => {
        persistence.suspended = v;
      },
    });
  });
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
