/**
 * Drift Mode - Calm ambient motion for blob fields
 *
 * Applied when audio is quiet - creates gentle, swirling effect.
 * Ported from brf-auto/wavefront/drift.ts
 *
 * Features:
 * - Per-blob speed/direction variation for better metaball effects
 * - Viewport boundary containment (soft edges)
 * - Size breathing (pulsing)
 * - Gradual direction evolution for swirling motion
 */

import type { WaveFrontBlob } from './types';
import { DRIFT_CONFIG } from './types';

/**
 * Apply calm drift motion to blobs.
 * Used when audio is quiet - creates ambient swirling effect.
 *
 * @param blobs - Current blob array
 * @param deltaMs - Time since last frame
 * @param elapsedMs - Total elapsed time
 * @param viewportWidth - Viewport width for boundary containment
 * @param viewportHeight - Viewport height for boundary containment
 */
export function applyDriftToBlobs(
  blobs: WaveFrontBlob[],
  deltaMs: number,
  elapsedMs: number,
  viewportWidth: number,
  viewportHeight: number
): WaveFrontBlob[] {
  const centerX = viewportWidth / 2;
  const centerY = viewportHeight / 2;

  return blobs.map((blob, index) => {
    const phaseOffset = index * 0.7;

    // 1. Per-blob direction wobble - each blob has its own oscillating path
    // Creates relative movement between blobs for better metaball merging
    const directionWobble =
      Math.sin(elapsedMs * 0.0004 + phaseOffset * 2.3) *
      DRIFT_CONFIG.directionWobbleAmount;
    const effectiveDirection = blob.direction + directionWobble;

    // 2. Per-blob speed variation - some blobs move faster than others
    // Creates dynamic relative movement for exciting metaball effects
    const speedVariation =
      1 +
      Math.sin(elapsedMs * 0.0003 + phaseOffset * 1.7) *
        DRIFT_CONFIG.speedVariationAmount;
    const driftSpeed = DRIFT_CONFIG.speed * speedVariation;

    let driftX = Math.cos(effectiveDirection) * driftSpeed * deltaMs;
    let driftY = Math.sin(effectiveDirection) * driftSpeed * deltaMs;

    // 3. Viewport boundary containment
    // Soft boundaries at viewport edges gently push blobs back inward
    const viewportX = blob.x + centerX;
    const viewportY = blob.y + centerY;
    const margin = DRIFT_CONFIG.boundaryMargin;
    const strength = DRIFT_CONFIG.boundaryStrength;

    // Left edge
    if (viewportX < margin) {
      driftX += (margin - viewportX) * strength * deltaMs;
    }
    // Right edge
    if (viewportX > viewportWidth - margin) {
      driftX -= (viewportX - (viewportWidth - margin)) * strength * deltaMs;
    }
    // Top edge
    if (viewportY < margin) {
      driftY += (margin - viewportY) * strength * deltaMs;
    }
    // Bottom edge
    if (viewportY > viewportHeight - margin) {
      driftY -= (viewportY - (viewportHeight - margin)) * strength * deltaMs;
    }

    // 4. Gradual direction evolution - swirling effect
    const curlAngle =
      Math.sin(elapsedMs * 0.0002 + phaseOffset) * Math.PI * 0.15;
    const newDirection =
      blob.direction + curlAngle * DRIFT_CONFIG.directionChangeRate * deltaMs;

    return {
      ...blob,
      x: blob.x + driftX,
      y: blob.y + driftY,
      direction: newDirection,
    };
  });
}

/**
 * Calculate size breathing multiplier for ambient pulsing effect.
 *
 * @param elapsedMs - Total elapsed time
 * @param blobIndex - Index of the blob (for phase offset)
 */
export function getSizeBreathingMultiplier(
  elapsedMs: number,
  blobIndex: number
): number {
  const phaseOffset = blobIndex * 0.5;
  const breathing =
    Math.sin(elapsedMs * DRIFT_CONFIG.sizeBreathingRate + phaseOffset) *
    DRIFT_CONFIG.sizeBreathingAmount;
  return 1 + breathing;
}
