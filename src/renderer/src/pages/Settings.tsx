import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { LIMITS } from '@shared/jam/types';
import { EQ_BANDS, EQ_PRESETS, EQ_RANGE_DB, presetFor, type EqPreset } from '@shared/audio';
import { AUDIO_FORMATS, type AudioFormat } from '@shared/offline';
import { MAX_CROSSFADE_S, TEXT_SCALES, THEMES, type AppSettings, type ThemeId } from '@shared/settings';
import { api, errorMessage } from '../api';
import { cx, formatBytes } from '../lib/format';
import { discoverStore } from '../stores/discover';
import { useOffline } from '../stores/offline';
import { persistence, player } from '../player/instance';
import { settingsStore, useSettings } from '../stores/settings';
import { toast, useUi } from '../stores/ui';
import { useUpdates } from '../stores/updates';

/** Cada control escribe con esto: se aplica al instante y se guarda con un pequeño retraso. */
const set = (patch: Partial<AppSettings>) => settingsStore.getState().update(patch);

const SWATCHES = [
  { hex: '#ff5d73', name: 'Coral' },
  { hex: '#ff9f43', name: 'Naranja' },
  { hex: '#ffd60a', name: 'Amarillo' },
  { hex: '#62d9a3', name: 'Verde' },
  { hex: '#38bdf8', name: 'Celeste' },
  { hex: '#8b7cff', name: 'Violeta' },
  { hex: '#e879b9', name: 'Rosa' },
];
const SCALE_LABELS: Record<(typeof TEXT_SCALES)[number], string> = { 0.9: 'Pequeño', 1: 'Normal', 1.1: 'Grande', 1.25: 'Muy grande' };
const THEME_OPTIONS: { value: ThemeId; label: string }[] = [{ value: 'system', label: 'Sistema' }, ...THEMES.map((t) => ({ value: t.id, label: t.label }))];
const FORMAT_OPTIONS: { value: AudioFormat; label: string }[] = (['opus', 'aac'] as const).map((f) => ({ value: f, label: AUDIO_FORMATS[f].label }));

function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="set-group" aria-labelledby={id}>
      <h2 className="h2" id={id}>
        {title}
      </h2>
      <div className="set-card">{children}</div>
    </section>
  );
}

/** Opciones excluyentes: radios nativos con aspecto de botones. */
function Choice<T extends string | number>({ legend, hint, value, options, onChange }: { legend: string; hint?: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const name = useId();
  const labelId = useId();
  const hintId = useId();
  return (
    <div className="set-row" role="radiogroup" aria-labelledby={labelId} aria-describedby={hint ? hintId : undefined}>
      <span className="set-row__label" id={labelId}>
        {legend}
      </span>
      {hint && (
        <p className="set-row__hint" id={hintId}>
          {hint}
        </p>
      )}
      <div className="set-opts">
        {options.map((o) => (
          <label key={o.value} className="set-opt">
            <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** Interruptor: reutiliza el estilo del switch de las salas. */
function Toggle({ label, hint, on, onChange }: { label: string; hint: string; on: boolean; onChange: (v: boolean) => void }) {
  const labelId = useId();
  const hintId = useId();
  return (
    <div className="set-row set-row--inline">
      <div>
        <span className="set-row__label" id={labelId}>
          {label}
        </span>
        <p className="set-row__hint" id={hintId}>
          {hint}
        </p>
      </div>
      <button type="button" role="switch" aria-checked={on} aria-labelledby={labelId} aria-describedby={hintId} className={cx('jam-switch', on && 'is-on')} onClick={() => onChange(!on)}>
        <span className="jam-switch__track" aria-hidden="true">
          <span className="jam-switch__thumb" />
        </span>
      </button>
    </div>
  );
}

function AccentRow({ accent }: { accent: string | null }) {
  const labelId = useId();
  const hintId = useId();
  // Sin acento propio, el selector parte del que usa el tema actual.
  const themeAccent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const current = accent ?? themeAccent;
  return (
    <div className="set-row" role="group" aria-labelledby={labelId} aria-describedby={hintId}>
      <span className="set-row__label" id={labelId}>
        Color de acento
      </span>
      <p className="set-row__hint" id={hintId}>
        El color de los botones principales, la canción que suena y lo que está activo.
      </p>
      <div className="set-swatches">
        {SWATCHES.map((s) => (
          <button key={s.hex} type="button" className="set-swatch" style={{ background: s.hex }} aria-label={s.name} aria-pressed={accent === s.hex} title={s.name} onClick={() => set({ accent: s.hex })} />
        ))}
        <input type="color" className="set-color" aria-label="Elegir otro color de acento" value={/^#[0-9a-f]{6}$/i.test(current) ? current : '#ff5d73'} onChange={(e) => set({ accent: e.target.value })} />
        <button type="button" className="btn btn--ghost" disabled={accent === null} onClick={() => set({ accent: null })}>
          Usar el del tema
        </button>
      </div>
    </div>
  );
}

const fmtHz = (hz: number) => (hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`);
const fmtDb = (db: number) => `${db > 0 ? '+' : db < 0 ? '−' : ''}${Math.abs(db)} dB`;

/**
 * Ecualizador de 10 bandas: preajustes, una barra por banda y preamplificador. Con el ecualizador apagado todo el
 * `fieldset` queda deshabilitado (los valores se conservan).
 */
function EqualizerControls({ on, gains, preamp }: { on: boolean; gains: number[]; preamp: number }) {
  const labelId = useId();
  const current = presetFor(gains, preamp);
  const choose = (p: EqPreset) => set({ eqGains: [...p.gains], eqPreamp: p.preamp });
  const setBand = (i: number, v: number) => set({ eqGains: gains.map((g, j) => (j === i ? v : g)) });
  return (
    <div className={cx('set-row eqset', !on && 'is-off')} role="group" aria-labelledby={labelId}>
      <span className="set-row__label" id={labelId}>
        Ajuste del ecualizador
      </span>
      <div className="eqset__top">
        <label className="eqset__preset">
          Preajuste
          <select disabled={!on} value={current?.id ?? 'custom'} onChange={(e) => choose(EQ_PRESETS.find((p) => p.id === e.target.value)!)}>
            {EQ_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
            {!current && (
              <option value="custom" disabled>
                Personalizado
              </option>
            )}
          </select>
        </label>
        <button type="button" className="btn btn--ghost" disabled={!on || current?.id === 'plano'} onClick={() => choose(EQ_PRESETS[0]!)}>
          Restablecer
        </button>
      </div>
      <div className="eqset__bands">
        {EQ_BANDS.map((hz, i) => (
          <div key={hz} className="eqset__band">
            <output className="eqset__db">{fmtDb(gains[i]!)}</output>
            <input
              type="range"
              className="eqset__range"
              min={-EQ_RANGE_DB}
              max={EQ_RANGE_DB}
              step={0.5}
              value={gains[i]}
              disabled={!on}
              aria-label={fmtHz(hz)}
              aria-valuetext={fmtDb(gains[i]!)}
              onChange={(e) => setBand(i, Number(e.target.value))}
            />
            <span className="eqset__hz" aria-hidden="true">
              {fmtHz(hz)}
            </span>
          </div>
        ))}
      </div>
      <label className="eqset__preamp">
        Preamplificador
        <input
          type="range"
          className="slider"
          min={-EQ_RANGE_DB}
          max={EQ_RANGE_DB}
          step={0.5}
          value={preamp}
          disabled={!on}
          aria-valuetext={fmtDb(preamp)}
          style={{ '--pct': `${((preamp + EQ_RANGE_DB) / (2 * EQ_RANGE_DB)) * 100}%` } as React.CSSProperties}
          onChange={(e) => set({ eqPreamp: Number(e.target.value) })}
        />
        <output>{fmtDb(preamp)}</output>
      </label>
    </div>
  );
}

/** Fundido cruzado: segundos en que la canción que termina se apaga mientras empieza la siguiente (0 = sin fundido). */
function CrossfadeRow({ seconds }: { seconds: number }) {
  const inputId = useId();
  const hintId = useId();
  const text = seconds === 0 ? 'Sin fundido' : `${seconds} s`;
  return (
    <div className="set-row">
      <label className="set-row__label" htmlFor={inputId}>
        Fundido entre canciones
      </label>
      <p className="set-row__hint" id={hintId}>
        La canción que termina se apaga mientras empieza la siguiente. No rige dentro de una sala ni con «repetir una».
      </p>
      <div className="set-range">
        <input
          id={inputId}
          type="range"
          className="slider"
          min={0}
          max={MAX_CROSSFADE_S}
          step={1}
          value={seconds}
          aria-describedby={hintId}
          aria-valuetext={text}
          style={{ '--pct': `${(seconds / MAX_CROSSFADE_S) * 100}%` } as React.CSSProperties}
          onChange={(e) => set({ crossfade: Number(e.target.value) })}
        />
        <output>{text}</output>
      </div>
    </div>
  );
}

/** Cuánto ocupan las descargas y el botón para borrarlas todas (con confirmación). */
function DownloadsRow() {
  const hintId = useId();
  const count = useOffline((s) => s.ids.size);
  const bytes = useOffline((s) => s.bytes);
  const clear = () =>
    useUi.getState().openDialog({
      kind: 'confirm',
      title: 'Borrar todas las descargas',
      message: `Se borran del disco ${count === 1 ? 'la canción descargada' : `las ${count} canciones descargadas`}. Si la descarga automática sigue activada, las favoritas se bajan de nuevo la próxima vez que abras la app.`,
      confirmLabel: 'Borrar todo',
      danger: true,
      onConfirm: async () => {
        try {
          await api.offline.clear();
          toast('Descargas borradas', 'success');
        } catch (e) {
          toast(errorMessage(e), 'error');
        }
      },
    });
  return (
    <div className="set-row set-row--inline">
      <div>
        <span className="set-row__label">Espacio usado</span>
        <p className="set-row__hint" id={hintId}>
          {formatBytes(bytes)} en {count === 1 ? '1 canción descargada' : `${count} canciones descargadas`}.
        </p>
      </div>
      <button type="button" className="btn" disabled={count === 0} aria-describedby={hintId} onClick={clear}>
        Borrar todas las descargas
      </button>
    </div>
  );
}

/** «Reiniciar mis gustos»: las listas y la radio ignoran lo anterior. No borra el historial ni las favoritas. */
function ResetTasteRow() {
  const hintId = useId();
  const reset = () =>
    useUi.getState().openDialog({
      kind: 'confirm',
      title: 'Reiniciar mis gustos',
      message: 'Se ignora lo que escuchaste y las favoritas agregadas hasta ahora para armar las listas y la radio. Tu historial y tus favoritas no se borran.',
      confirmLabel: 'Reiniciar',
      danger: true,
      onConfirm: async () => {
        try {
          discoverStore.getState().set(await api.discover.resetTaste());
          toast('Gustos reiniciados', 'success');
        } catch (e) {
          toast(errorMessage(e), 'error');
        }
      },
    });
  return (
    <div className="set-row set-row--inline">
      <div>
        <span className="set-row__label">Reiniciar mis gustos</span>
        <p className="set-row__hint" id={hintId}>
          Las listas se arman de nuevo solo con lo que escuches desde ahora. No borra tu historial ni tus favoritas.
        </p>
      </div>
      <button type="button" className="btn" aria-describedby={hintId} onClick={reset}>
        Reiniciar mis gustos
      </button>
    </div>
  );
}

function JamNameRow() {
  const hintId = useId();
  const saved = useSettings((s) => s.settings.jamName);
  const [name, setName] = useState(saved);
  useEffect(() => setName(saved), [saved]);
  const commit = () => {
    const next = name.trim();
    if (next !== saved) set({ jamName: next });
  };
  return (
    <form className="set-row" onSubmit={(e: FormEvent) => (e.preventDefault(), commit())}>
      <label className="field">
        <span className="set-row__label">Tu nombre en las salas</span>
        <input className="field__input set-name" value={name} maxLength={LIMITS.name} autoComplete="off" placeholder="Cómo te ven los demás" aria-describedby={hintId} onChange={(e) => setName(e.target.value)} onBlur={commit} />
      </label>
      <p className="set-row__hint" id={hintId}>
        Es el nombre que se propone al crear una sala o unirte a una.
      </p>
    </form>
  );
}

function UpdatesRow() {
  const state = useUpdates((s) => s.state);
  const [saving, setSaving] = useState(false);
  const hintId = useId();
  const status = state?.status;
  const android = api.platform === 'android';
  const messages = {
    unsupported: api.platform === 'darwin'
      ? 'Esta compilación de prueba se actualiza instalando un nuevo archivo DMG.'
      : 'Para recibir actualizaciones, usá la versión instalada de Spotaple para Windows.',
    idle: 'Buscá una versión nueva en GitHub Releases.',
    checking: 'Buscando actualizaciones…',
    current: 'Ya tenés la última versión.',
    error: 'No se pudo buscar o descargar la actualización. Probá de nuevo.',
    downloading: state?.status === 'downloading' && `Descargando la versión ${state.version}${state.percent === undefined ? '…' : ` (${state.percent} %)`}`,
    ready: state?.status === 'ready' && (state.installFailed
      ? 'No se pudo iniciar la instalación. Podés volver a intentarlo.'
      : android
        ? `La versión ${state.version} está lista. Confirmá la instalación en Android.`
        : `La versión ${state.version} está lista. Spotaple se va a cerrar y abrir de nuevo.`),
    installing: 'Reiniciando para instalar la actualización…',
  };

  async function run() {
    try {
      if (status === 'ready') {
        setSaving(true);
        await settingsStore.getState().flush();
        if (!persistence.suspended) await api.state.save(player().snapshot());
        await api.updates.install();
      } else {
        await api.updates.check();
      }
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="set-row set-row--inline">
      <div>
        <p className="set-row__label">Spotaple</p>
        <p className="set-row__hint">Versión {__APP_VERSION__}</p>
        <p className="set-row__hint" id={hintId} role="status">{status && messages[status]}</p>
      </div>
      <button
        type="button"
        className="btn"
        aria-describedby={hintId}
        disabled={saving || !status || status === 'unsupported' || status === 'checking' || status === 'downloading' || status === 'installing'}
        onClick={() => void run()}
      >
        {status === 'ready' || status === 'installing'
          ? (android ? 'Instalar actualización' : 'Reiniciar e instalar')
          : 'Buscar actualizaciones'}
      </button>
    </div>
  );
}

export function SettingsPage() {
  const s = useSettings((x) => x.settings);
  return (
    <div className="page page--settings">
      <h1 className="h1">Ajustes</h1>

      <Group title="Apariencia">
        <Choice legend="Tema" value={s.theme} options={THEME_OPTIONS} onChange={(theme) => set({ theme })} />
        <AccentRow accent={s.accent} />
        <Choice legend="Tamaño del texto" value={s.textScale} options={TEXT_SCALES.map((v) => ({ value: v as number, label: SCALE_LABELS[v] }))} onChange={(textScale) => set({ textScale })} />
        <Choice
          legend="Densidad"
          hint="La compacta muestra más canciones en pantalla."
          value={s.density}
          options={[
            { value: 'comfortable', label: 'Cómoda' },
            { value: 'compact', label: 'Compacta' },
          ]}
          onChange={(density) => set({ density })}
        />
        <Toggle label="Reducir animaciones" hint="Quita los desplazamientos y los rebotes; solo quedan cambios de color y opacidad." on={s.reduceMotion} onChange={(reduceMotion) => set({ reduceMotion })} />
      </Group>

      <Group title="Sonido">
        <Choice
          legend="Calidad de streaming"
          hint="Alta usa el mejor audio disponible. Ahorro de datos usa menos internet a cambio de menos calidad. El cambio vale desde la próxima canción que suene."
          value={s.streamQuality}
          options={[
            { value: 'high', label: 'Alta' },
            { value: 'saver', label: 'Ahorro de datos' },
          ]}
          onChange={(streamQuality) => set({ streamQuality })}
        />
        <Toggle
          label="Normalizar volumen"
          hint="Iguala el volumen entre canciones: baja las que vienen más fuertes y deja como están las más suaves. Vale al instante."
          on={s.normalize}
          onChange={(normalize) => set({ normalize })}
        />
        <Toggle label="Ecualizador" hint="Sube o baja graves, medios y agudos. Vale al instante y se guarda." on={s.eqOn} onChange={(eqOn) => set({ eqOn })} />
        <EqualizerControls on={s.eqOn} gains={s.eqGains} preamp={s.eqPreamp} />
      </Group>

      <Group title="Reproducción">
        <Toggle
          label="Radio automática"
          hint="Cuando se acaba lo que hay en la cola, sigue sola con canciones del mismo artista y de otros parecidos. Con la radio activada, tocar una canción suelta en la búsqueda suena sola y sigue la radio. Apagada, la reproducción se detiene al terminar la cola."
          on={s.radio}
          onChange={(radio) => set({ radio })}
        />
        <CrossfadeRow seconds={s.crossfade} />
        <Toggle label="Reanudar al abrir la app" hint="Al abrir Spotaple, la canción que estaba en pausa sigue sonando donde la dejaste." on={s.resumeOnOpen} onChange={(resumeOnOpen) => set({ resumeOnOpen })} />
      </Group>

      <Group title="Descargas">
        <Toggle
          label="Descargar las favoritas automáticamente"
          hint="Cada canción que marcás como favorita se guarda en tu disco para escucharla sin internet. Se guardan siempre en Opus, la mejor calidad."
          on={s.autoDownload}
          onChange={(autoDownload) => set({ autoDownload })}
        />
        <Choice
          legend="Formato al descargar una canción"
          hint="Es el que aparece primero en el menú «Descargar canción» (clic derecho sobre una canción)."
          value={s.exportFormat}
          options={FORMAT_OPTIONS}
          onChange={(exportFormat) => set({ exportFormat })}
        />
        <DownloadsRow />
      </Group>

      <Group title="Hecho para vos">
        <Toggle
          label="Mostrar «Hecho para vos» en Inicio"
          hint="Listas armadas con lo que escuchás y tus favoritas: Descubrimiento semanal, Mixes diarios, Release Radar y artistas que podrías escuchar. Todo sale de tu historial en esta PC."
          on={s.forYou}
          onChange={(forYou) => set({ forYou })}
        />
        <ResetTasteRow />
      </Group>

      <Group title="Salas">
        <JamNameRow />
      </Group>

      <Group title="Acerca de">
        <UpdatesRow />
      </Group>
    </div>
  );
}
