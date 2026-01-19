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
import { useAdaptiveAudio } from './useAdaptiveAudio';

// 3 Cluster configurations - different sizes and speeds
const CLUSTERS = [
  { sizeMultiplier: 0.7, speedMultiplier: 1.4, centerOffset: { x: -150, y: -100 } },  // Small & fast
  { sizeMultiplier: 1.0, speedMultiplier: 1.0, centerOffset: { x: 0, y: 50 } },       // Medium & normal
  { sizeMultiplier: 1.5, speedMultiplier: 0.6, centerOffset: { x: 180, y: -50 } },    // Large & slow
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
const CLUSTER_FREQUENCY_BIAS = [
  { bassWeight: 1.2, midsWeight: 1.0, trebleWeight: 0.8 },  // Cluster 0: Bass-leaning (darker purples)
  { bassWeight: 0.9, midsWeight: 1.3, trebleWeight: 0.9 },  // Cluster 1: Mids-leaning (more pinks)
  { bassWeight: 0.7, midsWeight: 0.9, trebleWeight: 1.4 },  // Cluster 2: Treble-leaning (oranges, can go yellow)
];

// Hue anchors for frequency bands
const HUE_BASS = 270;       // Dark purple
const HUE_MIDS = 310;       // Purple-pink
const HUE_TREBLE = 25;      // Coral-orange (wraps around 0°)
const HUE_BRIGHT = 50;      // Yellow-ish for "all high" state

// BPM normalization - maps BPM to 0-1 scale for smooth animation blending
// Low BPM (60-90) = calm/cool, High BPM (140-180) = energetic/warm
const BPM_MIN = 70;   // Below this = fully calm (0)
const BPM_MAX = 150;  // Above this = fully energetic (1)

// Spawning lifecycle configuration
// Phase 1: Seed the stage with diminishing spawns
// Phase 2: Intensity-driven spawn/death equilibrium
const SEED_BLOBS_INITIAL = 50;        // First second: spawn 50 blobs
const SEED_DECAY_FACTOR = 0.4;        // Each second: spawn 40% of previous (50→20→8→3...)
const SEED_DURATION_SECONDS = 5;       // Seeding phase lasts 5 seconds
const SPAWN_RATE_CALM = 0.5;          // Blobs/second when intensity < 70%
const SPAWN_RATE_INTENSE = 3;         // Blobs/second when intensity > 70%
const DEATH_RATE_CALM = 0.3;          // Blobs/second dying when intensity < 70% (gentle decline)
const DEATH_RATE_INTENSE = 0.2;       // Blobs/second dying when intensity > 70% (barely any)
const INTENSITY_THRESHOLD = 0.7;      // Below this: slightly more die than spawn

// Note: Cluster pulsing constants removed (feature disabled)
// Can be re-added from git history if needed

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
    backgroundColor: 'rgba(39, 39, 42, 0.95)',
    borderRadius: 12,
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

export function Blobulator() {
  // Initialize with 50 blobs immediately (no timing dependencies)
  const [blobs, setBlobs] = useState<WaveFrontBlob[]>(() =>
    Array.from({ length: SEED_BLOBS_INITIAL }, () => createBlob(DEFAULT_CONFIG.baseBlobSize))
  );
  const [config] = useState<BlobFieldConfig>(DEFAULT_CONFIG);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [isPaused, setIsPaused] = useState(false);
  const {
    isListening,
    error,
    features,
    intensity,
    inertiaIntensity,
    bpm,
    bpmConfidence,
    adaptiveThreshold,
    startListening,
    stopListening,
  } = useAdaptiveAudio();

  const animationRef = useRef<number | null>(null);
  const lastSpawnRef = useRef<number>(0);
  const lastDeathRef = useRef<number>(0);
  const elapsedRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);
  const lastDisplayUpdateRef = useRef<number>(0);

  // Seeding phase state
  const seedingStartTimeRef = useRef<number>(0);
  const lastSeedSecondRef = useRef<number>(-1);  // Track which second of seeding we're in

  // Display time (updated once per second to avoid excessive re-renders)
  const [displayTime, setDisplayTime] = useState(0);

  // BPM normalized to 0-1 scale (changes slowly, good for color/style blending)
  // Low BPM (70) = 0 (calm), High BPM (150) = 1 (energetic)
  const bpmNormalized = Math.max(0, Math.min(1, (bpm - BPM_MIN) / (BPM_MAX - BPM_MIN)));

  // Create a new blob at random position near center
  const createRandomBlob = useCallback((): WaveFrontBlob => {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * 150 + 50;  // 50-200px from center
    return {
      id: `blob-${Math.random().toString(36).slice(2, 11)}`,
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
      direction: Math.random() * Math.PI * 2,
      generation: 0,
      size: config.baseBlobSize * (0.8 + Math.random() * 0.4),  // ±20% size variation
      age: 0,
      isFrontier: true,
      colorIndex: Math.floor(Math.random() * 5),
    };
  }, [config.baseBlobSize]);

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

      // BPM boost: higher BPM = faster spawn (up to 80% boost at max BPM)
      const bpmSpawnBoost = 1 + bpmNormalized * 0.8;
      // BPM also slightly reduces death rate at high tempos (keeps population up)
      const bpmDeathReduction = 1 - bpmNormalized * 0.3;

      // Bass boost: strong bass doubles spawn rate
      const bassBoost = features.bass > 0.5 ? 2 : 1;

      const effectiveSpawnRate = baseSpawnRate * bassBoost * bpmSpawnBoost;
      const effectiveDeathRate = baseDeathRate * bpmDeathReduction;

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

      // ===== FULLY UNIFIED MOTION: All behaviors blend smoothly =====
      // No thresholds, no mode switches - just continuous scaling

      // Blend factors based on INTENSITY (responsive to music energy)
      // Intensity changes with the music = visible difference in animation style
      const driftFactor = 1 - intensity * 0.8;           // 1.0 → 0.2 (mostly drift when quiet)
      const expansionFactor = 0.05 + intensity * 0.95;   // 0.05 → 1.0 (mostly expansion when loud)
      const midSpeedBoost = 1 + features.mid * 0.5;

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
        updateBlobVelocity(
          blob,
          dynamicConfig,
          elapsedRef.current,
          0.8 * cluster.speedMultiplier * midSpeedBoost * expansionFactor
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

      // Center gravity - gentle pull, keeps blobs from dispersing too far
      const centerGravityBase = 0.0000032;  // 2.5x reduction from 0.000008
      const centerGravityBpmBoost = 0.000006;  // Scaled proportionally
      const centerGravityStrength = centerGravityBase + bpmNormalized * centerGravityBpmBoost;

      const centerX = viewport.width / 2;
      const centerY = viewport.height / 2;

      for (const blob of updatedBlobs) {
        const distFromCenter = Math.sqrt(blob.x * blob.x + blob.y * blob.y);
        if (distFromCenter > 30) {
          blob.x -= blob.x * centerGravityStrength * deltaMs;
          blob.y -= blob.y * centerGravityStrength * deltaMs;
        }

        // Viewport boundary containment - soft edges push blobs back
        // Reduced margin lets blobs use more of the screen
        const boundaryMargin = 100;  // Reduced from 200 - blobs can go closer to edges
        const boundaryStrength = 0.00006 * (0.3 + driftFactor * 0.4); // Gentler push
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
      for (let i = 0; i < updatedBlobs.length; i++) {
        const blob = updatedBlobs[i];
        if (blob.age < INFLUENCE_MIN_AGE) continue;

        let avgVx = 0;
        let avgVy = 0;
        let neighborCount = 0;

        for (let j = 0; j < updatedBlobs.length; j++) {
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

      // Limit total blob count for performance
      if (updatedBlobs.length > 300) {
        updatedBlobs = updatedBlobs
          .sort((a, b) => a.age - b.age)
          .slice(-250);
      }

      return updatedBlobs;
    });

    animationRef.current = requestAnimationFrame(animate);
  }, [config, features, viewport, intensity, isPaused, createRandomBlob]);

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
    const baseSize = blob.size * cluster.sizeMultiplier;

    // Per-blob variation using index for uniqueness (±15%)
    const blobVariation = 1 + Math.sin(index * 1.7) * 0.15;

    // Amplitude affects all blobs (pulse effect)
    const amplitudeBoost = 1 + features.amplitude * 0.4;

    // Mids create subtle per-blob wobble (different phase per blob)
    const midWobble = 1 + features.mid * 0.2 * Math.sin(elapsedRef.current * 0.003 + index * 0.5);

    // Breathing effect - stronger at low BPM (calm state)
    const breathingAmount = (1 - bpmNormalized) * getSizeBreathingMultiplier(elapsedRef.current, index);
    const breathingMultiplier = 1 + (breathingAmount - 1) * (1 - bpmNormalized);

    // Cluster-wide pulsing - DISABLED for now
    // const clusterPulseMultiplier = getClusterPulseMultiplier(clusterIndex, elapsedRef.current);
    const clusterPulseMultiplier = 1.0;

    // Neighbor size influence - nearby larger blobs make this blob slightly larger
    let neighborSizeInfluence = 1.0;
    if (blob.age >= INFLUENCE_MIN_AGE) {
      let totalInfluence = 0;
      let totalWeight = 0;

      for (let i = 0; i < blobs.length; i++) {
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

    return baseSize * blobVariation * amplitudeBoost * midWobble * breathingMultiplier * clusterPulseMultiplier * neighborSizeInfluence;
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
    // Higher intensity = shift toward pink/orange (add ~40° at max intensity)
    const intensityHueShift = intensity * 40;

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

    // Saturation: high bass = richer, high intensity = more neon
    const baseSaturation = 65 + features.bass * 15 + intensity * 20;

    // Lightness: base 50%, brighter with treble and intensity
    // "All high" pushes toward white (up to 85% lightness for cluster 2)
    const baseLightness = 50 + features.treble * 10 + intensity * 10;
    const brightLightnessBoost = clusterIndex === 2 ? brightFactor * 20 : brightFactor * 10;
    const lightness = Math.min(85, baseLightness + brightLightnessBoost);

    return { h: baseHue, s: Math.min(100, baseSaturation), l: lightness };
  };

  // Dynamic color with neighbor blending - blobs become more similar when close
  const getDynamicColor = (blob: WaveFrontBlob, index: number) => {
    const baseColor = getBlobBaseHSL(blob);

    // Skip blending for young blobs - prevents "infection" in spawn pool
    if (blob.age < INFLUENCE_MIN_AGE) {
      return `hsl(${baseColor.h}, ${baseColor.s}%, ${baseColor.l}%)`;
    }

    // Find nearby blobs and calculate weighted color influence
    let totalWeight = 0;
    let weightedHue = 0;
    let weightedSat = 0;
    let weightedLight = 0;

    for (let i = 0; i < blobs.length; i++) {
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
      </svg>
    </div>
  );
}
