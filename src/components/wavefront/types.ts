/**
 * Blobulator - Audio-Reactive Wavefront Animation
 * Core types and configuration
 */

export interface WaveFrontBlob {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  direction: number;
  generation: number;
  size: number;
  age: number;
  isFrontier: boolean;
  colorIndex: number;
}

export interface BlobFieldConfig {
  baseSpeed: number;
  accelerationFactor: number;
  baseBlobSize: number;
  shrinkFactor: number;
  spawnIntervalMs: number;
  spawnCountRange: [number, number];
  spawnDistance: [number, number];
  spawnDirectionOffset: number;
  gooeyIntensity: 'weak' | 'medium' | 'strong';
  useCurlNoise: boolean;
  curlScale: number;
  curlLerpFactor: number;
  curlTimeEvolution: number;
  curlBlobVariation: number;
  positionJitter: number;
  expansionEasing: number;
  growthFactor: number;
}

// Settings from your screenshot
export const DEFAULT_CONFIG: BlobFieldConfig = {
  baseSpeed: 2,
  accelerationFactor: 1.0,        // From screenshot: 1.00
  baseBlobSize: 50,
  shrinkFactor: 0.85,
  spawnIntervalMs: 600,           // From screenshot: 600ms
  spawnCountRange: [1, 1],
  spawnDistance: [8, 12],
  spawnDirectionOffset: 0.1,
  gooeyIntensity: 'strong',
  useCurlNoise: true,             // From screenshot: ON
  curlScale: 0.008,               // From screenshot: 0.0080
  curlLerpFactor: 0.12,           // From screenshot: 0.12
  curlTimeEvolution: 0.0003,      // From screenshot: 0.00030
  curlBlobVariation: 0.02,
  positionJitter: 8,
  expansionEasing: 0.6,
  growthFactor: 11.0,             // From screenshot: 11.0x
};

// Coral/pink palette from brf-auto
export const BLOB_COLORS = [
  '#E57878',   // warmPink
  '#EB8A8F',   // warmPinkLight
  '#E8668B',   // accentPink
  '#F08DA8',   // accentPinkLight
  '#EC4899',   // coolPink
];

export interface AudioFeatures {
  amplitude: number;    // 0-1 overall loudness
  bass: number;         // 0-1 low frequency energy
  mid: number;          // 0-1 mid frequency energy
  treble: number;       // 0-1 high frequency energy
}
