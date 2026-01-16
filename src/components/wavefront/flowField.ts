/**
 * Curl Noise Flow Field
 * Creates smooth, organic liquid-like motion
 */

import { createNoise2D, createNoise3D } from 'simplex-noise';

const noise2D = createNoise2D();
const noise3D = createNoise3D();

export interface CurlNoiseConfig {
  scale: number;
  lerpFactor: number;
  timeEvolution: number;
  blobVariation: number;
}

function getCurlVelocity3D(
  x: number,
  y: number,
  time: number,
  scale: number,
  timeEvolution: number
): { x: number; y: number } {
  const delta = 0.0001;
  const t = time * timeEvolution;

  const dx =
    (noise3D(x * scale + delta, y * scale, t) -
      noise3D(x * scale - delta, y * scale, t)) /
    (2 * delta);
  const dy =
    (noise3D(x * scale, y * scale + delta, t) -
      noise3D(x * scale, y * scale - delta, t)) /
    (2 * delta);

  return { x: dy, y: -dx };
}

function getFlowDirection(
  x: number,
  y: number,
  time: number,
  config: CurlNoiseConfig
): number {
  const curl = getCurlVelocity3D(x, y, time, config.scale, config.timeEvolution);
  return Math.atan2(curl.y, curl.x);
}

function blendTowardFlow(
  currentDirection: number,
  x: number,
  y: number,
  time: number,
  config: CurlNoiseConfig
): number {
  const flowDir = getFlowDirection(x, y, time, config);

  let diff = flowDir - currentDirection;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;

  return currentDirection + diff * config.lerpFactor;
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash;
}

function addBlobVariation(
  direction: number,
  blobId: string,
  time: number,
  variation: number
): number {
  const idHash = hashString(blobId);
  const offset = noise2D(idHash * 0.01, time * 0.0005);
  return direction + offset * variation;
}

export function applyCurlNoise(
  currentDirection: number,
  x: number,
  y: number,
  blobId: string,
  time: number,
  config: CurlNoiseConfig
): number {
  let newDirection = blendTowardFlow(currentDirection, x, y, time, config);
  newDirection = addBlobVariation(newDirection, blobId, time, config.blobVariation);
  return newDirection;
}
