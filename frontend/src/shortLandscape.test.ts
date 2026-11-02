import { expect, it } from "vitest";
import { isShortLandscape } from "./shortLandscape.js";
import type { ViewportLike } from "./viewportHeight.js";

it.each([
  [844, 390, true],
  [600, 390, false],
  [601, 390, true],
  [844, 400, false],
  [844, 399, true],
])("classifies a %ix%i visual viewport", (width, height, expected) => {
  expect(isShortLandscape({ width, height } as ViewportLike)).toBe(expected);
});
