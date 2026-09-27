/**
 * Dynamic Island geometry, from Apple's Human Interface Guidelines, Live
 * Activities > Specifications (read 2026-09-27; page updated 2025-12-16).
 * Values are for the 430 x 932 pt screen (the Pro Max class), in points,
 * rendered here as CSS pixels and scaled as a whole by the desk.
 *
 *   compact leading / trailing   62.33 x 36.67
 *   compact or minimal width     250
 *   minimal (detached)           36.67-45 x 36.67
 *   expanded                     408 x 84-160
 *   corner radius                44 ("matches the TrueDepth camera")
 *   Lock Screen margin           14
 *
 * The resting island's width is not in that table: 126 is the sensor housing
 * the compact width is built around (250 - 2 x 62.33 = 125.33).
 */
export const SPEC = {
  height: 36.67,
  idleWidth: 126,
  compactWidth: 250,
  compactSide: 62.33,
  minimalMin: 36.67,
  minimalMax: 45,
  expandedWidth: 408,
  expandedMinH: 84,
  expandedMaxH: 160,
  expandedRadius: 44,
  margin: 14,
  /** Gap between the island and a detached minimal. Measured by eye, not in the HIG. */
  detachedGap: 7,
  /** Apple caps Live Activity animations at two seconds. */
  maxAnimation: 2,
} as const;
