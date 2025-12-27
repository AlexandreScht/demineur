export interface CellData {
    x: number;
    y: number;
    isMine: boolean;
    isOpen: boolean;
    flag: number; // 0: none, 1: flag, 2: question
    neighborCount: number;
    quantumRange?: string | null;
    lyingNumbers?: number[] | null;
}

export type GridData = CellData[][];

export interface GameInitData {
    grid: GridData;
    hp: number;
    rows: number;
    cols: number;
    mines: number;
    role?: 'P1' | 'P2';
}
