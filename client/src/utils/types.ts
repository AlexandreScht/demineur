export interface CellData {
    x: number;
    y: number;
    isMine: boolean;
    isOpen: boolean;
    flag: number; // 0: none, 1: flag, 2: question
    neighborCount: number;
    lyingNumbers?: number[] | null;
    scanned?: 'mine' | 'safe' | null;
}

export type GridData = CellData[][];

export interface GameInitData {
    grid: GridData;
    hp: number;
    rows: number;
    cols: number;
    mines: number;
    scansAvailable?: number;
    role?: 'P1' | 'P2';
    mode?: string;
    difficulty?: string;
    level?: number;
}

export interface Account {
    pseudo: string;
    tag: string;
}

export interface AccountInfo extends Account {
    currentRoomId: string | null;
    gameMode: string | null;
    gameDifficulty: string | null;
    gameLevel: number | null;
    notFound?: boolean;
}

export interface Friend {
    pseudo: string;
    tag: string;
    online: boolean;
    inGame: boolean;
    gameMode: string | null;
    gameDifficulty: string | null;
    gameLevel: number | null;
    roomId: string | null;
    notFound?: boolean;
}

export interface IncomingJoinRequest {
    fromPseudo: string;
    fromTag: string;
    roomId: string;
    receivedAt: number;
    expiresAt: number;
}

export interface IncomingFriendRequest {
    fromPseudo: string;
    fromTag: string;
    receivedAt: number;
}
