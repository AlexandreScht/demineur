"use client";
import { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { CellData, GridData } from '@/utils/types';
import { socket } from '@/utils/socket';
import { cn } from '@/utils/cn';
import { Flag, HelpCircle, Bomb } from 'lucide-react';
import { MousePointer2 } from 'lucide-react';

interface GridProps {
  grid: GridData;
  roomId: string;
  isScanning: boolean;
  onScan: () => void;
  myRole?: 'P1' | 'P2' | null;
  skipRows?: number[];
  mobileFlagMode?: boolean;
}

interface CellProps {
    cell: CellData;
    onClick: () => void;
    onRightClick: (e: React.MouseEvent) => void;
    onTap: () => void;
    onLongPress: () => void;
}

const LONG_PRESS_MS = 380;
const MOVE_TOLERANCE_PX = 10;

const Cell = ({ cell, onClick, onRightClick, onTap, onLongPress }: CellProps) => {
    const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const longPressFiredRef = useRef(false);
    const touchStartRef = useRef<{ x: number; y: number } | null>(null);

    const clearLongPressTimer = () => {
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
    };

    const handleTouchStart = (e: React.TouchEvent) => {
        if (e.touches.length !== 1) {
            clearLongPressTimer();
            touchStartRef.current = null;
            return;
        }
        longPressFiredRef.current = false;
        const t = e.touches[0];
        touchStartRef.current = { x: t.clientX, y: t.clientY };
        longPressTimerRef.current = setTimeout(() => {
            longPressFiredRef.current = true;
            onLongPress();
            if (typeof navigator !== 'undefined' && navigator.vibrate) {
                try { navigator.vibrate(35); } catch {}
            }
        }, LONG_PRESS_MS);
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (!touchStartRef.current) return;
        const t = e.touches[0];
        const dx = t.clientX - touchStartRef.current.x;
        const dy = t.clientY - touchStartRef.current.y;
        if (Math.hypot(dx, dy) > MOVE_TOLERANCE_PX) {
            clearLongPressTimer();
            touchStartRef.current = null;
        }
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
        const wasTouching = touchStartRef.current !== null;
        clearLongPressTimer();
        touchStartRef.current = null;
        if (!wasTouching) return;
        // Always preventDefault so the synthesized mouse click is suppressed
        e.preventDefault();
        if (!longPressFiredRef.current) {
            onTap();
        }
    };

    const handleTouchCancel = () => {
        clearLongPressTimer();
        touchStartRef.current = null;
    };

    let content = null;
    // Closed cell — solid raised slate tile with subtle top highlight (frosted but opaque)
    let styleClass = "bg-slate-700/80 hover:bg-slate-600/80 border-slate-500/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),inset_0_-1px_0_rgba(0,0,0,0.25)]";

    if (cell.isOpen) {
        // Open cell — recessed but still solid, calm slate
        styleClass = "bg-slate-800/70 border-slate-600/60 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]";
        if (cell.isMine) {
            styleClass = "bg-rose-900/40 border-rose-700/40";
            if (cell.flag === 1) {
                styleClass = "bg-rose-950/30 border-rose-800/40";
                content = (
                    <div className="relative flex items-center justify-center w-full h-full">
                        <Flag className="w-4 h-4 md:w-5 md:h-5 text-rose-400/90 relative z-10" />
                    </div>
                );
            } else {
                content = <Bomb className="w-4 h-4 md:w-5 md:h-5 text-rose-400/90" />;
            }
        } else if (cell.neighborCount > 0) {
            if (cell.lyingNumbers) {
                content = (
                    <div className="flex items-center justify-center gap-[0.12rem] w-full h-full">
                        <span className="text-[10px] md:text-sm font-bold text-amber-400/90">{cell.lyingNumbers[0]}</span>
                        <span className="text-[0.4rem] md:text-[0.6rem] font-bold text-amber-400/70">/</span>
                        <span className="text-[10px] md:text-sm font-bold text-amber-400/90">{cell.lyingNumbers[1]}</span>
                    </div>
                );
            } else {
                // Muted palette inspired by the original — cohesive with the dark slate cell
                const colors = [
                    '',
                    'text-sky-400',
                    'text-emerald-400',
                    'text-rose-400',
                    'text-violet-400',
                    'text-amber-500',
                    'text-pink-400',
                    'text-teal-300',
                    'text-slate-300',
                ];
                content = <span className={`text-xs md:text-sm font-bold ${colors[cell.neighborCount]}`}>{cell.neighborCount}</span>;
            }
        }
    } else {
        if (cell.flag === 1) content = <Flag className="w-4 h-4 md:w-5 md:h-5 text-rose-400/90" />;
        if (cell.flag === 2) content = <HelpCircle className="w-4 h-4 md:w-6 md:h-6 text-violet-300/90" />;
        if (cell.scanned === 'mine') {
            styleClass = "bg-rose-800/40 border-rose-700/50";
        } else if (cell.scanned === 'safe') {
            styleClass = "bg-emerald-700/40 border-emerald-600/50";
        }
    }

    return (
        <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={cn(
                "w-full aspect-square border rounded-md flex items-center justify-center cursor-pointer select-none transition-colors duration-100",
                styleClass
            )}
            style={{ touchAction: 'manipulation' }}
            onClick={onClick}
            onContextMenu={onRightClick}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchCancel}
            whileHover={{ scale: 1.06, zIndex: 10 }}
            whileTap={{ scale: 0.94 }}
        >
            {content}
        </motion.div>
    );
};

export default function Grid({ grid, roomId, isScanning, onScan, skipRows, mobileFlagMode }: GridProps) {
    const [cursors, setCursors] = useState<{ [id: string]: { x: number, y: number, role: 'P1'|'P2' } }>({});
    const lastEmit = useRef(0);
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        const check = () => setIsMobile(window.innerWidth < 768);
        check();
        window.addEventListener('resize', check);
        return () => window.removeEventListener('resize', check);
    }, []);

    useEffect(() => {
        socket.on('partner_cursor', ({ id, x, y, role }) => {
            setCursors(prev => ({ ...prev, [id]: { x, y, role } }));
        });

        socket.on('partner_leave', ({ id }) => {
            setCursors(prev => {
                const newCursors = { ...prev };
                delete newCursors[id];
                return newCursors;
            });
        });

        return () => {
            socket.off('partner_cursor');
            socket.off('partner_leave');
        };
    }, []);

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        const now = Date.now();
        if (now - lastEmit.current < 30) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;

        socket.emit('cursor_move', { x, y, roomId });
        lastEmit.current = now;
    };

    const handleMouseLeave = () => {
        socket.emit('cursor_leave', { roomId });
    };

    // Desktop mouse: left-click reveals (or scans). On mobile devices that
    // synthesize click events (rare since touchend preventDefault suppresses them),
    // honour the flag-mode toggle so tapping flags instead of revealing.
    const handleMouseClick = (x: number, y: number) => {
        if (isScanning) {
            socket.emit('scan_cell', { x, y, roomId });
            onScan();
        } else if (isMobile && mobileFlagMode) {
            socket.emit('flag_cell', { x, y, roomId });
        } else {
            socket.emit('click_cell', { x, y, roomId });
        }
    };

    const handleRightClick = (e: React.MouseEvent, x: number, y: number) => {
        e.preventDefault();
        socket.emit('flag_cell', { x, y, roomId });
    };

    // Mobile touch: short tap respects mobileFlagMode AND never reveals a flagged cell —
    // a tap on a flag/question simply cycles its state without opening the cell.
    const handleTouchTap = (cell: CellData, x: number, y: number) => {
        if (isScanning) {
            socket.emit('scan_cell', { x, y, roomId });
            onScan();
            return;
        }
        if (cell.isOpen) return;
        if (cell.flag !== 0) {
            // Cycle flag state on a flagged/question cell — never reveal.
            socket.emit('flag_cell', { x, y, roomId });
            return;
        }
        if (mobileFlagMode) {
            socket.emit('flag_cell', { x, y, roomId });
        } else {
            socket.emit('click_cell', { x, y, roomId });
        }
    };

    // Mobile long-press: always places/cycles a flag on a closed cell.
    const handleTouchLongPress = (cell: CellData, x: number, y: number) => {
        if (cell.isOpen) return;
        if (isScanning) return;
        socket.emit('flag_cell', { x, y, roomId });
    };

    return (
        <div
            className="relative w-full h-full"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
        >
            <div
                className="grid gap-x-[2px] gap-y-[2px] md:gap-x-1 md:gap-y-[4px]"
                style={{
                    gridTemplateColumns: isMobile
                        ? `repeat(${grid[0]?.length || 0}, 30px)`
                        : `repeat(${grid[0]?.length || 0}, minmax(0, 1fr))`
                }}
            >
                {grid.map((row, y) => (
                    (skipRows?.includes(y)) ? null :
                    row.map((cell, x) => (
                        <Cell
                            key={`${x}-${y}`}
                            cell={cell}
                            onClick={() => handleMouseClick(x, y)}
                            onRightClick={(e) => handleRightClick(e, x, y)}
                            onTap={() => handleTouchTap(cell, x, y)}
                            onLongPress={() => handleTouchLongPress(cell, x, y)}
                        />
                    ))
                ))}
            </div>

            {Object.entries(cursors).map(([id, pos]) => (
                <div
                    key={id}
                    className="absolute pointer-events-none z-50 transition-all duration-75 ease-linear hidden md:block"
                    style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                >
                    <MousePointer2
                        className="w-7 h-7 drop-shadow-[0_0_10px_rgba(167,139,250,0.7)] text-violet-300 fill-violet-300/30"
                        strokeWidth={1.5}
                    />
                </div>
            ))}
        </div>
    );
}
