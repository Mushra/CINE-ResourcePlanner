import { useLayoutEffect, useRef } from 'react';

/**
 * Keeps the point under the mouse fixed while Ctrl+wheel zooming a timeline, so zoom focuses where
 * the pointer is instead of around the left edge. Shared by the project Timeline and the cinematic
 * Schedule (LoqTimeline).
 *
 * Call the returned `capture(e)` in the wheel handler *before* applying the new zoom: it records the
 * cursor's position as a fraction of the current (pre-zoom) track. A layout effect then re-aligns
 * `scrollLeft` once the zoom has changed the track width. `labelWidth` is the fixed sticky left
 * column, which does not scale; `trackWidth` is the current track width in px (the post-zoom value
 * on the effect pass, the pre-zoom value when `capture` runs).
 */
export function useZoomAtCursor(
  scrollRef: React.RefObject<HTMLElement | null>,
  labelWidth: number,
  trackWidth: number,
): (e: { clientX: number }) => void {
  const anchorRef = useRef<{ frac: number; pointer: number } | null>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    anchorRef.current = null;
    const el = scrollRef.current;
    if (!el) return;
    // Re-place the same track fraction under the same viewport-relative pointer position.
    el.scrollLeft = labelWidth + anchor.frac * trackWidth - anchor.pointer;
  }, [scrollRef, labelWidth, trackWidth]);

  return (e) => {
    const el = scrollRef.current;
    if (!el || trackWidth <= 0) return;
    const rect = el.getBoundingClientRect();
    const pointer = e.clientX - rect.left;
    const trackOffset = el.scrollLeft + pointer - labelWidth;
    anchorRef.current = { frac: Math.max(0, trackOffset) / trackWidth, pointer };
  };
}
