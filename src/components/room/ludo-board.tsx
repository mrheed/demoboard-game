import { memo, type CSSProperties } from "react";

import {
  LUDO_SIZE,
  ludoCellsForRules,
  ludoSeatColor,
  yardHex,
  yardShade,
  type LudoCell,
} from "@/lib/game/ludo-board";
import { pawnGlyph } from "@/lib/game/pawn-sprite";
import { cn } from "@/lib/utils";

/**
 * Pixel Ludo board: four coloured start yards with distinct seat glyphs, a
 * cross-shaped track, and home lanes into the centre. Kept in DOM so pawn
 * overlays can target cells by `data-row` / `data-col`.
 */
export function LudoBoard({
  className,
  overlay,
  showYardBadges = true,
  rulesVersion = 2,
}: {
  className?: string;
  overlay?: React.ReactNode;
  /** Seat glyph badges in each yard. Off for compact marketing demos. */
  showYardBadges?: boolean;
  rulesVersion?: number;
}) {
  const cells = ludoCellsForRules(rulesVersion);
  return (
    <div
      className={cn(
        "relative grid aspect-square w-full gap-px bg-edge p-px",
        className,
      )}
      style={{
        gridTemplateColumns: `repeat(${LUDO_SIZE}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${LUDO_SIZE}, minmax(0, 1fr))`,
      }}
      role="img"
      aria-label="Ludo board with four distinct seat yards"
    >
      {cells.map((cell) => (
        <LudoCellView key={`${cell.row}-${cell.col}`} cell={cell} />
      ))}

      {showYardBadges
        ? ([1, 2, 3, 4] as const).map((seat) => (
            <YardBadge key={seat} seat={seat} />
          ))
        : null}

      {overlay}
    </div>
  );
}

const YardBadge = memo(function YardBadge({ seat }: { seat: number }) {
  const color = ludoSeatColor(seat);
  // Place badge in the inner corner of each yard (away from the track).
  const placement: Record<number, string> = {
    1: "bottom-[2.5%] left-[2.5%]",
    2: "top-[2.5%] left-[2.5%]",
    3: "top-[2.5%] right-[2.5%]",
    4: "bottom-[2.5%] right-[2.5%]",
  };

  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute z-[1] grid size-[7%] place-items-center border-2 border-void/50 bg-void/40 font-pixel text-[clamp(6px,1.1vh,12px)]",
        placement[seat],
      )}
      style={{
        color: color.hex,
        boxShadow: `2px 2px 0 0 ${color.shadeHex}`,
      }}
    >
      {pawnGlyph(seat)}
    </div>
  );
});

const LudoCellView = memo(function LudoCellView({ cell }: { cell: LudoCell }) {
  return (
    <div
      data-row={cell.row}
      data-col={cell.col}
      data-kind={cell.kind}
      data-seat={cell.seat}
      className={cn(
        "relative overflow-hidden",
        cell.kind === "void" && "bg-void",
        cell.kind === "path" && "bg-cream/90",
        cell.kind === "safe" && "bg-cream",
        cell.kind === "center" && "bg-gold",
      )}
      style={cellStyle(cell)}
    >
      {cell.kind === "safe" && (
        <span
          aria-hidden
          className="absolute inset-[22%] rotate-45 border border-void/30 bg-gold/70"
        />
      )}
      {cell.kind === "entry" && (
        <span
          aria-hidden
          className="absolute inset-[28%] rounded-none"
          style={{ backgroundColor: yardShade(cell.seat ?? 1) }}
        />
      )}
      {cell.kind === "yard-pad" && (
        <span
          aria-hidden
          className="absolute inset-[18%] border-2 border-void/35 pixel-inset"
          style={{
            backgroundColor: "color-mix(in srgb, white 35%, transparent)",
          }}
        />
      )}
      {cell.kind === "center" && (
        <span className="absolute inset-0 grid place-items-center font-pixel text-[clamp(4px,0.7vh,8px)] text-void">
          ★
        </span>
      )}
    </div>
  );
});

function cellStyle(cell: LudoCell): CSSProperties | undefined {
  if (cell.kind === "yard" || cell.kind === "yard-pad") {
    return {
      backgroundColor: yardHex(cell.seat ?? 1),
    };
  }
  if (cell.kind === "home-lane") {
    return {
      backgroundColor: yardHex(cell.seat ?? 1),
      opacity: 0.85,
    };
  }
  if (cell.kind === "entry") {
    return {
      backgroundColor: `color-mix(in srgb, ${yardHex(cell.seat ?? 1)} 35%, #e8ecf8)`,
    };
  }
  return undefined;
}
