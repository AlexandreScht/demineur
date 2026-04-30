import React from 'react';

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

      <div className="relative w-full h-7 flex items-center group">
        {/* Track Background */}
        <div className="absolute w-full h-2.5 bg-white/5 rounded-full overflow-hidden border border-white/5 backdrop-blur-sm">
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
        <div className="absolute w-full pointer-events-none">
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

        {/* Input */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="absolute w-full inset-0 opacity-0 cursor-pointer z-10"
        />

        {/* Thumb */}
        <div
          className="absolute w-5 h-5 rounded-full pointer-events-none transition-all duration-150 -translate-x-1/2"
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
