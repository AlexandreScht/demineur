"use client";
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { CellData, GridData } from '@/utils/types';
import { socket } from '@/utils/socket';
import { cn } from '@/utils/cn';
import { Flag, HelpCircle, Bomb } from 'lucide-react';
import { useRef } from 'react';
import { MousePointer2 } from 'lucide-react';

interface GridProps {
  grid: GridData;
  roomId: string;
  isScanning: boolean;
  onScan: () => void;
  myRole?: 'P1' | 'P2' | null;
}

const Cell = ({ cell, onClick, onRightClick }: { cell: CellData, onClick: () => void, onRightClick: (e: React.MouseEvent) => void }) => {
    // Determine content
    let content = null;
    let styleClass = "bg-slate-700 hover:bg-slate-600";
    
    if (cell.isOpen) {
        styleClass = "bg-slate-800";
        if (cell.isMine) {
            styleClass = "bg-red-900/30 border-red-800";
            if (cell.flag === 1) {
                styleClass = "bg-red-950/20 border-red-800"; 
                content = (
                    <div className="relative flex items-center justify-center w-full h-full">
                        <Flag className="w-6 h-6 text-red-500 relative z-10 drop-shadow-md" />
                    </div>
                );
            } else {
                content = <Bomb className="w-5 h-5 text-red-700" />;
            }
        } else if (cell.neighborCount > 0) {
            // Quantum display, Lying numbers or Normal
            if (cell.quantumRange) {
                content = <span className="text-yellow-400 font-mono text-sm tracking-tighter opacity-80 blink-anim">{cell.quantumRange}</span>;
            } else if (cell.lyingNumbers) {
                content = (
                    <div className="flex items-center justify-center gap-[0.12rem] w-full h-full">
                        <span className="text-xs md:text-sm font-black text-orange-400 drop-shadow-sm">{cell.lyingNumbers[0]}</span>
                        <span className="text-[0.5rem] md:text-[0.6rem] font-black text-orange-400 drop-shadow-sm">-</span>
                        <span className="text-xs md:text-sm font-black text-orange-400 drop-shadow-sm">{cell.lyingNumbers[1]}</span>
                    </div>
                );
            } else {
                const colors = [
                    '', 'text-blue-400', 'text-green-400', 'text-red-400', 'text-purple-400', 
                    'text-yellow-600', 'text-pink-400', 'text-teal-400', 'text-gray-400'
                ];
                content = <span className={`font-bold ${colors[cell.neighborCount]}`}>{cell.neighborCount}</span>;
            }
        }
    } else {
        // Closed State
        if (cell.flag === 1) content = <Flag className="w-6 h-6 text-red-500" />;
        if (cell.flag === 2) content = <HelpCircle className="w-7 h-7 text-violet-400" />;
        if (cell.scanned === 'mine') {
            styleClass = "bg-red-800/30 border-2 border-red-900";
        } else if (cell.scanned === 'safe') {
            styleClass = "bg-green-500/50 border-2 border-green-700";
        }
    }

    return (
        <motion.div
            layout
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={cn(
                "w-8 h-8 md:w-10 md:h-10 border border-slate-600 rounded-sm flex items-center justify-center cursor-pointer select-none transition-colors duration-100",
                styleClass
            )}
            onClick={onClick}
            onContextMenu={onRightClick}
            whileHover={{ scale: 1.05, zIndex: 10 }}
            whileTap={{ scale: 0.95 }}
        >
            {content}
        </motion.div>
    );
};

export default function Grid({ grid, roomId, isScanning, onScan }: GridProps) {
    const [cursors, setCursors] = useState<{ [id: string]: { x: number, y: number, role: 'P1'|'P2' } }>({});
    const lastEmit = useRef(0);

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
        const x = e.clientX - rect.left + e.currentTarget.scrollLeft;
        const y = e.clientY - rect.top + e.currentTarget.scrollTop;

        socket.emit('cursor_move', { x, y, roomId });
        lastEmit.current = now;
    };

    const handleMouseLeave = () => {
        socket.emit('cursor_leave', { roomId });
    };

    const handleCellClick = (x: number, y: number) => {
        if (isScanning) {
            socket.emit('scan_cell', { x, y, roomId });
            onScan();
        } else {
            socket.emit('click_cell', { x, y, roomId });
        }
    };

    const handleRightClick = (e: React.MouseEvent, x: number, y: number) => {
        e.preventDefault();
        socket.emit('flag_cell', { x, y, roomId });
    };

    return (
        <div 
            className="relative bg-slate-900/50 p-4 rounded-xl shadow-2xl overflow-hidden border border-slate-700/50 backdrop-blur-sm"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
        >
            <div 
                className="grid gap-1"
                style={{ 
                    gridTemplateColumns: `repeat(${grid[0]?.length || 0}, minmax(0, 1fr))` 
                }}
            >
                {grid.map((row, y) => (
                    row.map((cell, x) => (
                        <Cell 
                            key={`${x}-${y}`} 
                            cell={cell} 
                            onClick={() => handleCellClick(x, y)}
                            onRightClick={(e) => handleRightClick(e, x, y)}
                        />
                    ))
                ))}
            </div>
            
            {Object.entries(cursors).map(([id, pos]) => (
                <div 
                    key={id}
                    className="absolute pointer-events-none z-50 transition-all duration-75 ease-linear"
                    style={{ left: pos.x, top: pos.y }}
                >
                     <MousePointer2 
                        className="w-8 h-8 drop-shadow-[0_0_10px_rgba(250,204,21,0.5)] text-yellow-400 fill-yellow-400/20" 
                        strokeWidth={1.5}
                     />
                </div>
            ))}
        </div>
    );
}
