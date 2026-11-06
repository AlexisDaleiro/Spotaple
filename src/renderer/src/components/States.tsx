import { LoaderCircle, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../lib/format';

export const Spinner = ({ size = 16 }: { size?: number }) => <LoaderCircle className="spin" size={size} aria-hidden="true" />;

export function Empty({ icon, title, text, action, heading: Heading = 'h2' }: { icon: ReactNode; title: string; text?: string; action?: ReactNode; heading?: 'h1' | 'h2' }) {
  return (
    <div className="empty">
      <div className="empty__icon" aria-hidden="true">
        {icon}
      </div>
      <Heading className="empty__title">{title}</Heading>
      {text && <p className="empty__text">{text}</p>}
      {action && <div className="empty__action">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="empty" role="alert">
      <div className="empty__icon empty__icon--error" aria-hidden="true">
        <WifiOff size={26} />
      </div>
      <h2 className="empty__title">No se pudo cargar</h2>
      <p className="empty__text">{message}</p>
      {onRetry && (
        <div className="empty__action">
          <button type="button" className="btn btn--solid" onClick={onRetry}>
            Reintentar
          </button>
        </div>
      )}
    </div>
  );
}

/** Esqueleto con la altura final de una fila: evita saltos al llegar los datos. */
export function RowsSkeleton({ n = 8 }: { n?: number }) {
  return (
    <div className="skel-rows" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="skel-row">
          <span className="skel skel--sq" />
          <span className="skel-col">
            <span className="skel skel--line" style={{ width: `${48 + ((i * 17) % 32)}%` }} />
            <span className="skel skel--line skel--short" style={{ width: `${24 + ((i * 11) % 20)}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}

export function CardsSkeleton({ n = 6, round }: { n?: number; round?: boolean }) {
  return (
    <div className="skel-cards" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="skel-card">
          <span className={cx('skel skel--cover', round && 'skel--round')} />
          <span className="skel skel--line" style={{ width: '70%' }} />
          <span className="skel skel--line skel--short" style={{ width: '45%' }} />
        </div>
      ))}
    </div>
  );
}
