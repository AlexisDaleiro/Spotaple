import { Copy, Crown, ThumbsUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { JamView } from '@shared/jam/types';
import { api, errorMessage } from '../api';
import { cx } from '../lib/format';
import { isAdmin } from '../stores/jam';
import { toast, useUi } from '../stores/ui';

const send = (msg: unknown) => void api.jam.send(msg).catch(() => undefined);

/** Dónde suena: el admin lo cambia con un switch; los miembros solo lo ven. */
export function ModeSwitch({ view }: { view: JamView }) {
  const everyone = view.state?.mode === 'everyone';
  if (!isAdmin(view)) {
    return <p className="jam-switch jam-switch--readonly">Suena en: {everyone ? 'todas las PCs' : 'la PC del admin'}</p>;
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={everyone}
      aria-label="Reproducir en todas las PCs"
      className={cx('jam-switch', everyone && 'is-on')}
      onClick={() => send({ t: 'mode.set', mode: everyone ? 'admin-only' : 'everyone' })}
    >
      <span className="jam-switch__track" aria-hidden="true">
        <span className="jam-switch__thumb" />
      </span>
      <span>{everyone ? 'Suena en todas las PCs' : 'Suena solo en esta PC'}</span>
    </button>
  );
}

/** La sala en la que estás: invitación, dónde suena, quién está y cómo salir. */
export function JamPanel({ view }: { view: JamView }) {
  const state = view.state!;
  const admin = isAdmin(view);
  const local = view.kind === 'local';
  const connected = state.members.filter((m) => m.connected).length;

  // En red local, si pasados 30 s sigue solo el admin, lo más probable es el firewall de Windows o una red que aísla los equipos.
  const [helpDue, setHelpDue] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setHelpDue(true), 30_000);
    return () => clearTimeout(t);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(view.invite ?? '');
      toast('Invitación copiada', 'success');
    } catch {
      toast('No se pudo copiar. Seleccioná el texto y copialo con Ctrl+C.', 'error');
    }
  };
  const leave = () => void api.jam.leave().catch((e) => toast(errorMessage(e), 'error'));
  const close = () =>
    useUi.getState().openDialog({
      kind: 'confirm',
      title: 'Cerrar la sala',
      message: 'La sala se cierra para todos y se pierde la cola.',
      confirmLabel: 'Cerrar sala',
      danger: true,
      onConfirm: async () => {
        send({ t: 'close' });
        await new Promise((r) => setTimeout(r, 400));
        await api.jam.leave().catch(() => undefined);
      },
    });

  return (
    <div className="jam-panel">
      <header className="jam-panel__head">
        <h2 className="h2">Sala {state.code}</h2>
        <span className="chip">{local ? 'Red local' : 'Internet'}</span>
        {view.status === 'reconnecting' && (
          <span className="jam-status" role="status">
            Reconectando…
          </span>
        )}
      </header>

      {view.invite && (
        <section className="jam-section" aria-label="Invitación">
          <p className="jam-hint">Pasales esto a quienes quieran unirse.</p>
          <div className="jam-invite">
            <input className="field__input jam-invite__input" readOnly value={view.invite} aria-label="Invitación a la sala" onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="btn" onClick={() => void copy()}>
              <Copy size={15} aria-hidden="true" /> Copiar invitación
            </button>
          </div>
        </section>
      )}

      <section className="jam-section">
        <h3 className="jam-section__title">Dónde suena</h3>
        <ModeSwitch view={view} />
      </section>

      <section className="jam-section">
        <h3 className="jam-section__title">Miembros · {state.members.length}</h3>
        <ul className="jam-members">
          {state.members.map((m) => (
            <li key={m.id} className={cx('jam-member', !m.connected && 'is-off')}>
              <span className="jam-member__name">
                {m.name}
                {m.id === view.selfId && ' (vos)'}
              </span>
              {m.id === state.adminId && (
                <span className="jam-badge">
                  <Crown size={12} aria-hidden="true" /> Admin
                </span>
              )}
              {!m.connected && <span className="jam-member__off">sin conexión</span>}
              <span className="jam-member__likes" aria-label={`${m.likesReceived} likes recibidos`}>
                <ThumbsUp size={12} aria-hidden="true" /> {m.likesReceived}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {local && admin && connected <= 1 && helpDue && (
        <p className="jam-help" role="note">
          ¿Nadie se puede conectar? La primera vez Windows pregunta por el firewall: permití el acceso en redes privadas. Algunas redes Wi-Fi también aíslan los equipos entre sí; si es el caso, probá una sala por Internet.
        </p>
      )}

      <div className="jam-actions">
        {!(admin && local) && (
          <button type="button" className="btn" onClick={leave}>
            Salir de la sala
          </button>
        )}
        {admin && (
          <button type="button" className="btn btn--danger" onClick={close}>
            Cerrar sala
          </button>
        )}
      </div>
    </div>
  );
}
