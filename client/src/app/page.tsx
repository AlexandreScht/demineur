/* eslint-disable react-hooks/set-state-in-effect */
"use client";
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import { socket } from '@/utils/socket';
import { GridData, CellData, GameInitData } from '@/utils/types';
import Grid from '@/components/Grid';
import GameContainer from '@/components/GameContainer';
import RangeSlider from '@/components/ui/RangeSlider';
import { Activity, Zap, Heart, Flag as FlagIcon, Radar, Gamepad2, Settings } from 'lucide-react';

export default function Home() {
  const [inRoom, setInRoom] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [grid, setGrid] = useState<GridData>([]);
  const [transitionGrid, setTransitionGrid] = useState<GridData | null>(null);
  const [hp, setHp] = useState(3);
  // ... (lines 18-128 omitted)
  const [isExploding, setIsExploding] = useState(false);
  const [isGameOver, setIsGameOver] = useState(false);
  const [isGameWon, setIsGameWon] = useState(false);
  const [showGameWinModal, setShowGameWinModal] = useState(false);
  const [myRole, setMyRole] = useState<'P1' | 'P2' | null>(null);

  // Setup state
  const [setupMode, setSetupMode] = useState<'classic' | 'hardcore' | null>(null);
  const [difficulty, setDifficulty] = useState('medium');
  const [customHp, setCustomHp] = useState(3);
  
  // Custom Mode State
  const [customGridStep, setCustomGridStep] = useState(0); // 0 to 18
  const [customBombRate, setCustomBombRate] = useState(4.5); // 3.0 to 6.0
  const [customScanners, setCustomScanners] = useState(1); // 0 to 10
  const [customAllowLying, setCustomAllowLying] = useState(false);
  const [customLyingChance, setCustomLyingChance] = useState(12); // 10 to 25
  
  const [minesCount, setMinesCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const [score, setScore] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showGameOverModal, setShowGameOverModal] = useState(false);
  
  // Scanner state
  const [scansAvailable, setScansAvailable] = useState(0);
  const [isScanning, setIsScanning] = useState(false);

  // Custom Helpers
  const { customRows, customCols, customMines } = useMemo(() => {
      const base = 8;
      const rowSteps = Math.floor(customGridStep / 2);
      const colSteps = Math.ceil(customGridStep / 2);
      
      const rows = base + (rowSteps * 3);
      const cols = base + (colSteps * 3);
      
      const totalCells = rows * cols;
      const mines = Math.floor(totalCells / customBombRate);

      return { customRows: rows, customCols: cols, customMines: mines };
  }, [customGridStep, customBombRate]);

  // Recovery State
  // Recovery State
  const [pseudo, setPseudo] = useState('');
  const [storedPseudo, setStoredPseudo] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(true);

  const handleCopyRoomId = () => {
      navigator.clipboard.writeText(roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
  };

  // Calculate flags
  const flagsCount = grid.flat().filter(cell => cell.flag === 1).length;
  const remainingMines = minesCount - flagsCount;

  const leaveRoom = useCallback(() => {
      setInRoom(false);
      setRoomId('');
      setGrid([]);
      setHp(3);
      setIsGameOver(false);
      setScore(0);
      sessionStorage.removeItem('minigame_roomId'); // Clear only on explicit leave
      socket.emit('leave_room', roomId, pseudo);
  }, [roomId, pseudo]);
  
  const joinRoom = useCallback((id: string) => {
    setRoomId(id);
    socket.emit('join_room', id, pseudo);
  }, [pseudo]);

  useEffect(() => {
    socket.connect();
    
    function onRoomCreated(id: string) {
      setRoomId(id);
      setInRoom(true);
      setInRoom(true);
      setIsGameOver(false);
      setShowGameOverModal(false);
      setIsGameWon(false);
      setShowGameWinModal(false);
      setScore(0);
    }
    // ... existing listeners ...
    const onInitGame = (data: GameInitData) => {
        setGrid(data.grid);
        setHp(data.hp);
        setInRoom(true);
        setInRoom(true);
        setIsGameOver(false);
        setShowGameOverModal(false);
        setMinesCount(data.mines); 
        setScansAvailable(data.scansAvailable || 0);
        setIsScanning(false); 
        if (data.role) setMyRole(data.role);
        if (data.mode) setSetupMode(data.mode as any);
        if (data.difficulty) setDifficulty(data.difficulty as any);
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
    
    function onLevelComplete({ grid: newGrid, score: newScore, mines, scansAvailable }: { grid: GridData, score: number, mines: number, scansAvailable?: number }) {
        setGrid(currentGrid => {
            // Construct merged grid for animation: Current + New (skipping first overlapped row)
            const merged = [...currentGrid, ...newGrid.slice(1)];
            setTransitionGrid(merged);
            
            // Set timeout to switch to new grid AFTER animation
            setTimeout(() => {
                setTransitionGrid(null); // Clear transition grid
                setIsTransitioning(false); 
            }, 2000); 

            return newGrid; 
        });
        
        setScore(newScore);
        setMinesCount(mines);
        if (scansAvailable !== undefined) setScansAvailable(scansAvailable);
        setIsScanning(false);
        setIsTransitioning(true); 
    }

    function onExplosion({ hp }: { x: number, y: number, hp: number }) {
        setHp(hp);
        setIsExploding(true);
        setTimeout(() => setIsExploding(false), 500);
    }

    function onGameOver({ mines }: { mines: CellData[]}) {
        setIsGameOver(true);
        setShowGameOverModal(true);
        if (mines) {
            setGrid(prev => {
                const newGrid = [...prev];
                mines.forEach(mine => {
                    newGrid[mine.y][mine.x] = { ...mine, isOpen: true }; // Force open visually
                });
                return newGrid;
            });
        }
    }

    function onGameWin() {
        setIsGameWon(true);
        setShowGameWinModal(true);
        // Maybe play sound?
    }

    function onUpdateMines({ mines }: { mines: number }) {
        setMinesCount(mines);
    }
    
    function onUpdateScans({ scansAvailable }: { scansAvailable: number }) {
        setScansAvailable(scansAvailable);
        // If no scans left, disable scanning mode
        if (scansAvailable <= 0) setIsScanning(false);
    }

    socket.on('room_created', onRoomCreated);
    socket.on('init_game', onInitGame);
    socket.on('update_grid', onUpdateGrid);
    socket.on('update_mines', onUpdateMines);
    socket.on('update_scans', onUpdateScans);
    socket.on('level_complete', onLevelComplete);
    socket.on('explosion', onExplosion);
    socket.on('game_over', onGameOver);
    socket.on('game_win', onGameWin);
    socket.on('recovery_available', ({ roomId, mode, difficulty }: { roomId: string, mode: string, difficulty: string }) => {
        toast.custom((t) => (
            <div className="w-full flex flex-col gap-3 bg-slate-900/95 border border-blue-500/30 p-4 rounded-xl shadow-2xl shadow-blue-500/10 backdrop-blur-md relative overflow-hidden">
                {/* Glow effect */}
                <div className="absolute top-0 left-0 w-1 h-full bg-linear-to-b from-blue-500 to-purple-500" />
                
                <div className="flex items-start gap-3 pl-2">
                    <div className="p-2 bg-blue-500/10 rounded-lg shrink-0 mt-0.5">
                        <Gamepad2 className="w-5 h-5 text-blue-400 animate-pulse" />
                    </div>
                    <div className="flex-1">
                        <h3 className="font-bold text-white text-sm tracking-wide">SESSION FOUND</h3>
                        <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">
                            Resuming <span className={`font-extrabold uppercase ${mode === 'hardcore' ? 'text-pink-300' : 'text-blue-400'}`}>
                                {mode === 'hardcore' ? 'INFINITE' : 'CLASSIC'}
                            </span> game on <span className="font-bold text-yellow-500 uppercase">{difficulty}</span> difficulty.
                        </p>
                    </div>
                </div>

                <div className="flex gap-2 w-full pl-2 mt-1">
                    <button 
                        onClick={() => toast.dismiss(t)} 
                        className="flex-1 py-2 text-xs font-bold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
                    >
                        DISMISS
                    </button>
                    <button 
                        onClick={() => { joinRoom(roomId); toast.dismiss(t); }} 
                        className="flex-1 py-2 text-xs font-bold text-white bg-linear-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 rounded-lg shadow-lg shadow-blue-500/20 transition-all active:scale-95"
                    >
                        RESUME GAME
                    </button>
                </div>
            </div>
        ), { duration: Infinity });
    });


    return () => {
      socket.off('room_created', onRoomCreated);
      socket.off('init_game', onInitGame);
      socket.off('update_grid', onUpdateGrid);
      socket.off('update_mines', onUpdateMines);
      socket.off('update_scans', onUpdateScans);
      socket.off('level_complete', onLevelComplete);
      socket.off('explosion', onExplosion);
      socket.off('game_over', onGameOver);
      socket.off('game_win', onGameWin);
      socket.off('recovery_available');
      socket.disconnect();
    };
  }, [joinRoom]);



  // Keep Session Storage in sync (Only Set, never Clear automatically)
  useEffect(() => {
      if (inRoom && roomId) {
          sessionStorage.setItem('minigame_roomId', roomId);
      }
  }, [inRoom, roomId]);

  const startGame = () => {
      if (!setupMode) return;
      socket.emit('create_room', { 
          mode: setupMode, 
          difficulty, 
          hp: customHp, 
          pseudo,
          // Custom params
          rows: difficulty === 'custom' ? customRows : undefined,
          cols: difficulty === 'custom' ? customCols : undefined,
          mines: difficulty === 'custom' ? customMines : undefined,
          scansAvailable: difficulty === 'custom' ? customScanners : undefined,
          allowLying: difficulty === 'custom' ? customAllowLying : undefined,
          lyingChance: difficulty === 'custom' ? customLyingChance : undefined
      });
  };

  const restartGame = () => {
      if (!setupMode) return;
      socket.emit('restart_game', { 
          roomId, 
          mode: setupMode, 
          difficulty, 
          hp: customHp,
          // Custom params
          rows: difficulty === 'custom' ? customRows : undefined,
          cols: difficulty === 'custom' ? customCols : undefined,
          mines: difficulty === 'custom' ? customMines : undefined,
          scansAvailable: difficulty === 'custom' ? customScanners : undefined,
          allowLying: difficulty === 'custom' ? customAllowLying : undefined,
          lyingChance: difficulty === 'custom' ? customLyingChance : undefined
      });
      setIsGameOver(false); 
      setShowGameOverModal(false); 
      setIsGameWon(false);
      setShowGameWinModal(false);
  };

  // Restore Pseudo State (Run once on mount)
  // Restore Pseudo State (Run once on mount)
  useEffect(() => {
      const sPseudo = sessionStorage.getItem('minigame_pseudo');
      const sRoomId = sessionStorage.getItem('minigame_roomId');

      if (sPseudo) {
          setPseudo(sPseudo);
          setStoredPseudo(sPseudo);
          setIsEditing(false);

          // Check for recovery if no local room but pseudo exists
          if (!sRoomId) {
             if (socket.connected) {
                 socket.emit('check_recovery', sPseudo);
             } else {
                 socket.once('connect', () => {
                     socket.emit('check_recovery', sPseudo);
                 });
             }
          }
      }
  }, []);

  // Auto-Join Effect
  useEffect(() => {
      const sPseudo = sessionStorage.getItem('minigame_pseudo');
      const sRoomId = sessionStorage.getItem('minigame_roomId');
      

      
      if (sRoomId && !inRoom && socket.connected) {

           setRoomId((prev) => (prev !== sRoomId ? sRoomId : prev)); 
           socket.emit('join_room', sRoomId, sPseudo || ""); // Pseudo optional
      } else if (sRoomId && !inRoom) {
          socket.once('connect', () => {
              setRoomId(sRoomId); 
              socket.emit('join_room', sRoomId, sPseudo || "");
          });
      }
  }, [inRoom]);

  const handleLogin = () => {
      // 1. MODIFY STATE: User wants to edit
      if (!isEditing) {
          setIsEditing(true);
          return;
      }

      // 2. CANCEL STATE: User cancels editing (revert to stored)
      if (storedPseudo && pseudo === storedPseudo) {
          setIsEditing(false);
          return;
      }
      
      // 3. LOGIN STATE: User submits new pseudo
      if(pseudo.length > 0) {
          sessionStorage.setItem('minigame_pseudo', pseudo);
          setStoredPseudo(pseudo);
          setIsEditing(false);
          socket.emit('check_recovery', pseudo);
      }
  };

  const getButtonState = () => {
      if (!isEditing) return 'MODIFY';
      if (storedPseudo && pseudo === storedPseudo) return 'CANCEL';
      return 'LOGIN';
  };



  if (!inRoom) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-black text-white p-6 md:p-24 relative overflow-hidden">
        {/* Ambient Background */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,var(--tw-gradient-stops))] from-blue-900/20 via-black to-black z-0 pointer-events-none" />
        
        {/* Recovery Toast */}


        <div className="z-10 flex flex-col items-center gap-8 w-full max-w-lg">
            <h1 className="text-5xl md:text-7xl font-black bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 bg-clip-text text-transparent tracking-tighter text-center mb-4 drop-shadow-lg">
                DEMINEURS V2
            </h1>
            
            <div className="w-full flex flex-col gap-2">
                <label className="text-slate-400 text-xs font-bold uppercase tracking-wider ml-1">IDENTIFICATION</label>
                <div className="flex gap-2">
                    <input 
                        type="text" 
                        placeholder="Enter your Pseudo" 
                        value={pseudo}
                        onChange={(e) => setPseudo(e.target.value)}
                        readOnly={!isEditing}
                        onKeyDown={(e) => e.key === 'Enter' && pseudo.length > 0 && handleLogin()}
                        className={`flex-1 px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white focus:outline-none transition-all placeholder:text-slate-600 ${
                            isEditing 
                            ? 'focus:border-blue-500 focus:ring-1 focus:ring-blue-500' 
                            : 'opacity-50 cursor-not-allowed bg-slate-950 text-slate-400'
                        }`}
                    />
                    <button 
                        onClick={handleLogin}
                        disabled={isEditing && pseudo.length === 0}
                        className={`px-6 py-3 rounded-xl font-bold text-white transition-all shadow-lg min-w-[100px] ${
                            getButtonState() === 'MODIFY' ? 'bg-slate-700 hover:bg-slate-600' :
                            getButtonState() === 'CANCEL' ? 'bg-red-600 hover:bg-red-500 shadow-red-500/20' :
                            pseudo.length > 0 
                                ? 'bg-blue-600 hover:bg-blue-500 shadow-blue-500/20' 
                                : 'bg-slate-800 text-slate-500 cursor-not-allowed shadow-none'
                        }`}
                    >
                        {getButtonState()}
                    </button>
                </div>
            </div>
            
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
                        <div className="grid grid-cols-5 gap-2">
                            {['easy', 'medium', 'hard', 'hardcore', 'custom'].map((d) => (
                                <button
                                    key={d}
                                    onClick={() => setDifficulty(d)}
                                    className={`py-2 rounded-lg font-bold capitalize transition-all text-xs sm:text-sm ${
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

                    {/* CUSTOM SETTINGS */}
                    {difficulty === 'custom' && (
                        <motion.div 
                           initial={{ opacity: 0, height: 0 }}
                           animate={{ opacity: 1, height: 'auto' }}
                           className="space-y-4 bg-slate-950/50 p-4 rounded-xl border border-slate-700/50"
                        >
                            <div className="flex items-center gap-2 text-blue-400 mb-2">
                                <Settings className="w-4 h-4" />
                                <span className="font-bold text-sm uppercase">Custom Configuration</span>
                            </div>

                            <RangeSlider 
                                label="Grid Size"
                                min={0}
                                max={18}
                                value={customGridStep}
                                onChange={setCustomGridStep}
                                formatValue={() => `${customRows} x ${customCols}`}
                            />

                            <RangeSlider 
                                label="Bomb Density (1 Mine / X Cells)"
                                min={3.0}
                                max={6.0}
                                step={0.2}
                                value={customBombRate}
                                onChange={setCustomBombRate}
                                formatValue={(v) => v.toFixed(1)}
                            />
                             <div className="text-right text-xs text-slate-400 -mt-2">
                                Total Mines: <span className="text-white font-bold">{customMines}</span>
                            </div>

                            <RangeSlider 
                                label="Scanners Available"
                                min={0}
                                max={10}
                                value={customScanners}
                                onChange={setCustomScanners}
                                formatValue={(v) => v.toString()}
                            />

                            {/* DOUBLE NUMBERS (LYING) */}
                            <div className="flex items-center justify-between py-2">
                                <label className="text-slate-400 text-sm font-semibold uppercase tracking-wider">
                                    Allow Double Numbers On same Case
                                </label>
                                <button
                                    onClick={() => setCustomAllowLying(!customAllowLying)}
                                    className={`relative w-12 h-6 rounded-full transition-colors ${
                                        customAllowLying ? 'bg-blue-600' : 'bg-slate-700'
                                    }`}
                                >
                                    <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${
                                        customAllowLying ? 'translate-x-6' : 'translate-x-0'
                                    }`} />
                                </button>
                            </div>

                            {customAllowLying && (
                                <RangeSlider 
                                    label="Double Number Chance (%)"
                                    min={10}
                                    max={25}
                                    step={1}
                                    value={customLyingChance}
                                    onChange={setCustomLyingChance}
                                    formatValue={(v) => `${Math.round(v)}%`}
                                />
                            )}
                        </motion.div>
                    )}

                    {/* HP */}
                    <div className="space-y-3">
                        <RangeSlider 
                            label="Health Points (HP)"
                            min={1} 
                            max={10} 
                            value={customHp} 
                            onChange={(val) => setCustomHp(Math.round(val))} // RangeSlider returns float, hp needs int
                            formatValue={(v) => `${Math.round(v)} ♥`}
                        />
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

              {/* Scanner Control */}
              <button 
                  onClick={() => scansAvailable > 0 && setIsScanning(!isScanning)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all ${
                      isScanning 
                      ? 'bg-green-500/20 border-green-500 text-green-400 shadow-[0_0_15px_rgba(34,197,94,0.3)]' 
                      : scansAvailable > 0
                        ? 'bg-slate-900/50 border-slate-700/50 text-slate-400 hover:text-white hover:border-slate-500'
                        : 'bg-slate-900/30 border-slate-800 text-slate-600 cursor-not-allowed'
                  }`}
                  title="Scanner Tool"
              >
                   <Radar className={`w-5 h-5 ${isScanning ? 'animate-spin-slow' : ''}`} />
                   <span className="font-mono font-bold text-xl">{scansAvailable}</span>
              </button>

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
      
       {/* GAME BOARD WINDOW */}
       <div className="w-full flex justify-center">
            <div className="relative bg-slate-900/50 p-4 rounded-xl shadow-2xl overflow-hidden border border-slate-700/50 backdrop-blur-sm">
                
                {/* 1. SPACER GRID (Invisible, sets container size) */}
                <div className="invisible pointer-events-none">
                     <Grid grid={grid} roomId={roomId} isScanning={false} onScan={() => {}} />
                </div>

                {/* 2. ANIMATED GRID LAYER */}
                <motion.div
                        className={`absolute top-4 left-4 right-4 flex flex-col items-center ${isTransitioning ? 'pointer-events-none' : ''}`}
                        initial={false}
                        animate={isTransitioning && transitionGrid ? { 
                            y: `-${((transitionGrid.length - grid.length) / transitionGrid.length) * 100}%` 
                        } : { y: 0 }}
                        transition={isTransitioning ? { duration: 2.0, ease: "easeInOut" } : { duration: 0 }}
                >
                    <Grid 
                        grid={isTransitioning && transitionGrid ? transitionGrid : grid} 
                        roomId={roomId} 
                        myRole={myRole} 
                        isScanning={isScanning} 
                        onScan={() => setIsScanning(false)} 
                    />
                </motion.div>
            </div>
       </div>

      <div className="fixed bottom-4 right-4 text-xs text-slate-600">
         Server: Connected
      </div>

       {/* GAME OVER OVERLAY */}
       <AnimatePresence>
            {isGameOver && showGameOverModal && (
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
                                <button 
                                    onClick={restartGame}
                                    className="w-full py-4 bg-red-600 hover:bg-red-500 text-white font-black text-xl transition-all rounded-lg shadow-lg hover:shadow-red-500/50"
                                >
                                    RETRY
                                </button>
                            <button 
                                onClick={() => setShowGameOverModal(false)}
                                className="w-full py-4 bg-slate-700 hover:bg-slate-600 text-white font-bold text-xl transition-colors rounded-lg"
                            >
                                VIEW BOARD
                            </button>
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

            {/* PERSISTENT GAME OVER CONTROLS (When modal is closed) */}
            {isGameOver && !showGameOverModal && (
                <motion.div 
                    initial={{ y: 100 }}
                    animate={{ y: 0 }}
                    className="fixed bottom-0 left-0 right-0 z-40 bg-slate-900/90 border-t border-red-500/50 p-4 backdrop-blur-md"
                >
                    <div className="max-w-7xl mx-auto flex justify-between items-center gap-4">
                        <div className="flex items-center gap-2">
                             <span className="text-red-500 font-bold text-xl">GAME OVER</span>
                             <button 
                                onClick={() => setShowGameOverModal(true)}
                                className="text-sm text-slate-400 hover:text-white underline ml-2"
                             >
                                Show Menu
                             </button>
                        </div>

                        <div className="flex gap-2">
                            {setupMode && (
                                <button 
                                    onClick={restartGame}
                                    className="px-6 py-2 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg shadow-lg hover:shadow-red-500/50 transition-all"
                                >
                                    RETRY
                                </button>
                            )}
                            <button 
                                onClick={leaveRoom}
                                className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-lg transition-colors"
                            >
                                MENU
                            </button>
                        </div>
                    </div>
                </motion.div>
            )}

            {/* GAME WIN MODAL */}
            {isGameWon && showGameWinModal && (
                <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
                >
                    <motion.div 
                        initial={{ scale: 0.9, y: 20 }}
                        animate={{ scale: 1, y: 0 }}
                        className="bg-slate-900 border border-green-500/50 p-8 rounded-2xl max-w-md w-full text-center shadow-[0_0_50px_rgba(34,197,94,0.2)]"
                    >
                        <h2 className="text-5xl font-black text-green-500 mb-2">Nice Bravo !</h2>
                        <p className="text-slate-400 mb-8 text-lg">Sector Cleared Successfully!</p>
                        
                        <div className="flex flex-col gap-3">
                                <button 
                                    onClick={restartGame}
                                    className="w-full py-4 bg-green-600 hover:bg-green-500 text-white font-black text-xl transition-all rounded-lg shadow-lg hover:shadow-green-500/50"
                                >
                                    PLAY AGAIN
                                </button>
                            <button 
                                onClick={() => setShowGameWinModal(false)}
                                className="w-full py-4 bg-slate-700 hover:bg-slate-600 text-white font-bold text-xl transition-colors rounded-lg"
                            >
                                VIEW BOARD
                            </button>
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

            {/* PERSISTENT GAME WIN CONTROLS */}
            {isGameWon && !showGameWinModal && (
                <motion.div 
                    initial={{ y: 100 }}
                    animate={{ y: 0 }}
                    className="fixed bottom-0 left-0 right-0 z-40 bg-slate-900/90 border-t border-green-500/50 p-4 backdrop-blur-md"
                >
                    <div className="max-w-7xl mx-auto flex justify-between items-center gap-4">
                        <div className="flex items-center gap-2">
                             <span className="text-green-500 font-bold text-xl">VICTORY</span>
                             <button 
                                onClick={() => setShowGameWinModal(true)}
                                className="text-sm text-slate-400 hover:text-white underline ml-2"
                             >
                                Show Menu
                             </button>
                        </div>

                        <div className="flex gap-2">
                            {setupMode && (
                                <button 
                                    onClick={restartGame}
                                    className="px-6 py-2 bg-green-600 hover:bg-green-500 text-white font-bold rounded-lg shadow-lg hover:shadow-green-500/50 transition-all"
                                >
                                    PLAY AGAIN
                                </button>
                            )}
                            <button 
                                onClick={leaveRoom}
                                className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-lg transition-colors"
                            >
                                MENU
                            </button>
                        </div>
                    </div>
                </motion.div>
            )}
       </AnimatePresence>
    </GameContainer>
  );
}
