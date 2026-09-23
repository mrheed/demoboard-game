import { memo } from "react";

import {
  spritePixels,
  spriteSize,
  type PixelSprite,
} from "@/lib/game/pixel-sprite";
import { cn } from "@/lib/utils";

const urlCache = new Map<string, string>();

function spriteKey(sprite: PixelSprite) {
  let key = sprite.rows.join("\n");
  for (const row of Object.keys(sprite.palette)) {
    key += `|${row}${sprite.palette[row]}`;
  }
  return key;
}

/** One cached image per sprite, instead of a DOM node per pixel. */
function spriteUrl(sprite: PixelSprite) {
  const key = spriteKey(sprite);
  const hit = urlCache.get(key);
  if (hit) return hit;
  const { width, height } = spriteSize(sprite);
  const pixels = spritePixels(sprite);
  let rects = "";
  for (const pixel of pixels) {
    rects += `<rect x="${pixel.x}" y="${pixel.y}" width="1" height="1" fill="${pixel.fill}"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">${rects}</svg>`;
  const url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  urlCache.set(key, url);
  return url;
}

/**
 * Renders a {@link PixelSprite} as one cached image. Pixel grids stay sharp
 * via `image-rendering: pixelated` without a DOM node per pixel.
 */
export const PixelArt = memo(function PixelArt({
  sprite,
  label,
  className,
}: {
  sprite: PixelSprite;
  /** Accessible name, or omit to treat the art as decorative. */
  label?: string;
  className?: string;
}) {
  return (
    // Generated data URLs cannot use Next Image's optimization pipeline.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={spriteUrl(sprite)}
      alt={label ?? ""}
      draggable={false}
      data-pixel
      className={cn("pointer-events-none block h-auto w-full select-none", className)}
      style={{ imageRendering: "pixelated" }}
    />
  );
});
