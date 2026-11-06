import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import { App } from './App';
import { bridgeAvailable } from './api';
import { startMediaSession, startPlayerPersistence } from './player/instance';

const root = createRoot(document.getElementById('root')!);

if (!bridgeAvailable) {
  root.render(
    <div className="fatal" role="alert">
      <h1>Spotaple no pudo conectarse con su proceso local</h1>
      <p>Cerrá la aplicación y volvé a abrirla. Si el problema sigue, reinstalá o reconstruí el proyecto.</p>
    </div>,
  );
} else {
  void startPlayerPersistence().then(startMediaSession);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
