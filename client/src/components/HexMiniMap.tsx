"use client";
import { useEffect, useRef, useState, useMemo, useCallback } from 'react';

interface HexCell {
  col: number;
  row: number;
  isMine: boolean;
  revealed: boolean;
  flagged: boolean;
  active: boolean;
}

interface HexMiniMapProps {
  grid: HexCell[][];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** Maximum minimap edge in CSS px. */
  maxSize?: number;
  /** Orientation of hexes: pointy or flat */
  orient: "pointy" | "flat";
}

interface Viewport {
  sx: number;
  sy: number;
  vw: number;
  vh: number;
  bw: number;
  bh: number;
}

export default function HexMiniMap({ grid, scrollRef, maxSize = 110, orient }: HexMiniMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [overflows, setOverflows] = useState(false);

  const cols = grid.length;
  const rows = grid[0]?.length || 0;

  // Minimap dimensions — proportional to the board, capped by maxSize.
  const { mapW, mapH } = useMemo(() => {
    if (!rows || !cols) return { mapW: 0, mapH: 0 };
    // Approximate board aspect ratio depending on orientation
    let boardAspect: number;
    if (orient === "pointy") {
      const hexW = Math.sqrt(3);
      const bw = hexW * cols + hexW / 2;
      const bh = 1.5 * (rows - 1) + 2;
      boardAspect = bw / bh;
    } else {
      const hexH = Math.sqrt(3);
      const bw = 1.5 * (cols - 1) + 2;
      const bh = hexH * rows + hexH / 2;
      boardAspect = bw / bh;
    }
    let w: number, h: number;
    if (boardAspect >= 1) { w = maxSize; h = maxSize / boardAspect; }
    else { h = maxSize; w = maxSize * boardAspect; }
    return { mapW: Math.round(w), mapH: Math.round(h) };
  }, [rows, cols, maxSize, orient]);

  // Track scroll position + overflow state.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const update = () => {
      const bw = el.scrollWidth;
      const bh = el.scrollHeight;
      const vw = el.clientWidth;
      const vh = el.clientHeight;
      const isOverflowing = bw > vw + 1 || bh > vh + 1;
      setOverflows(isOverflowing);
      setViewport({ sx: el.scrollLeft, sy: el.scrollTop, vw, vh, bw, bh });
    };
    update();

    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [scrollRef, grid]);

  // Paint hex cells onto the canvas.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !rows || !cols || !mapW || !mapH) return;

    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    canvas.width = Math.max(1, Math.round(mapW * dpr));
    canvas.height = Math.max(1, Math.round(mapH * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, mapW, mapH);

    // Background
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.fillRect(0, 0, mapW, mapH);

    const SQRT3 = Math.sqrt(3);

    // Compute hex positions in minimap coordinates
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const cell = grid[c]?.[r];
        if (!cell || !cell.active) continue;

        // Map hex position to minimap coords
        let nx: number, ny: number; // normalised 0-1
        if (orient === "pointy") {
          const hexW = SQRT3;
          const totalW = hexW * cols + hexW / 2;
          const totalH = 1.5 * (rows - 1) + 2;
          const cx = hexW * c + (r % 2 === 1 ? hexW / 2 : 0) + hexW / 2;
          const cy = 1.5 * r + 1;
          nx = cx / totalW;
          ny = cy / totalH;
        } else {
          const hexH = SQRT3;
          const totalW = 1.5 * (cols - 1) + 2;
          const totalH = hexH * rows + hexH / 2;
          const cx = 1.5 * c + 1;
          const cy = hexH * r + (c % 2 === 1 ? hexH / 2 : 0) + hexH / 2;
          nx = cx / totalW;
          ny = cy / totalH;
        }

        // Determine dot size and color
        const dotR = Math.max(1.5, Math.min(mapW / cols, mapH / rows) * 0.35);
        let color: string;
        if (cell.revealed && cell.isMine) {
          color = '#fb7185';
        } else if (cell.revealed) {
          color = 'rgba(56, 189, 248, 0.6)';
        } else if (cell.flagged) {
          color = '#fda4af';
        } else {
          color = 'rgba(100, 116, 139, 0.4)';
        }

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(nx * mapW, ny * mapH, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [grid, rows, cols, mapW, mapH, orient]);

  // Tap or drag on the minimap to scroll the board.
  const scrollFromPoint = useCallback((clientX: number, clientY: number) => {
    const el = scrollRef.current;
    const wrap = wrapperRef.current;
    if (!el || !wrap || !viewport) return;
    const rect = wrap.getBoundingClientRect();
    const ratioX = (clientX - rect.left) / rect.width;
    const ratioY = (clientY - rect.top) / rect.height;
    const targetX = ratioX * viewport.bw - viewport.vw / 2;
    const targetY = ratioY * viewport.bh - viewport.vh / 2;
    el.scrollTo({
      left: Math.max(0, Math.min(viewport.bw - viewport.vw, targetX)),
      top: Math.max(0, Math.min(viewport.bh - viewport.vh, targetY)),
      behavior: 'auto',
    });
  }, [scrollRef, viewport]);

  const draggingRef = useRef(false);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrollFromPoint(e.clientX, e.clientY);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    scrollFromPoint(e.clientX, e.clientY);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // Hide minimap if the board fits or grid is empty.
  if (!overflows || !rows || !cols || !viewport) return null;

  // Visible viewport rectangle mapped to minimap.
  const vbX = (viewport.sx / viewport.bw) * mapW;
  const vbY = (viewport.sy / viewport.bh) * mapH;
  const vbW = (viewport.vw / viewport.bw) * mapW;
  const vbH = (viewport.vh / viewport.bh) * mapH;

  return (
    <div
      className="fixed z-40 select-none touch-none"
      style={{
        bottom: 'max(1rem, env(safe-area-inset-bottom))',
        left: 'max(0.75rem, env(safe-area-inset-left))',
      }}
    >
      <div
        ref={wrapperRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="relative rounded-lg overflow-hidden glass-strong"
        style={{
          width: mapW + 8,
          height: mapH + 8,
          padding: 4,
          cursor: 'pointer',
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: mapW, height: mapH, display: 'block', borderRadius: 4 }}
        />
        {/* Visible viewport rectangle */}
        <div
          className="absolute pointer-events-none rounded-[3px]"
          style={{
            left: 4 + vbX,
            top: 4 + vbY,
            width: Math.max(6, vbW),
            height: Math.max(6, vbH),
            border: '1.5px solid rgba(52, 211, 153, 0.95)',
            boxShadow: '0 0 8px rgba(52, 211, 153, 0.6), inset 0 0 0 1px rgba(255,255,255,0.25)',
            background: 'rgba(52, 211, 153, 0.1)',
          }}
        />
      </div>
    </div>
  );
}
