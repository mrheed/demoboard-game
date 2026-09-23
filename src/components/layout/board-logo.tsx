import Image from "next/image";
import { cn } from "@/lib/utils";

type BoardLogoProps = React.ComponentProps<"span"> & {
  /** `mark` is the compact icon + name. `banner` is the Pixels-style wordmark. */
  variant?: "mark" | "banner";
};

/**
 * Wordmark: pixel mark + Pixelify BOARD.
 */
export function BoardLogo({
  className,
  variant = "mark",
  ...props
}: BoardLogoProps) {
  if (variant === "banner") {
    return (
      <span
        className={cn(
          "inline-block font-pixel text-[1.65rem] font-bold leading-none tracking-wide text-gold sm:text-5xl lg:text-[3.35rem]",
          className,
        )}
        style={{ textShadow: "4px 4px 0 #c45a00, 7px 7px 0 #1a0c06" }}
        {...props}
      >
        BOARD
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2.5 font-pixel text-lg font-bold leading-none text-parchment sm:text-xl",
        className,
      )}
      {...props}
    >
      <Image
        src="/board-logo.png"
        alt=""
        width={36}
        height={36}
        data-pixel
        className="size-8 shrink-0 bg-transparent sm:size-9"
        draggable={false}
      />
      <span className="pt-0.5">BOARD</span>
    </span>
  );
}
