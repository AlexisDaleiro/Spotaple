import { Music } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { cx, hueFrom, thumbUrl } from '../lib/format';

interface Props {
  src?: string;
  /** Lado en px, o 'fill' para ocupar el ancho del contenedor (cuadrada). */
  size: number | 'fill';
  round?: boolean;
  /** Texto que da el tono del marcador cuando no hay portada. */
  label?: string;
  className?: string;
}

/** Portada con marcador estable: la caja tiene tamaño fijo, así que cargar la imagen no mueve el diseño. */
export function Cover({ src, size, round, label, className }: Props) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>(src ? 'loading' : 'failed');
  useEffect(() => setState(src ? 'loading' : 'failed'), [src]);

  const url = thumbUrl(src, size === 'fill' ? 320 : size);
  const style = {
    '--hue': hueFrom(label ?? src ?? 'x'),
    ...(size === 'fill' ? {} : { width: size, height: size }),
  } as CSSProperties;

  return (
    <div className={cx('cover', round && 'cover--round', className)} style={style}>
      <Music className="cover__ph" aria-hidden="true" size={size === 'fill' ? 28 : Math.max(14, Math.round((size as number) * 0.4))} />
      {url && state !== 'failed' && (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className={state === 'ready' ? 'is-ready' : undefined}
          onLoad={() => setState('ready')}
          onError={() => setState('failed')}
        />
      )}
    </div>
  );
}
