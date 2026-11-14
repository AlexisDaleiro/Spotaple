import { useRef, useState, type DragEvent } from 'react';

export interface ReorderItem {
  props: {
    draggable: true;
    onDragStart: (e: DragEvent) => void;
    onDragOver: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
    onDragEnd: () => void;
  };
  dragging: boolean;
  /** Línea indicadora antes / después de esta fila. */
  dropBefore: boolean;
  dropAfter: boolean;
}

/**
 * Reordenar por arrastre con HTML5 DnD. `onMove(from, to)` recibe índices finales (ya compensados).
 * La alternativa por teclado ("Mover arriba/abajo") vive en el menú contextual de cada lista.
 */
export function useReorder(length: number, onMove: (from: number, to: number) => void) {
  const source = useRef<number | null>(null);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const dropIndex = (event: DragEvent, index: number) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientY > bounds.top + bounds.height / 2 ? index + 1 : index;
  };
  const finish = () => {
    source.current = null;
    setDrag(null);
  };

  return (index: number): ReorderItem => {
    // `over` es un hueco (0..length): arrastrar junto a su propia posición no cambia nada.
    const noop = drag ? drag.over === drag.from || drag.over === drag.from + 1 : true;
    return {
      props: {
        draggable: true,
        onDragStart: (e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(index));
          source.current = index;
          setDrag({ from: index, over: index });
        },
        onDragOver: (e) => {
          const from = source.current;
          if (from === null) return;
          e.preventDefault();
          const over = dropIndex(e, index);
          setDrag((previous) => previous?.over === over ? previous : { from, over });
        },
        onDrop: (e) => {
          e.preventDefault();
          const from = source.current;
          if (from === null) return;
          const over = dropIndex(e, index);
          const to = over > from ? over - 1 : over;
          finish();
          if (to !== from) onMove(from, to);
        },
        onDragEnd: finish,
      },
      dragging: drag?.from === index,
      dropBefore: !!drag && !noop && drag.over === index,
      dropAfter: !!drag && !noop && drag.over === length && index === length - 1,
    };
  };
}
