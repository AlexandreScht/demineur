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
