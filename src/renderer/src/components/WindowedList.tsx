import { Fragment, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

const OVERSCAN = 400;

export interface ListRowPosition {
  'data-window-index': number;
  'aria-posinset': number;
  'aria-setsize': number;
}

interface Props {
  className: string;
  label: string;
  count: number;
  scrollSelector: string;
  rowHeight: number;
  extraHeight?: (index: number) => number;
  stickyHeader?: number;
  rowKey: (index: number) => string;
  renderRow: (index: number, position: ListRowPosition) => ReactNode;
}

function rowIndex(target: EventTarget | null): number | null {
  const row = target instanceof Element ? target.closest<HTMLElement>('[data-window-index]') : null;
  return row ? Number(row.dataset.windowIndex) : null;
}

/** Monta las filas cercanas al área visible y conserva la fila enfocada o arrastrada. */
export function WindowedList({ className, label, count, scrollSelector, rowHeight, extraHeight, stickyHeader = 0, rowKey, renderRow }: Props) {
  const list = useRef<HTMLUListElement>(null);
  const pendingFocus = useRef<number | null>(null);
  const [range, setRange] = useState({ start: 0, end: 32 });
  const [focused, setFocused] = useState<number | null>(null);
  const [dragged, setDragged] = useState<number | null>(null);
  const offsets = useMemo(() => {
    const positions = [0];
    for (let i = 0; i < count; i++) positions.push(positions[i]! + rowHeight + (extraHeight?.(i) ?? 0));
    return positions;
  }, [count, rowHeight, extraHeight]);

  useLayoutEffect(() => {
    const element = list.current;
    const scroll = element?.closest<HTMLElement>(scrollSelector);
    if (!element || !scroll) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const top = scroll.getBoundingClientRect().top + scroll.clientTop - element.getBoundingClientRect().top;
      const bottom = top + scroll.clientHeight + OVERSCAN;
      const first = offsets.findIndex((_, i) => i < count && offsets[i + 1]! > top - OVERSCAN);
      const last = offsets.findIndex((offset) => offset >= bottom);
      const start = first < 0 ? count : first;
      const end = Math.max(start, last < 0 ? count : last);
      setRange((previous) => previous.start === start && previous.end === end ? previous : { start, end });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    scroll.addEventListener('scroll', schedule, { passive: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(scroll);
    resize.observe(element);
    if (element.parentElement) resize.observe(element.parentElement);
    return () => {
      cancelAnimationFrame(frame);
      scroll.removeEventListener('scroll', schedule);
      resize.disconnect();
    };
  }, [count, offsets, scrollSelector]);

  useLayoutEffect(() => {
    if (pendingFocus.current === null) return;
    const row = list.current?.querySelector<HTMLElement>(`[data-window-index="${pendingFocus.current}"]`);
    if (row) {
      pendingFocus.current = null;
      row.focus({ preventScroll: true });
    }
  });

  const moveFocus = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (!(event.target instanceof HTMLElement) || event.target.dataset.windowIndex === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const index = Number(event.target.dataset.windowIndex);
    const next = index + (event.key === 'ArrowDown' ? 1 : -1);
    const element = list.current;
    const scroll = element?.closest<HTMLElement>(scrollSelector);
    if (next < 0 || next >= count || !element || !scroll) return;
    const top = element.getBoundingClientRect().top - scroll.getBoundingClientRect().top - scroll.clientTop;
    const start = top + offsets[next]!;
    const end = top + offsets[next + 1]!;
    if (start < stickyHeader) scroll.scrollTop += start - stickyHeader;
    else if (end > scroll.clientHeight) scroll.scrollTop += end - scroll.clientHeight;
    pendingFocus.current = next;
    setFocused(next);
  };

  const indices = new Set<number>();
  for (let i = range.start; i < Math.min(range.end, count); i++) indices.add(i);
  for (const i of [focused, dragged]) if (i !== null && i < count) indices.add(i);
  const children: ReactNode[] = [];
  let previous = 0;
  const spacer = (to: number) => {
    const height = offsets[to]! - offsets[previous]!;
    if (height > 0) children.push(<li key={`gap-${previous}`} aria-hidden="true" role="presentation" style={{ height, overflowAnchor: 'none' }} />);
  };
  for (const index of [...indices].sort((a, b) => a - b)) {
    spacer(index);
    children.push(<Fragment key={`row-${rowKey(index)}`}>{renderRow(index, {
      'data-window-index': index,
      'aria-posinset': index + 1,
      'aria-setsize': count,
    })}</Fragment>);
    previous = index + 1;
  }
  spacer(count);

  return (
    <ul
      ref={list}
      className={className}
      aria-label={label}
      onKeyDownCapture={moveFocus}
      onFocusCapture={(event) => setFocused(rowIndex(event.target))}
      onBlurCapture={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setFocused(null);
      }}
      onDragStartCapture={(event) => setDragged(rowIndex(event.target))}
      onDragEndCapture={() => setDragged(null)}
    >
      {children}
    </ul>
  );
}
