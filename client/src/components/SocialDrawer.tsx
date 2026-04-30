"use client";
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { socket } from '@/utils/socket';
import { Friend } from '@/utils/types';
import { Users, UserPlus, X, Send, Circle, Trash2, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
    isOpen: boolean;
    onClose?: () => void;
    /** 'panel' = static sidebar (home page), 'drawer' = sliding overlay (in-game) */
    variant?: 'drawer' | 'panel';
    activePseudo?: string | null;
    activeTag?: string | null;
}

const friendKey = (p: string, t: string) => `${p}#${t}`;

export default function SocialDrawer({
    isOpen,
    onClose,
    variant = 'drawer',
    activePseudo,
    activeTag,
}: Props) {
    const [friends, setFriends] = useState<Friend[]>([]);
    const [hasFetched, setHasFetched] = useState(false);
    const [addInput, setAddInput] = useState('');
    const [pendingOutgoing, setPendingOutgoing] = useState<Set<string>>(new Set());
    const [copied, setCopied] = useState(false);

    // Panel is always open; drawer polls only while open
    const shouldPoll = variant === 'panel' || isOpen;

    useEffect(() => {
        if (!shouldPoll) return;
        socket.emit('fetch_friends');
        const interval = setInterval(() => socket.emit('fetch_friends'), 8000);
        return () => clearInterval(interval);
    }, [shouldPoll]);

    useEffect(() => {
        function onFriendsList(list: Friend[]) {
            setFriends(list || []);
            setHasFetched(true);
        }
        function onFriendAdded({ pseudo, tag }: { pseudo: string; tag: string }) {
            toast.success(`${pseudo}#${tag} is now your friend`);
            setAddInput('');
            socket.emit('fetch_friends');
        }
        function onFriendRemoved() {
            socket.emit('fetch_friends');
        }
        function onFriendError({ reason }: { reason: string }) {
            toast.error(reason || 'Friend error');
        }
        function onFriendRequestSent({ friendPseudo, friendTag }: { friendPseudo: string; friendTag: string }) {
            toast.success(`Friend request sent to ${friendPseudo}#${friendTag}`);
            setAddInput('');
        }
        function onFriendRequestAccepted({ byPseudo, byTag }: { byPseudo: string; byTag: string }) {
            toast.success(`${byPseudo}#${byTag} accepted your friend request`);
            socket.emit('fetch_friends');
        }
        function onFriendRequestDeclined({ byPseudo, byTag }: { byPseudo: string; byTag: string }) {
            toast(`${byPseudo}#${byTag} declined your friend request`);
        }
        function onJoinRequestSent({ friendPseudo, friendTag }: { friendPseudo: string; friendTag: string }) {
            const k = friendKey(friendPseudo, friendTag);
            setPendingOutgoing(prev => { const next = new Set(prev); next.add(k); return next; });
            toast.success(`Request sent to ${friendPseudo}#${friendTag}`);
            setTimeout(() => {
                setPendingOutgoing(prev => { const next = new Set(prev); next.delete(k); return next; });
            }, 60_000);
        }
        function onJoinRequestError({ reason }: { reason: string }) {
            toast.error(reason || 'Cannot send request');
        }
        function onJoinRequestDeclined({ fromPseudo, fromTag }: { fromPseudo: string; fromTag: string }) {
            const k = friendKey(fromPseudo, fromTag);
            setPendingOutgoing(prev => { const next = new Set(prev); next.delete(k); return next; });
            toast(`${fromPseudo}#${fromTag} declined your request`);
        }
        function onFriendStatusUpdate(updated: Friend) {
            setFriends(prev => {
                const k = friendKey(updated.pseudo, updated.tag);
                const idx = prev.findIndex(f => friendKey(f.pseudo, f.tag) === k);
                if (idx === -1) return prev;
                const next = [...prev];
                next[idx] = { ...prev[idx], ...updated };
                return next;
            });
        }

        socket.on('friends_list', onFriendsList);
        socket.on('friend_added', onFriendAdded);
        socket.on('friend_removed', onFriendRemoved);
        socket.on('friend_error', onFriendError);
        socket.on('friend_request_sent', onFriendRequestSent);
        socket.on('friend_request_accepted', onFriendRequestAccepted);
        socket.on('friend_request_declined', onFriendRequestDeclined);
        socket.on('friend_status_update', onFriendStatusUpdate);
        socket.on('join_request_sent', onJoinRequestSent);
        socket.on('join_request_error', onJoinRequestError);
        socket.on('join_request_declined', onJoinRequestDeclined);
        return () => {
            socket.off('friends_list', onFriendsList);
            socket.off('friend_added', onFriendAdded);
            socket.off('friend_removed', onFriendRemoved);
            socket.off('friend_error', onFriendError);
            socket.off('friend_request_sent', onFriendRequestSent);
            socket.off('friend_request_accepted', onFriendRequestAccepted);
            socket.off('friend_request_declined', onFriendRequestDeclined);
            socket.off('friend_status_update', onFriendStatusUpdate);
            socket.off('join_request_sent', onJoinRequestSent);
            socket.off('join_request_error', onJoinRequestError);
            socket.off('join_request_declined', onJoinRequestDeclined);
        };
    }, []);

    const handleAdd = () => {
        const m = addInput.trim().match(/^(.+?)#([A-Za-z0-9]{4})$/);
        if (!m) { toast.error('Format: Pseudo#XXXX'); return; }
        socket.emit('send_friend_request', { friendPseudo: m[1].trim(), friendTag: m[2].toUpperCase() });
    };

    const handleRequestJoin = (f: Friend) => {
        socket.emit('request_join', { friendPseudo: f.pseudo, friendTag: f.tag });
    };

    const handleRemove = (f: Friend) => {
        socket.emit('remove_friend', { friendPseudo: f.pseudo, friendTag: f.tag });
    };

    const handleCopyMyId = () => {
        if (!activePseudo || !activeTag) return;
        navigator.clipboard.writeText(`${activePseudo}#${activeTag}`);
        setCopied(true);
        toast.success('Pseudo copied to clipboard');
        setTimeout(() => setCopied(false), 2000);
    };

    const sortedFriends = [...friends].sort((a, b) => {
        const score = (x: Friend) => (x.inGame ? 2 : x.online ? 1 : 0);
        return score(b) - score(a) || a.pseudo.localeCompare(b.pseudo);
    });

    const panelContent = (
        <>
            <div className="p-5 border-b border-white/10 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                    <Users className="w-5 h-5 text-cyan-accent" />
                    <h2 className="text-lg font-bold text-white tracking-wide">SOCIAL</h2>
                </div>
                {variant === 'drawer' && onClose && (
                    <button
                        onClick={onClose}
                        className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                        aria-label="Close"
                    >
                        <X className="w-5 h-5" />
                    </button>
                )}
            </div>

            {/* Active account: copy your own ID to share */}
            {activePseudo && activeTag && (
                <div className="p-4 border-b border-white/10 shrink-0">
                    <label className="text-slate-300/70 text-[11px] font-bold uppercase tracking-[0.2em] mb-2 block">
                        Your ID
                    </label>
                    <button
                        onClick={handleCopyMyId}
                        className="w-full flex items-center gap-3 glass rounded-xl p-3 hover:bg-white/[0.07] transition-colors group"
                    >
                        <div className="flex-1 min-w-0 text-left">
                            <div className="font-bold text-white truncate">
                                {activePseudo}<span className="font-mono text-slate-400 text-[12px]">#{activeTag}</span>
                            </div>
                            <div className="text-[10px] text-slate-500 mt-0.5">Click to copy &amp; share</div>
                        </div>
                        <div className={`shrink-0 p-1.5 rounded-lg transition-colors ${copied ? 'bg-emerald-400/15 text-emerald-300' : 'glass text-slate-400 group-hover:text-white'}`}>
                            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        </div>
                    </button>
                </div>
            )}

            <div className="p-5 border-b border-white/10 shrink-0">
                <label className="text-slate-300/70 text-[11px] font-bold uppercase tracking-[0.2em] mb-2 block">
                    Add a friend
                </label>
                <div className="flex gap-2">
                    <input
                        type="text"
                        placeholder="Pseudo#XXXX"
                        value={addInput}
                        onChange={(e) => setAddInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                        className="flex-1 px-3 py-2.5 rounded-xl text-white text-sm focus:outline-none focus:border-cyan-300/60 focus:shadow-[0_0_18px_rgba(56,189,248,0.2)] placeholder:text-slate-500 glass"
                    />
                    <button
                        onClick={handleAdd}
                        disabled={!addInput.includes('#')}
                        className={`px-3 py-2.5 rounded-xl glass-sheen flex items-center gap-1 text-xs font-bold transition-all ${
                            addInput.includes('#')
                                ? 'bg-gradient-to-r from-cyan-300 to-violet-300 text-slate-950 hover:brightness-110 active:scale-95 shadow-[0_0_18px_rgba(56,189,248,0.35)]'
                                : 'glass text-slate-500 cursor-not-allowed'
                        }`}
                    >
                        <UserPlus className="w-4 h-4" />
                        ASK
                    </button>
                </div>
                <p className="text-[10px] text-slate-500 mt-2">They&apos;ll receive a request to accept.</p>
            </div>

            <div className="flex-1 overflow-y-auto p-4 no-scrollbar">
                {!hasFetched ? (
                    <div className="text-center text-slate-500 text-xs mt-12">Loading…</div>
                ) : sortedFriends.length === 0 ? (
                    <div className="text-center text-slate-500 text-sm mt-12 px-4">
                        No friends yet. Add one above using their <span className="font-mono text-slate-300">Pseudo#TAG</span>.
                    </div>
                ) : (
                    <div className="flex flex-col gap-2">
                        {sortedFriends.map((f) => {
                            const k = friendKey(f.pseudo, f.tag);
                            const pending = pendingOutgoing.has(k);
                            const isHardcore = f.gameMode === 'hardcore';
                            const inGameTextColor = isHardcore ? 'text-violet-accent' : 'text-cyan-accent';
                            return (
                                <div
                                    key={k}
                                    className="glass rounded-xl p-3 flex items-center gap-3 group hover:bg-white/[0.06] transition-colors"
                                >
                                    <div className="relative shrink-0">
                                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm border ${
                                            f.inGame
                                                ? isHardcore
                                                    ? 'bg-violet-400/15 text-violet-200 border-violet-300/30'
                                                    : 'bg-cyan-400/15 text-cyan-200 border-cyan-300/30'
                                                : f.online
                                                    ? 'bg-emerald-400/15 text-emerald-200 border-emerald-300/30'
                                                    : 'bg-slate-700/40 text-slate-400 border-slate-600/40'
                                        }`}>
                                            {f.pseudo[0]?.toUpperCase() || '?'}
                                        </div>
                                        <Circle
                                            className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 fill-current ${
                                                f.inGame
                                                    ? isHardcore ? 'text-violet-400' : 'text-cyan-400'
                                                    : f.online ? 'text-emerald-400' : 'text-slate-600'
                                            } drop-shadow`}
                                            strokeWidth={2.5}
                                        />
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <div className="font-bold text-white text-sm truncate">
                                            {f.pseudo}<span className="font-mono text-slate-400 text-[11px]">#{f.tag}</span>
                                        </div>
                                        <div className="text-[11px] mt-0.5 truncate">
                                            {f.notFound ? (
                                                <span className="text-slate-500">Account not found</span>
                                            ) : f.inGame ? (
                                                <span className={inGameTextColor}>
                                                    In game · <span className="capitalize">{f.gameDifficulty || ''}</span>
                                                    {isHardcore && f.gameLevel ? ` · Lv ${f.gameLevel}` : ''}
                                                </span>
                                            ) : f.online ? (
                                                <span className="text-emerald-300/80">Online</span>
                                            ) : (
                                                <span className="text-slate-500">Offline</span>
                                            )}
                                        </div>
                                    </div>

                                    {f.inGame && (
                                        <button
                                            onClick={() => handleRequestJoin(f)}
                                            disabled={pending}
                                            title={pending ? 'Request pending…' : 'Ask to join their game'}
                                            className={`shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-all ${
                                                pending
                                                    ? 'glass text-slate-400 cursor-not-allowed'
                                                    : isHardcore
                                                        ? 'bg-gradient-to-r from-violet-300 to-fuchsia-300 text-slate-950 hover:brightness-110 active:scale-95 shadow-[0_0_12px_rgba(167,139,250,0.4)]'
                                                        : 'bg-gradient-to-r from-cyan-300 to-sky-300 text-slate-950 hover:brightness-110 active:scale-95 shadow-[0_0_12px_rgba(56,189,248,0.4)]'
                                            }`}
                                        >
                                            <Send className="w-3 h-3" />
                                            {pending ? 'SENT' : 'JOIN'}
                                        </button>
                                    )}
                                    <button
                                        onClick={() => handleRemove(f)}
                                        className="p-1.5 rounded-lg text-slate-500 hover:text-rose-300 hover:bg-rose-500/10 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                                        title="Remove friend"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </>
    );

    if (variant === 'panel') {
        return <div className="flex flex-col h-full">{panelContent}</div>;
    }

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-sm"
                    />
                    <motion.div
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={{ type: 'spring', damping: 28, stiffness: 280 }}
                        className="fixed top-0 right-0 bottom-0 z-50 w-[min(420px,100vw)] glass-strong border-l border-white/10 flex flex-col"
                    >
                        {panelContent}
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
