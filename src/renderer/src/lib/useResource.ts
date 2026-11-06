import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../api';

export interface Resource<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Carga asíncrona con protección contra respuestas fuera de orden:
 * si `deps` cambia mientras hay una petición en vuelo, la respuesta vieja se descarta.
 */
export function useResource<T>(load: () => Promise<T>, deps: unknown[]): Resource<T> {
  const [state, setState] = useState<{ data?: T; error: string | null; loading: boolean }>({ error: null, loading: true });
  const token = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const run = useCallback(() => {
    const mine = ++token.current;
    setState({ error: null, loading: true });
    loadRef.current().then(
      (data) => mine === token.current && setState({ data, error: null, loading: false }),
      (e) => mine === token.current && setState({ error: errorMessage(e), loading: false }),
    );
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(run, deps);
  useEffect(() => () => void token.current++, []);

  return { data: state.data, error: state.error, loading: state.loading, reload: run };
}
