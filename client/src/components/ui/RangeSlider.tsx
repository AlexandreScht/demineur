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
  
  // Create an array of dots positions
  const dots = [];
  const numSteps = (max - min) / step;
  
  // Only show dots if there aren't too many of them (e.g. max 50)
  if (numSteps <= 50) {
      for (let i = 0; i <= numSteps; i++) {
        dots.push((i / numSteps) * 100);
      }
  }

  return (
    <div className={`w-full ${className}`}>
      {label && (
        <div className="flex justify-between items-center mb-2">
            <span className="text-slate-400 text-sm font-semibold uppercase tracking-wider">{label}</span>
            {formatValue && <span className="text-white font-mono font-bold">{formatValue(value)}</span>}
        </div>
      )}
      
      <div className="relative w-full h-6 flex items-center">
        {/* Track Background */}
        <div className="absolute w-full h-2 bg-slate-800 rounded-full overflow-hidden">
            {/* Active Track */}
            <div 
                className="h-full bg-blue-600 rounded-full transition-all duration-150"
                style={{ width: `${percentage}%` }}
            />
        </div>

        {/* Dots */}
        <div className="absolute w-full flex justify-between px-[10px] pointer-events-none">
            {dots.map((pos, idx) => (
                <div 
                    key={idx} 
                    className={`w-1 h-1 rounded-full absolute top-1/2 -translate-y-1/2 -translate-x-1/2 transition-colors ${
                        (pos <= percentage + 1) ? 'bg-blue-400/50' : 'bg-slate-600'
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

         {/* Thumb (Visual Only - follows percentage) */}
         <div 
             className="absolute w-5 h-5 bg-white rounded-full shadow-lg shadow-black/50 border-2 border-blue-500 pointer-events-none transition-all duration-150 transform -translate-x-1/2"
             style={{ left: `${percentage}%` }}
         />
      </div>
    </div>
  );
}
