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

// Settings tuned for nice multi-blob gooey metaball-merging expansion
// From brf-auto WaveFrontTestMode slider settings
export const DEFAULT_CONFIG: BlobFieldConfig = {
  baseSpeed: 2,
  accelerationFactor: 3.0,        // Speed multiplier per generation
  baseBlobSize: 50,
  shrinkFactor: 0.85,
  spawnIntervalMs: 600,           // How often new frontier blobs spawn
  spawnCountRange: [1, 1],
  spawnDistance: [8, 12],
  spawnDirectionOffset: 0.1,
  gooeyIntensity: 'strong',
  useCurlNoise: true,             // Organic flow vs random
  curlScale: 0.009,               // Lower = sweeping, higher = tight
  curlLerpFactor: 0.02,           // Blend speed toward flow (LOW = preserves momentum!)
  curlTimeEvolution: 0.0003,      // Flow field change rate
  curlBlobVariation: 0.02,
  positionJitter: 8,
  expansionEasing: 0.6,
  growthFactor: 15.0,             // Blob size multiplier at 100% progress
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

/**
 * Animation mode - continuous expansion vs ambient drift
 * Ported from brf-auto's phase system
 */
export type AnimationMode = 'expanding' | 'drift';

/**
 * Drift mode configuration - calm ambient motion
 * Applied when audio is quiet, creates gentle swirling effect
 * Ported from brf-auto/wavefront/drift.ts
 */
export const DRIFT_CONFIG = {
  speed: 0.018,                  // px/ms - base drift speed
  directionChangeRate: 0.0016,  // How quickly direction evolves
  sizeBreathingRate: 0.0008,    // Size pulsing frequency
  sizeBreathingAmount: 0.03,    // 3% size variation
  curlInfluence: 0.15,          // How much curl noise affects drift
  // Per-blob variation for better metaball effects
  speedVariationAmount: 0.8,    // ±80% speed variation between blobs
  directionWobbleAmount: 0.7,   // ~40° of direction wobble per blob
  // Viewport boundary containment
  boundaryMargin: 200,          // Pixels from edge where soft boundary starts
  boundaryStrength: 0.00008,    // How strongly blobs are pushed back
} as const;

export type DriftConfig = typeof DRIFT_CONFIG;
