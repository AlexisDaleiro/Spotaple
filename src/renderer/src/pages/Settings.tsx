import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { LIMITS } from '@shared/jam/types';
import { TEXT_SCALES, THEMES, type AppSettings, type ThemeId } from '@shared/settings';
import { cx } from '../lib/format';
import { settingsStore, useSettings } from '../stores/settings';

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
  const hintId = useId();
  return (
    <fieldset className="set-row" aria-describedby={hint ? hintId : undefined}>
      <legend className="set-row__label">{legend}</legend>
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
    </fieldset>
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
  const hintId = useId();
  // Sin acento propio, el selector parte del que usa el tema actual.
  const themeAccent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const current = accent ?? themeAccent;
  return (
    <fieldset className="set-row" aria-describedby={hintId}>
      <legend className="set-row__label">Color de acento</legend>
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
    </fieldset>
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
      </Group>

      <Group title="Reproducción">
        <Toggle label="Reanudar al abrir la app" hint="Al abrir Spotaple, la canción que estaba en pausa sigue sonando donde la dejaste." on={s.resumeOnOpen} onChange={(resumeOnOpen) => set({ resumeOnOpen })} />
      </Group>

      <Group title="Salas">
        <JamNameRow />
      </Group>

      <Group title="Acerca de">
        <div className="set-row">
          <p className="set-row__label">Spotaple</p>
          <p className="set-row__hint">Versión {__APP_VERSION__}</p>
        </div>
      </Group>
    </div>
  );
}
