import { WifiOff } from 'lucide-react';
import { useOffline } from '../stores/offline';

/**
 * Aviso sobre el contenido cuando no hay red. El contenedor es siempre una región de estado (vacía no se ve), así que
 * los lectores de pantalla anuncian el texto cuando aparece.
 */
export function OfflineBanner() {
  const online = useOffline((s) => s.online);
  return (
    <div className="offline-banner" role="status">
      {!online && (
        <>
          <WifiOff size={15} aria-hidden="true" />
          <span>Sin conexión. Solo suenan las canciones descargadas.</span>
        </>
      )}
    </div>
  );
}
