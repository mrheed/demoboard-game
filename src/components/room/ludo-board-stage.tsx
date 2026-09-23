import { LudoBoard } from "@/components/room/ludo-board";
import { PixelFrame } from "@/components/ui/pixel-frame";
import { cn } from "@/lib/utils";

/**
 * Square frame that holds the Ludo board. `overlay` spans the whole board for
 * pawns and dice effects.
 */
export function LudoBoardStage({
  className,
  overlay,
  rulesVersion,
}: {
  className?: string;
  overlay?: React.ReactNode;
  rulesVersion?: number;
}) {
  return (
    <PixelFrame
      className={cn(
        "relative mx-auto aspect-square w-full max-w-[min(100%,78vh)]",
        className,
      )}
    >
      <LudoBoard overlay={overlay} rulesVersion={rulesVersion} />
    </PixelFrame>
  );
}
