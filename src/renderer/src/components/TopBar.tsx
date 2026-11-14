import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import brand from '@shared/assets/brand.png';
import { canGoBack, canGoForward, navigate, useNav } from '../stores/nav';
import { useUi } from '../stores/ui';
import { IconButton } from './IconButton';
import { api } from '../api';

const DEBOUNCE_MS = 350;

export function TopBar({ inert }: { inert?: boolean }) {
  const mobile = api.platform === 'android';
  const route = useNav((s) => s.route);
  const back = useNav((s) => s.back);
  const forward = useNav((s) => s.forward);
  const canBack = useNav(canGoBack);
  const canFwd = useNav(canGoForward);
  const focusTick = useUi((s) => s.focusSearchTick);

  const [text, setText] = useState(route.page === 'search' ? route.q : '');
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // El cuadro refleja la búsqueda abierta (también al ir atrás/adelante) y se vacía al salir de ella.
  useEffect(() => {
    clearTimeout(timer.current);
    setText(route.page === 'search' ? route.q : '');
    return () => clearTimeout(timer.current);
  }, [route]);

  useEffect(() => {
    if (focusTick > 0) {
      input.current?.focus();
      input.current?.select();
    }
  }, [focusTick]);

  const submit = (value: string) => {
    clearTimeout(timer.current);
    const q = value.trim();
    const cur = useNav.getState().route;
    if (!q && cur.page !== 'search') return;
    navigate({ page: 'search', q }, { replace: cur.page === 'search' });
  };

  const onChange = (v: string) => {
    setText(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => submit(v), DEBOUNCE_MS);
  };
  const clear = () => {
    setText('');
    submit('');
    input.current?.focus();
  };

  return (
    <header className="titlebar" inert={inert}>
      <div className="brand">
        <span className="brand__mark" aria-hidden="true">
          <img className="brand__logo" src={brand} alt="" draggable={false} />
        </span>
        <span className="brand__name">Spotaple</span>
      </div>

      {!mobile && (
        <div className="titlebar__nav">
          <IconButton variant="solid" icon={<ChevronLeft size={18} />} label="Atrás (Alt+←)" disabled={!canBack} onClick={back} />
          <IconButton variant="solid" icon={<ChevronRight size={18} />} label="Adelante (Alt+→)" disabled={!canFwd} onClick={forward} />
        </div>
      )}

      <form
        className="search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          submit(text);
        }}
      >
        <Search size={17} className="search__icon" aria-hidden="true" />
        <input
          ref={input}
          className="search__input"
          type="text"
          value={text}
          placeholder="¿Qué querés escuchar?"
          aria-label="Buscar canciones, artistas y álbumes"
          spellCheck={false}
          autoComplete="off"
          maxLength={200}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              if (text) clear();
              else input.current?.blur();
            }
          }}
        />
        {text && (
          <button
            type="button"
            className="search__clear"
            aria-label="Borrar búsqueda"
            onClick={clear}
          >
            <X size={15} aria-hidden="true" />
          </button>
        )}
        <kbd className="search__kbd" aria-hidden="true">
          {api.platform === 'darwin' ? '⌘ K' : 'Ctrl K'}
        </kbd>
      </form>
    </header>
  );
}
