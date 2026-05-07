"use client";
import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { GridData } from '@/utils/types';

interface MiniMapProps {
    grid: GridData;
    scrollRef: React.RefObject<HTMLDivElement | null>;
    /** Rendered cell pitch in px on the actual board (cell width + gap). */
    cellPitchPx: number;
    /** Maximum minimap edge in CSS px. Width and height stay within this box. */
    maxSize?: number;
}

interface Viewport {
    sx: number;  // scrollLeft in board px
    sy: number;  // scrollTop  in board px
    vw: number;  // visible width (clientWidth)
    vh: number;  // visible height (clientHeight)
    bw: number;  // total board scrollWidth
    bh: number;  // total board scrollHeight
}

export default function MiniMap({ grid, scrollRef, cellPitchPx, maxSize = 96 }: MiniMapProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const [viewport, setViewport] = useState<Viewport | null>(null);
    const [overflows, setOverflows] = useState(false);

    const rows = grid.length;
    const cols = grid[0]?.length || 0;

    // Minimap dimensions in CSS px — proportional to the board, capped by maxSize.
    const { mapW, mapH } = useMemo(() => {
        if (!rows || !cols) return { mapW: 0, mapH: 0 };
        const aspect = cols / rows;
        let w: number, h: number;
        if (aspect >= 1) { w = maxSize; h = maxSize / aspect; }
        else             { h = maxSize; w = maxSize * aspect; }
        return { mapW: Math.round(w), mapH: Math.round(h) };
    }, [rows, cols, maxSize]);

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

    // Paint the cells onto the canvas.
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

        const cw = mapW / cols;
        const ch = mapH / rows;

        // Background (closed cells).
        ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.fillRect(0, 0, mapW, mapH);

        for (let y = 0; y < rows; y++) {
            const row = grid[y];
            if (!row) continue;
            for (let x = 0; x < cols; x++) {
                const cell = row[x];
                if (!cell) continue;
                let color: string | null = null;
                if (cell.isOpen) {
                    color = cell.isMine ? '#fb7185' : 'rgba(56, 189, 248, 0.55)';
                } else if (cell.flag === 1) {
                    color = '#fda4af';
                } else if (cell.flag === 2) {
                    color = '#c4b5fd';
                }
                if (color) {
                    ctx.fillStyle = color;
                    // Pixel-snap with a tiny overlap so adjacent cells don't show seams.
                    const px = Math.floor(x * cw);
                    const py = Math.floor(y * ch);
                    const pw = Math.ceil((x + 1) * cw) - px;
                    const ph = Math.ceil((y + 1) * ch) - py;
                    ctx.fillRect(px, py, pw, ph);
                }
            }
        }
    }, [grid, rows, cols, mapW, mapH]);

    // Tap or drag on the minimap to scroll the board to that location.
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
            top:  Math.max(0, Math.min(viewport.bh - viewport.vh, targetY)),
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

    // Hide minimap entirely if the board fits or grid is empty.
    if (!overflows || !rows || !cols || !viewport) return null;

    // Visible viewport rectangle, mapped from board px → minimap px.
    const vbX = (viewport.sx / viewport.bw) * mapW;
    const vbY = (viewport.sy / viewport.bh) * mapH;
    const vbW = (viewport.vw / viewport.bw) * mapW;
    const vbH = (viewport.vh / viewport.bh) * mapH;

    // Suppress unused-var lint; cellPitchPx kept in API for future tuning.
    void cellPitchPx;

    return (
        <div
            className="md:hidden fixed z-40 select-none touch-none"
            style={{
                top: 'calc(max(0.5rem, env(safe-area-inset-top)) + 56px)',
                right: 'max(0.5rem, env(safe-area-inset-right))',
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
                        border: '1.5px solid rgba(56, 189, 248, 0.95)',
                        boxShadow: '0 0 8px rgba(56, 189, 248, 0.6), inset 0 0 0 1px rgba(255,255,255,0.25)',
                        background: 'rgba(56, 189, 248, 0.1)',
                    }}
                />
            </div>
        </div>
    );
}
