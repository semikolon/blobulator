/**
 * Blobulator - Audio-Reactive Metaball Visualization
 *
 * BPM-based animation system:
 * - Animation style driven by detected BPM (slow BPM = calm, fast BPM = energetic)
 * - Low BPM (<90): Calm ambient swirling with cool colors (purple/blue/teal)
 * - High BPM (>140): Active expansion with warm colors (pink/orange)
 * - BPM changes slowly = smooth color transitions (not jarring)
 *
 * Audio reactivity:
 * - BPM drives color palette and animation style
 * - Bass affects spawn rate
 * - Amplitude affects blob size pulse
 * - Mids affect movement speed
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { WaveFrontBlob, BlobFieldConfig } from './types';
import { DEFAULT_CONFIG } from './types';
import {
  updateBlobVelocity,
  recycleBlobsAtEdge,
} from './physics';
import { getSizeBreathingMultiplier } from './drift';
import type { AdaptiveAudioResult } from '../../shared';

interface BlobulatorProps {
  audio: AdaptiveAudioResult;
}

// 3 Cluster configurations - more dramatic size differences
const CLUSTERS = [
  { sizeMultiplier: 0.5, speedMultiplier: 1.6, centerOffset: { x: -150, y: -100 } },  // Tiny & very fast
  { sizeMultiplier: 1.0, speedMultiplier: 1.0, centerOffset: { x: 0, y: 50 } },       // Medium & normal
  { sizeMultiplier: 2.0, speedMultiplier: 0.5, centerOffset: { x: 180, y: -50 } },    // Large & slow
];

// Blob interaction configuration - affects color, size, and direction
const BLOB_INFLUENCE_RADIUS = 80;      // Pixels - blobs within this distance influence each other
const COLOR_BLEND_STRENGTH = 0.5;      // 0-1 - color blending intensity
const SIZE_INFLUENCE_STRENGTH = 0.15;  // 0-1 - how much neighbors affect size (larger neighbors = bigger)
const DIRECTION_INFLUENCE_STRENGTH = 0.08; // 0-1 - how much to align with neighbor velocities
const INFLUENCE_MIN_AGE = 3000;        // ms - start influencing after this age

// Frequency-based color mapping (75% frequency mix + 25% intensity)
// Bass = dark purple (270°), Mids = purple→neon pink (290-320°), Treble = pink→coral→orange (320-30°)
// Each cluster has a different frequency "character" for visual variety
// More extreme frequency bias for visible color variety between clusters
const CLUSTER_FREQUENCY_BIAS = [
  { bassWeight: 1.8, midsWeight: 0.8, trebleWeight: 0.4 },  // Cluster 0: Heavy bass (deep purples)
  { bassWeight: 0.6, midsWeight: 1.8, trebleWeight: 0.6 },  // Cluster 1: Heavy mids (neon pinks)
  { bassWeight: 0.4, midsWeight: 0.6, trebleWeight: 2.0 },  // Cluster 2: Heavy treble (oranges/yellows)
];

// Hue anchors for frequency bands - COOLER BASE for deeper purple at rest
const HUE_BASS = 265;       // Deep purple (cool anchor)
const HUE_MIDS = 310;       // Purple-pink (not too warm)
const HUE_TREBLE = 30;      // Coral-orange (warmest, requires treble to reach)
const HUE_BRIGHT = 50;      // Yellow for "all high" state (hard to reach)

// BPM normalization - maps BPM to 0-1 scale for smooth animation blending
// Low BPM (60-90) = calm/cool, High BPM (140-180) = energetic/warm
const BPM_MIN = 70;   // Below this = fully calm (0)
const BPM_MAX = 150;  // Above this = fully energetic (1)

// "Energy" metric = BPM + inertia combined (used for cluster-specific effects)
// This creates sustained energy that doesn't flicker with every beat

// Spawning lifecycle configuration
// Phase 1: Seed the stage with diminishing spawns
// Phase 2: Intensity-driven spawn/death equilibrium
const SEED_BLOBS_INITIAL = 50;        // First second: spawn 50 blobs
const SEED_DECAY_FACTOR = 0.4;        // Each second: spawn 40% of previous (50→20→8→3...)
const SEED_DURATION_SECONDS = 5;       // Seeding phase lasts 5 seconds
const SPAWN_RATE_CALM = 0.5;          // Blobs/second when intensity < 70%
const SPAWN_RATE_INTENSE = 2;         // Blobs/second when intensity > 70% (reduced from 3)
const DEATH_RATE_CALM = 0.4;          // Blobs/second dying when intensity < 70%
const DEATH_RATE_INTENSE = 0.3;       // Blobs/second dying when intensity > 70% (increased from 0.2)
const INTENSITY_THRESHOLD = 0.7;      // Below this: slightly more die than spawn

// Soft population cap - death rate scales up as we approach limit
const SOFT_CAP_START = 200;           // Start increasing death rate here
const SOFT_CAP_MAX = 350;             // Maximum comfortable population
const HARD_CAP_LIMIT = 400;           // Emergency cull threshold
const HARD_CAP_TARGET = 350;          // Cull down to this

// Dynamic gravity centers - form where blobs congregate
const MAX_GRAVITY_CENTERS = 3;        // Maximum active gravity wells
const GRAVITY_CENTER_RADIUS = 150;    // Radius to detect blob clusters
const GRAVITY_CENTER_MIN_BLOBS = 8;   // Min blobs to form a gravity center
const GRAVITY_CENTER_STRENGTH = 0.000025;  // Pull strength per center
const GRAVITY_CENTER_UPDATE_MS = 500; // How often to recalculate target centers
const GRAVITY_CENTER_LERP = 0.03;     // Smoothing factor: 0.03 = ~1s to reach target (smooth)
const GRAVITY_CENTER_FADE_THRESHOLD = 0.000001; // Remove centers when strength falls below this
const FIXED_CENTER_GRAVITY = 0.000001; // Much weaker fixed center (was 0.000008)

// Spatial hash configuration for O(n) neighbor lookups instead of O(n²)
const SPATIAL_HASH_CELL_SIZE = 100;   // Must be >= BLOB_INFLUENCE_RADIUS (80px)
const SPATIAL_HASH_MIN_BLOBS = 50;    // Below this, O(n²) is faster than hash overhead

/**
 * Spatial Hash Grid - enables O(n) neighbor lookups instead of O(n²)
 * Divides space into cells; only checks adjacent cells for neighbors.
 * With 350 blobs and 80px influence radius, reduces checks from 122,500 to ~2,000.
 */
class SpatialHash {
  private cellSize: number;
  private cells: Map<string, number[]>; // cell key -> array of blob indices

  constructor(cellSize: number) {
    this.cellSize = cellSize;
    this.cells = new Map();
  }

  // Convert position to cell key
  private getKey(x: number, y: number): string {
    const cellX = Math.floor(x / this.cellSize);
    const cellY = Math.floor(y / this.cellSize);
    return `${cellX},${cellY}`;
  }

  // Clear and rebuild from blob array
  rebuild(blobs: WaveFrontBlob[]): void {
    this.cells.clear();
    for (let i = 0; i < blobs.length; i++) {
      const key = this.getKey(blobs[i].x, blobs[i].y);
      if (!this.cells.has(key)) {
        this.cells.set(key, []);
      }
      this.cells.get(key)!.push(i);
    }
  }

  // Get indices of blobs in same + adjacent cells (9 cells total)
  getNeighborIndices(x: number, y: number): number[] {
    const cellX = Math.floor(x / this.cellSize);
    const cellY = Math.floor(y / this.cellSize);
    const result: number[] = [];

    // Check 3x3 grid of cells centered on this position
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${cellX + dx},${cellY + dy}`;
        const cell = this.cells.get(key);
        if (cell) {
          result.push(...cell);
        }
      }
    }
    return result;
  }
}

// Get cluster index from blob ID (uses random part for even distribution)
function getClusterIndex(blobId: string): number {
  const randomPart = blobId.split('-')[1] || blobId;
  const hash = randomPart.charCodeAt(0) + randomPart.charCodeAt(1) + randomPart.charCodeAt(2);
  return hash % 3;
}

// Inline styles since we don't have Tailwind
const styles = {
  container: {
    position: 'fixed' as const,
    inset: 0,
    overflow: 'hidden',
    transition: 'background-color 0.8s ease',
  },
  controlPanel: {
    position: 'absolute' as const,
    top: 16,
    left: 16,
    zIndex: 20,
    backgroundColor: 'rgba(39, 39, 42, 0.8)',
    borderRadius: 16,
    padding: 16,
    color: 'white',
    fontFamily: 'system-ui, sans-serif',
    minWidth: 200,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold' as const,
    marginBottom: 12,
  },
  button: {
    padding: '10px 20px',
    borderRadius: 8,
    fontWeight: 500,
    border: 'none',
    cursor: 'pointer',
    fontSize: 14,
    transition: 'background-color 0.2s',
  },
  buttonStart: {
    backgroundColor: '#ec4899',
  },
  buttonStop: {
    backgroundColor: '#ef4444',
  },
  error: {
    color: '#f87171',
    fontSize: 12,
    marginBottom: 8,
  },
  stats: {
    marginTop: 12,
    fontSize: 11,
    color: '#a1a1aa',
  },
  meterContainer: {
    marginTop: 12,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  meterRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  meterLabel: {
    width: 50,
    fontSize: 12,
  },
  meterBg: {
    flex: 1,
    height: 6,
    backgroundColor: '#3f3f46',
    borderRadius: 3,
    overflow: 'hidden',
  },
  svg: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
};

// Helper to create a blob (used for initial state before component mounts)
function createBlob(baseBlobSize: number): WaveFrontBlob {
  const angle = Math.random() * Math.PI * 2;
  const distance = Math.random() * 150 + 50;
  return {
    id: `blob-${Math.random().toString(36).slice(2, 11)}`,
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance,
    vx: (Math.random() - 0.5) * 0.5,
    vy: (Math.random() - 0.5) * 0.5,
    direction: Math.random() * Math.PI * 2,
    generation: 0,
    size: baseBlobSize * (0.8 + Math.random() * 0.4),
    age: 0,
    isFrontier: true,
    colorIndex: Math.floor(Math.random() * 5),
  };
}

export function Blobulator({ audio }: BlobulatorProps) {
  // Initialize with 50 blobs immediately (no timing dependencies)
  const [blobs, setBlobs] = useState<WaveFrontBlob[]>(() =>
    Array.from({ length: SEED_BLOBS_INITIAL }, () => createBlob(DEFAULT_CONFIG.baseBlobSize))
  );
  const [config] = useState<BlobFieldConfig>(DEFAULT_CONFIG);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [isPaused, setIsPaused] = useState(false);

  // Extract audio values from shared audio prop
  const {
    isListening,
    error,
    features,
    intensity,
    inertiaIntensity,
    bpm,
    bpmConfidence,
    startListening,
    stopListening,
  } = audio;

  const animationRef = useRef<number | null>(null);
  const lastSpawnRef = useRef<number>(0);
  const lastDeathRef = useRef<number>(0);
  const populationRef = useRef<number>(50); // Track current blob count for soft cap
  const elapsedRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);
  const lastDisplayUpdateRef = useRef<number>(0);

  // Seeding phase state
  const seedingStartTimeRef = useRef<number>(0);
  const lastSeedSecondRef = useRef<number>(-1);  // Track which second of seeding we're in

  // Dynamic gravity centers - form where blobs congregate
  // Target centers are recalculated periodically; actual centers lerp toward them
  const gravityCentersRef = useRef<Array<{ x: number; y: number; strength: number }>>([]);
  const targetGravityCentersRef = useRef<Array<{ x: number; y: number; strength: number }>>([]);
  const lastGravityUpdateRef = useRef<number>(0);

  // Spatial hash for O(n) neighbor lookups - rebuilt each frame
  const spatialHashRef = useRef<SpatialHash>(new SpatialHash(SPATIAL_HASH_CELL_SIZE));
  // Track which blob array the hash was built from (to avoid redundant rebuilds in render)
  const spatialHashBlobsRef = useRef<WaveFrontBlob[] | null>(null);

  // Display time (updated once per second to avoid excessive re-renders)
  const [displayTime, setDisplayTime] = useState(0);

  // BPM normalized to 0-1 scale (changes slowly, good for color/style blending)
  // Low BPM (70) = 0 (calm), High BPM (150) = 1 (energetic)
  const bpmNormalized = Math.max(0, Math.min(1, (bpm - BPM_MIN) / (BPM_MAX - BPM_MIN)));

  // "Energy" metric: combines BPM (tempo) + inertia (sustained loudness)
  // Used for cluster-specific dynamic effects (speed/size boosts)
  // Weighted: 40% BPM + 60% inertia (inertia more important for "feel")
  const energyMetric = Math.min(1, bpmNormalized * 0.4 + inertiaIntensity * 0.6);

  // Create a new blob at random position across the viewport
  // Uses padding to keep blobs slightly away from edges
  const createRandomBlob = useCallback((): WaveFrontBlob => {
    const padding = 100; // Stay this far from edges
    const maxX = (viewport.width / 2) - padding;
    const maxY = (viewport.height / 2) - padding;
    return {
      id: `blob-${Math.random().toString(36).slice(2, 11)}`,
      x: (Math.random() - 0.5) * 2 * maxX,  // Random position across width
      y: (Math.random() - 0.5) * 2 * maxY,  // Random position across height
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
      direction: Math.random() * Math.PI * 2,
      generation: 0,
      size: config.baseBlobSize * (0.8 + Math.random() * 0.4),  // ±20% size variation
      age: 0,
      isFrontier: true,
      colorIndex: Math.floor(Math.random() * 5),
    };
  }, [config.baseBlobSize, viewport.width, viewport.height]);

  // Initialize timing refs
  useEffect(() => {
    lastFrameRef.current = performance.now();
    seedingStartTimeRef.current = performance.now();
    lastSeedSecondRef.current = 0;  // Start at 0 since initial blobs already created
  }, []);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Auto-start microphone on load (or on first user interaction if browser blocks it)
  useEffect(() => {
    let mounted = true;

    const tryStart = async () => {
      try {
        await startListening();
      } catch {
        // Browser blocked auto-start, wait for user interaction
        const startOnClick = async () => {
          if (mounted && !isListening) {
            await startListening();
          }
          document.removeEventListener('click', startOnClick);
        };
        document.addEventListener('click', startOnClick, { once: true });
      }
    };

    tryStart();

    return () => {
      mounted = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle click on background to toggle pause
  const handleBackgroundClick = useCallback(() => {
    setIsPaused(prev => !prev);
  }, []);

  // Animation loop - FULLY SMOOTH blending of all behaviors across 0-1 BPM spectrum
  // No hard mode switches - every behavior is always present, just scaled by bpmNormalized
  const animate = useCallback((timestamp: number) => {
    // Skip animation updates when paused (but keep the loop running)
    if (isPaused) {
      lastFrameRef.current = timestamp; // Keep time reference updated
      animationRef.current = requestAnimationFrame(animate);
      return;
    }

    const deltaMs = timestamp - lastFrameRef.current;
    lastFrameRef.current = timestamp;
    elapsedRef.current += deltaMs;

    // ===== SPAWN/DEATH DECISIONS (outside setBlobs to avoid Strict Mode issues) =====
    // Calculate how many blobs to spawn/kill BEFORE calling setBlobs
    // Refs are mutated here, not inside the state update callback

    const now = performance.now();

    // Initialize seeding start time on first frame
    if (seedingStartTimeRef.current === 0) {
      seedingStartTimeRef.current = now;
    }

    const seedingElapsedMs = now - seedingStartTimeRef.current;
    const seedingElapsedSeconds = Math.floor(seedingElapsedMs / 1000);
    const isSeeding = seedingElapsedSeconds < SEED_DURATION_SECONDS;

    let spawnCount = 0;
    let shouldKillOldest = false;

    if (isSeeding) {
      // SEEDING PHASE: Spawn diminishing batches each second
      if (seedingElapsedSeconds > lastSeedSecondRef.current) {
        // Calculate how many blobs to spawn this second
        spawnCount = Math.max(1, Math.round(
          SEED_BLOBS_INITIAL * Math.pow(SEED_DECAY_FACTOR, seedingElapsedSeconds)
        ));
        lastSeedSecondRef.current = seedingElapsedSeconds;
      }
    } else {
      // EQUILIBRIUM PHASE: Intensity + BPM control spawn/death balance
      const isIntense = intensity >= INTENSITY_THRESHOLD;
      const baseSpawnRate = isIntense ? SPAWN_RATE_INTENSE : SPAWN_RATE_CALM;
      const baseDeathRate = isIntense ? DEATH_RATE_INTENSE : DEATH_RATE_CALM;

      // BPM boost: higher BPM = faster spawn (up to 60% boost at max BPM)
      const bpmSpawnBoost = 1 + bpmNormalized * 0.6;
      // BPM slightly reduces death rate at high tempos
      const bpmDeathReduction = 1 - bpmNormalized * 0.2;

      // Continuous bass boost: scales smoothly with bass level (up to 1.5x at max bass)
      const bassBoost = 1 + features.bass * 0.5;

      // Intensity also boosts spawn (up to 30% extra)
      const intensitySpawnBoost = 1 + intensity * 0.3;

      // SOFT CAP: Death rate increases as population approaches limit
      // This creates natural equilibrium instead of jarring hard culls
      const currentPopulation = populationRef.current;
      let populationDeathMultiplier = 1;
      if (currentPopulation > SOFT_CAP_START) {
        // Exponentially increase death rate as we approach SOFT_CAP_MAX
        const overageRatio = Math.min(1, (currentPopulation - SOFT_CAP_START) / (SOFT_CAP_MAX - SOFT_CAP_START));
        populationDeathMultiplier = 1 + Math.pow(overageRatio, 1.5) * 4; // Up to 5x death rate at cap
      }

      const effectiveSpawnRate = baseSpawnRate * bassBoost * bpmSpawnBoost * intensitySpawnBoost;
      const effectiveDeathRate = baseDeathRate * bpmDeathReduction * populationDeathMultiplier;

      // Check if it's time to spawn
      const spawnInterval = 1000 / effectiveSpawnRate;
      if (elapsedRef.current - lastSpawnRef.current > spawnInterval) {
        spawnCount = 1;
        lastSpawnRef.current = elapsedRef.current;
      }

      // Check if it's time to kill (only if we have enough blobs)
      const deathInterval = 1000 / effectiveDeathRate;
      if (elapsedRef.current - lastDeathRef.current > deathInterval) {
        shouldKillOldest = true;
        lastDeathRef.current = elapsedRef.current;
      }
    }

    // Update display time once per second
    const currentSecond = Math.floor(elapsedRef.current / 1000);
    if (currentSecond !== lastDisplayUpdateRef.current) {
      lastDisplayUpdateRef.current = currentSecond;
      setDisplayTime(currentSecond);
    }

    setBlobs(currentBlobs => {
      let updatedBlobs = [...currentBlobs];

      // Rebuild spatial hash for O(n) neighbor lookups this frame
      // Note: We rebuild again at end of frame after spawn/death for render functions
      spatialHashRef.current.rebuild(updatedBlobs);

      // ===== FULLY UNIFIED MOTION: All behaviors blend smoothly =====
      // No thresholds, no mode switches - just continuous scaling

      // Blend factors based on INTENSITY (responsive to music energy)
      // More aggressive scaling for visible animation differences
      const driftFactor = 1 - intensity * 0.9;           // 1.0 → 0.1 (almost no drift when loud)
      const expansionFactor = 0.1 + intensity * 1.5;     // 0.1 → 1.6 (MUCH faster when loud)
      const midSpeedBoost = 1 + features.mid * 1.0;      // Doubled mids speed boost (100% max)
      const intensitySpeedBoost = 1 + intensity * 0.8;   // Extra speed from overall intensity

      // === AUDIO-DRIVEN CURL NOISE PARAMETERS ===
      // These control the low-level "feel" of blob movement
      // Mids → lerpFactor: higher mids = snappier response to flow field (less momentum)
      // Treble → timeEvolution: higher treble = faster flow field changes (sparkly/energetic)
      // Bass → scale: higher bass = broader sweeping curves (vs tight local swirls)
      const dynamicConfig = {
        ...config,
        curlLerpFactor: 0.01 + features.mid * 0.07,      // 0.01 → 0.08 (snappier with mids)
        curlTimeEvolution: 0.0001 + features.treble * 0.0009, // 0.0001 → 0.001 (faster with treble)
        curlScale: 0.005 + (1 - features.bass) * 0.01,   // 0.005 → 0.015 (broader with bass)
      };

      // Process each blob with BOTH drift and expansion physics blended together
      for (let i = 0; i < updatedBlobs.length; i++) {
        const blob = updatedBlobs[i];
        const cluster = CLUSTERS[getClusterIndex(blob.id)];
        const phaseOffset = i * 0.7;

        // === DRIFT-LIKE BEHAVIORS (scale with driftFactor) ===

        // Direction wobble - each blob has oscillating direction
        const directionWobble = Math.sin(elapsedRef.current * 0.0004 + phaseOffset * 2.3) * 0.7;
        const wobbleInfluence = directionWobble * driftFactor * deltaMs * 0.001;
        blob.direction += wobbleInfluence;

        // Speed variation per blob - creates relative movement
        const speedVariation = 1 + Math.sin(elapsedRef.current * 0.0003 + phaseOffset * 1.7) * 0.8 * driftFactor;

        // Drift movement (swirling in place)
        const driftSpeed = 0.018 * speedVariation * driftFactor;
        const driftX = Math.cos(blob.direction) * driftSpeed * deltaMs;
        const driftY = Math.sin(blob.direction) * driftSpeed * deltaMs;

        // === EXPANSION-LIKE BEHAVIORS (scale with expansionFactor) ===

        // Velocity updates - curl noise + generation-based acceleration
        // Uses dynamicConfig with audio-driven curl parameters
        // Speed scales dramatically with intensity AND mids
        // Cluster 0 (tiny/fast) gets EXTRA speed boost from energy metric
        const clusterIndex = getClusterIndex(blob.id);
        const energySpeedBoost = clusterIndex === 0 ? (1 + energyMetric * 1.5) : 1; // Up to 2.5x for cluster 0
        updateBlobVelocity(
          blob,
          dynamicConfig,
          elapsedRef.current,
          0.8 * cluster.speedMultiplier * midSpeedBoost * intensitySpeedBoost * energySpeedBoost * expansionFactor
        );

        // === COMBINE BOTH SYSTEMS ===
        // Position = drift contribution + velocity contribution (both always present)
        blob.x += driftX + blob.vx * expansionFactor;
        blob.y += driftY + blob.vy * expansionFactor;
        blob.age += 1;  // Age used for influence calculations

        // Gradual direction evolution (swirling effect, always present)
        const curlAngle = Math.sin(elapsedRef.current * 0.0002 + phaseOffset) * Math.PI * 0.15;
        blob.direction += curlAngle * 0.0016 * deltaMs * driftFactor;
      }

      // === DYNAMIC GRAVITY CENTERS ===
      // Periodically detect clusters and update TARGET gravity centers
      const now = performance.now();
      if (now - lastGravityUpdateRef.current > GRAVITY_CENTER_UPDATE_MS) {
        lastGravityUpdateRef.current = now;

        // Find blob clusters using simple grid-based density detection
        const cellSize = GRAVITY_CENTER_RADIUS;
        const densityMap = new Map<string, { x: number; y: number; count: number; sumX: number; sumY: number }>();

        for (const blob of updatedBlobs) {
          const cellX = Math.floor(blob.x / cellSize);
          const cellY = Math.floor(blob.y / cellSize);
          const key = `${cellX},${cellY}`;

          if (!densityMap.has(key)) {
            densityMap.set(key, { x: cellX, y: cellY, count: 0, sumX: 0, sumY: 0 });
          }
          const cell = densityMap.get(key)!;
          cell.count++;
          cell.sumX += blob.x;
          cell.sumY += blob.y;
        }

        // Find top N densest cells as gravity centers
        const candidates = Array.from(densityMap.values())
          .filter(cell => cell.count >= GRAVITY_CENTER_MIN_BLOBS)
          .sort((a, b) => b.count - a.count)
          .slice(0, MAX_GRAVITY_CENTERS);

        // Update TARGET gravity centers (not actual - those are lerped below)
        targetGravityCentersRef.current = candidates.map(cell => ({
          x: cell.sumX / cell.count,
          y: cell.sumY / cell.count,
          strength: GRAVITY_CENTER_STRENGTH * Math.min(1, cell.count / 20),
        }));

        // Initialize actual centers if empty (first run)
        if (gravityCentersRef.current.length === 0 && targetGravityCentersRef.current.length > 0) {
          gravityCentersRef.current = targetGravityCentersRef.current.map(t => ({ ...t }));
        }
      }

      // SMOOTH LERP: Actual gravity centers move toward targets every frame
      // This prevents jarring "jolt" when targets recalculate
      // New centers fade IN (start at strength 0), dying centers fade OUT (lerp to 0)
      const targets = targetGravityCentersRef.current;
      const actuals = gravityCentersRef.current;

      // 1. Add new centers with strength 0 (they'll fade in via lerp)
      while (actuals.length < targets.length) {
        const newTarget = targets[actuals.length];
        actuals.push({ x: newTarget.x, y: newTarget.y, strength: 0 }); // Fade in from 0
      }

      // 2. Lerp all actuals toward their targets (or toward 0 for extras)
      for (let i = 0; i < actuals.length; i++) {
        const actual = actuals[i];
        if (i < targets.length) {
          // Active center: lerp toward target
          const target = targets[i];
          actual.x += (target.x - actual.x) * GRAVITY_CENTER_LERP;
          actual.y += (target.y - actual.y) * GRAVITY_CENTER_LERP;
          actual.strength += (target.strength - actual.strength) * GRAVITY_CENTER_LERP;
        } else {
          // Dying center: lerp strength toward 0 (fade out)
          actual.strength += (0 - actual.strength) * GRAVITY_CENTER_LERP;
        }
      }

      // 3. Remove fully faded centers (strength below threshold)
      gravityCentersRef.current = actuals.filter(c => c.strength > GRAVITY_CENTER_FADE_THRESHOLD);

      const centerX = viewport.width / 2;
      const centerY = viewport.height / 2;

      for (const blob of updatedBlobs) {
        // Weak fixed center gravity (fallback to prevent total dispersion)
        const distFromCenter = Math.sqrt(blob.x * blob.x + blob.y * blob.y);
        if (distFromCenter > 50) {
          blob.x -= blob.x * FIXED_CENTER_GRAVITY * deltaMs;
          blob.y -= blob.y * FIXED_CENTER_GRAVITY * deltaMs;
        }

        // Dynamic gravity centers - pull toward where blobs congregate
        for (const center of gravityCentersRef.current) {
          const dx = center.x - blob.x;
          const dy = center.y - blob.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          // Only apply if within influence radius and not too close
          if (dist > 20 && dist < GRAVITY_CENTER_RADIUS * 2) {
            const pull = center.strength * deltaMs / Math.max(50, dist * 0.5);
            blob.x += dx * pull;
            blob.y += dy * pull;
          }
        }

        // Viewport boundary containment - soft edges push blobs back
        const boundaryMargin = 80;  // Smaller margin for more screen use
        const boundaryStrength = 0.00008 * (0.3 + driftFactor * 0.4);
        const viewportX = blob.x + centerX;
        const viewportY = blob.y + centerY;

        if (viewportX < boundaryMargin) {
          blob.x += (boundaryMargin - viewportX) * boundaryStrength * deltaMs;
        }
        if (viewportX > viewport.width - boundaryMargin) {
          blob.x -= (viewportX - (viewport.width - boundaryMargin)) * boundaryStrength * deltaMs;
        }
        if (viewportY < boundaryMargin) {
          blob.y += (boundaryMargin - viewportY) * boundaryStrength * deltaMs;
        }
        if (viewportY > viewport.height - boundaryMargin) {
          blob.y -= (viewportY - (viewport.height - boundaryMargin)) * boundaryStrength * deltaMs;
        }
      }

      // 4. Blob-to-blob direction influence - nearby blobs align velocities
      //    Similar to flocking behavior, creates more organic flow
      //    Uses spatial hash for O(n) lookups when blob count >= threshold
      const useSpatialHash = updatedBlobs.length >= SPATIAL_HASH_MIN_BLOBS;

      for (let i = 0; i < updatedBlobs.length; i++) {
        const blob = updatedBlobs[i];
        if (blob.age < INFLUENCE_MIN_AGE) continue;

        let avgVx = 0;
        let avgVy = 0;
        let neighborCount = 0;

        // Use spatial hash for large counts, naive loop for small counts
        const checkIndices = useSpatialHash
          ? spatialHashRef.current.getNeighborIndices(blob.x, blob.y)
          : updatedBlobs.map((_, idx) => idx);

        for (const j of checkIndices) {
          if (i === j) continue;
          const other = updatedBlobs[j];
          if (other.age < INFLUENCE_MIN_AGE) continue;

          const dx = blob.x - other.x;
          const dy = blob.y - other.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < BLOB_INFLUENCE_RADIUS && distance > 0) {
            // Weight by inverse distance (closer = stronger influence)
            const weight = 1 - (distance / BLOB_INFLUENCE_RADIUS);
            avgVx += other.vx * weight;
            avgVy += other.vy * weight;
            neighborCount += weight;
          }
        }

        // Apply direction influence (blend toward neighbor average)
        if (neighborCount > 0) {
          avgVx /= neighborCount;
          avgVy /= neighborCount;
          blob.vx += (avgVx - blob.vx) * DIRECTION_INFLUENCE_STRENGTH * deltaMs * 0.01;
          blob.vy += (avgVy - blob.vy) * DIRECTION_INFLUENCE_STRENGTH * deltaMs * 0.01;
        }
      }

      // ===== APPLY SPAWN/DEATH (pure state transformation using pre-calculated values) =====
      // spawnCount and shouldKillOldest were calculated outside setBlobs to avoid Strict Mode issues

      // Spawn new blobs
      if (spawnCount > 0) {
        for (let i = 0; i < spawnCount; i++) {
          updatedBlobs.push(createRandomBlob());
        }
      }

      // Kill oldest blob (only if we have enough)
      if (shouldKillOldest && updatedBlobs.length > 20) {
        const oldestIndex = updatedBlobs.reduce((oldest, blob, idx) =>
          blob.age > updatedBlobs[oldest].age ? idx : oldest, 0);
        updatedBlobs.splice(oldestIndex, 1);
      }

      // Recycle blobs that have left the viewport
      updatedBlobs = recycleBlobsAtEdge(updatedBlobs, viewport.width, viewport.height, 200);

      // Emergency re-seed if we're running critically low
      if (updatedBlobs.length < 10) {
        for (let i = 0; i < 20; i++) {
          updatedBlobs.push(createRandomBlob());
        }
      }

      // Hard cap - emergency cull if soft cap fails to maintain equilibrium
      // This should rarely trigger now that soft cap is in place
      if (updatedBlobs.length > HARD_CAP_LIMIT) {
        updatedBlobs = updatedBlobs
          .sort((a, b) => a.age - b.age)
          .slice(-HARD_CAP_TARGET);
      }

      // Update population ref for soft cap calculation next frame
      populationRef.current = updatedBlobs.length;

      // Final rebuild of spatial hash after all modifications (for render functions)
      spatialHashRef.current.rebuild(updatedBlobs);
      spatialHashBlobsRef.current = updatedBlobs;

      return updatedBlobs;
    });

    animationRef.current = requestAnimationFrame(animate);
  }, [config, features, viewport, intensity, isPaused, createRandomBlob, energyMetric]);

  // Start/stop animation
  useEffect(() => {
    animationRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [animate]);

  // Calculate display size with cluster variation and audio reactivity
  const getDisplaySize = (blob: WaveFrontBlob, index: number) => {
    // Assign blob to one of 3 clusters based on its ID
    const clusterIndex = getClusterIndex(blob.id);
    const cluster = CLUSTERS[clusterIndex];

    // Base size with cluster multiplier
    // Cluster 2 (large/slow) gets EXTRA size boost from energy metric
    const energySizeBoost = clusterIndex === 2 ? (1 + energyMetric * 0.8) : 1; // Up to 1.8x for cluster 2
    const baseSize = blob.size * cluster.sizeMultiplier * energySizeBoost;

    // Per-blob variation using index for uniqueness (±15%)
    const blobVariation = 1 + Math.sin(index * 1.7) * 0.15;

    // BASS THUMP: Strong size pulse on bass hits (80% boost at max)
    const bassThump = 1 + features.bass * 0.8;

    // Amplitude affects all blobs (additional pulse, 50% boost)
    const amplitudeBoost = 1 + features.amplitude * 0.5;

    // Mids create per-blob wobble (different phase per blob, stronger)
    const midWobble = 1 + features.mid * 0.35 * Math.sin(elapsedRef.current * 0.004 + index * 0.5);

    // Breathing effect - stronger at low BPM (calm state)
    const breathingAmount = (1 - bpmNormalized) * getSizeBreathingMultiplier(elapsedRef.current, index);
    const breathingMultiplier = 1 + (breathingAmount - 1) * (1 - bpmNormalized);

    // Cluster-wide pulsing - DISABLED for now
    // const clusterPulseMultiplier = getClusterPulseMultiplier(clusterIndex, elapsedRef.current);
    const clusterPulseMultiplier = 1.0;

    // Neighbor size influence - nearby larger blobs make this blob slightly larger
    // Uses spatial hash for O(n) lookups when blob count >= threshold
    let neighborSizeInfluence = 1.0;
    if (blob.age >= INFLUENCE_MIN_AGE) {
      // Ensure spatial hash is current for this render pass (only if using it)
      const useSpatialHash = blobs.length >= SPATIAL_HASH_MIN_BLOBS;
      if (useSpatialHash && spatialHashBlobsRef.current !== blobs) {
        spatialHashRef.current.rebuild(blobs);
        spatialHashBlobsRef.current = blobs;
      }

      let totalInfluence = 0;
      let totalWeight = 0;

      // Use spatial hash for large counts, naive loop for small counts
      const checkIndices = useSpatialHash
        ? spatialHashRef.current.getNeighborIndices(blob.x, blob.y)
        : blobs.map((_, idx) => idx);

      for (const i of checkIndices) {
        if (i === index) continue;
        const other = blobs[i];
        if (other.age < INFLUENCE_MIN_AGE) continue;

        const dx = blob.x - other.x;
        const dy = blob.y - other.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < BLOB_INFLUENCE_RADIUS && distance > 0) {
          const weight = 1 - (distance / BLOB_INFLUENCE_RADIUS);
          // Compare sizes - if neighbor is larger, influence is positive
          const sizeRatio = other.size / blob.size;
          totalInfluence += (sizeRatio - 1) * weight;
          totalWeight += weight;
        }
      }

      if (totalWeight > 0) {
        const avgInfluence = totalInfluence / totalWeight;
        // Apply gentle size influence (larger neighbors = slightly bigger)
        neighborSizeInfluence = 1 + avgInfluence * SIZE_INFLUENCE_STRENGTH;
        // Clamp to reasonable range
        neighborSizeInfluence = Math.max(0.8, Math.min(1.2, neighborSizeInfluence));
      }
    }

    return baseSize * blobVariation * bassThump * amplitudeBoost * midWobble * breathingMultiplier * clusterPulseMultiplier * neighborSizeInfluence;
  };

  // Calculate base HSL color for a blob (without neighbor blending)
  // 75% frequency mix (bass/mids/treble) + 25% intensity influence
  // Bass = dark purple, Mids = purple→pink, Treble = pink→coral→orange
  // High intensity + all frequencies = bright yellow/white (especially cluster 2)
  const getBlobBaseHSL = (blob: WaveFrontBlob): { h: number; s: number; l: number } => {
    const clusterIndex = getClusterIndex(blob.id);
    const bias = CLUSTER_FREQUENCY_BIAS[clusterIndex];

    // Apply cluster bias to frequency values
    const bass = features.bass * bias.bassWeight;
    const mids = features.mid * bias.midsWeight;
    const treble = features.treble * bias.trebleWeight;
    const totalFreq = bass + mids + treble + 0.001; // Avoid division by zero

    // Normalize to get frequency mix ratios (0-1 each, sum to 1)
    const bassRatio = bass / totalFreq;
    const midsRatio = mids / totalFreq;
    const trebleRatio = treble / totalFreq;

    // Calculate weighted hue from frequency mix (75% of color)
    // Handle hue wrapping: treble (25°) is near bass (270°) on the color wheel
    // Convert to vectors to average properly across the 0°/360° boundary
    const bassAngle = HUE_BASS * Math.PI / 180;
    const midsAngle = HUE_MIDS * Math.PI / 180;
    const trebleAngle = HUE_TREBLE * Math.PI / 180;

    const x = bassRatio * Math.cos(bassAngle) + midsRatio * Math.cos(midsAngle) + trebleRatio * Math.cos(trebleAngle);
    const y = bassRatio * Math.sin(bassAngle) + midsRatio * Math.sin(midsAngle) + trebleRatio * Math.sin(trebleAngle);
    let frequencyHue = Math.atan2(y, x) * 180 / Math.PI;
    if (frequencyHue < 0) frequencyHue += 360;

    // Intensity influence (25% of color) - pushes toward warmer hues
    // RAISED BAR: Only shifts significantly at high intensity (squared for higher threshold)
    // Max ~30° hue shift, but requires high intensity to get there
    const intensityHueShift = Math.pow(intensity, 1.5) * 30;

    // Combine: 75% frequency + 25% intensity
    let baseHue = frequencyHue * 0.75 + (frequencyHue + intensityHueShift) * 0.25;

    // Per-blob variation (±15° based on colorIndex)
    const blobHueVariation = ((blob.colorIndex % 5) - 2) * 6;
    baseHue = ((baseHue + blobHueVariation) % 360 + 360) % 360;

    // "All high" bright mode: when intensity AND all frequencies are elevated
    // Cluster 2 (treble-leaning) goes brightest, others get a boost too
    const allHigh = Math.min(features.bass, features.mid, features.treble);
    const brightFactor = allHigh * intensity; // 0-1 scale, only high when BOTH conditions met

    // Cluster 2 can reach yellow (50°), others shift slightly toward it
    const brightShift = clusterIndex === 2
      ? brightFactor * (HUE_BRIGHT - baseHue) * 0.6  // Strong shift to yellow
      : brightFactor * 15;  // Subtle warm shift for other clusters
    baseHue = ((baseHue + brightShift) % 360 + 360) % 360;

    // SATURATION: Rich and deep
    // Base 60% when quiet, needs high bass/intensity to go neon
    const baseSaturation = 60 + features.bass * 20 + Math.pow(intensity, 1.3) * 20;

    // LIGHTNESS: Darker base, raised bar for brightness
    // Base 38% (darker purple), requires high treble+intensity to brighten
    // Uses power curve so low values stay dark, only high values go bright
    const baseLightness = 38 + features.treble * 12 + Math.pow(intensity, 1.4) * 25;
    // "All high" brightness boost requires even higher threshold
    const brightLightnessBoost = clusterIndex === 2 ? Math.pow(brightFactor, 1.2) * 30 : Math.pow(brightFactor, 1.2) * 15;
    const lightness = Math.min(88, baseLightness + brightLightnessBoost);

    return { h: baseHue, s: Math.min(100, baseSaturation), l: lightness };
  };

  // Dynamic color with neighbor blending - blobs become more similar when close
  // Uses spatial hash for O(n) lookups when blob count >= threshold
  const getDynamicColor = (blob: WaveFrontBlob, index: number) => {
    const baseColor = getBlobBaseHSL(blob);

    // Skip blending for young blobs - prevents "infection" in spawn pool
    if (blob.age < INFLUENCE_MIN_AGE) {
      return `hsl(${baseColor.h}, ${baseColor.s}%, ${baseColor.l}%)`;
    }

    // Ensure spatial hash is current for this render pass (only if using it)
    const useSpatialHash = blobs.length >= SPATIAL_HASH_MIN_BLOBS;
    if (useSpatialHash && spatialHashBlobsRef.current !== blobs) {
      spatialHashRef.current.rebuild(blobs);
      spatialHashBlobsRef.current = blobs;
    }

    // Find nearby blobs and calculate weighted color influence
    let totalWeight = 0;
    let weightedHue = 0;
    let weightedSat = 0;
    let weightedLight = 0;

    // Use spatial hash for large counts, naive loop for small counts
    const checkIndices = useSpatialHash
      ? spatialHashRef.current.getNeighborIndices(blob.x, blob.y)
      : blobs.map((_, idx) => idx);

    for (const i of checkIndices) {
      if (i === index) continue; // Skip self

      const other = blobs[i];

      // Only blend with other mature blobs
      if (other.age < INFLUENCE_MIN_AGE) continue;

      const dx = blob.x - other.x;
      const dy = blob.y - other.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < BLOB_INFLUENCE_RADIUS) {
        // Weight falls off with distance (1 at center, 0 at radius edge)
        const weight = 1 - (distance / BLOB_INFLUENCE_RADIUS);
        const otherColor = getBlobBaseHSL(other);

        // Handle hue wrapping (e.g., 350° and 10° should average to 0°, not 180°)
        let hueDiff = otherColor.h - baseColor.h;
        if (hueDiff > 180) hueDiff -= 360;
        if (hueDiff < -180) hueDiff += 360;

        weightedHue += hueDiff * weight;
        weightedSat += otherColor.s * weight;
        weightedLight += otherColor.l * weight;
        totalWeight += weight;
      }
    }

    // Blend toward neighbor average if there are nearby blobs
    let finalHue = baseColor.h;
    let finalSat = baseColor.s;
    let finalLight = baseColor.l;

    if (totalWeight > 0) {
      const avgHueOffset = weightedHue / totalWeight;
      const avgSat = weightedSat / totalWeight;
      const avgLight = weightedLight / totalWeight;

      // Apply blending (strength determines how much we move toward neighbors)
      const blendFactor = Math.min(totalWeight * 0.3, 1) * COLOR_BLEND_STRENGTH;
      finalHue = (baseColor.h + avgHueOffset * blendFactor + 360) % 360;
      finalSat = baseColor.s + (avgSat - baseColor.s) * blendFactor;
      finalLight = baseColor.l + (avgLight - baseColor.l) * blendFactor;
    }

    return `hsl(${finalHue}, ${finalSat}%, ${finalLight}%)`;
  };

  const centerX = viewport.width / 2;
  const centerY = viewport.height / 2;

  // Dynamic background color based on BPM + inertia intensity
  // Interpolate between calm purple tint and energetic dark
  // Inertia intensity adds sustained energy glow (saturation boost)
  const bgLightness = 10 + bpmNormalized * 4 + inertiaIntensity * 3;  // Up to 17% with sustained energy
  const bgSaturation = 20 - bpmNormalized * 10 + inertiaIntensity * 15; // Inertia adds up to 15% saturation
  const backgroundColor = `hsl(270, ${Math.min(35, bgSaturation)}%, ${Math.min(18, bgLightness)}%)`;

  return (
    <div style={{ ...styles.container, backgroundColor }} onClick={handleBackgroundClick}>
      {/* Control Panel - stop propagation so clicks here don't toggle pause */}
      <div style={styles.controlPanel} onClick={(e) => e.stopPropagation()}>
        <h1 style={styles.title}>Blobulator</h1>

        {error && <p style={styles.error}>{error}</p>}

        <button
          onClick={isListening ? stopListening : startListening}
          style={{
            ...styles.button,
            ...(isListening ? styles.buttonStop : styles.buttonStart),
          }}
        >
          {isListening ? 'Stop Listening' : 'Start Microphone'}
        </button>

        {isListening && (
          <div style={styles.meterContainer}>
            {[
              { label: 'Amp', value: features.amplitude, color: '#ec4899' },
              { label: 'Bass', value: features.bass, color: '#ef4444' },
              { label: 'Mid', value: features.mid, color: '#f97316' },
              { label: 'Treble', value: features.treble, color: '#eab308' },
            ].map(({ label, value, color }) => (
              <div key={label} style={styles.meterRow}>
                <span style={styles.meterLabel}>{label}:</span>
                <div style={styles.meterBg}>
                  <div
                    style={{
                      height: '100%',
                      backgroundColor: color,
                      width: `${value * 100}%`,
                      transition: 'width 75ms',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        <p style={styles.stats}>
          {bpmNormalized < 0.3 ? '🌊' : bpmNormalized < 0.7 ? '🔥' : '💥'} {blobs.length} blobs | {displayTime}s
        </p>
        {isListening && (
          <>
            <p style={{ ...styles.stats, fontSize: 10, marginTop: 4 }}>
              BPM: {bpm} {bpmConfidence > 0.5 ? '✓' : '~'} | Style: {(bpmNormalized * 100).toFixed(0)}%
            </p>
            <p style={{ ...styles.stats, fontSize: 10, marginTop: 2 }}>
              Intensity: {(intensity * 100).toFixed(0)}% | Inertia: {(inertiaIntensity * 100).toFixed(0)}%
            </p>
          </>
        )}
      </div>

      {/* Blob Visualization with Gooey SVG Filter */}
      <svg style={styles.svg} viewBox={`0 0 ${viewport.width} ${viewport.height}`}>
        <defs>
          {/* Gooey metaball filter - matches brf-auto "strong" intensity WITHOUT composite
              (no feComposite = internal blobs merge together, not just at edges) */}
          <filter id="goo" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation="16" />
            <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 96 -48" />
          </filter>
        </defs>

        <g filter="url(#goo)">
          {blobs.map((blob, index) => (
            <circle
              key={blob.id}
              cx={centerX + blob.x}
              cy={centerY + blob.y}
              r={getDisplaySize(blob, index)}
              fill={getDynamicColor(blob, index)}
            />
          ))}
        </g>

        {/* Gravity center indicators - dots showing where blobs congregate */}
        {/* Opacity fades with strength (fade-in/fade-out effect) */}
        {gravityCentersRef.current.map((center, i) => {
          const opacity = Math.min(1, center.strength / GRAVITY_CENTER_STRENGTH);
          return (
            <circle
              key={`gravity-${i}`}
              cx={centerX + center.x}
              cy={centerY + center.y}
              r={6}
              fill={`rgba(255, 255, 255, ${opacity})`}
              stroke={`rgba(0, 0, 0, ${opacity * 0.6})`}
              strokeWidth={2}
            />
          );
        })}
      </svg>
    </div>
  );
}
