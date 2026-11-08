import { useEffect, useId, useState, type FormEvent } from 'react';
import type { JamView } from '@shared/jam/types';
import { api, errorMessage } from '../api';
import { JamPanel } from '../components/JamPanel';
import { inRoom, useJam } from '../stores/jam';
import { settingsStore, useSettings } from '../stores/settings';

type Where = 'create' | 'join';

function AndroidRelaySetup() {
  const status = useJam((s) => s.relay);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.jam.setRelayUrl(url);
      useJam.setState({ relay: await api.jam.relayStatus() });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="jam-relay">
      {status === 'ready' && <p role="status">Tu relé está listo.</p>}
      <p>Pegá la dirección de tu relé de Cloudflare para crear salas por internet.</p>
      <label className="field">
        <span className="field__label">Dirección del relé</span>
        <input className="field__input" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://tu-rele.workers.dev" />
      </label>
      <div className="jam-relay__actions">
        <button type="button" className="btn" disabled={busy || !url.trim()} onClick={() => void save()}>Guardar relé</button>
        <a href="https://github.com/AlexisDaleiro/Spotaple/tree/main/relay" target="_blank" rel="noreferrer">Cómo crear un relé</a>
      </div>
      {error && <p className="jam-error" role="alert">{error}</p>}
    </div>
  );
}

function RelaySetup() {
  const status = useJam((s) => s.relay);
  const [showTerms, setShowTerms] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (status === null) return <p className="jam-status" role="status">Cargando el relé…</p>;
  if (status === 'ready') return <p className="jam-status" role="status">Tu relé está listo.</p>;

  return (
    <div className="jam-relay">
      {status === 'preparing' ? (
        <p className="jam-status" role="status">Preparando tu relé en Cloudflare…</p>
      ) : status === 'claim' && !showTerms ? (
        <>
          <p>Terminá la activación en Cloudflare dentro de una hora y después confirmala acá.</p>
          <div className="jam-relay__actions">
            <button type="button" className="btn" disabled={busy} onClick={() => void run(api.jam.openRelayClaim)}>Abrir Cloudflare</button>
            <button type="button" className="btn" disabled={busy} onClick={() => void run(api.jam.activateRelay)}>Ya activé mi relé</button>
            <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => { setAccepted(false); setShowTerms(true); }}>Preparar otro</button>
          </div>
        </>
      ) : showTerms ? (
        <>
          <p>Spotaple prepara el relé. Después iniciás sesión en Cloudflare para guardarlo en tu cuenta.</p>
          <label className="jam-relay__consent">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
            <span>Acepto los <a href="https://www.cloudflare.com/terms/" target="_blank" rel="noreferrer">términos</a> y la <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noreferrer">política de privacidad de Cloudflare</a>.</span>
          </label>
          <button type="button" className="btn" disabled={busy || !accepted} onClick={() => {
            setShowTerms(false);
            setAccepted(false);
            void run(() => api.jam.prepareRelay(accepted));
          }}>Preparar relé</button>
        </>
      ) : (
        <>
          <p>Configurá Cloudflare una vez para crear salas por internet. Tus invitados solo necesitan la invitación.</p>
          <button type="button" className="btn" disabled={busy} onClick={() => setShowTerms(true)}>Configurar mi relé</button>
        </>
      )}
      {error && <p className="jam-error" role="alert">{error}</p>}
    </div>
  );
}

/** Fuera de sala: elegir un nombre y crear una sala nueva o unirse a una con su invitación. */
function JamStart({ view }: { view: JamView | null }) {
  const ids = useId();
  // El nombre por defecto sale de Ajustes (que se actualiza al crear o unirse a una sala), no de la vista inicial de la sesión.
  const saved = useSettings((s) => s.settings.jamName);
  const [name, setName] = useState(saved || view?.name || '');
  const [kind, setKind] = useState<'local' | 'internet'>('local');
  const relay = useJam((s) => s.relay);
  const [invite, setInvite] = useState('');
  const [working, setWorking] = useState<Where | null>(null);
  const [error, setError] = useState<{ where: Where; message: string } | null>(null);
  const busy = view?.status === 'connecting' || working !== null;

  // El nombre recordado puede llegar después de abrir la página.
  const remembered = saved || view?.name;
  useEffect(() => {
    if (remembered) setName((n) => n || remembered);
  }, [remembered]);

  const run = async (where: Where, action: () => Promise<unknown>) => {
    setError(null);
    setWorking(where);
    try {
      await action();
      // Main ya guardó el nombre al crear o unirse: Ajustes lo muestra sin esperar a un reinicio.
      settingsStore.setState((s) => ({ settings: { ...s.settings, jamName: name.trim() } }));
    } catch (e) {
      setError({ where, message: errorMessage(e) });
    } finally {
      setWorking(null);
    }
  };
  const create = (e: FormEvent) => (e.preventDefault(), void run('create', () => api.jam.create({ kind, name })));
  const join = (e: FormEvent) => (e.preventDefault(), void run('join', () => api.jam.join({ invite, name })));

  return (
    <>
      <p className="jam-lede">Escuchen juntos. Cada persona pide canciones desde su dispositivo y suenan donde elija quien creó la sala.</p>
      <label className="field jam-name">
        <span className="field__label">Tu nombre</span>
        <input className="field__input" value={name} maxLength={24} autoComplete="off" placeholder="Cómo te ven los demás" onChange={(e) => setName(e.target.value)} />
      </label>
      {view?.status === 'connecting' && (
        <p className="jam-status" role="status">
          Conectando…
        </p>
      )}

      <div className="jam-grid">
        <form className="jam-card" onSubmit={create} aria-labelledby={`${ids}-create`}>
          <h2 className="jam-card__title" id={`${ids}-create`}>
            Crear una sala
          </h2>
          <fieldset className="jam-kind">
            <legend>¿Dónde se conectan?</legend>
            <label className="jam-kind__opt">
              <input type="radio" name="jam-kind" value="local" checked={kind === 'local'} onChange={() => setKind('local')} />
              <span>Red local</span>
              <span className="jam-kind__hint">Para quienes están en la misma red. No usa ningún servidor externo.</span>
            </label>
            <label className="jam-kind__opt">
              <input type="radio" name="jam-kind" value="internet" checked={kind === 'internet'} onChange={() => setKind('internet')} />
              <span>Internet</span>
              <span className="jam-kind__hint">Para escuchar juntos desde redes distintas con tu relé de Cloudflare.</span>
            </label>
          </fieldset>
          {kind === 'internet' && (api.platform === 'android' ? <AndroidRelaySetup /> : <RelaySetup />)}
          {error?.where === 'create' && (
            <p className="jam-error" role="alert">
              {error.message}
            </p>
          )}
          <button type="submit" className="btn btn--solid" disabled={busy || !name.trim() || (kind === 'internet' && relay !== 'ready')}>
            {working === 'create' ? 'Creando…' : 'Crear sala'}
          </button>
        </form>

        <form className="jam-card" onSubmit={join} aria-labelledby={`${ids}-join`}>
          <h2 className="jam-card__title" id={`${ids}-join`}>
            Unirse a una sala
          </h2>
          <label className="field">
            <span className="field__label">Invitación</span>
            <input
              className="field__input"
              value={invite}
              spellCheck={false}
              autoComplete="off"
              placeholder="Pegá el enlace o código que te compartieron"
              onChange={(e) => setInvite(e.target.value)}
            />
          </label>
          {error?.where === 'join' && (
            <p className="jam-error" role="alert">
              {error.message}
            </p>
          )}
          <button type="submit" className="btn btn--solid" disabled={busy || !name.trim() || !invite.trim()}>
            {working === 'join' ? 'Uniéndote…' : 'Unirse'}
          </button>
        </form>
      </div>
    </>
  );
}

export function JamPage() {
  const view = useJam((s) => s.view);
  return (
    <div className="page page--jam">
      <h1 className="h1">Jam</h1>
      {inRoom(view) && view ? <JamPanel view={view} /> : <JamStart view={view} />}
    </div>
  );
}
