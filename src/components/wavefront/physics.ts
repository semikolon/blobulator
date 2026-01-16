/**
 * Wavefront Physics Engine
 * Velocity gradients, blob spawning, position updates
 */

import type { WaveFrontBlob, BlobFieldConfig } from './types';
import { DEFAULT_CONFIG, BLOB_COLORS } from './types';
import { applyCurlNoise } from './flowField';

export function getVelocity(
  generation: number,
  config: BlobFieldConfig = DEFAULT_CONFIG,
  progress: number = 1
): number {
  const easingMultiplier = (1 - config.expansionEasing) + config.expansionEasing * (progress * progress);

  if (generation === 0) {
    return config.baseSpeed * 0.1;
  }

  const baseVelocity = config.baseSpeed * (1 + generation * config.accelerationFactor);
  return baseVelocity * easingMultiplier;
}

export function getBlobSize(generation: number, config: BlobFieldConfig = DEFAULT_CONFIG): number {
  return config.baseBlobSize * Math.pow(config.shrinkFactor, generation);
}

export function updateBlobVelocity(
  blob: WaveFrontBlob,
  config: BlobFieldConfig = DEFAULT_CONFIG,
  elapsedMs: number = 0,
  progress: number = 1
): void {
  if (config.useCurlNoise) {
    blob.direction = applyCurlNoise(
      blob.direction,
      blob.x,
      blob.y,
      blob.id,
      elapsedMs,
      {
        scale: config.curlScale,
        lerpFactor: config.curlLerpFactor,
        timeEvolution: config.curlTimeEvolution,
        blobVariation: config.curlBlobVariation,
      }
    );
  }

  const speed = getVelocity(blob.generation, config, progress);
  blob.vx = Math.cos(blob.direction) * speed;
  blob.vy = Math.sin(blob.direction) * speed;
}

export function updateBlobPosition(blob: WaveFrontBlob): void {
  blob.x += blob.vx;
  blob.y += blob.vy;
  blob.age += 1;
}

function createCoreBlob(x: number, y: number, config: BlobFieldConfig): WaveFrontBlob {
  const baseDirection = Math.atan2(y, x);
  const directionJitter = (Math.random() - 0.5) * 0.5;

  return {
    id: `core-${Math.random().toString(36).substring(2, 11)}`,
    x,
    y,
    vx: 0,
    vy: 0,
    direction: baseDirection + directionJitter,
    generation: 0,
    size: getBlobSize(0, config),
    age: 0,
    isFrontier: false,
    colorIndex: Math.floor(Math.random() * BLOB_COLORS.length),
  };
}

export function generateInitialBlobs(
  _centerX: number,
  _centerY: number,
  config: BlobFieldConfig = DEFAULT_CONFIG
): WaveFrontBlob[] {
  const blobs: WaveFrontBlob[] = [];
  const coreSize = getBlobSize(0, config);
  const overlapFactor = 0.6;
  const stepX = coreSize * overlapFactor;
  const stepY = coreSize * overlapFactor;

  // Create a circular cluster in the center
  const radius = 100;

  for (let gx = -radius; gx <= radius; gx += stepX) {
    for (let gy = -radius; gy <= radius; gy += stepY) {
      const dist = Math.sqrt(gx * gx + gy * gy);
      if (dist <= radius) {
        let x = gx + (Math.random() - 0.5) * config.positionJitter;
        let y = gy + (Math.random() - 0.5) * config.positionJitter;
        blobs.push(createCoreBlob(x, y, config));
      }
    }
  }

  // Mark edge blobs as frontier
  for (const blob of blobs) {
    const dist = Math.sqrt(blob.x * blob.x + blob.y * blob.y);
    blob.isFrontier = dist > radius - 30;
  }

  return blobs;
}

export function spawnFromFrontier(
  frontierBlobs: WaveFrontBlob[],
  config: BlobFieldConfig = DEFAULT_CONFIG
): WaveFrontBlob[] {
  const newBlobs: WaveFrontBlob[] = [];

  for (const parent of frontierBlobs) {
    const [min, max] = config.spawnCountRange;
    const spawnCount = min + Math.floor(Math.random() * (max - min + 1));

    for (let i = 0; i < spawnCount; i++) {
      const directionOffset = (Math.random() - 0.5) * 2 * config.spawnDirectionOffset;
      const childDirection = parent.direction + directionOffset;
      const [minDist, maxDist] = config.spawnDistance;
      const distance = minDist + Math.random() * (maxDist - minDist);
      const newGeneration = parent.generation + 1;
      const speed = getVelocity(newGeneration, config);

      newBlobs.push({
        id: `blob-${Math.random().toString(36).substring(2, 11)}`,
        x: parent.x + Math.cos(childDirection) * distance,
        y: parent.y + Math.sin(childDirection) * distance,
        vx: Math.cos(childDirection) * speed,
        vy: Math.sin(childDirection) * speed,
        direction: childDirection,
        generation: newGeneration,
        size: getBlobSize(newGeneration, config),
        age: 0,
        isFrontier: true,
        colorIndex: parent.colorIndex,
      });
    }

    parent.isFrontier = false;
  }

  return newBlobs;
}

export function recycleBlobsAtEdge(
  blobs: WaveFrontBlob[],
  viewportWidth: number,
  viewportHeight: number,
  margin: number = 100
): WaveFrontBlob[] {
  const halfW = viewportWidth / 2 + margin;
  const halfH = viewportHeight / 2 + margin;

  return blobs.filter(blob => {
    return Math.abs(blob.x) < halfW && Math.abs(blob.y) < halfH;
  });
}
