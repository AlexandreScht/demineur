/* eslint-disable react-hooks/set-state-in-effect */
"use client";
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { socket } from '@/utils/socket';
import { GridData, CellData, GameInitData, Account, AccountInfo, IncomingJoinRequest, IncomingFriendRequest } from '@/utils/types';
import Grid from '@/components/Grid';
import GameContainer from '@/components/GameContainer';
import RangeSlider from '@/components/ui/RangeSlider';
import SocialDrawer from '@/components/SocialDrawer';
import { Activity, Zap, Heart, Flag as FlagIcon, Radar, Settings, ArrowLeft, Copy, Check, Trophy, UserPlus, X, Play, LogIn, User, Users, MailPlus } from 'lucide-react';

const ACCOUNTS_KEY = 'minesweeper_accounts';
const ACTIVE_ACCOUNT_KEY = 'minesweeper_active_account';

function readAccountsFromStorage(): Account[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(ACCOUNTS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(a => a && typeof a.pseudo === 'string' && typeof a.tag === 'string');
    } catch {
        return [];
    }
}

function writeAccountsToStorage(accounts: Account[]) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

function accountKey(a: Account) {
    return `${a.pseudo}#${a.tag}`;
}

export default function Home() {
  const [inRoom, setInRoom] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [grid, setGrid] = useState<GridData>([]);
  const [transitionGrid, setTransitionGrid] = useState<GridData | null>(null);
  const [hp, setHp] = useState(3);
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
  const [customGridStep, setCustomGridStep] = useState(0);
  const [customBombRate, setCustomBombRate] = useState(4.5);
  const [customScanners, setCustomScanners] = useState(1);
  const [customAllowLying, setCustomAllowLying] = useState(false);
  const [customLyingChance, setCustomLyingChance] = useState(12);

  const [minesCount, setMinesCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const [score, setScore] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showGameOverModal, setShowGameOverModal] = useState(false);

  // Scanner state
  const [scansAvailable, setScansAvailable] = useState(0);
  const [isScanning, setIsScanning] = useState(false);

  // Board height measured from DOM so it always matches actual cell size
  const boardRef = useRef<HTMLDivElement>(null);
  const [boardInnerH, setBoardInnerH] = useState(0);

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

  // === Accounts (multi-pseudo, persistent in localStorage) ===
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsInfo, setAccountsInfo] = useState<AccountInfo[]>([]);
  const [activeAccount, setActiveAccount] = useState<Account | null>(null);
  const [newPseudoInput, setNewPseudoInput] = useState('');
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [accountsHydrated, setAccountsHydrated] = useState(false);

  // === Social ===
  const [socialOpen, setSocialOpen] = useState(false);
  const [incomingRequests, setIncomingRequests] = useState<IncomingJoinRequest[]>([]);
  const [incomingFriendRequests, setIncomingFriendRequests] = useState<IncomingFriendRequest[]>([]);

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
      socket.emit('leave_room', roomId, activeAccount?.pseudo, activeAccount?.tag);
  }, [roomId, activeAccount]);

  const joinRoom = useCallback((id: string, account?: Account | null) => {
    const acc = account || activeAccount;
    setRoomId(id);
    socket.emit('join_room', id, acc?.pseudo, acc?.tag);
  }, [activeAccount]);

  useEffect(() => {
    socket.connect();

    function onRoomCreated(id: string) {
      setRoomId(id);
      setInRoom(true);
      setIsGameOver(false);
      setShowGameOverModal(false);
      setIsGameWon(false);
      setShowGameWinModal(false);
      setScore(0);
    }

    const onInitGame = (data: GameInitData) => {
        setGrid(data.grid);
        setHp(data.hp);
        setInRoom(true);
        setIsGameOver(false);
        setShowGameOverModal(false);
        setMinesCount(data.mines);
        setScansAvailable(data.scansAvailable || 0);
        setIsScanning(false);
        if (data.role) setMyRole(data.role);
        if (data.mode) setSetupMode(data.mode as any);
        if (data.difficulty) setDifficulty(data.difficulty as any);
        setScore(data.level ? data.level - 1 : 0);
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

    function onLevelComplete({ grid: newGrid, score: newScore, level: newLevel, mines, scansAvailable }: { grid: GridData, score: number, level?: number, mines: number, scansAvailable?: number }) {
        setGrid(currentGrid => {
            const merged = [...currentGrid, ...newGrid.slice(1)];
            setTransitionGrid(merged);

            setTimeout(() => {
                setTransitionGrid(null);
                setIsTransitioning(false);
            }, 2000);

            return newGrid;
        });

        setScore(newLevel ? newLevel - 1 : newScore);
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
                    newGrid[mine.y][mine.x] = { ...mine, isOpen: true };
                });
                return newGrid;
            });
        }
    }

    function onGameWin() {
        setIsGameWon(true);
        setShowGameWinModal(true);
    }

    function onUpdateMines({ mines }: { mines: number }) {
        setMinesCount(mines);
    }

    function onUpdateScans({ scansAvailable }: { scansAvailable: number }) {
        setScansAvailable(scansAvailable);
        if (scansAvailable <= 0) setIsScanning(false);
    }

    function onAccountsInfo(infos: AccountInfo[]) {
        setAccountsInfo(infos || []);
    }

    function onAccountCreated({ pseudo, tag }: { pseudo: string; tag: string }) {
        const newAcc: Account = { pseudo, tag };
        setAccounts(prev => {
            const exists = prev.some(a => accountKey(a) === accountKey(newAcc));
            const next = exists ? prev : [...prev, newAcc];
            writeAccountsToStorage(next);
            return next;
        });
        setAccountsInfo(prev => [...prev.filter(i => accountKey(i) !== accountKey(newAcc)), {
            ...newAcc,
            currentRoomId: null,
            gameMode: null,
            gameDifficulty: null,
            gameLevel: null,
        }]);
        setActiveAccount(newAcc);
        localStorage.setItem(ACTIVE_ACCOUNT_KEY, JSON.stringify(newAcc));
        setNewPseudoInput('');
        setIsCreatingAccount(false);
        toast.success(`Compte ${pseudo}#${tag} créé`);
    }

    function onAccountError({ reason }: { reason: string }) {
        setIsCreatingAccount(false);
        toast.error(reason || 'Erreur compte');
    }

    function onJoinRequest({ fromPseudo, fromTag, roomId, expiresInMs }: { fromPseudo: string; fromTag: string; roomId: string; expiresInMs?: number }) {
        const ttl = expiresInMs || 60_000;
        const now = Date.now();
        setIncomingRequests(prev => {
            // dedupe per sender
            const filtered = prev.filter(r => !(r.fromPseudo === fromPseudo && r.fromTag === fromTag));
            return [...filtered, { fromPseudo, fromTag, roomId, receivedAt: now, expiresAt: now + ttl }];
        });
    }

    function onJoinRequestAccepted({ roomId }: { roomId: string }) {
        toast.success('Demande acceptée, connexion en cours…');
        const stored = localStorage.getItem(ACTIVE_ACCOUNT_KEY);
        let acc: Account | null = null;
        if (stored) {
            try { acc = JSON.parse(stored); } catch {}
        }
        // Joining a new room replaces any current one
        socket.emit('join_room', roomId, acc?.pseudo, acc?.tag);
        setRoomId(roomId);
    }

    function onFriendRequestReceived({ fromPseudo, fromTag, ts }: { fromPseudo: string; fromTag: string; ts?: number }) {
        const receivedAt = ts || Date.now();
        setIncomingFriendRequests(prev => {
            const filtered = prev.filter(r => !(r.fromPseudo === fromPseudo && r.fromTag === fromTag));
            return [...filtered, { fromPseudo, fromTag, receivedAt }];
        });
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
    socket.on('accounts_info', onAccountsInfo);
    socket.on('account_created', onAccountCreated);
    socket.on('account_error', onAccountError);
    socket.on('join_request', onJoinRequest);
    socket.on('join_request_accepted', onJoinRequestAccepted);
    socket.on('friend_request_received', onFriendRequestReceived);

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
      socket.off('accounts_info', onAccountsInfo);
      socket.off('account_created', onAccountCreated);
      socket.off('account_error', onAccountError);
      socket.off('join_request', onJoinRequest);
      socket.off('join_request_accepted', onJoinRequestAccepted);
      socket.off('friend_request_received', onFriendRequestReceived);
      socket.disconnect();
    };
  }, []);

  // Register account with the server for presence + invite delivery
  useEffect(() => {
      if (!activeAccount) return;
      const send = () => socket.emit('register_account', activeAccount);
      if (socket.connected) send();
      socket.on('connect', send);
      return () => {
          socket.off('connect', send);
          socket.emit('unregister_account');
      };
  }, [activeAccount]);

  // Auto-expire incoming requests
  useEffect(() => {
      if (incomingRequests.length === 0) return;
      const interval = setInterval(() => {
          const now = Date.now();
          setIncomingRequests(prev => prev.filter(r => r.expiresAt > now));
      }, 1000);
      return () => clearInterval(interval);
  }, [incomingRequests.length]);

  const acceptJoinRequest = (req: IncomingJoinRequest) => {
      socket.emit('accept_join_request', { fromPseudo: req.fromPseudo, fromTag: req.fromTag });
      setIncomingRequests(prev => prev.filter(r => r !== req));
  };
  const declineJoinRequest = (req: IncomingJoinRequest) => {
      socket.emit('decline_join_request', { fromPseudo: req.fromPseudo, fromTag: req.fromTag });
      setIncomingRequests(prev => prev.filter(r => r !== req));
  };
  const acceptFriendRequest = (req: IncomingFriendRequest) => {
      socket.emit('accept_friend_request', { fromPseudo: req.fromPseudo, fromTag: req.fromTag });
      setIncomingFriendRequests(prev => prev.filter(r => r !== req));
  };
  const declineFriendRequest = (req: IncomingFriendRequest) => {
      socket.emit('decline_friend_request', { fromPseudo: req.fromPseudo, fromTag: req.fromTag });
      setIncomingFriendRequests(prev => prev.filter(r => r !== req));
  };



  const startGame = () => {
      if (!setupMode || !activeAccount) return;
      socket.emit('create_room', {
          mode: setupMode,
          difficulty,
          hp: customHp,
          pseudo: activeAccount.pseudo,
          tag: activeAccount.tag,
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

  // Hydrate accounts from localStorage on mount
  useEffect(() => {
      const stored = readAccountsFromStorage();
      setAccounts(stored);
      setAccountsHydrated(true);
  }, []);

  // Once hydrated (and socket is up), fetch live game info for those accounts
  useEffect(() => {
      if (!accountsHydrated) return;
      if (accounts.length === 0) {
          setAccountsInfo([]);
          return;
      }
      const send = () => socket.emit('fetch_accounts_info', accounts);
      if (socket.connected) {
          send();
      } else {
          socket.once('connect', send);
      }
  }, [accountsHydrated, accounts]);

  // Measure actual board height from the container width so there's never empty space
  useEffect(() => {
    if (!boardRef.current || !inRoom) return;
    const GAP_X = 4; // matches gap-x-1 in Grid.tsx
    const GAP_Y = 4; // matches gap-y-[4px] in Grid.tsx

    const measure = () => {
      if (!boardRef.current) return;
      const cols = grid[0]?.length || 0;
      const rows = grid.length;
      if (!cols || !rows) return;
      const innerW = boardRef.current.clientWidth - 40; // minus 2×p-5 padding
      const cellW = Math.max(28, (innerW - (cols - 1) * GAP_X) / cols);
      setBoardInnerH(rows * cellW + (rows - 1) * GAP_Y);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(boardRef.current);
    return () => ro.disconnect();
  }, [grid, inRoom]);

  // === Account picker handlers ===
  const handleCreateAccount = () => {
      const trimmed = newPseudoInput.trim();
      if (trimmed.length === 0 || isCreatingAccount) return;
      setIsCreatingAccount(true);
      const send = () => socket.emit('create_account', { pseudo: trimmed });
      if (socket.connected) send();
      else socket.once('connect', send);
  };

  const handleSelectAccount = (acc: Account) => {
      setActiveAccount(acc);
      localStorage.setItem(ACTIVE_ACCOUNT_KEY, JSON.stringify(acc));
      // Refresh info for this single account so the resume prompt is up to date
      socket.emit('fetch_accounts_info', [acc]);
  };

  const handleRemoveAccount = (acc: Account) => {
      const next = accounts.filter(a => accountKey(a) !== accountKey(acc));
      setAccounts(next);
      writeAccountsToStorage(next);
      setAccountsInfo(prev => prev.filter(i => accountKey(i) !== accountKey(acc)));
      if (activeAccount && accountKey(activeAccount) === accountKey(acc)) {
          setActiveAccount(null);
          localStorage.removeItem(ACTIVE_ACCOUNT_KEY);
      }
  };

  const handleResumeGame = (acc: Account, roomId: string) => {
      setActiveAccount(acc);
      localStorage.setItem(ACTIVE_ACCOUNT_KEY, JSON.stringify(acc));
      joinRoom(roomId, acc);
  };

  const handleSwitchAccount = () => {
      setActiveAccount(null);
      setSetupMode(null);
      localStorage.removeItem(ACTIVE_ACCOUNT_KEY);
  };

  const activeAccountInfo: AccountInfo | undefined = activeAccount
      ? accountsInfo.find(i => accountKey(i) === accountKey(activeAccount))
      : undefined;



  // Top-right corner: combined notification stack (friend + join requests)
  const notificationCorner = activeAccount && (incomingFriendRequests.length > 0 || incomingRequests.length > 0) ? (
    <div className="fixed top-4 right-4 z-[60] flex flex-col gap-2 max-w-[320px] w-[min(320px,calc(100vw-2rem))]">
        <AnimatePresence>
            {incomingFriendRequests.map((req) => (
                <motion.div
                    key={`fr-${req.fromPseudo}#${req.fromTag}-${req.receivedAt}`}
                    initial={{ opacity: 0, x: 20, scale: 0.95 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={{ opacity: 0, x: 20, scale: 0.95 }}
                    className="glass-strong glass-tint-cyan rounded-2xl p-3 flex items-center gap-2 shadow-[0_10px_30px_-10px_rgba(56,189,248,0.5)] border border-cyan-300/25"
                >
                    <div className="p-2 rounded-lg bg-cyan-400/15 border border-cyan-300/25 shrink-0">
                        <UserPlus className="w-4 h-4 text-cyan-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Demande d&apos;ami</div>
                        <div className="text-sm font-bold text-white truncate">
                            {req.fromPseudo}<span className="font-mono text-slate-400 text-xs">#{req.fromTag}</span>
                        </div>
                    </div>
                    <button
                        onClick={() => acceptFriendRequest(req)}
                        className="px-2 py-1.5 rounded-lg text-[11px] font-bold bg-gradient-to-r from-emerald-300 to-teal-300 text-slate-950 hover:brightness-110 active:scale-95 transition-all shadow-[0_0_10px_rgba(52,211,153,0.4)]"
                        title="Accepter"
                    >
                        <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                        onClick={() => declineFriendRequest(req)}
                        className="px-2 py-1.5 rounded-lg text-[11px] font-bold glass text-slate-300 hover:text-white hover:bg-white/10 transition-all"
                        title="Refuser"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </motion.div>
            ))}
            {incomingRequests.map((req) => (
                <motion.div
                    key={`jr-${req.fromPseudo}#${req.fromTag}-${req.receivedAt}`}
                    initial={{ opacity: 0, x: 20, scale: 0.95 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={{ opacity: 0, x: 20, scale: 0.95 }}
                    className="glass-strong glass-tint-violet rounded-2xl p-3 flex items-center gap-2 shadow-[0_10px_30px_-10px_rgba(167,139,250,0.5)] border border-violet-300/25"
                >
                    <div className="p-2 rounded-lg bg-violet-400/15 border border-violet-300/25 shrink-0">
                        <MailPlus className="w-4 h-4 text-violet-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Demande de rejoindre</div>
                        <div className="text-sm font-bold text-white truncate">
                            {req.fromPseudo}<span className="font-mono text-slate-400 text-xs">#{req.fromTag}</span>
                        </div>
                    </div>
                    <button
                        onClick={() => acceptJoinRequest(req)}
                        className="px-2 py-1.5 rounded-lg text-[11px] font-bold bg-gradient-to-r from-emerald-300 to-teal-300 text-slate-950 hover:brightness-110 active:scale-95 transition-all shadow-[0_0_10px_rgba(52,211,153,0.4)]"
                        title="Accepter"
                    >
                        <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                        onClick={() => declineJoinRequest(req)}
                        className="px-2 py-1.5 rounded-lg text-[11px] font-bold glass text-slate-300 hover:text-white hover:bg-white/10 transition-all"
                        title="Refuser"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </motion.div>
            ))}
        </AnimatePresence>
    </div>
  ) : null;

  // In-game only: floating social button + drawer
  const inGameSocialUI = activeAccount ? (
    <>
        <button
            onClick={() => setSocialOpen(true)}
            className="fixed bottom-4 left-4 z-30 w-12 h-12 rounded-2xl glass-strong flex items-center justify-center hover:bg-white/[0.08] active:scale-95 transition-all shadow-[0_8px_28px_-8px_rgba(0,0,0,0.6)] border border-white/10"
            title="Social"
        >
            <Users className="w-5 h-5 text-cyan-accent" />
            {(incomingRequests.length + incomingFriendRequests.length) > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-gradient-to-br from-rose-400 to-rose-500 text-[11px] font-black text-slate-950 flex items-center justify-center border-2 border-slate-950 shadow-[0_0_10px_rgba(251,113,133,0.5)] animate-pulse">
                    {incomingRequests.length + incomingFriendRequests.length}
                </span>
            )}
        </button>

        <SocialDrawer
            isOpen={socialOpen}
            onClose={() => setSocialOpen(false)}
            variant="drawer"
            activePseudo={activeAccount.pseudo}
            activeTag={activeAccount.tag}
        />
    </>
  ) : null;

  if (!inRoom) {
    return (
      <main className="flex min-h-screen text-white relative overflow-hidden">
        {/* Floating ambient blobs */}
        <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
            <div className="absolute top-[-10%] left-[-5%] w-[40rem] h-[40rem] rounded-full bg-cyan-500/20 blur-[120px] animate-float-blob" />
            <div className="absolute top-[20%] right-[-10%] w-[35rem] h-[35rem] rounded-full bg-violet-500/20 blur-[120px] animate-float-blob" style={{ animationDelay: '-4s' }} />
            <div className="absolute bottom-[-15%] left-[20%] w-[40rem] h-[40rem] rounded-full bg-emerald-500/15 blur-[120px] animate-float-blob" style={{ animationDelay: '-8s' }} />
        </div>

        {/* ── Main content (flex-1, centered) ── */}
        <div className="flex-1 flex flex-col items-center justify-center p-6 md:p-16 min-h-screen">
        <div className="z-10 flex flex-col items-center gap-8 w-full max-w-lg">
            <div className="text-center mb-2">
                <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-shimmer drop-shadow-[0_4px_30px_rgba(56,189,248,0.3)]">
                    DEMINEURS V2
                </h1>
                <p className="text-slate-400 text-sm mt-2 tracking-widest uppercase">Co-op Minesweeper · Liquid Edition</p>
            </div>

            {!activeAccount ? (
                /* === ACCOUNT PICKER === */
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="w-full flex flex-col gap-5"
                >
                    {accounts.length > 0 && (
                        <div className="flex flex-col gap-3">
                            <label className="text-slate-300/70 text-xs font-bold uppercase tracking-[0.2em] ml-1">
                                Vos comptes
                            </label>
                            <div className="flex flex-col gap-2">
                                {accounts.map((acc) => {
                                    const info = accountsInfo.find(i => accountKey(i) === accountKey(acc));
                                    const hasGame = !!info?.currentRoomId;
                                    return (
                                        <div
                                            key={accountKey(acc)}
                                            className="group relative glass rounded-2xl p-4 flex items-center gap-4 hover:bg-white/[0.07] hover:border-white/20 transition-all"
                                        >
                                            <div className={`p-2.5 rounded-xl ${hasGame ? 'bg-violet-400/15 border border-violet-300/25' : 'bg-cyan-400/10 border border-cyan-300/20'}`}>
                                                <User className={`w-5 h-5 ${hasGame ? 'text-violet-accent' : 'text-cyan-accent'}`} />
                                            </div>

                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-baseline gap-1">
                                                    <span className="font-bold text-white truncate">{acc.pseudo}</span>
                                                    <span className="font-mono text-slate-400 text-sm">#{acc.tag}</span>
                                                </div>
                                                {hasGame ? (
                                                    <div className="text-xs text-slate-300/80 mt-0.5">
                                                        <span className={info?.gameMode === 'hardcore' ? 'text-violet-accent font-bold' : 'text-cyan-accent font-bold'}>
                                                            {info?.gameMode === 'hardcore' ? 'INFINITE' : 'CLASSIC'}
                                                        </span>
                                                        <span className="text-slate-500 mx-1">·</span>
                                                        <span className="capitalize">{info?.gameDifficulty}</span>
                                                        {info?.gameMode === 'hardcore' && info.gameLevel && (
                                                            <>
                                                                <span className="text-slate-500 mx-1">·</span>
                                                                <span>Lv {info.gameLevel}</span>
                                                            </>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <div className="text-xs text-slate-500 mt-0.5">Aucune partie active</div>
                                                )}
                                            </div>

                                            <div className="flex items-center gap-1.5">
                                                {hasGame && info?.currentRoomId && (
                                                    <button
                                                        onClick={() => handleResumeGame(acc, info.currentRoomId as string)}
                                                        className="px-3 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-violet-300 to-fuchsia-300 text-slate-950 hover:brightness-110 active:scale-95 transition-all shadow-[0_0_14px_rgba(167,139,250,0.4)] flex items-center gap-1"
                                                        title="Reprendre la partie"
                                                    >
                                                        <Play className="w-3 h-3" /> RESUME
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => handleSelectAccount(acc)}
                                                    className="px-3 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-cyan-300 to-sky-300 text-slate-950 hover:brightness-110 active:scale-95 transition-all shadow-[0_0_14px_rgba(56,189,248,0.4)] flex items-center gap-1"
                                                    title="Utiliser ce compte"
                                                >
                                                    <LogIn className="w-3 h-3" /> SELECT
                                                </button>
                                                <button
                                                    onClick={() => handleRemoveAccount(acc)}
                                                    className="p-1.5 rounded-lg text-slate-500 hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
                                                    title="Supprimer de cet appareil"
                                                >
                                                    <X className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* CREATE NEW ACCOUNT */}
                    <div className="flex flex-col gap-3">
                        <label className="text-slate-300/70 text-xs font-bold uppercase tracking-[0.2em] ml-1">
                            {accounts.length > 0 ? 'Ou créer un nouveau compte' : 'Créer votre premier compte'}
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                placeholder="Pseudo (un tag #XXXX est généré automatiquement)"
                                value={newPseudoInput}
                                onChange={(e) => setNewPseudoInput(e.target.value.slice(0, 32))}
                                onKeyDown={(e) => e.key === 'Enter' && newPseudoInput.trim().length > 0 && handleCreateAccount()}
                                disabled={isCreatingAccount}
                                className="flex-1 px-4 py-3 rounded-2xl text-white focus:outline-none focus:border-cyan-300/60 focus:shadow-[0_0_20px_rgba(56,189,248,0.25)] transition-all placeholder:text-slate-500 glass"
                            />
                            <button
                                onClick={handleCreateAccount}
                                disabled={newPseudoInput.trim().length === 0 || isCreatingAccount}
                                className={`px-5 py-3 rounded-2xl font-bold transition-all min-w-[120px] glass-sheen flex items-center justify-center gap-2 ${
                                    newPseudoInput.trim().length > 0 && !isCreatingAccount
                                        ? 'bg-gradient-to-r from-cyan-300 to-violet-300 text-slate-950 shadow-[0_0_25px_rgba(56,189,248,0.4)] hover:brightness-110'
                                        : 'glass text-slate-500 cursor-not-allowed'
                                }`}
                            >
                                <UserPlus className="w-4 h-4" />
                                {isCreatingAccount ? '...' : 'CREATE'}
                            </button>
                        </div>
                        <p className="text-[11px] text-slate-500 ml-1">
                            Plusieurs comptes peuvent partager le même pseudo — le #tag les rend uniques.
                        </p>
                    </div>
                </motion.div>
            ) : (
                /* === ACCOUNT IS SELECTED === */
                <div className="w-full flex flex-col gap-6">
                    {/* Active account badge */}
                    <div className="w-full flex items-center justify-between glass rounded-2xl px-4 py-3">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="p-2 rounded-xl bg-cyan-400/10 border border-cyan-300/20">
                                <User className="w-4 h-4 text-cyan-accent" />
                            </div>
                            <div className="min-w-0">
                                <div className="text-[10px] text-slate-400 uppercase tracking-widest">Connecté en tant que</div>
                                <div className="font-bold text-white truncate">
                                    {activeAccount.pseudo}
                                    <span className="font-mono text-slate-400 text-sm ml-0.5">#{activeAccount.tag}</span>
                                </div>
                            </div>
                        </div>
                        <button
                            onClick={handleSwitchAccount}
                            className="text-xs font-bold text-slate-300 hover:text-white px-3 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
                        >
                            SWITCH
                        </button>
                    </div>

                    {/* Resume prompt if a game is in progress */}
                    {!setupMode && activeAccountInfo?.currentRoomId && (
                        <motion.div
                            initial={{ opacity: 0, y: -8 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="glass-strong glass-tint-violet rounded-2xl p-4 flex items-center gap-3"
                        >
                            <div className="p-2 rounded-xl bg-violet-400/15 border border-violet-300/25 shrink-0">
                                <Play className="w-4 h-4 text-violet-accent" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-bold text-white">Partie en cours</div>
                                <div className="text-xs text-slate-300/80">
                                    <span className={activeAccountInfo.gameMode === 'hardcore' ? 'text-violet-accent font-bold' : 'text-cyan-accent font-bold'}>
                                        {activeAccountInfo.gameMode === 'hardcore' ? 'INFINITE' : 'CLASSIC'}
                                    </span>
                                    <span className="text-slate-500 mx-1">·</span>
                                    <span className="capitalize">{activeAccountInfo.gameDifficulty}</span>
                                    {activeAccountInfo.gameMode === 'hardcore' && activeAccountInfo.gameLevel && (
                                        <>
                                            <span className="text-slate-500 mx-1">·</span>
                                            <span>Level {activeAccountInfo.gameLevel}</span>
                                        </>
                                    )}
                                </div>
                            </div>
                            <button
                                onClick={() => handleResumeGame(activeAccount, activeAccountInfo.currentRoomId as string)}
                                className="px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-violet-300 to-fuchsia-300 text-slate-950 hover:brightness-110 active:scale-95 transition-all shadow-[0_0_14px_rgba(167,139,250,0.4)]"
                            >
                                RESUME
                            </button>
                        </motion.div>
                    )}

                    {!setupMode ? (
                <div className="flex flex-col gap-5 w-full">
                    {/* CLASSIC MODE */}
                    <button
                        onClick={() => setSetupMode('classic')}
                        className="group relative px-8 py-7 glass glass-sheen glass-tint-cyan rounded-3xl hover:shadow-[0_0_50px_-10px_rgba(56,189,248,0.5)] hover:border-cyan-300/50 transition-all flex flex-col items-center gap-2 overflow-hidden"
                    >
                        <div className="flex items-center gap-3 relative z-10">
                            <Activity className="w-7 h-7 text-cyan-accent drop-shadow-[0_0_8px_rgba(56,189,248,0.6)]" />
                            <span className="text-2xl font-bold text-white tracking-wide">CLASSIC MODE</span>
                        </div>
                        <span className="text-slate-300/70 text-sm relative z-10">Expérience Démineur classique.</span>
                    </button>

                    {/* INFINITE MODE */}
                    <button
                        onClick={() => setSetupMode('hardcore')}
                        className="group relative px-8 py-7 glass glass-sheen glass-tint-violet rounded-3xl hover:shadow-[0_0_50px_-10px_rgba(167,139,250,0.5)] hover:border-violet-300/50 transition-all flex flex-col items-center gap-2 overflow-hidden"
                    >
                        <div className="flex items-center gap-3 relative z-10">
                            <Zap className="w-7 h-7 text-amber-accent animate-pulse drop-shadow-[0_0_8px_rgba(252,211,77,0.6)]" />
                            <span className="text-2xl font-bold text-white tracking-wide">INFINITE MODE</span>
                        </div>
                        <span className="text-slate-300/70 text-sm relative z-10">Incertitude &amp; Chiffres ambigus.</span>
                    </button>

                    {/* JOIN ROOM */}
                    <div className="flex gap-2 w-full mt-6">
                        <input
                            type="text"
                            placeholder="Vous avez un code ? Entrez l'ID de la salle"
                            className="flex-1 px-4 py-3 rounded-2xl text-white focus:outline-none focus:border-cyan-300/60 focus:shadow-[0_0_20px_rgba(56,189,248,0.25)] transition-all placeholder:text-slate-500 glass uppercase"
                            onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                        />
                        <button
                            onClick={() => joinRoom(roomId)}
                            className="px-6 py-3 glass glass-sheen text-white rounded-2xl font-bold transition-colors hover:bg-white/10"
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
                    className="w-full glass-strong p-8 rounded-3xl flex flex-col gap-6"
                >
                    <div className="flex justify-between items-center mb-2">
                        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                            {setupMode === 'classic'
                                ? <Activity className="text-cyan-accent drop-shadow-[0_0_8px_rgba(56,189,248,0.6)]"/>
                                : <Zap className="text-violet-accent drop-shadow-[0_0_8px_rgba(167,139,250,0.6)]"/>}
                            Setup Game
                        </h2>
                        <button onClick={() => setSetupMode(null)} className="text-slate-400 hover:text-white text-sm hover:underline">Annuler</button>
                    </div>

                    {/* Difficulty */}
                    <div className="space-y-3">
                        <label className="text-slate-300/70 text-xs font-semibold uppercase tracking-[0.15em]">Difficulté</label>
                        <div className="grid grid-cols-5 gap-2">
                            {['easy', 'medium', 'hard', 'hardcore', 'custom'].map((d) => (
                                <button
                                    key={d}
                                    onClick={() => setDifficulty(d)}
                                    className={`py-2.5 rounded-xl font-bold capitalize transition-all text-xs sm:text-sm border ${
                                        difficulty === d
                                        ? 'bg-gradient-to-br from-cyan-400/30 to-violet-400/30 text-white border-cyan-300/60 shadow-[0_0_18px_rgba(56,189,248,0.35)]'
                                        : 'bg-white/[0.04] text-slate-300 border-white/10 hover:bg-white/[0.08] hover:border-white/20'
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
                           className="space-y-5 glass-soft p-5 rounded-2xl"
                        >
                            <div className="flex items-center gap-2 text-cyan-accent mb-1">
                                <Settings className="w-4 h-4" />
                                <span className="font-bold text-sm uppercase tracking-wider">Custom Configuration</span>
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
                            <div className="text-right text-xs text-slate-400 -mt-3">
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
                            <div className="flex items-center justify-between py-1">
                                <label className="text-slate-300/80 text-xs font-semibold uppercase tracking-[0.15em] max-w-[70%]">
                                    Allow Double Numbers On Same Case
                                </label>
                                <button
                                    onClick={() => setCustomAllowLying(!customAllowLying)}
                                    className={`relative w-12 h-7 rounded-full transition-all border ${
                                        customAllowLying
                                            ? 'bg-gradient-to-r from-cyan-400 to-violet-400 border-white/20 shadow-[0_0_12px_rgba(56,189,248,0.5)]'
                                            : 'bg-white/10 border-white/15'
                                    }`}
                                >
                                    <div className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform shadow-md ${
                                        customAllowLying ? 'translate-x-5' : 'translate-x-0'
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
                            onChange={(val) => setCustomHp(Math.round(val))}
                            formatValue={(v) => `${Math.round(v)} ♥`}
                        />
                    </div>

                    <button
                        onClick={startGame}
                        className={`w-full py-4 mt-2 rounded-2xl font-bold text-xl transition-all transform hover:scale-[1.02] active:scale-[0.98] glass-sheen ${
                            setupMode === 'classic'
                            ? 'bg-gradient-to-r from-cyan-300 to-sky-400 text-slate-950 shadow-[0_10px_40px_-10px_rgba(56,189,248,0.6)]'
                            : 'bg-gradient-to-r from-violet-300 to-fuchsia-400 text-slate-950 shadow-[0_10px_40px_-10px_rgba(167,139,250,0.6)]'
                        }`}
                    >
                        START GAME
                    </button>
                </motion.div>
            )}
                </div>
            )}
        </div>
        </div>

        {/* ── Permanent social panel (desktop only, shown when account is active) ── */}
        {activeAccount && (
            <aside className="hidden lg:flex w-[340px] shrink-0 min-h-screen border-l border-white/10 glass-strong flex-col">
                <SocialDrawer
                    isOpen={true}
                    variant="panel"
                    activePseudo={activeAccount.pseudo}
                    activeTag={activeAccount.tag}
                />
            </aside>
        )}
        {notificationCorner}
      </main>
    );
  }

  // Board max-width: target 40px cells + 4px gap + 40px glass padding
  const boardCols = grid[0]?.length || 0;
  const boardMaxW = boardCols ? boardCols * 40 + (boardCols - 1) * 4 + 40 : 340;

  return (
    <GameContainer isExploding={isExploding} difficulty={difficulty}>
      <header className="w-full flex justify-between items-center mb-6 px-2 max-w-7xl mx-auto gap-3">

          {/* ── Left HUD Bar ── */}
          <div className="flex items-stretch bg-slate-900/90 rounded-2xl border border-slate-600/40 h-11 shadow-md shadow-black/40 overflow-hidden">

             {/* MENU */}
             <button
                onClick={leaveRoom}
                className="flex items-center gap-2 px-4 text-slate-400 hover:text-slate-100 hover:bg-slate-800 border-r border-slate-700/50 transition-colors"
                title="Back to menu"
             >
                <ArrowLeft className="w-4 h-4" />
                <span className="text-[11px] font-bold tracking-widest uppercase">Menu</span>
             </button>

             {/* Level (hardcore) — amber accent */}
             {setupMode === 'hardcore' && (
                 <div className="relative flex items-center gap-2 px-4 border-r border-slate-700/50">
                     <Trophy className="w-4 h-4 text-amber-400" />
                     <span className="text-white font-mono font-bold text-sm tabular-nums">{score + 1}</span>
                     <span className="text-slate-500 text-[10px] font-semibold uppercase hidden sm:block">Lv</span>
                     <div className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-amber-400" />
                 </div>
             )}

             {/* Mine Counter — rose accent when negative */}
             <div className={`relative flex items-center gap-2 px-4 border-r border-slate-700/50 ${
                 remainingMines < 0 ? 'bg-rose-500/10' : ''
             }`}>
                 <FlagIcon className={`w-4 h-4 ${remainingMines < 0 ? 'text-rose-400 fill-rose-400' : 'text-rose-400/70 fill-rose-400/30'}`} />
                 <span className={`font-mono font-bold text-sm tabular-nums ${remainingMines < 0 ? 'text-rose-300' : 'text-white'}`}>
                     {remainingMines}
                 </span>
                 {remainingMines < 0 && (
                     <div className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-rose-400" />
                 )}
             </div>

             {/* Scanner — emerald accent when active */}
             <button
                 onClick={() => scansAvailable > 0 && setIsScanning(!isScanning)}
                 disabled={scansAvailable <= 0}
                 title="Scanner Tool"
                 className={`relative flex hover:cursor-pointer items-center gap-2 px-4 border-r border-slate-700/50 transition-colors ${
                     isScanning
                         ? 'bg-emerald-500/10 text-emerald-200'
                         : scansAvailable > 0
                             ? 'text-slate-300 hover:text-white hover:bg-slate-800'
                             : 'text-slate-600 cursor-not-allowed'
                 }`}
             >
                 <Radar className={`w-4 h-4 ${isScanning ? 'text-emerald-400' : scansAvailable > 0 ? 'text-emerald-500/70' : 'text-slate-600'}`} />
                 <span className="font-mono font-bold text-sm tabular-nums">{scansAvailable}</span>
                 {isScanning && (
                     <div className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-emerald-400" />
                 )}
             </button>

             {/* Room ID */}
             <button
                 onClick={handleCopyRoomId}
                 className="hidden md:flex hover:cursor-pointer items-center gap-2 px-4 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                 title="Copy Room ID"
             >
                 {copied
                     ? <Check className="w-4 h-4 text-emerald-400" />
                     : <Copy className="w-4 h-4" />
                 }
                 <span className="font-mono font-bold text-sm tracking-widest">{roomId}</span>
             </button>
          </div>

          {/* ── Right: Hearts ── */}
          <div className="flex items-center gap-1 bg-slate-900/90 rounded-2xl border border-slate-600/40 h-11 px-3.5 shadow-md shadow-black/40">
              {[...Array(3)].map((_, i) => (
                  <div
                     key={i}
                     className={i < hp ? `heart-wave-${i}` : ''}
                  >
                      <Heart
                         className={`w-4 h-4 fill-current ${
                             i < hp ? 'text-rose-400' : 'text-slate-700'
                         }`}
                      />
                  </div>
              ))}
              {hp > 3 && (
                  <span className="text-rose-300 font-bold text-[11px] font-mono ml-0.5 px-1.5 py-0.5 rounded bg-rose-500/15">
                      +{hp - 3}
                  </span>
              )}
          </div>

      </header>

       {/* GAME BOARD WINDOW */}
       <div className="w-full flex justify-center">
            {/* Glass shell: width capped at target size, cells adapt via 1fr columns */}
            <div
                ref={boardRef}
                className="glass-strong p-5 rounded-2xl"
                style={{ width: `min(${boardMaxW}px, 92vw)` }}
            >
                {/* Inner clip: height measured from DOM, so no empty space ever */}
                <div
                    className="relative overflow-hidden"
                    style={{ height: boardInnerH || undefined }}
                >
                    <motion.div
                        className={`w-full ${isTransitioning ? 'pointer-events-none' : ''}`}
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
       </div>

      <div className="fixed bottom-4 right-4 text-xs text-slate-500 flex items-center gap-2 glass px-3 py-1.5 rounded-full">
         <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)] animate-pulse" />
         Serveur : Connecté
      </div>

       {/* GAME OVER OVERLAY */}
       <AnimatePresence>
            {isGameOver && showGameOverModal && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-md p-4"
                >
                    <motion.div
                        initial={{ scale: 0.9, y: 20 }}
                        animate={{ scale: 1, y: 0 }}
                        className="glass-strong glass-tint-coral p-8 rounded-3xl max-w-md w-full text-center"
                        style={{ boxShadow: '0 30px 80px -20px rgba(0,0,0,0.7), 0 0 60px -10px rgba(251,113,133,0.45)' }}
                    >
                        <h2 className="text-5xl font-black text-rose-300 mb-2 drop-shadow-[0_0_15px_rgba(251,113,133,0.5)]">ÉCHEC CRITIQUE</h2>
                        <p className="text-slate-300 mb-8 text-lg">Vous avez échoué ! (perdant)</p>

                        <div className="flex flex-col gap-3">
                            <button
                                onClick={restartGame}
                                className="w-full py-4 bg-gradient-to-r from-rose-400 to-pink-400 text-slate-950 font-black text-xl transition-all rounded-2xl shadow-[0_10px_40px_-10px_rgba(251,113,133,0.6)] hover:brightness-110 active:scale-[0.98]"
                            >
                                RÉESSAYER
                            </button>
                            <button
                                onClick={() => setShowGameOverModal(false)}
                                className="w-full py-4 glass glass-sheen text-white font-bold text-xl transition-colors rounded-2xl hover:bg-white/10"
                            >
                                VOIR LE PLATEAU
                            </button>
                            <button
                                onClick={leaveRoom}
                                className="w-full py-4 glass-soft text-slate-200 font-black text-xl hover:bg-white/10 transition-colors rounded-2xl"
                            >
                                RETOUR À L'ACCUEIL
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}

            {isGameOver && !showGameOverModal && (
                <motion.div
                    initial={{ y: 100 }}
                    animate={{ y: 0 }}
                    className="fixed bottom-0 left-0 right-0 z-40 glass-strong border-t border-rose-300/30 p-4"
                >
                    <div className="max-w-7xl mx-auto flex justify-between items-center gap-4 flex-wrap">
                        <div className="flex items-center gap-2">
                             <span className="text-rose-300 font-bold text-xl drop-shadow-[0_0_8px_rgba(251,113,133,0.5)]">PARTIE TERMINÉE</span>
                             <button
                                onClick={() => setShowGameOverModal(true)}
                                className="text-sm text-slate-400 hover:text-white underline ml-2"
                             >
                                Voir le menu
                             </button>
                        </div>

                        <div className="flex gap-2">
                            {setupMode && (
                                <button
                                    onClick={restartGame}
                                    className="px-6 py-2 bg-gradient-to-r from-rose-400 to-pink-400 text-slate-950 font-bold rounded-xl shadow-[0_0_18px_rgba(251,113,133,0.4)] hover:brightness-110 transition-all"
                                >
                                    RÉESSAYER
                                </button>
                            )}
                            <button
                                onClick={leaveRoom}
                                className="px-6 py-2 glass text-white font-bold rounded-xl hover:bg-white/10 transition-colors"
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
                    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-md p-4"
                >
                    <motion.div
                        initial={{ scale: 0.9, y: 20 }}
                        animate={{ scale: 1, y: 0 }}
                        className="glass-strong glass-tint-mint p-8 rounded-3xl max-w-md w-full text-center"
                        style={{ boxShadow: '0 30px 80px -20px rgba(0,0,0,0.7), 0 0 60px -10px rgba(52,211,153,0.45)' }}
                    >
                        <h2 className="text-5xl font-black text-mint-accent mb-2 drop-shadow-[0_0_15px_rgba(52,211,153,0.5)]">Bravo !</h2>
                        <p className="text-slate-300 mb-8 text-lg">Secteur dégagé avec succès !</p>

                        <div className="flex flex-col gap-3">
                            <button
                                onClick={restartGame}
                                className="w-full py-4 bg-gradient-to-r from-emerald-300 to-teal-400 text-slate-950 font-black text-xl transition-all rounded-2xl shadow-[0_10px_40px_-10px_rgba(52,211,153,0.6)] hover:brightness-110 active:scale-[0.98]"
                            >
                                PLAY AGAIN
                            </button>
                            <button
                                onClick={() => setShowGameWinModal(false)}
                                className="w-full py-4 glass glass-sheen text-white font-bold text-xl transition-colors rounded-2xl hover:bg-white/10"
                            >
                                VIEW BOARD
                            </button>
                            <button
                                onClick={leaveRoom}
                                className="w-full py-4 glass-soft text-slate-200 font-black text-xl hover:bg-white/10 transition-colors rounded-2xl"
                            >
                                RETURN TO HOME
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}

            {isGameWon && !showGameWinModal && (
                <motion.div
                    initial={{ y: 100 }}
                    animate={{ y: 0 }}
                    className="fixed bottom-0 left-0 right-0 z-40 glass-strong border-t border-emerald-300/30 p-4"
                >
                    <div className="max-w-7xl mx-auto flex justify-between items-center gap-4 flex-wrap">
                        <div className="flex items-center gap-2">
                             <span className="text-mint-accent font-bold text-xl drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]">VICTORY</span>
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
                                    className="px-6 py-2 bg-gradient-to-r from-emerald-300 to-teal-400 text-slate-950 font-bold rounded-xl shadow-[0_0_18px_rgba(52,211,153,0.4)] hover:brightness-110 transition-all"
                                >
                                    PLAY AGAIN
                                </button>
                            )}
                            <button
                                onClick={leaveRoom}
                                className="px-6 py-2 glass text-white font-bold rounded-xl hover:bg-white/10 transition-colors"
                            >
                                MENU
                            </button>
                        </div>
                    </div>
                </motion.div>
            )}
       </AnimatePresence>
       {inGameSocialUI}
       {notificationCorner}
    </GameContainer>
  );
}
