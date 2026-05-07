"use client";
import React, { useCallback, useRef } from 'react';

interface RangeSliderProps {
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  label?: string;
  formatValue?: (value: number) => React.ReactNode;
  className?: string;
}

export default function RangeSlider({
  min,
  max,
  value,
  onChange,
  step = 1,
  label,
  formatValue,
  className = '',
}: RangeSliderProps) {
  const percentage = ((value - min) / (max - min)) * 100;

  const dots: number[] = [];
  const numSteps = (max - min) / step;
  if (numSteps <= 50) {
    for (let i = 0; i <= numSteps; i++) {
      dots.push((i / numSteps) * 100);
    }
  }

  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const valueFromClientX = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return value;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return value;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const raw = min + ratio * (max - min);
    const steps = Math.round((raw - min) / step);
    const next = min + steps * step;
    // Floating-point safety: round to step precision
    const decimals = (step.toString().split('.')[1] || '').length;
    const rounded = decimals > 0 ? parseFloat(next.toFixed(decimals)) : next;
    return Math.max(min, Math.min(max, rounded));
  }, [min, max, step, value]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    onChange(valueFromClientX(e.clientX));
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    onChange(valueFromClientX(e.clientX));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    let next = value;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = value - step;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = value + step;
    else if (e.key === 'Home') next = min;
    else if (e.key === 'End') next = max;
    else return;
    e.preventDefault();
    onChange(Math.max(min, Math.min(max, next)));
  };

  return (
    <div className={`w-full ${className}`}>
      {label && (
        <div className="flex justify-between items-center mb-3">
          <span className="text-slate-300/80 text-xs font-semibold uppercase tracking-[0.15em]">{label}</span>
          {formatValue && (
            <span className="text-white font-mono font-bold text-sm px-2.5 py-1 rounded-lg bg-white/5 border border-white/10">
              {formatValue(value)}
            </span>
          )}
        </div>
      )}

      {/* Wrapper is a tall, generous touch target. Inner track stays slim. */}
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-label={label}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
        // touch-action: none so a horizontal drag isn't swallowed by the
        // body-level `pan-x pan-y` that we use to block pinch-zoom.
        style={{ touchAction: 'none' }}
        className="relative w-full h-9 flex items-center cursor-pointer select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 rounded-full"
      >
        {/* Track Background */}
        <div className="absolute left-0 right-0 h-2.5 bg-white/5 rounded-full overflow-hidden border border-white/5 backdrop-blur-sm pointer-events-none">
          {/* Active Track with gradient */}
          <div
            className="h-full rounded-full transition-all duration-150 relative"
            style={{
              width: `${percentage}%`,
              background: 'linear-gradient(90deg, #38bdf8 0%, #a78bfa 100%)',
              boxShadow: '0 0 12px rgba(56, 189, 248, 0.5)',
            }}
          >
            <div className="absolute inset-0 rounded-full bg-gradient-to-b from-white/30 to-transparent" />
          </div>
        </div>

        {/* Dots */}
        <div className="absolute left-0 right-0 pointer-events-none">
          {dots.map((pos, idx) => (
            <div
              key={idx}
              className={`w-1 h-1 rounded-full absolute top-1/2 -translate-y-1/2 -translate-x-1/2 transition-colors ${
                pos <= percentage + 1 ? 'bg-white/70' : 'bg-white/15'
              }`}
              style={{ left: `${pos}%` }}
            />
          ))}
        </div>

        {/* Thumb */}
        <div
          className="absolute w-5 h-5 rounded-full pointer-events-none transition-[left] duration-75 -translate-x-1/2"
          style={{
            left: `${percentage}%`,
            background: 'linear-gradient(135deg, #ffffff 0%, #e0e7ff 100%)',
            boxShadow:
              '0 0 0 1px rgba(56,189,248,0.6), 0 0 18px rgba(56,189,248,0.5), inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -1px 0 rgba(0,0,0,0.15)',
          }}
        />
      </div>
    </div>
  );
}
