/**
 * Classic 15×15 Ludo layout. Four coloured yards sit in the corners; a cross
 * of path cells meets in the centre where the home lanes finish.
 */

/** Ludo-only seat paints. Monopoly keeps the shared seat palette. */
export const LUDO_COLORS = [
  { hex: "#22a84a", shadeHex: "#146b2e", label: "Green" },
  { hex: "#e23b3b", shadeHex: "#9b1c1c", label: "Red" },
  { hex: "#2f6fe4", shadeHex: "#1a3f8f", label: "Blue" },
  { hex: "#f5c518", shadeHex: "#a67c00", label: "Yellow" },
] as const;

export function ludoSeatColor(seat: number) {
  return LUDO_COLORS[(seat - 1) % LUDO_COLORS.length];
}

export const LUDO_SIZE = 15;

export type LudoCellKind =
  | "yard"
  | "yard-pad"
  | "path"
  | "safe"
  | "entry"
  | "home-lane"
  | "center"
  | "void";

export type LudoCell = {
  row: number;
  col: number;
  kind: LudoCellKind;
  /** Seat that owns this yard / home lane / entry, when applicable. */
  seat?: number;
};

/** Seat → corner yard (row/col ranges, inclusive). */
export const YARD_BOUNDS: Record<
  number,
  { rows: [number, number]; cols: [number, number] }
> = {
  1: { rows: [9, 14], cols: [0, 5] }, // bottom-left · Green
  2: { rows: [0, 5], cols: [0, 5] }, // top-left · Red
  3: { rows: [0, 5], cols: [9, 14] }, // top-right · Blue
  4: { rows: [9, 14], cols: [9, 14] }, // bottom-right · Yellow
};

/** Four start pads inside each 6×6 yard, relative to the yard origin. */
const PAD_OFFSETS: readonly [number, number][] = [
  [1, 1],
  [1, 3],
  [3, 1],
  [3, 3],
];

/**
 * Home-lane cells leading into the centre, ordered from entry toward finish.
 * Five coloured steps; the sixth exact pip enters the centre (with a bridge
 * cell between the last lane square and [7,7]).
 */
export const HOME_LANES: Record<number, readonly [number, number][]> = {
  1: [
    [13, 7],
    [12, 7],
    [11, 7],
    [10, 7],
    [9, 7],
  ],
  2: [
    [7, 1],
    [7, 2],
    [7, 3],
    [7, 4],
    [7, 5],
  ],
  3: [
    [1, 7],
    [2, 7],
    [3, 7],
    [4, 7],
    [5, 7],
  ],
  4: [
    [7, 13],
    [7, 12],
    [7, 11],
    [7, 10],
    [7, 9],
  ],
};

/** Cell between the last home-lane square and the finish hub. */
export const HOME_BRIDGE: Record<number, [number, number]> = {
  1: [8, 7],
  2: [7, 6],
  3: [6, 7],
  4: [7, 8],
};

/** Track cell where a seat's pawns enter after rolling a 6 from the yard. */
export const ENTRY_CELLS: Record<number, [number, number]> = {
  1: [13, 6],
  2: [6, 1],
  3: [1, 8],
  4: [8, 13],
};

/** Globally safe cells (cannot be captured). */
export const SAFE_CELLS: readonly [number, number][] = [
  [13, 6],
  [6, 1],
  [1, 8],
  [8, 13],
  [8, 2],
  [2, 6],
  [6, 12],
  [12, 8],
];

function inBounds(
  row: number,
  col: number,
  rows: [number, number],
  cols: [number, number],
) {
  return (
    row >= rows[0] && row <= rows[1] && col >= cols[0] && col <= cols[1]
  );
}

function isCross(row: number, col: number) {
  return (row >= 6 && row <= 8) || (col >= 6 && col <= 8);
}

function isCenter(row: number, col: number) {
  return row >= 6 && row <= 8 && col >= 6 && col <= 8;
}

function key(row: number, col: number) {
  return `${row}:${col}`;
}

export const LUDO_CELLS: LudoCell[] = (() => {
  const cells: LudoCell[] = [];
  const homeMap = new Map<string, number>();
  for (const [seat, lane] of Object.entries(HOME_LANES)) {
    for (const [r, c] of lane) homeMap.set(key(r, c), Number(seat));
  }

  const safeSet = new Set(SAFE_CELLS.map(([r, c]) => key(r, c)));
  const entryMap = new Map(
    Object.entries(ENTRY_CELLS).map(([seat, [r, c]]) => [
      key(r, c),
      Number(seat),
    ]),
  );

  for (let row = 0; row < LUDO_SIZE; row += 1) {
    for (let col = 0; col < LUDO_SIZE; col += 1) {
      let seat: number | undefined;
      for (const [s, bounds] of Object.entries(YARD_BOUNDS)) {
        if (inBounds(row, col, bounds.rows, bounds.cols)) {
          seat = Number(s);
          break;
        }
      }

      if (seat !== undefined && !isCross(row, col)) {
        const bounds = YARD_BOUNDS[seat];
        const localRow = row - bounds.rows[0];
        const localCol = col - bounds.cols[0];
        const isPad = PAD_OFFSETS.some(
          ([pr, pc]) => pr === localRow && pc === localCol,
        );
        cells.push({
          row,
          col,
          kind: isPad ? "yard-pad" : "yard",
          seat,
        });
        continue;
      }

      if (isCenter(row, col)) {
        // The very middle of the 3×3 is the finish hub; the ring around it
        // belongs to the home lanes / path that feed into it.
        if (row === 7 && col === 7) {
          cells.push({ row, col, kind: "center" });
        } else if (homeMap.has(key(row, col))) {
          cells.push({
            row,
            col,
            kind: "home-lane",
            seat: homeMap.get(key(row, col)),
          });
        } else {
          cells.push({ row, col, kind: "path" });
        }
        continue;
      }

      if (homeMap.has(key(row, col))) {
        cells.push({
          row,
          col,
          kind: "home-lane",
          seat: homeMap.get(key(row, col)),
        });
        continue;
      }

      if (isCross(row, col)) {
        const entrySeat = entryMap.get(key(row, col));
        if (entrySeat !== undefined) {
          cells.push({ row, col, kind: "entry", seat: entrySeat });
        } else if (safeSet.has(key(row, col))) {
          cells.push({ row, col, kind: "safe" });
        } else {
          cells.push({ row, col, kind: "path" });
        }
        continue;
      }

      cells.push({ row, col, kind: "void" });
    }
  }

  return cells;
})();

const V2_REMOVED_TRACK_CELLS = new Set(["6:6", "6:8", "8:6", "8:8"]);
const LUDO_V2_CELLS = LUDO_CELLS.map((cell) =>
  cell.kind === "path" && V2_REMOVED_TRACK_CELLS.has(key(cell.row, cell.col))
    ? { ...cell, kind: "void" as const }
    : cell,
);

/** Render geometry must match the persisted match rules version. */
export function ludoCellsForRules(rulesVersion = 2): readonly LudoCell[] {
  if (rulesVersion === 1) return LUDO_CELLS;
  return LUDO_V2_CELLS;
}

export function yardHex(seat: number) {
  return ludoSeatColor(seat).hex;
}

export function yardShade(seat: number) {
  return ludoSeatColor(seat).shadeHex;
}
