import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/jam.css';
import './styles/settings.css';
import { App } from './App';
import { api, bridgeAvailable } from './api';
import { persistence, playerStore, startMediaSession, startPlayerPersistence } from './player/instance';
import { startJamSync } from './player/jam-sync';
import { startJamBridge, useJam } from './stores/jam';
import { startOfflineBridge } from './stores/offline';
import { settingsStore } from './stores/settings';

const root = createRoot(document.getElementById('root')!);

if (!bridgeAvailable) {
  root.render(
    <div className="fatal" role="alert">
      <h1>Spotaple no pudo conectarse con su proceso local</h1>
      <p>Cerrá la aplicación y volvé a abrirla. Si el problema sigue, reinstalá o reconstruí el proyecto.</p>
    </div>,
  );
} else {
  // Los ajustes visuales se aplican antes del primer render (sin destello del tema equivocado). `load` no falla:
  // si no puede leerlos, rigen los de fábrica.
  const settingsReady = settingsStore.getState().load();
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => settingsStore.getState().reapply());
  window.addEventListener('beforeunload', () => void settingsStore.getState().flush());
  // Descargas y red: el estado de lo que hay en el disco y el aviso «Sin conexión».
  void startOfflineBridge();

  // Primero se restaura la cola personal; recién después el jam puede tomar el reproductor (y guardarla aparte).
  void startPlayerPersistence().then(async () => {
    await settingsReady;
    startMediaSession();
    // «Reanudar al abrir la app»: la sesión restaurada queda en pausa y este ajuste la retoma donde estaba.
    if (settingsStore.getState().settings.resumeOnOpen && playerStore.getState().status === 'paused') playerStore.getState().togglePlay();
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
  void settingsReady.then(() =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  );
}
