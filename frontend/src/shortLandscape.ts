import type { ViewportLike } from "./viewportHeight.js";

export function isShortLandscape(viewport: ViewportLike): boolean {
  return viewport.height < 400 && viewport.width > 600;
}
