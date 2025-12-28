"use client";
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import { socket } from '@/utils/socket';
import { GridData, CellData, GameInitData } from '@/utils/types';
import Grid from '@/components/Grid';
import GameContainer from '@/components/GameContainer';
import { Activity, Zap, Heart, Flag as FlagIcon } from 'lucide-react';

export default function Home() {
  const [inRoom, setInRoom] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [grid, setGrid] = useState<GridData>([]);
  const [hp, setHp] = useState(3);
  const [isExploding, setIsExploding] = useState(false);
  const [isGameOver, setIsGameOver] = useState(false);
  const [myRole, setMyRole] = useState<'P1' | 'P2' | null>(null);

  // Setup state
  const [setupMode, setSetupMode] = useState<'classic' | 'hardcore' | null>(null);
  const [difficulty, setDifficulty] = useState('medium');
  const [customHp, setCustomHp] = useState(3);
  const [minesCount, setMinesCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const [score, setScore] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const handleCopyRoomId = () => {
      navigator.clipboard.writeText(roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
  };

  // Calculate flags
  const flagsCount = grid.flat().filter(cell => cell.flag === 1).length;
  const remainingMines = minesCount - flagsCount;

  useEffect(() => {
    socket.connect();
    
    function onRoomCreated(id: string) {
      setRoomId(id);
      setInRoom(true);
      setIsGameOver(false);
      setScore(0);
    }
    // ... existing listeners ...
    const onInitGame = (data: GameInitData) => {
        setGrid(data.grid);
        setHp(data.hp);
        setInRoom(true);
        setIsGameOver(false);
        setMinesCount(data.mines); 
        if (data.role) setMyRole(data.role);
        setScore(0);
    };

    function onUpdateGrid(changes: CellData[]) {
        setGrid(prev => {
            const newGrid = [...prev];
            changes.forEach((cell: CellData) => {
                newGrid[cell.y][cell.x] = cell;
            });
            return newGrid;
        });
    }
    
    function onLevelComplete({ grid: newGrid, score: newScore, mines }: { grid: GridData, score: number, mines: number }) {
        setIsTransitioning(true);
        // Play success sound?
        
        // Wait for animation
        setTimeout(() => {
            setGrid(newGrid);
            setScore(newScore);
            setMinesCount(mines);
            setIsTransitioning(false);
        }, 1000); // 1s animation duration
    }

    function onExplosion({ hp }: { x: number, y: number, hp: number }) {
        setHp(hp);
        setIsExploding(true);
        setTimeout(() => setIsExploding(false), 500);
    }

    function onGameOver() {
        setIsGameOver(true);
    }

    function onUpdateMines({ mines }: { mines: number }) {
        setMinesCount(mines);
    }

    socket.on('room_created', onRoomCreated);
    socket.on('init_game', onInitGame);
    socket.on('update_grid', onUpdateGrid);
    socket.on('update_mines', onUpdateMines);
    socket.on('level_complete', onLevelComplete);
    socket.on('explosion', onExplosion);
    socket.on('game_over', onGameOver);

    return () => {
      socket.off('room_created', onRoomCreated);
      socket.off('init_game', onInitGame);
      socket.off('update_grid', onUpdateGrid);
      socket.off('update_mines', onUpdateMines);
      socket.off('level_complete', onLevelComplete);
      socket.off('explosion', onExplosion);
      socket.off('game_over', onGameOver);
      socket.disconnect();
    };
  }, []);

  const leaveRoom = () => {
      setInRoom(false);
      setRoomId('');
      setGrid([]);
      setHp(3);
      setIsGameOver(false);
      setScore(0);
      socket.emit('leave_room', roomId);
  };
  
  const joinRoom = (id: string) => {
    socket.emit('join_room', id);
  };

  const startGame = () => {
      if (!setupMode) return;
      socket.emit('create_room', { mode: setupMode, difficulty, hp: customHp });
  };

  const restartGame = () => {
      if (!setupMode) return;
      socket.emit('restart_game', { roomId, mode: setupMode, difficulty, hp: customHp });
      setIsGameOver(false); 
  };

  if (!inRoom) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-black text-white p-6 md:p-24 relative overflow-hidden">
        {/* Ambient Background */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,var(--tw-gradient-stops))] from-blue-900/20 via-black to-black z-0 pointer-events-none" />
        
        <div className="z-10 flex flex-col items-center gap-8 w-full max-w-lg">
            <h1 className="text-5xl md:text-7xl font-black bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 bg-clip-text text-transparent tracking-tighter text-center mb-4 drop-shadow-lg">
                DEMINEURS V2
            </h1>
            
            {!setupMode ? (
                // MODE SELECTION
                <div className="flex flex-col gap-6 w-full">
                    <button 
                        onClick={() => setSetupMode('classic')}
                        className="group relative px-8 py-6 bg-slate-900/80 border border-blue-500/30 rounded-2xl hover:border-blue-500 hover:shadow-[0_0_30px_rgba(59,130,246,0.3)] transition-all flex flex-col items-center gap-2 overflow-hidden"
                    >
                        <div className="absolute inset-0 bg-blue-500/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                        <span className="text-2xl font-bold text-blue-400 group-hover:text-white transition-colors relative z-10">CLASSIC MODE</span>
                        <span className="text-slate-400 text-sm relative z-10">Standard Minesweeper experience.</span>
                    </button>
                    
                    <button 
                        onClick={() => setSetupMode('hardcore')}
                        className="group relative px-8 py-6 bg-slate-900/80 border border-purple-500/30 rounded-2xl hover:border-purple-500 hover:shadow-[0_0_30px_rgba(168,85,247,0.3)] transition-all flex flex-col items-center gap-2 overflow-hidden"
                    >
                        <div className="absolute inset-0 bg-purple-500/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                        <div className="flex items-center gap-2 relative z-10">
                            <Zap className="w-6 h-6 text-yellow-400 animate-pulse" />
                            <span className="text-2xl font-bold text-purple-400 group-hover:text-white transition-colors">INFINITE MODE</span>
                        </div>
                        <span className="text-slate-400 text-sm relative z-10">Uncertainty & Ambiguous numbers.</span>
                    </button>

                     <div className="flex gap-2 w-full mt-8">
                        <input 
                            type="text" 
                            placeholder="Have a code? Enter Room ID" 
                            className="flex-1 px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-blue-500 transition-colors placeholder:text-slate-500"
                            onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                        />
                        <button 
                            onClick={() => joinRoom(roomId)}
                            className="px-6 py-3 bg-slate-700 hover:bg-slate-600 rounded-lg font-bold text-white transition-colors"
                        >
                            JOIN
                        </button>
                    </div>
                </div>
            ) : (
                // SETUP SCREEN
                <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="w-full bg-slate-900/90 border border-slate-700 p-8 rounded-2xl shadow-xl backdrop-blur-md flex flex-col gap-6"
                >
                    <div className="flex justify-between items-center mb-2">
                        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                            {setupMode === 'classic' ? <Activity className="text-blue-500"/> : <Zap className="text-purple-500"/>}
                            Setup Game
                        </h2>
                        <button onClick={() => setSetupMode(null)} className="text-slate-500 hover:text-white text-sm hover:underline">Cancel</button>
                    </div>

                    {/* Difficulty */}
                    <div className="space-y-3">
                        <label className="text-slate-400 text-sm font-semibold uppercase tracking-wider">Difficulty</label>
                        <div className="grid grid-cols-4 gap-2">
                            {['easy', 'medium', 'hard', 'hardcore'].map((d) => (
                                <button
                                    key={d}
                                    onClick={() => setDifficulty(d)}
                                    className={`py-2 rounded-lg font-bold capitalize transition-all ${
                                        difficulty === d 
                                        ? 'bg-blue-600 text-white shadow-lg' 
                                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                                    }`}
                                >
                                    {d}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* HP */}
                    <div className="space-y-3">
                        <label className="text-slate-400 text-sm font-semibold uppercase tracking-wider">Health Points (HP)</label>
                        <div className="flex items-center gap-4 bg-slate-800 p-4 rounded-lg">
                            <input 
                                type="range" 
                                min="1" 
                                max="10" 
                                value={customHp} 
                                onChange={(e) => setCustomHp(parseInt(e.target.value))}
                                className="w-full accent-blue-500"
                            />
                            <div className="flex items-center gap-1 min-w-12 font-bold text-xl text-white">
                                {customHp} <span className="text-red-500">♥</span>
                            </div>
                        </div>
                    </div>

                    <button 
                        onClick={startGame}
                        className={`w-full py-4 mt-4 rounded-xl font-bold text-xl shadow-lg transition-all transform hover:scale-[1.02] active:scale-[0.98] ${
                            setupMode === 'classic' 
                            ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/20' 
                            : 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-900/20'
                        }`}
                    >
                        START GAME
                    </button>
                </motion.div>
            )}
        </div>
      </main>
    );
  }

  return (
    <GameContainer isExploding={isExploding} difficulty={difficulty}>
      <header className="w-full flex justify-between items-center mb-8 px-4 max-w-7xl mx-auto">
          <div className="flex gap-4 items-center">
             <button onClick={leaveRoom} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded text-sm font-bold text-slate-200 transition-colors border border-slate-700">
                ← MENU
             </button>
             
             {/* Scoreboard */}
             {setupMode === 'hardcore' && (
                 <div className="flex items-center gap-2 bg-purple-900/50 px-4 py-1.5 rounded-lg border border-purple-500/50">
                     <span className="text-purple-300 font-bold text-sm">LEVEL</span>
                     <span className="text-white font-mono text-xl font-bold">{score + 1}</span>
                 </div>
             )}
             
             {/* Mine Counter */}
             <div className="flex items-center gap-2 bg-slate-900/50 px-3 py-1.5 rounded-lg border border-slate-700/50">
                   <div className={`font-mono text-xl font-bold ${remainingMines < 0 ? 'text-red-500' : 'text-white'}`}>
                       {remainingMines}
                   </div>
                   <FlagIcon className="w-5 h-5 text-red-500 fill-red-500" />
             </div>

             <div 
                 onClick={handleCopyRoomId}
                 className="text-sm font-mono text-slate-400 hidden md:flex items-center gap-2 cursor-pointer hover:text-slate-200 transition-colors active:scale-95 transform relative"
                 title="Click to copy Room ID"
             >
                ROOM: <span className="text-white font-bold">{roomId}</span>
                <AnimatePresence>
                    {copied && (
                        <motion.span 
                            initial={{ opacity: 0, x: -10 }} 
                            animate={{ opacity: 1, x: 0 }} 
                            exit={{ opacity: 0 }}
                            className="absolute left-full ml-2 bg-green-500 text-black text-xs font-bold px-2 py-0.5 rounded"
                        >
                            COPIED!
                        </motion.span>
                    )}
                </AnimatePresence>
             </div>
          </div>
          
           <div className="flex gap-1">
              {[...Array(3)].map((_, i) => ( 
                  <motion.div 
                     key={i}
                     initial={{ scale: 1 }}
                     animate={{ scale: i < hp ? 1 : 0.8, opacity: i < hp ? 1 : 0.2 }}
                  >
                      <Heart className={`w-8 h-8 fill-current ${i < hp ? 'text-red-500' : 'text-slate-800'}`} />
                  </motion.div>
              ))}
              {hp > 3 && <span className="text-red-500 font-bold ml-2">+{hp - 3}</span>}
           </div>
      </header>
      
       <motion.div
            animate={isTransitioning ? { y: "-92%", opacity: 0 } : { y: 0, opacity: 1 }}
            transition={{ duration: 1.0, ease: "easeInOut" }}
            className="w-full flex justify-center"
       >
           <Grid grid={grid} roomId={roomId} myRole={myRole} />
       </motion.div>

      <div className="fixed bottom-4 right-4 text-xs text-slate-600">
         Server: Connected
      </div>

       {/* GAME OVER OVERLAY */}
       <AnimatePresence>
            {isGameOver && (
                <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
                >
                    <motion.div 
                        initial={{ scale: 0.9, y: 20 }}
                        animate={{ scale: 1, y: 0 }}
                        className="bg-slate-900 border border-red-500/50 p-8 rounded-2xl max-w-md w-full text-center shadow-[0_0_50px_rgba(239,68,68,0.2)]"
                    >
                        <h2 className="text-5xl font-black text-red-500 mb-2">CRITICAL FAILURE</h2>
                        <p className="text-slate-400 mb-8 text-lg">You Failed ! (looser)</p>
                        
                        <div className="flex flex-col gap-3">
                            {setupMode && (
                                <button 
                                    onClick={restartGame}
                                    className="w-full py-4 bg-red-600 hover:bg-red-500 text-white font-black text-xl transition-all rounded-lg shadow-lg hover:shadow-red-500/50"
                                >
                                    RETRY
                                </button>
                            )}
                            <button 
                                onClick={leaveRoom}
                                className="w-full py-4 bg-white text-black font-black text-xl hover:bg-slate-200 transition-colors rounded-lg"
                            >
                                RETURN TO HOME
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
       </AnimatePresence>
    </GameContainer>
  );
}
