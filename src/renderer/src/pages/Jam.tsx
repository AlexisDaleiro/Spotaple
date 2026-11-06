import { useEffect, useId, useState, type FormEvent } from 'react';
import type { JamView } from '@shared/jam/types';
import { api, errorMessage } from '../api';
import { JamPanel } from '../components/JamPanel';
import { inRoom, useJam } from '../stores/jam';

type Where = 'create' | 'join';

/** Fuera de sala: elegir un nombre y crear una sala nueva o unirse a una con su invitación. */
function JamStart({ view }: { view: JamView | null }) {
  const ids = useId();
  const [name, setName] = useState(view?.name ?? '');
  const [kind, setKind] = useState<'local' | 'internet'>('local');
  const [invite, setInvite] = useState('');
  const [working, setWorking] = useState<Where | null>(null);
  const [error, setError] = useState<{ where: Where; message: string } | null>(null);
  const busy = view?.status === 'connecting' || working !== null;

  // El nombre recordado puede llegar después de abrir la página.
  useEffect(() => {
    if (view?.name) setName((n) => n || view.name);
  }, [view?.name]);

  const run = async (where: Where, action: () => Promise<unknown>) => {
    setError(null);
    setWorking(where);
    try {
      await action();
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
      <p className="jam-lede">Escuchen juntos: cada uno pide canciones desde su PC y suenan en la PC del admin o en las de todos.</p>
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
              <span className="jam-kind__hint">Funciona aunque la red de la oficina no deje conectar las PCs entre sí.</span>
            </label>
          </fieldset>
          {error?.where === 'create' && (
            <p className="jam-error" role="alert">
              {error.message}
            </p>
          )}
          <button type="submit" className="btn btn--solid" disabled={busy || !name.trim()}>
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
              placeholder="K7M2P o 192.168.1.20:47800/K7M2P"
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
