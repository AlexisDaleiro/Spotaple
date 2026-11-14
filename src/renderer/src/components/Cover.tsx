import { Music } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { cx, hueFrom, thumbUrl } from '../lib/format';

interface Props {
  src?: string;
  /** Lado en px, o 'fill' para ocupar el ancho del contenedor (cuadrada). */
  size: number | 'fill';
  /** Tamaño solicitado al proveedor para una portada que ocupa un espacio adaptable. */
  imageSize?: number;
  round?: boolean;
  /** Texto que da el tono del marcador cuando no hay portada. */
  label?: string;
  className?: string;
}

/** Portada con marcador estable: la caja tiene tamaño fijo, así que cargar la imagen no mueve el diseño. */
export function Cover({ src, size, imageSize, round, label, className }: Props) {
  const url = thumbUrl(src, imageSize ?? (size === 'fill' ? 320 : size));
  // El resultado va atado a la URL que lo produjo, sin efecto que lo reinicie: con la imagen en caché
  // `onLoad` dispara antes que cualquier efecto, y un reinicio posterior la dejaba invisible (opacity 0).
  const [done, setDone] = useState<{ url?: string; ok: boolean }>();
  const state = !url ? 'failed' : done?.url !== url ? 'loading' : done.ok ? 'ready' : 'failed';
  const style = {
    '--hue': hueFrom(label ?? src ?? 'x'),
    ...(size === 'fill' ? {} : { width: size, height: size }),
  } as CSSProperties;

  return (
    <span className={cx('cover', round && 'cover--round', className)} style={style}>
      <Music className="cover__ph" aria-hidden="true" size={size === 'fill' ? 28 : Math.max(14, Math.round((size as number) * 0.4))} />
      {url && state !== 'failed' && (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className={state === 'ready' ? 'is-ready' : undefined}
          onLoad={() => setDone({ url, ok: true })}
          onError={() => setDone({ url, ok: false })}
        />
      )}
    </span>
  );
}
