"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft, RotateCcw, Clock, Bomb, Lightbulb,
  Settings as SettingsIcon, Heart, Sparkles, Wand2, Loader2,
  Eye, EyeOff, MousePointer2, Flag as FlagIcon, ArrowLeft,
} from "lucide-react";
import RangeSlider from "@/components/ui/RangeSlider";

type Orientation = "pointy" | "flat";
type OrientChoice = "pointy" | "flat" | "random";
type Symmetry = "none" | "horizontal" | "radial";

interface HexCell {
  col: number;
  row: number;
  isMine: boolean;
  revealed: boolean;
  flagged: boolean;
  adjacentMines: number;
  adjacentConsecutive: boolean;
  active: boolean;          // false = "hole", not rendered
  isGiven: boolean;         // pre-revealed at puzzle start
  isDistant: boolean;       // shows radius-2 mine count instead of adjacency
  distantMines: number;     // cached count for distant cells
}

interface Settings {
  cols: number;
  rows: number;
  mineDensity: number;      // fraction of active cells that are mines (0.10 - 0.32)
  holeDensity: number;      // fraction of cells turned into holes (0 - 0.40)
  orientation: OrientChoice;
  symmetry: Symmetry;
  showLineHints: boolean;
  showConsecutive: boolean;
  mistakesAllowed: number;  // 0 = lose on first mistake, N = N mistakes tolerated, -1 = infinite
  hintsCount: number;       // hints available per game (0 = no hint button)
  noGuess: boolean;         // generate puzzles solvable without guessing
  distantIndices: boolean;  // sprinkle radius-2 hints among the pre-revealed cells
  givenRatio: number;       // fraction of safe cells pre-revealed (0 - 0.25)
  distantRatio: number;     // fraction of givens that are distant (0 - 1)
}

const DEFAULT_SETTINGS: Settings = {
  cols: 15, rows: 12,
  mineDensity: 0.22,
  holeDensity: 0.20,
  orientation: "random",
  symmetry: "none",
  showLineHints: true,
  showConsecutive: true,
  mistakesAllowed: 3,
  hintsCount: 3,
  noGuess: true,
  distantIndices: true,
  givenRatio: 0.08,
  distantRatio: 0.35,
};

type Preset = "easy" | "medium" | "hard";
const PRESETS: Record<Preset, Partial<Settings>> = {
  easy:   { cols: 11, rows: 9,  mineDensity: 0.18, mistakesAllowed: 5, hintsCount: 5 },
  medium: { cols: 15, rows: 12, mineDensity: 0.22, mistakesAllowed: 3, hintsCount: 3 },
  hard:   { cols: 19, rows: 16, mineDensity: 0.27, mistakesAllowed: 1, hintsCount: 2 },
};

const SQRT3 = Math.sqrt(3);
const NUM_COLORS = ["", "#7dd3fc", "#6ee7b7", "#fda4af", "#c4b5fd", "#fcd34d", "#67e8f9"];
const HEX_SIZE = 40;
const LABEL_H = 42;
const ROW_LW = 40;
const MARGIN = 12;

// Pointy-top: odd-r offset (odd rows shifted right). Rows are straight horizontal lines.
// Flat-top: odd-q offset (odd cols shifted down). Cols are straight vertical lines.
function getNeighbors(orient: Orientation, col: number, row: number, cols: number, rows: number): [number, number][] {
  let offsets: [number, number][];
  if (orient === "pointy") {
    const isOdd = row % 2 === 1;
    offsets = isOdd
      ? [[-1, 0], [1, 0], [0, -1], [1, -1], [0, 1], [1, 1]]
      : [[-1, 0], [1, 0], [-1, -1], [0, -1], [-1, 1], [0, 1]];
  } else {
    const isOdd = col % 2 === 1;
    offsets = isOdd
      ? [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, 1], [1, 1]]
      : [[-1, -1], [1, -1], [0, -1], [0, 1], [-1, 0], [1, 0]];
  }
  return offsets
    .map(([dc, dr]): [number, number] => [col + dc, row + dr])
    .filter(([c, r]) => c >= 0 && c < cols && r >= 0 && r < rows);
}

function getNeighborsCyclic(orient: Orientation, col: number, row: number, cols: number, rows: number): ([number, number] | null)[] {
  let offsets: [number, number][];
  if (orient === "pointy") {
    const isOdd = row % 2 === 1;
    offsets = isOdd
      ? [[1, -1], [1, 0], [1, 1], [0, 1], [-1, 0], [0, -1]]
      : [[0, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  } else {
    const isOdd = col % 2 === 1;
    offsets = isOdd
      ? [[0, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]]
      : [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 0], [-1, -1]];
  }
  return offsets.map(([dc, dr]): [number, number] | null => {
    const c = col + dc, r = row + dr;
    if (c < 0 || c >= cols || r < 0 || r >= rows) return null;
    return [c, r];
  });
}

function checkAdjacentConsecutive(orient: Orientation, col: number, row: number, cols: number, rows: number, grid: HexCell[][]): boolean {
  const cyclic = getNeighborsCyclic(orient, col, row, cols, rows);
  const states: ("mine" | "safe")[] = [];
  for (const pos of cyclic) {
    if (pos === null) continue;
    const [c, r] = pos;
    if (!grid[c][r].active) continue;
    states.push(grid[c][r].isMine ? "mine" : "safe");
  }
  const mineCount = states.filter(s => s === "mine").length;
  if (mineCount <= 1 || mineCount === states.length) return true;
  let runs = 0;
  for (let i = 0; i < states.length; i++) {
    const prev = states[(i - 1 + states.length) % states.length];
    if (states[i] === "mine" && prev !== "mine") runs++;
  }
  return runs <= 1;
}

// BFS to depth R, excluding the source cell. Hex distance = number of edge steps.
function withinRadius(orient: Orientation, col: number, row: number, cols: number, rows: number, R: number): [number, number][] {
  const visited = new Set<string>([`${col},${row}`]);
  const queue: [number, number, number][] = [[col, row, 0]];
  const out: [number, number][] = [];
  while (queue.length) {
    const [c, r, d] = queue.shift()!;
    if (d > 0) out.push([c, r]);
    if (d < R) {
      for (const [nc, nr] of getNeighbors(orient, c, r, cols, rows)) {
        const k = `${nc},${nr}`;
        if (!visited.has(k)) { visited.add(k); queue.push([nc, nr, d + 1]); }
      }
    }
  }
  return out;
}

type LineSegment = {
  startIdx: number;
  length: number;
  mineCount: number;
  consecutive: boolean;
};

function buildLineSegments(cells: (HexCell | undefined)[]): LineSegment[] {
  const segs: LineSegment[] = [];
  let cur: HexCell[] = [];
  let startIdx = -1;
  const flush = () => {
    if (cur.length === 0) return;
    let firstM = -1, lastM = -1, mc = 0;
    for (let i = 0; i < cur.length; i++) {
      if (cur[i].isMine) {
        if (firstM < 0) firstM = i;
        lastM = i;
        mc++;
      }
    }
    const consecutive = mc <= 1 || (lastM - firstM + 1) === mc;
    segs.push({ startIdx, length: cur.length, mineCount: mc, consecutive });
    cur = [];
  };
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (cell?.active) {
      if (cur.length === 0) startIdx = i;
      cur.push(cell);
    } else {
      flush();
    }
  }
  flush();
  return segs;
}

function formatLineHint(count: number, consecutive: boolean, showConsec: boolean): string {
  if (count <= 1 || !showConsec) return String(count);
  return consecutive ? `{${count}}` : `-${count}-`;
}

function hexPos(orient: Orientation, col: number, row: number, size: number, ox: number, oy: number): [number, number] {
  if (orient === "pointy") {
    const hw = SQRT3 * size;
    return [ox + hw * col + (row % 2 === 1 ? hw / 2 : 0), oy + 1.5 * size * row];
  }
  const hh = SQRT3 * size;
  return [ox + 1.5 * size * col, oy + hh * row + (col % 2 === 1 ? hh / 2 : 0)];
}

function hexPolygon(orient: Orientation, cx: number, cy: number, size: number): string {
  const startAngle = orient === "pointy" ? Math.PI / 6 : 0;
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i + startAngle;
    return `${(cx + size * Math.cos(a)).toFixed(2)},${(cy + size * Math.sin(a)).toFixed(2)}`;
  }).join(" ");
}

// Carve random holes. Returns [col][row] mask of active cells.
function generateShape(orient: Orientation, cols: number, rows: number, holeDensity: number, sym: Symmetry): boolean[][] {
  if (holeDensity < 0.02) {
    return Array.from({ length: cols }, () => Array(rows).fill(true));
  }
  const active: boolean[][] = Array.from({ length: cols }, () => Array(rows).fill(true));
  const total = cols * rows;
  const targetRemove = Math.floor(total * holeDensity);
  let removed = 0;

  const interior: [number, number][] = [];
  const margin = Math.max(1, Math.floor(Math.min(cols, rows) * 0.15));
  for (let c = margin; c < cols - margin; c++) {
    for (let r = margin; r < rows - margin; r++) {
      interior.push([c, r]);
    }
  }
  for (let i = interior.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [interior[i], interior[j]] = [interior[j], interior[i]];
  }

  const numCarves = 3 + Math.floor(Math.random() * 5);
  for (let k = 0; k < numCarves && removed < targetRemove; k++) {
    let [c, r] = interior.length > 0 ? interior[k % interior.length] : [Math.floor(cols / 2), Math.floor(rows / 2)];
    const len = 3 + Math.floor(Math.random() * 9);
    for (let i = 0; i < len && removed < targetRemove; i++) {
      if (c >= 0 && c < cols && r >= 0 && r < rows && active[c][r]) {
        active[c][r] = false;
        removed++;
      }
      const ns = getNeighbors(orient, c, r, cols, rows);
      if (ns.length === 0) break;
      [c, r] = ns[Math.floor(Math.random() * ns.length)];
    }
  }

  const numHoles = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < numHoles; i++) {
    let attempts = 0;
    while (attempts++ < 50 && removed < targetRemove) {
      const hc = Math.floor(Math.random() * cols);
      const hr = Math.floor(Math.random() * rows);
      if (active[hc][hr]) {
        active[hc][hr] = false;
        removed++;
        break;
      }
    }
  }

  const symmetric = applySymmetry(active, cols, rows, sym);
  const connected = keepLargestComponent(orient, symmetric, cols, rows);

  let count = 0;
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) if (connected[c][r]) count++;
  if (count < total * 0.45) {
    return Array.from({ length: cols }, () => Array(rows).fill(true));
  }
  return connected;
}

function applySymmetry(active: boolean[][], cols: number, rows: number, sym: Symmetry): boolean[][] {
  if (sym === "none") return active;
  const result = active.map(c => c.slice());
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (!active[c][r]) {
        let mc = c, mr = r;
        if (sym === "horizontal") { mc = cols - 1 - c; }
        else if (sym === "radial")     { mc = cols - 1 - c; mr = rows - 1 - r; }
        if (mc >= 0 && mc < cols && mr >= 0 && mr < rows) result[mc][mr] = false;
      }
    }
  }
  return result;
}

function keepLargestComponent(orient: Orientation, active: boolean[][], cols: number, rows: number): boolean[][] {
  const visited: boolean[][] = Array.from({ length: cols }, () => Array(rows).fill(false));
  const components: [number, number][][] = [];

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (!active[c][r] || visited[c][r]) continue;
      const comp: [number, number][] = [];
      const queue: [number, number][] = [[c, r]];
      while (queue.length) {
        const [qc, qr] = queue.shift()!;
        if (visited[qc][qr]) continue;
        visited[qc][qr] = true;
        comp.push([qc, qr]);
        for (const [nc, nr] of getNeighbors(orient, qc, qr, cols, rows)) {
          if (active[nc][nr] && !visited[nc][nr]) queue.push([nc, nr]);
        }
      }
      components.push(comp);
    }
  }

  if (components.length <= 1) return active;
  let largest = components[0];
  for (const comp of components) if (comp.length > largest.length) largest = comp;
  const result: boolean[][] = Array.from({ length: cols }, () => Array(rows).fill(false));
  for (const [c, r] of largest) result[c][r] = true;
  return result;
}

function buildEmptyGrid(cols: number, rows: number, shape: boolean[][]): HexCell[][] {
  return Array.from({ length: cols }, (_, col) =>
    Array.from({ length: rows }, (_, row) => ({
      col, row,
      isMine: false, revealed: false, flagged: false, adjacentMines: 0,
      adjacentConsecutive: true,
      active: shape[col][row],
      isGiven: false, isDistant: false, distantMines: 0,
    }))
  );
}

// Decorate: compute adjacencies + consecutiveness for every active cell.
function decorateAdjacency(orient: Orientation, g: HexCell[][], cols: number, rows: number): void {
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (g[c][r].active && !g[c][r].isMine) {
        g[c][r].adjacentMines = getNeighbors(orient, c, r, cols, rows)
          .filter(([nc, nr]) => g[nc][nr].active && g[nc][nr].isMine).length;
        g[c][r].adjacentConsecutive = checkAdjacentConsecutive(orient, c, r, cols, rows, g);
      }
    }
  }
}

function placeMinesRandom(base: HexCell[][], cols: number, rows: number, mines: number, forbidden: Set<string>): HexCell[][] {
  const g = base.map(c => c.map(cell => ({ ...cell })));
  const placeable: [number, number][] = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (g[c][r].active && !forbidden.has(`${c},${r}`)) placeable.push([c, r]);
    }
  }
  for (let i = placeable.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [placeable[i], placeable[j]] = [placeable[j], placeable[i]];
  }
  const actual = Math.min(mines, placeable.length);
  for (let i = 0; i < actual; i++) {
    const [c, r] = placeable[i];
    g[c][r].isMine = true;
  }
  return g;
}

// Pick K safe non-mine cells as "givens", optionally distant.
function pickGivens(orient: Orientation, g: HexCell[][], cols: number, rows: number, settings: Settings, exclude: Set<string>): void {
  const candidates: [number, number][] = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const cell = g[c][r];
      if (!cell.active || cell.isMine) continue;
      if (exclude.has(`${c},${r}`)) continue;
      candidates.push([c, r]);
    }
  }
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const numGivens = Math.floor(candidates.length * settings.givenRatio);
  const numDistant = settings.distantIndices ? Math.floor(numGivens * settings.distantRatio) : 0;

  for (let i = 0; i < numGivens && i < candidates.length; i++) {
    const [c, r] = candidates[i];
    g[c][r].isGiven = true;
    g[c][r].revealed = true;
    if (i < numDistant) {
      g[c][r].isDistant = true;
      const within = withinRadius(orient, c, r, cols, rows, 2);
      g[c][r].distantMines = within
        .filter(([nc, nr]) => g[nc][nr].active && g[nc][nr].isMine).length;
    }
  }
}

function flood(orient: Orientation, g: HexCell[][], col: number, row: number, cols: number, rows: number): HexCell[][] {
  const next = g.map(c => c.map(cell => ({ ...cell })));
  const queue: [number, number][] = [[col, row]];
  const seen = new Set<string>();
  while (queue.length) {
    const [c, r] = queue.shift()!;
    const k = `${c},${r}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const cell = next[c][r];
    if (!cell.active || cell.revealed || cell.flagged || cell.isMine) continue;
    cell.revealed = true;
    // Distant cells don't flood (their visible number means something different,
    // and the standard "0 = expand" rule doesn't apply to them).
    if (cell.adjacentMines === 0 && !cell.isDistant) {
      queue.push(...getNeighbors(orient, c, r, cols, rows));
    }
  }
  return next;
}

// === Solver ===

type CellState = "unknown" | "safe" | "mine";
type Constraint = {
  cells: string[];
  mines: number;
  ownerKey?: string; // when set, constraint only active when owner is "safe"
};

function buildConstraints(orient: Orientation, g: HexCell[][], cols: number, rows: number, settings: Settings, totalMines: number): Constraint[] {
  const constraints: Constraint[] = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const cell = g[c][r];
      if (!cell.active || cell.isMine) continue;
      const key = `${c},${r}`;
      if (cell.isDistant) {
        const cells = withinRadius(orient, c, r, cols, rows, 2)
          .filter(([nc, nr]) => g[nc][nr].active)
          .map(([nc, nr]) => `${nc},${nr}`);
        constraints.push({ cells, mines: cell.distantMines, ownerKey: key });
      } else {
        const cells = getNeighbors(orient, c, r, cols, rows)
          .filter(([nc, nr]) => g[nc][nr].active)
          .map(([nc, nr]) => `${nc},${nr}`);
        constraints.push({ cells, mines: cell.adjacentMines, ownerKey: key });
      }
    }
  }

  if (settings.showLineHints) {
    if (orient === "flat") {
      for (let c = 0; c < cols; c++) {
        const segs = buildLineSegments(g[c]);
        for (const seg of segs) {
          const cells: string[] = [];
          for (let i = seg.startIdx; i < seg.startIdx + seg.length; i++) cells.push(`${c},${i}`);
          constraints.push({ cells, mines: seg.mineCount });
        }
      }
    } else {
      for (let r = 0; r < rows; r++) {
        const line = Array.from({ length: cols }, (_, c) => g[c][r]);
        const segs = buildLineSegments(line);
        for (const seg of segs) {
          const cells: string[] = [];
          for (let i = seg.startIdx; i < seg.startIdx + seg.length; i++) cells.push(`${i},${r}`);
          constraints.push({ cells, mines: seg.mineCount });
        }
      }
    }
  }

  // Global: total mines on the board.
  const allActive: string[] = [];
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
    if (g[c][r].active) allActive.push(`${c},${r}`);
  }
  constraints.push({ cells: allActive, mines: totalMines });

  return constraints;
}

type Reduced = { unk: string[]; unkSet: Set<string>; mines: number };

function reduceAll(constraints: Constraint[], states: Record<string, CellState>): Reduced[] {
  const out: Reduced[] = [];
  for (const c of constraints) {
    if (c.ownerKey && states[c.ownerKey] !== "safe") continue;
    const unk: string[] = [];
    let m = c.mines;
    for (const k of c.cells) {
      const s = states[k];
      if (s === "mine") m--;
      else if (s !== "safe") unk.push(k);
    }
    if (unk.length === 0) continue;
    if (m < 0 || m > unk.length) {
      // contradiction — return empty marker
      out.push({ unk: [], unkSet: new Set(), mines: -999 });
      return out;
    }
    out.push({ unk, unkSet: new Set(unk), mines: m });
  }
  return out;
}

function solveFully(initialStates: Record<string, CellState>, constraints: Constraint[]): { states: Record<string, CellState>; ok: boolean } {
  const states = { ...initialStates };
  let safety = 0;
  while (safety++ < 200) {
    const reduced = reduceAll(constraints, states);
    if (reduced.some(r => r.mines === -999)) return { states, ok: false };
    if (reduced.length === 0) break;
    let progress = false;
    for (const r of reduced) {
      if (r.mines === 0) {
        for (const k of r.unk) if (states[k] !== "safe") { states[k] = "safe"; progress = true; }
      } else if (r.mines === r.unk.length) {
        for (const k of r.unk) if (states[k] !== "mine") { states[k] = "mine"; progress = true; }
      }
    }
    if (progress) continue;

    // Subset rule (only over reasonably-sized constraints to keep it fast)
    const small = reduced.filter(r => r.unk.length <= 14);
    let subsetProgress = false;
    outer: for (let i = 0; i < small.length; i++) {
      for (let j = 0; j < small.length; j++) {
        if (i === j) continue;
        const a = small[i], b = small[j];
        if (a.unk.length >= b.unk.length) continue;
        let isSub = true;
        for (const k of a.unk) if (!b.unkSet.has(k)) { isSub = false; break; }
        if (!isSub) continue;
        const diffMines = b.mines - a.mines;
        const diffSize = b.unk.length - a.unk.length;
        if (diffMines < 0 || diffMines > diffSize) continue;
        if (diffMines === 0) {
          for (const k of b.unk) if (!a.unkSet.has(k) && states[k] !== "safe") {
            states[k] = "safe"; subsetProgress = true;
          }
        } else if (diffMines === diffSize) {
          for (const k of b.unk) if (!a.unkSet.has(k) && states[k] !== "mine") {
            states[k] = "mine"; subsetProgress = true;
          }
        }
        if (subsetProgress) break outer;
      }
    }
    if (!subsetProgress) break;
  }
  return { states, ok: true };
}

// === Generation entry: place mines (with no-guess retries if requested), decorate, pick givens. ===
function generateBoard(
  orient: Orientation, base: HexCell[][], cols: number, rows: number,
  totalMines: number, firstClick: { col: number; row: number } | null,
  settings: Settings,
): HexCell[][] {
  // Build a "safe seed" forbidden zone that the solver will start with.
  const forbid = new Set<string>();
  if (firstClick) {
    forbid.add(`${firstClick.col},${firstClick.row}`);
    for (const [c, r] of getNeighbors(orient, firstClick.col, firstClick.row, cols, rows)) {
      forbid.add(`${c},${r}`);
    }
  }

  const maxAttempts = settings.noGuess ? 40 : 1;
  let best: HexCell[][] | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const placed = placeMinesRandom(base, cols, rows, totalMines, forbid);
    decorateAdjacency(orient, placed, cols, rows);

    // Pre-revealed givens only make sense in no-guess mode — they exist to ensure
    // the solver has enough information to deduce every cell without guessing.
    if (settings.noGuess) {
      pickGivens(orient, placed, cols, rows, settings, forbid);
    }

    if (!settings.noGuess) {
      best = placed;
      break;
    }

    // Simulate first-click flood to get the starting safe set
    const flooded = firstClick
      ? flood(orient, placed, firstClick.col, firstClick.row, cols, rows)
      : placed;

    // Build initial states
    const initial: Record<string, CellState> = {};
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (!flooded[c][r].active) continue;
        if (flooded[c][r].revealed || flooded[c][r].isGiven) {
          initial[`${c},${r}`] = "safe";
        } else {
          initial[`${c},${r}`] = "unknown";
        }
      }
    }

    const constraints = buildConstraints(orient, placed, cols, rows, settings, totalMines);
    const { states, ok } = solveFully(initial, constraints);
    if (!ok) continue;

    // Check: every active non-mine cell is "safe"
    let allSolved = true;
    for (let c = 0; c < cols && allSolved; c++) {
      for (let r = 0; r < rows; r++) {
        const cell = placed[c][r];
        if (!cell.active || cell.isMine) continue;
        if (states[`${c},${r}`] !== "safe") { allSolved = false; break; }
      }
    }
    if (allSolved) {
      // Re-decorate flooded version's non-mine non-revealed cells
      // (best is the post-flood state so opening sequence is in place)
      best = flooded;
      break;
    }
    best = flooded; // fall back to last attempt
  }

  return best!;
}

// Attempt to find ONE deduction from the current grid state. Used by the Hint button.
function findHint(orient: Orientation, g: HexCell[][], cols: number, rows: number, settings: Settings, totalMines: number): { col: number; row: number; action: "reveal" | "flag" } | null {
  const initial: Record<string, CellState> = {};
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const cell = g[c][r];
      if (!cell.active) continue;
      const k = `${c},${r}`;
      if (cell.revealed && !cell.isMine) initial[k] = "safe";
      else if (cell.flagged) initial[k] = "mine";
      else initial[k] = "unknown";
    }
  }
  const constraints = buildConstraints(orient, g, cols, rows, settings, totalMines);
  const { states, ok } = solveFully(initial, constraints);
  if (!ok) return null;

  // Find first newly-determined unknown
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const cell = g[c][r];
      if (!cell.active) continue;
      if (cell.revealed || cell.flagged) continue;
      const k = `${c},${r}`;
      const s = states[k];
      if (s === "safe") return { col: c, row: r, action: "reveal" };
      if (s === "mine") return { col: c, row: r, action: "flag" };
    }
  }
  return null;
}

// === Visual: tinted dark fill from a hex number color ===
function tintedFill(n: number): string {
  // Revealed-empty: clearly lighter than the near-black board base (#0c1220) so empty cells read as distinct
  if (n <= 0) return "rgba(30,42,62,0.90)";
  const hex = NUM_COLORS[Math.min(n, 6)];
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // Mix 16% of the number color into the dark base.
  const baseR = 14, baseG = 21, baseB = 40;
  const t = 0.16;
  const mr = Math.round(baseR + (r - baseR) * t);
  const mg = Math.round(baseG + (g - baseG) * t);
  const mb = Math.round(baseB + (b - baseB) * t);
  return `rgba(${mr},${mg},${mb},0.88)`;
}
function tintedStroke(n: number): string {
  if (n <= 0) return "rgba(71,85,105,0.45)";
  const hex = NUM_COLORS[Math.min(n, 6)];
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},0.28)`;
}

export default function HexGame({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [orient, setOrient] = useState<Orientation>("pointy");
  const [grid, setGrid] = useState<HexCell[][] | null>(null);
  const [gameState, setGameState] = useState<"idle" | "playing" | "won" | "lost">("idle");
  const [minesLeft, setMinesLeft] = useState(0);
  const [time, setTime] = useState(0);
  const [exploded, setExploded] = useState<string | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [showEndModal, setShowEndModal] = useState(true);
  const [hintsLeft, setHintsLeft] = useState(DEFAULT_SETTINGS.hintsCount);
  const [mistakes, setMistakes] = useState(0);
  const [hintHighlight, setHintHighlight] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [presetActive, setPresetActive] = useState<Preset | null>("medium");

  // Mobile-only states
  const [mobileFlagMode, setMobileFlagMode] = useState(false);
  const [mobileHudVisible, setMobileHudVisible] = useState(true);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lpRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLP = useRef(false);
  const tMoved = useRef(false);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cfg = useMemo(() => {
    const cols = settings.cols;
    const rows = settings.rows;
    const cells = cols * rows;
    const expectedActive = cells * (1 - settings.holeDensity);
    const mines = Math.max(1, Math.round(expectedActive * settings.mineDensity));
    return { cols, rows, mines };
  }, [settings.cols, settings.rows, settings.holeDensity, settings.mineDensity]);

  const reset = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    const newOrient: Orientation =
      settings.orientation === "random"
        ? (Math.random() < 0.5 ? "pointy" : "flat")
        : settings.orientation;
    const shape = generateShape(newOrient, cfg.cols, cfg.rows, settings.holeDensity, settings.symmetry);
    const empty = buildEmptyGrid(cfg.cols, cfg.rows, shape);
    setOrient(newOrient);
    setGrid(empty);
    setGameState("idle");
    setMinesLeft(cfg.mines);
    setTime(0);
    setExploded(null);
    setShowEndModal(true);
    setHintsLeft(settings.hintsCount);
    setMistakes(0);
    setHintHighlight(null);
  }, [settings, cfg]);

  // Initial board on mount only; subsequent resets are user-triggered (Apply / New game).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reset(); }, []);

  useEffect(() => {
    if (gameState === "playing") {
      timerRef.current = setInterval(() => setTime(t => t + 1), 1000);
      return () => { if (timerRef.current) clearInterval(timerRef.current); };
    }
    if (timerRef.current) clearInterval(timerRef.current);
  }, [gameState]);

  // Lose if too many mistakes (mistakesAllowed === -1 → infinite).
  useEffect(() => {
    if (gameState !== "playing") return;
    if (settings.mistakesAllowed < 0) return;
    if (mistakes > settings.mistakesAllowed) {
      setGameState("lost");
    }
  }, [mistakes, settings.mistakesAllowed, gameState]);

  // On loss, reveal all remaining mines so the board is useful to inspect.
  useEffect(() => {
    if (gameState !== "lost") return;
    setGrid(prev => {
      if (!prev) return prev;
      return prev.map(col => col.map(cell =>
        cell.active && cell.isMine && !cell.revealed ? { ...cell, revealed: true } : cell
      ));
    });
  }, [gameState]);

  const handleFirstClick = useCallback(async (col: number, row: number, base: HexCell[][]): Promise<HexCell[][]> => {
    setGenerating(true);
    // Yield once so the spinner renders before a heavy no-guess loop.
    await new Promise(r => setTimeout(r, 0));
    // Use the live grid's dimensions (the user may have tweaked sliders without
    // clicking "Apply" yet — the running game must keep its actual size).
    const bcols = base.length;
    const brows = base[0]?.length ?? 0;
    let active = 0;
    for (let c = 0; c < bcols; c++) for (let r = 0; r < brows; r++) if (base[c][r].active) active++;
    const targetMines = Math.max(1, Math.min(active - 1, Math.round(active * settings.mineDensity)));
    const generated = generateBoard(orient, base, bcols, brows, targetMines, { col, row }, settings);
    setGenerating(false);
    return generated;
  }, [orient, settings]);

  const reveal = useCallback((col: number, row: number) => {
    if (gameState === "won" || gameState === "lost" || generating) return;
    if (!grid) return;
    const cell0 = grid[col][row];
    if (!cell0.active) return;
    if (cell0.revealed) return;
    if (cell0.flagged) return;

    if (gameState === "idle") {
      const gcols = grid.length;
      const grows = grid[0]?.length ?? 0;
      handleFirstClick(col, row, grid).then(generated => {
        const startCell = generated[col][row];
        let ng: HexCell[][];
        if (startCell.revealed) {
          ng = generated;
        } else {
          ng = flood(orient, generated, col, row, gcols, grows);
        }
        const actualMines = ng.flat().filter(c => c.isMine).length;
        setMinesLeft(actualMines);
        const won = ng.every(c => c.every(cell => !cell.active || cell.isMine || cell.revealed));
        setGrid(ng);
        setGameState(won ? "won" : "playing");
      });
      return;
    }

    if (cell0.isMine) {
      // Mistake. With finite mistakesAllowed > 0, just penalize and keep going.
      if (settings.mistakesAllowed >= 1 && mistakes < settings.mistakesAllowed) {
        // Reveal the mine cell briefly to signal the hit, then auto-flag it.
        const ng = grid.map(c => c.map(cell => ({ ...cell })));
        ng[col][row].flagged = true;
        setGrid(ng);
        setMinesLeft(m => Math.max(0, m - 1));
        setMistakes(m => m + 1);
        setExploded(`${col},${row}`);
        setShakeKey(k => k + 1);
        setTimeout(() => setExploded(null), 600);
        return;
      }
      if (settings.mistakesAllowed === -1) {
        // Infinite: same forgiveness as above.
        const ng = grid.map(c => c.map(cell => ({ ...cell })));
        ng[col][row].flagged = true;
        setGrid(ng);
        setMinesLeft(m => Math.max(0, m - 1));
        setMistakes(m => m + 1);
        setExploded(`${col},${row}`);
        setShakeKey(k => k + 1);
        setTimeout(() => setExploded(null), 600);
        return;
      }
      // mistakesAllowed === 0 → instant lose
      const ng = grid.map(column => column.map(c => c.active && c.isMine ? { ...c, revealed: true } : c));
      setExploded(`${col},${row}`);
      setShakeKey(k => k + 1);
      setGrid(ng);
      setGameState("lost");
      return;
    }

    const ng = flood(orient, grid, col, row, grid.length, grid[0]?.length ?? 0);
    const won = ng.every(c => c.every(cell => !cell.active || cell.isMine || cell.revealed));
    setGrid(ng);
    setGameState(won ? "won" : "playing");
  }, [grid, gameState, orient, mistakes, settings.mistakesAllowed, generating, handleFirstClick]);

  const flag = useCallback((col: number, row: number) => {
    if (!grid || gameState === "idle" || gameState === "won" || gameState === "lost") return;
    const cell = grid[col][row];
    if (!cell.active || cell.revealed) return;
    const ng = grid.map(c => c.map(cell => ({ ...cell })));
    ng[col][row].flagged = !cell.flagged;
    setMinesLeft(m => m + (cell.flagged ? 1 : -1));
    setGrid(ng);
    if (ng.every(c => c.every(cell =>
      !cell.active || (cell.isMine && cell.flagged) || (!cell.isMine && cell.revealed)
    ))) {
      setGameState("won");
    }
  }, [grid, gameState]);

  const useHint = useCallback(() => {
    if (!grid || gameState !== "playing" || hintsLeft <= 0 || generating) return;
    const gcols = grid.length;
    const grows = grid[0]?.length ?? 0;
    const totalMines = grid.flat().filter(c => c.isMine).length;
    const result = findHint(orient, grid, gcols, grows, settings, totalMines);
    if (!result) {
      setHintHighlight("__none__");
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(() => setHintHighlight(null), 1200);
      return;
    }
    setHintsLeft(h => h - 1);
    const k = `${result.col},${result.row}`;
    setHintHighlight(k);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHintHighlight(null), 1400);
    if (result.action === "reveal") reveal(result.col, result.row);
    else flag(result.col, result.row);
  }, [grid, gameState, hintsLeft, orient, settings, reveal, flag, generating]);

  // === Layout (uses the live grid's dimensions, not settings, so changing
  // sliders doesn't desync until the user clicks "Apply & new board"). ===
  const layoutCols = grid ? grid.length : cfg.cols;
  const layoutRows = grid && grid[0] ? grid[0].length : cfg.rows;
  let ox: number, oy: number, svgW: number, svgH: number;
  if (orient === "pointy") {
    const hw = SQRT3 * HEX_SIZE;
    ox = MARGIN + ROW_LW + hw / 2;
    oy = MARGIN + HEX_SIZE;
    svgW = MARGIN + ROW_LW + hw * layoutCols + hw / 2 + MARGIN;
    svgH = 2 * MARGIN + 1.5 * HEX_SIZE * (layoutRows - 1) + 2 * HEX_SIZE;
  } else {
    const hh = SQRT3 * HEX_SIZE;
    ox = MARGIN + HEX_SIZE;
    oy = MARGIN + LABEL_H + hh / 2;
    svgW = 2 * MARGIN + 1.5 * HEX_SIZE * (layoutCols - 1) + 2 * HEX_SIZE;
    svgH = MARGIN + LABEL_H + hh * layoutRows + hh / 2 + MARGIN;
  }

  const minesPlaced = gameState !== "idle";
  const colSegments = grid && settings.showLineHints
    ? Array.from({ length: layoutCols }, (_, c) => buildLineSegments(grid[c]))
    : null;
  const rowSegments = grid && settings.showLineHints
    ? Array.from({ length: layoutRows }, (_, r) =>
        buildLineSegments(Array.from({ length: layoutCols }, (_, c) => grid[c][r]))
      )
    : null;

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  // Apply a preset to settings without losing user-tweaked toggles.
  const applyPreset = (p: Preset) => {
    setSettings(s => ({ ...s, ...PRESETS[p] }));
    setPresetActive(p);
  };
  const updateSettings = (patch: Partial<Settings>) => {
    setSettings(s => ({ ...s, ...patch }));
    setPresetActive(null);
  };

  const livesRemaining = settings.mistakesAllowed < 0 ? -1 : Math.max(0, settings.mistakesAllowed - mistakes + 1);

  return (
    <div className="flex flex-col items-center min-h-screen p-2 pt-3 pb-20 md:p-4 md:pt-6 md:pb-10 w-full">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute top-[-10%] left-[-5%] w-[40rem] h-[40rem] rounded-full bg-violet-500/15 blur-[120px] animate-float-blob" />
        <div className="absolute top-[20%] right-[-10%] w-[35rem] h-[35rem] rounded-full bg-cyan-500/15 blur-[120px] animate-float-blob" style={{ animationDelay: "-5s" }} />
        <div className="absolute bottom-[-10%] left-[25%] w-[40rem] h-[40rem] rounded-full bg-emerald-500/12 blur-[120px] animate-float-blob" style={{ animationDelay: "-9s" }} />
      </div>

      {/* HUD — collapsible on mobile via mobileHudVisible */}
      <div
        className="w-full max-w-6xl mobile-hud-transition"
        data-hud-hidden={!mobileHudVisible ? '' : undefined}
      >
        {/* Desktop HUD — existing capsule style */}
        <div className="hidden md:flex hud-capsule hud-border-shimmer rounded-2xl px-4 py-3 items-center justify-between relative overflow-hidden mb-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors text-sm font-semibold"
          >
            <ChevronLeft className="w-4 h-4" />
            Retour
          </button>
          <div className="flex flex-col items-center">
            <span className="text-[10px] text-slate-500 uppercase tracking-[0.18em] font-bold leading-none mb-0.5">Mode</span>
            <span className="text-sm font-black tracking-widest text-shimmer">HEXCELLS</span>
          </div>
          <div className="flex items-center gap-2 text-sm font-mono">
            <span className="flex items-center gap-1.5 glass-tint-coral px-2.5 py-1 rounded-lg">
              <Bomb className="w-3.5 h-3.5 text-rose-400" />
              <span className="text-rose-300 font-bold">{minesLeft}</span>
            </span>
            <span className="flex items-center gap-1.5 glass-tint-cyan px-2.5 py-1 rounded-lg">
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-cyan-300 font-bold">{fmt(time)}</span>
            </span>
          </div>
        </div>

        {/* Mobile HUD — classic bar style matching démineur */}
        <div className="flex md:hidden justify-between items-center gap-2 mb-2 px-1 sticky top-0 z-30 py-2">
          {/* Left bar */}
          <div className="flex items-stretch bg-slate-900/55 backdrop-blur-md rounded-2xl border border-slate-600/40 h-11 shadow-md shadow-black/40 overflow-hidden min-w-0">
            {/* Back */}
            <button
              onClick={onBack}
              className="flex items-center gap-1 px-2.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 border-r border-slate-700/50 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            {/* Mine count */}
            <div className="flex items-center gap-1.5 px-2.5 border-r border-slate-700/50">
              <Bomb className="w-3.5 h-3.5 text-rose-400" />
              <span className="font-mono font-bold text-xs tabular-nums text-white">{minesLeft}</span>
            </div>
            {/* Timer */}
            <div className="flex items-center gap-1.5 px-2.5 border-r border-slate-700/50">
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
              <span className="font-mono font-bold text-xs tabular-nums text-cyan-300">{fmt(time)}</span>
            </div>
            {/* Hint button */}
            {settings.hintsCount > 0 && (
              <button
                onClick={useHint}
                disabled={hintsLeft <= 0 || gameState !== "playing" || generating}
                className={`flex items-center gap-1 px-2.5 transition-colors ${
                  hintsLeft <= 0 || gameState !== "playing"
                    ? "text-slate-600 cursor-not-allowed"
                    : "text-amber-300 hover:text-amber-200 hover:bg-slate-800"
                }`}
              >
                <Lightbulb className="w-3.5 h-3.5" />
                <span className="font-mono font-bold text-xs tabular-nums">{hintsLeft}</span>
              </button>
            )}
          </div>
          {/* Right: Hearts */}
          {settings.mistakesAllowed >= 0 && (
            <div className="flex items-center gap-1 bg-slate-900/55 backdrop-blur-md rounded-2xl border border-slate-600/40 h-11 px-2.5 shadow-md shadow-black/40 shrink-0">
              {Array.from({ length: settings.mistakesAllowed + 1 }, (_, i) => (
                <Heart
                  key={i}
                  className={`w-3.5 h-3.5 fill-current ${i < livesRemaining ? "text-rose-400" : "text-slate-700"}`}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Settings panel toggle — hidden on mobile */}
      <div className="w-full max-w-6xl mb-3 hidden md:flex items-center gap-2 justify-center flex-wrap">
        {(["easy", "medium", "hard"] as Preset[]).map(d => (
          <button
            key={d}
            onClick={() => applyPreset(d)}
            className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wide transition-all glass-sheen ${
              presetActive === d
                ? "glass-tint-violet text-violet-200 shadow-[0_0_20px_-5px_rgba(167,139,250,0.55)]"
                : "glass text-slate-400 hover:text-slate-200"
            }`}
          >
            {d === "easy" ? "Facile" : d === "medium" ? "Moyen" : "Difficile"}
          </button>
        ))}
        <button
          onClick={() => setSettingsOpen(o => !o)}
          className={`px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-wide transition-all glass-sheen flex items-center gap-1.5 ${
            settingsOpen
              ? "glass-tint-cyan text-cyan-200 shadow-[0_0_20px_-5px_rgba(56,189,248,0.55)]"
              : "glass text-slate-400 hover:text-slate-200"
          }`}
        >
          <SettingsIcon className="w-3.5 h-3.5" />
          Personnaliser
        </button>
      </div>

      {/* Settings panel */}
      <AnimatePresence initial={false}>
        {settingsOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: "auto", marginBottom: 12 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.22 }}
            className="w-full max-w-6xl overflow-hidden"
          >
            <div className="glass-strong rounded-2xl p-4 md:p-5 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 text-sm">
              {/* Dimensions */}
              <div className="flex flex-col gap-2">
                <RangeSlider
                  min={6} max={24} step={1}
                  value={settings.cols}
                  onChange={v => updateSettings({ cols: v })}
                  label="Colonnes"
                />
                <RangeSlider
                  min={6} max={20} step={1}
                  value={settings.rows}
                  onChange={v => updateSettings({ rows: v })}
                  label="Lignes"
                />
                <RangeSlider
                  min={0.10} max={0.32} step={0.01}
                  value={settings.mineDensity}
                  onChange={v => updateSettings({ mineDensity: v })}
                  label="Densité de mines"
                  formatValue={v => `${Math.round(v * 100)}%`}
                />
                <RangeSlider
                  min={0} max={0.40} step={0.01}
                  value={settings.holeDensity}
                  onChange={v => updateSettings({ holeDensity: v })}
                  label="Densité de trous"
                  formatValue={v => `${Math.round(v * 100)}%`}
                />
              </div>

              {/* Aides + indices */}
              <div className="flex flex-col gap-3">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-[0.18em] font-bold mb-1.5">Orientation</div>
                  <div className="flex gap-1">
                    {(["pointy", "flat", "random"] as OrientChoice[]).map(o => (
                      <button
                        key={o}
                        onClick={() => updateSettings({ orientation: o })}
                        className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                          settings.orientation === o
                            ? "bg-cyan-400/20 text-cyan-200 border border-cyan-300/40"
                            : "glass text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        {o === "pointy" ? "Pointu" : o === "flat" ? "Plat" : "Aléat."}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-[0.18em] font-bold mb-1.5">Symétrie de la forme</div>
                  <div className="flex gap-1">
                    {(["none", "horizontal", "radial"] as Symmetry[]).map(s => (
                      <button
                        key={s}
                        onClick={() => updateSettings({ symmetry: s })}
                        className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                          settings.symmetry === s
                            ? "bg-violet-400/20 text-violet-200 border border-violet-300/40"
                            : "glass text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        {s === "none" ? "Aucune" : s === "horizontal" ? "Horiz." : "Radiale"}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-[0.18em] font-bold mb-1.5">Fautes autorisées</div>
                  <div className="flex gap-1">
                    {[0, 1, 3, 5, -1].map(n => (
                      <button
                        key={n}
                        onClick={() => updateSettings({ mistakesAllowed: n })}
                        className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                          settings.mistakesAllowed === n
                            ? "bg-rose-400/20 text-rose-200 border border-rose-300/40"
                            : "glass text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        {n === -1 ? "∞" : n === 0 ? "0" : n}
                      </button>
                    ))}
                  </div>
                </div>

                <RangeSlider
                  min={0} max={9} step={1}
                  value={settings.hintsCount}
                  onChange={v => updateSettings({ hintsCount: v })}
                  label="Coups d'aide"
                />
              </div>

              {/* Toggles, full width row */}
              <div className="md:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-white/5">
                <ToggleChip
                  label="Indices ligne/col."
                  active={settings.showLineHints}
                  onClick={() => updateSettings({ showLineHints: !settings.showLineHints })}
                />
                <ToggleChip
                  label="Marqueurs {n} / -n-"
                  active={settings.showConsecutive}
                  onClick={() => updateSettings({ showConsecutive: !settings.showConsecutive })}
                />
                <ToggleChip
                  label="No-guess"
                  active={settings.noGuess}
                  onClick={() => updateSettings({ noGuess: !settings.noGuess })}
                  tint="emerald"
                />
                <ToggleChip
                  label="Indices distants"
                  active={settings.distantIndices}
                  onClick={() => updateSettings({ distantIndices: !settings.distantIndices })}
                  tint="violet"
                />
              </div>

              {settings.distantIndices && (
                <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                  <RangeSlider
                    min={0} max={0.20} step={0.01}
                    value={settings.givenRatio}
                    onChange={v => updateSettings({ givenRatio: v })}
                    label="Cellules pré-révélées"
                    formatValue={v => `${Math.round(v * 100)}%`}
                  />
                  <RangeSlider
                    min={0} max={1} step={0.05}
                    value={settings.distantRatio}
                    onChange={v => updateSettings({ distantRatio: v })}
                    label="Part en rayon-2"
                    formatValue={v => `${Math.round(v * 100)}%`}
                  />
                </div>
              )}

              <div className="md:col-span-2 flex items-center justify-between pt-2 border-t border-white/5">
                <span className="text-[11px] text-slate-500">
                  Estimation : <span className="text-slate-300 font-bold">{cfg.mines}</span> mines · {cfg.cols}×{cfg.rows}
                </span>
                <button
                  onClick={() => { setSettingsOpen(false); reset(); }}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-cyan-300 to-violet-300 text-slate-950 shadow-[0_0_18px_rgba(56,189,248,0.4)] hover:brightness-110 transition-all flex items-center gap-1.5"
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  Appliquer & nouveau plateau
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* In-game tools row — hidden on mobile (hearts/hints in mobile HUD bar) */}
      <div className="hidden md:flex items-center gap-3 mb-3 flex-wrap justify-center">
        {settings.mistakesAllowed >= 0 && (
          <span className="flex items-center gap-1 glass px-3 py-1.5 rounded-xl text-xs">
            {Array.from({ length: settings.mistakesAllowed + 1 }, (_, i) => (
              <Heart
                key={i}
                className={`w-3.5 h-3.5 ${i < (livesRemaining) ? "text-rose-400 fill-rose-400/40" : "text-slate-700"}`}
              />
            ))}
          </span>
        )}
        {settings.hintsCount > 0 && (
          <button
            onClick={useHint}
            disabled={hintsLeft <= 0 || gameState !== "playing" || generating}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all glass-sheen ${
              hintsLeft <= 0 || gameState !== "playing"
                ? "glass text-slate-600 cursor-not-allowed"
                : "glass-tint-amber text-amber-200 hover:brightness-110 shadow-[0_0_16px_-5px_rgba(252,211,77,0.5)]"
            }`}
            title="Révèle ou marque une cellule logiquement déductible"
          >
            <Lightbulb className="w-3.5 h-3.5" />
            Aide · {hintsLeft}
          </button>
        )}
        {hintHighlight === "__none__" && (
          <motion.span
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="text-[11px] text-amber-300 font-mono"
          >
            Aucune déduction logique trouvée — explorez davantage.
          </motion.span>
        )}
      </div>

      <AnimatePresence>
        {generating && (
          <motion.p
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="text-cyan-300 text-[11px] mb-3 tracking-wide text-center flex items-center gap-1.5"
          >
            <Loader2 className="w-3 h-3 animate-spin" />
            Génération d&apos;un plateau résoluble logiquement…
          </motion.p>
        )}
      </AnimatePresence>

      {/* Legend — above the board */}
      <div
        className="hidden md:flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mb-3 text-sm text-slate-400 w-full"
        style={{ maxWidth: `min(95vw, ${Math.max(svgW + 24, 480)}px)` }}
      >
        <span className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-sm bg-rose-400/70 shrink-0" />
          <span>{orient === "pointy" ? "Mines par ligne" : "Mines par colonne"}</span>
        </span>
        {settings.showConsecutive && (
          <>
            <span className="flex items-center gap-1.5">
              <span className="font-mono font-bold text-slate-200">{"{n}"}</span>
              <span>mines consécutives</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="font-mono font-bold text-slate-200">-n-</span>
              <span>mines séparées</span>
            </span>
          </>
        )}
        {settings.distantIndices && (
          <span className="flex items-center gap-2">
            <span className="inline-block w-4 h-4 rounded-full border-2 border-violet-300/70 border-dashed shrink-0" />
            <span className="font-mono font-bold text-violet-300">(n)</span>
            <span>mines dans un rayon de 2</span>
          </span>
        )}
        <span className="flex items-center gap-2 text-slate-500">
          <span>Clic gauche · révéler</span>
          <span className="text-slate-700">·</span>
          <span>Clic droit · drapeau</span>
        </span>
      </div>

      {/* Hex grid — container width scales with SVG natural width up to ~95vw */}
      <style>{`
        @keyframes hex-board-drift {
          0%   { background-position: 0% 0%; }
          50%  { background-position: 100% 100%; }
          100% { background-position: 0% 0%; }
        }
        .hex-board-bg {
          background: linear-gradient(
            135deg,
            #1a1238 0%,
            #0e1828 35%,
            #0c1220 55%,
            #0d1c30 75%,
            #101428 100%
          );
          background-size: 250% 250%;
          animation: hex-board-drift 55s ease-in-out infinite;
        }
        @keyframes hex-board-shake {
          0%   { transform: translateX(0); }
          12%  { transform: translateX(-7px) rotate(-0.6deg); }
          25%  { transform: translateX(6px)  rotate(0.5deg); }
          37%  { transform: translateX(-5px) rotate(-0.4deg); }
          50%  { transform: translateX(4px)  rotate(0.3deg); }
          62%  { transform: translateX(-3px); }
          75%  { transform: translateX(2px); }
          87%  { transform: translateX(-1px); }
          100% { transform: translateX(0); }
        }
        .hex-board-shake {
          animation: hex-board-shake 0.5s ease-in-out;
        }
      `}</style>
      <motion.div
        key={shakeKey}
        className={shakeKey > 0 ? "hex-board-shake" : ""}
        style={{ maxWidth: `min(95vw, ${Math.max(svgW + 24, 480)}px)`, width: "100%" }}
      >
      <div
        className="relative overflow-hidden rounded-2xl border border-white/[0.08] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.7)] w-full"
      >
        {/* Animated gradient background — drifts top-left → bottom-right */}
        <div className="hex-board-bg absolute inset-0" style={{ borderRadius: "inherit" }} />
        <div className="relative p-1 md:p-1.5">
        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ width: "100%", height: "auto", display: "block", touchAction: "manipulation" }}
          onContextMenu={e => e.preventDefault()}
        >
          <defs>
            <filter id="hex-glow-red" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="hex-glow-amber" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* Column hints (flat-top) */}
          {orient === "flat" && colSegments && colSegments.map((segs, col) =>
            segs.map((seg, sIdx) => {
              const display = minesPlaced ? formatLineHint(seg.mineCount, seg.consecutive, settings.showConsecutive) : "·";
              const fill = !minesPlaced
                ? "#334155"
                : seg.mineCount === 0 ? "#cbd5e1" : "#fda4af";
              const fontSize = display.length >= 4 ? 14 : display.length >= 3 ? 17 : 20;
              let hx: number, hy: number;
              if (seg.startIdx === 0) {
                [hx] = hexPos(orient, col, 0, HEX_SIZE, ox, oy);
                hy = MARGIN + LABEL_H / 2;
              } else {
                [hx, hy] = hexPos(orient, col, seg.startIdx - 1, HEX_SIZE, ox, oy);
              }
              return (
                <text
                  key={`ch${col}-${sIdx}`}
                  x={hx} y={hy}
                  textAnchor="middle" dominantBaseline="central"
                  fontSize={fontSize} fontWeight="700" fontFamily="monospace"
                  fill={fill}
                >
                  {display}
                </text>
              );
            })
          )}

          {/* Row hints (pointy-top) */}
          {orient === "pointy" && rowSegments && rowSegments.map((segs, row) =>
            segs.map((seg, sIdx) => {
              const display = minesPlaced ? formatLineHint(seg.mineCount, seg.consecutive, settings.showConsecutive) : "·";
              const fill = !minesPlaced
                ? "#334155"
                : seg.mineCount === 0 ? "#cbd5e1" : "#fda4af";
              const fontSize = display.length >= 4 ? 14 : display.length >= 3 ? 17 : 20;
              let hx: number, hy: number;
              if (seg.startIdx === 0) {
                [, hy] = hexPos(orient, 0, row, HEX_SIZE, ox, oy);
                hx = MARGIN + ROW_LW / 2;
              } else {
                [hx, hy] = hexPos(orient, seg.startIdx - 1, row, HEX_SIZE, ox, oy);
              }
              return (
                <text
                  key={`rh${row}-${sIdx}`}
                  x={hx} y={hy}
                  textAnchor="middle" dominantBaseline="central"
                  fontSize={fontSize} fontWeight="700" fontFamily="monospace"
                  fill={fill}
                >
                  {display}
                </text>
              );
            })
          )}

          {/* Cells */}
          {Array.from({ length: layoutCols }, (_, col) =>
            Array.from({ length: layoutRows }, (_, row) => {
              const cell = grid?.[col]?.[row];
              if (!cell || !cell.active) return null;
              const [cx, cy] = hexPos(orient, col, row, HEX_SIZE, ox, oy);
              const pts = hexPolygon(orient, cx, cy, HEX_SIZE - 3);
              const key = `${col},${row}`;
              const isExploded = exploded === key;
              const isHinted = hintHighlight === key;
              const isWon = gameState === "won";
              const numToDisplay = cell.isDistant ? cell.distantMines : cell.adjacentMines;

              let fill: string, stroke: string, sw = 1.5;

              if (cell.revealed && cell.isMine) {
                fill = isExploded ? "rgba(251,113,133,0.55)" : "rgba(127,29,29,0.45)";
                stroke = isExploded ? "#f43f5e" : "#ef4444";
                sw = isExploded ? 2.5 : 1.5;
              } else if (cell.revealed) {
                fill = tintedFill(numToDisplay);
                stroke = isWon
                  ? "rgba(52,211,153,0.28)"
                  : numToDisplay > 0
                    ? tintedStroke(numToDisplay)
                    : "rgba(71,85,105,0.45)";
              } else if (cell.flagged) {
                fill = "rgba(251,113,133,0.18)";
                stroke = "rgba(251,113,133,0.55)";
              } else {
                // Closed cell: matches the Démineur Grid palette (slate-700/80, slate-500/40 border)
                fill = "rgba(51,65,85,0.85)";
                stroke = "rgba(100,116,139,0.45)";
              }
              if (isHinted) {
                stroke = "#fcd34d";
                sw = 3;
              }

              return (
                <g
                  key={key}
                  filter={isExploded ? "url(#hex-glow-red)" : isHinted ? "url(#hex-glow-amber)" : undefined}
                >
                  <polygon
                    points={pts}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={sw}
                    style={{
                      cursor: cell.revealed ? "default" : "pointer",
                      transition: "fill 0.12s, stroke 0.12s",
                    }}
                    className={!cell.revealed && !cell.flagged ? "hover:brightness-[1.5]" : ""}
                    onClick={() => reveal(col, row)}
                    onContextMenu={e => { e.preventDefault(); flag(col, row); }}
                    onTouchStart={() => {
                      didLP.current = false;
                      tMoved.current = false;
                      lpRef.current = setTimeout(() => {
                        didLP.current = true;
                        flag(col, row);
                        navigator.vibrate?.(28);
                      }, 420);
                    }}
                    onTouchMove={() => {
                      tMoved.current = true;
                      if (lpRef.current) clearTimeout(lpRef.current);
                    }}
                    onTouchEnd={e => {
                      e.preventDefault();
                      if (lpRef.current) clearTimeout(lpRef.current);
                      if (!didLP.current && !tMoved.current) {
                        if (mobileFlagMode) flag(col, row);
                        else reveal(col, row);
                      }
                    }}
                  />

                  {/* Distant indicator: dashed ring around the cell */}
                  {cell.revealed && !cell.isMine && cell.isDistant && (
                    <circle
                      cx={cx} cy={cy}
                      r={HEX_SIZE * 0.62}
                      fill="none"
                      stroke="rgba(196,181,253,0.55)"
                      strokeWidth={1.4}
                      strokeDasharray="3 3"
                      style={{ pointerEvents: "none" }}
                    />
                  )}

                  {/* Adjacency / distant hint number */}
                  {cell.revealed && !cell.isMine && numToDisplay > 0 && (() => {
                    let label: string;
                    if (cell.isDistant) {
                      label = `(${numToDisplay})`;
                    } else if (numToDisplay <= 1 || !settings.showConsecutive) {
                      label = String(numToDisplay);
                    } else {
                      label = cell.adjacentConsecutive
                        ? `{${numToDisplay}}`
                        : `-${numToDisplay}-`;
                    }
                    const fontSize = label.length >= 4 ? 14 : label.length >= 3 ? 17 : 21;
                    const color = cell.isDistant
                      ? "#c4b5fd"
                      : NUM_COLORS[Math.min(numToDisplay, 6)];
                    return (
                      <text
                        x={cx} y={cy}
                        textAnchor="middle" dominantBaseline="central"
                        fontSize={fontSize} fontWeight="700" fontFamily="monospace"
                        fill={color}
                        style={{ pointerEvents: "none", userSelect: "none" }}
                      >
                        {label}
                      </text>
                    );
                  })()}

                  {/* Pre-revealed cell with 0 adjacent mines: white so it reads clearly */}
                  {cell.revealed && !cell.isMine && numToDisplay === 0 && cell.isGiven && (
                    <text
                      x={cx} y={cy}
                      textAnchor="middle" dominantBaseline="central"
                      fontSize={17} fontWeight="700" fontFamily="monospace"
                      fill="rgba(226,232,240,0.92)"
                      style={{ pointerEvents: "none", userSelect: "none" }}
                    >
                      {cell.isDistant ? "(0)" : "0"}
                    </text>
                  )}

                  {/* Flag */}
                  {!cell.revealed && cell.flagged && (
                    <text
                      x={cx + 3} y={cy}
                      textAnchor="middle" dominantBaseline="central"
                      fontSize={18}
                      style={{ pointerEvents: "none", userSelect: "none" }}
                    >
                      🚩
                    </text>
                  )}
                </g>
              );
            })
          )}
        </svg>
        </div> {/* /relative p-1 */}
      </div>
      </motion.div>


      {/* New game */}
      <button
        onClick={() => reset()}
        className="mt-2 md:mt-4 glass glass-sheen px-3 py-2 md:px-5 md:py-2.5 rounded-xl md:rounded-2xl flex items-center gap-2 text-slate-300 hover:text-white text-xs md:text-sm font-semibold transition-all"
      >
        <RotateCcw className="w-3.5 h-3.5 md:w-4 md:h-4" />
        Nouvelle partie
      </button>

      {/* Compact result pill — shown when modal is dismissed */}
      <AnimatePresence>
        {(gameState === "won" || gameState === "lost") && !showEndModal && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="mt-3 flex items-center gap-3 glass px-4 py-2 rounded-2xl text-sm"
          >
            <span>{gameState === "won" ? "🏆" : "💥"}</span>
            <span className={gameState === "won" ? "text-cyan-accent font-semibold" : "text-coral-accent font-semibold"}>
              {gameState === "won" ? "Puzzle résolu !" : "Mine touchée !"}
            </span>
            <button
              onClick={() => setShowEndModal(true)}
              className="ml-auto text-slate-400 hover:text-slate-200 text-xs underline transition-colors"
            >
              Résultats
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Win / Loss modal */}
      <AnimatePresence>
        {(gameState === "won" || gameState === "lost") && showEndModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6"
          >
            <motion.div
              initial={{ scale: 0.85, opacity: 0, y: 16 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.85, opacity: 0, y: 16 }}
              transition={{ type: "spring", stiffness: 300, damping: 26 }}
              className="glass-strong rounded-3xl p-8 text-center w-full max-w-sm"
            >
              <div className="text-6xl mb-4">{gameState === "won" ? "🏆" : "💥"}</div>
              <h2 className={`text-2xl font-black mb-1.5 ${gameState === "won" ? "text-cyan-accent" : "text-coral-accent"}`}>
                {gameState === "won" ? "Puzzle résolu !" : "Mine touchée !"}
              </h2>
              <p className="text-slate-400 text-sm mb-1.5">
                {gameState === "won"
                  ? `Terminé en ${fmt(time)} · ${cfg.mines} mine${cfg.mines > 1 ? "s" : ""}`
                  : "Vous avez révélé une mine de trop. Réessayez !"}
              </p>
              {gameState === "won" && mistakes === 0 && (
                <p className="text-emerald-400 text-xs font-bold mb-4 flex items-center justify-center gap-1">
                  <Sparkles className="w-3.5 h-3.5" /> Sans faute · Run parfaite
                </p>
              )}
              {gameState === "won" && mistakes > 0 && (
                <p className="text-slate-500 text-xs mb-4">{mistakes} faute{mistakes > 1 ? "s" : ""}</p>
              )}
              {gameState === "lost" && <div className="mb-4" />}
              <button
                onClick={() => reset()}
                className="w-full py-3 rounded-2xl font-bold glass-sheen border border-white/10 text-white hover:bg-white/10 transition-all flex items-center gap-2 justify-center"
              >
                <RotateCcw className="w-4 h-4" />
                Rejouer
              </button>
              <button
                onClick={() => setShowEndModal(false)}
                className="w-full mt-2 py-2 rounded-xl text-slate-400 hover:text-slate-200 text-sm transition-colors"
              >
                Voir le plateau
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Mobile-only controls: HUD toggle + flag/click toggle ── */}
      {gameState !== "won" && gameState !== "lost" && (
        <div
          className="md:hidden fixed z-50 flex items-center gap-2"
          style={{
            right: 'max(1rem, env(safe-area-inset-right))',
            bottom: 'max(1rem, env(safe-area-inset-bottom))',
          }}
        >
          {/* HUD show/hide */}
          <button
            onClick={() => setMobileHudVisible(v => !v)}
            aria-pressed={mobileHudVisible}
            title={mobileHudVisible ? 'Masquer le HUD' : 'Afficher le HUD'}
            className={`w-12 h-12 rounded-xl glass-strong flex items-center justify-center active:scale-95 transition-all border ${
              mobileHudVisible
                ? 'border-slate-400/30 shadow-[0_0_14px_-4px_rgba(148,163,184,0.35)]'
                : 'border-slate-500/20 shadow-[0_0_14px_-4px_rgba(100,116,139,0.25)]'
            }`}
          >
            {mobileHudVisible
              ? <EyeOff className="w-5 h-5 text-slate-300" />
              : <Eye className="w-5 h-5 text-slate-400" />}
          </button>
          {/* Flag / Reveal toggle */}
          <button
            onClick={() => setMobileFlagMode(m => !m)}
            aria-pressed={mobileFlagMode}
            title={mobileFlagMode ? 'Tap = drapeau' : 'Tap = révéler'}
            className={`w-14 h-14 rounded-2xl glass-strong flex items-center justify-center active:scale-95 transition-all border ${
              mobileFlagMode
                ? 'border-rose-300/40 shadow-[0_0_20px_-4px_rgba(251,113,133,0.55)]'
                : 'border-cyan-300/30 shadow-[0_0_20px_-6px_rgba(56,189,248,0.45)]'
            }`}
          >
            {mobileFlagMode
              ? <FlagIcon className="w-6 h-6 text-rose-300 fill-rose-300/40" />
              : <MousePointer2 className="w-6 h-6 text-cyan-accent" />}
          </button>
        </div>
      )}
    </div>
  );
}

function ToggleChip({
  label, active, onClick, tint = "cyan",
}: { label: string; active: boolean; onClick: () => void; tint?: "cyan" | "violet" | "emerald" }) {
  const tintClass = active
    ? tint === "violet"
      ? "bg-violet-400/20 text-violet-200 border-violet-300/40"
      : tint === "emerald"
        ? "bg-emerald-400/20 text-emerald-200 border-emerald-300/40"
        : "bg-cyan-400/20 text-cyan-200 border-cyan-300/40"
    : "glass text-slate-400 hover:text-slate-200";
  return (
    <button
      onClick={onClick}
      className={`px-2 py-2 rounded-lg text-[11px] font-bold transition-all border ${
        active ? `${tintClass} shadow-[0_0_12px_-4px_currentColor]` : `${tintClass} border-white/10`
      }`}
    >
      <span className={active ? "" : "opacity-70"}>{active ? "● " : "○ "}</span>
      {label}
    </button>
  );
}
