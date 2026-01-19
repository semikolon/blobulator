/**
 * Shared types for audio-reactive visualizations
 */

export interface AudioFeatures {
  amplitude: number;    // 0-1 overall loudness
  bass: number;         // 0-1 low frequency energy
  mid: number;          // 0-1 mid frequency energy
  treble: number;       // 0-1 high frequency energy
}

export type VisualizationMode = 'blobulator' | 'voidulator';
