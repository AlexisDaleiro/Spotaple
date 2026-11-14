import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { cx } from '../lib/format';
import { useUi, type DialogSpec } from '../stores/ui';

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const titleId = useId();
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          } else if (e.key === 'Tab') {
            const controls = e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)');
            const first = controls[0];
            const last = controls[controls.length - 1];
            if ((e.shiftKey && e.target === first) || (!e.shiftKey && e.target === last)) {
              e.preventDefault();
              (e.shiftKey ? last : first)?.focus();
            }
          }
        }}
      >
        <h2 id={titleId} className="dialog__title">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

function Prompt({ spec, close }: { spec: Extract<DialogSpec, { kind: 'prompt' }>; close: () => void }) {
  const [value, setValue] = useState(spec.initial ?? '');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.select(), []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim() || busy) return;
    setBusy(true);
    try {
      await spec.onSubmit(value.trim());
    } finally {
      close();
    }
  };
  return (
    <Shell title={spec.title} onClose={close}>
      <form onSubmit={submit}>
        <label className="field">
          <span className="field__label">{spec.label}</span>
          <input ref={input} className="field__input" value={value} maxLength={80} autoFocus onChange={(e) => setValue(e.target.value)} />
        </label>
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={close}>
            Cancelar
          </button>
          <button type="submit" className="btn btn--solid" disabled={!value.trim() || busy}>
            {spec.confirmLabel}
          </button>
        </div>
      </form>
    </Shell>
  );
}

function Confirm({ spec, close }: { spec: Extract<DialogSpec, { kind: 'confirm' }>; close: () => void }) {
  const [busy, setBusy] = useState(false);
  const ok = async () => {
    setBusy(true);
    try {
      await spec.onConfirm();
    } finally {
      close();
    }
  };
  return (
    <Shell title={spec.title} onClose={close}>
      <p className="dialog__text">{spec.message}</p>
      <div className="dialog__actions">
        <button type="button" className="btn" onClick={close} autoFocus>
          Cancelar
        </button>
        <button type="button" className={cx('btn', spec.danger ? 'btn--danger' : 'btn--solid')} disabled={busy} onClick={ok}>
          {spec.confirmLabel}
        </button>
      </div>
    </Shell>
  );
}

export function DialogHost() {
  const dialog = useUi((s) => s.dialog);
  const close = useUi((s) => s.closeDialog);
  if (!dialog) return null;
  return dialog.kind === 'prompt' ? <Prompt spec={dialog} close={close} /> : <Confirm spec={dialog} close={close} />;
}
