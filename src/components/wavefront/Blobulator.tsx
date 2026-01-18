/**
 * Blobulator - Audio-Reactive Metaball Visualization
 *
 * Unified intensity-based animation system:
 * - Behaviors blend smoothly on a 0-1 intensity scale (no binary mode switching)
 * - Low intensity: Calm ambient swirling with center gravity
 * - High intensity: Active wavefront expansion with faster spawning
 * - Center gravity always active, strength scales with intensity
 *
 * Audio reactivity:
 * - Intensity (energy + derivative) drives all animation blending
 * - BPM detected for tempo-synced effects
 * - Bass affects spawn rate and hue warmth
 * - Treble shifts hue toward cooler tones
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { WaveFrontBlob, BlobFieldConfig } from './types';
import { DEFAULT_CONFIG } from './types';
import {
  generateInitialBlobs,
  spawnFromFrontier,
  updateBlobPosition,
  updateBlobVelocity,
  recycleBlobsAtEdge,
} from './physics';
import { applyDriftToBlobs, getSizeBreathingMultiplier } from './drift';
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

// Cluster color palettes - shift based on intensity
// Low intensity (calm): Cool colors (purple, blue, teal, turquoise)
// High intensity (energetic): Warm colors (neon pink, magenta, orange)
const CLUSTER_HUE_RANGES_COOL = [
  { base: 270, spread: 30 },   // Cluster 0: Purple/violet
  { base: 200, spread: 25 },   // Cluster 1: Teal/turquoise
  { base: 230, spread: 25 },   // Cluster 2: Blue
];
const CLUSTER_HUE_RANGES_WARM = [
  { base: 320, spread: 25 },   // Cluster 0: Neon pink/magenta
  { base: 345, spread: 20 },   // Cluster 1: Rose/hot pink
  { base: 25, spread: 30 },    // Cluster 2: Orange/coral
];

// Cluster size pulsing configuration
// Each cluster randomly grows or shrinks on its own schedule
const PULSE_DURATION_MS = 1000;        // 1 second to complete pulse
const PULSE_INTERVAL_MIN_MS = 3000;    // Minimum 3 seconds between pulses
const PULSE_INTERVAL_MAX_MS = 6000;    // Maximum 6 seconds between pulses
const PULSE_GROW_SCALE = 1.5;          // Grow to 150% size
const PULSE_SHRINK_SCALE = 0.75;       // Shrink to 75% size

interface ClusterPulseState {
  targetScale: number;      // 1.0, 1.5, or 0.75
  pulseStartTime: number;   // When current pulse started
  nextPulseTime: number;    // When to trigger next pulse
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

export function Blobulator() {
  const [blobs, setBlobs] = useState<WaveFrontBlob[]>([]);
  const [config] = useState<BlobFieldConfig>(DEFAULT_CONFIG);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const {
    isListening,
    error,
    features,
    intensity,
    bpm,
    bpmConfidence,
    adaptiveThreshold,
    stats,
    startListening,
    stopListening,
  } = useAdaptiveAudio();

  const animationRef = useRef<number | null>(null);
  const lastSpawnRef = useRef<number>(0);
  const elapsedRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);

  // Cluster pulse state - each cluster pulses independently
  const clusterPulsesRef = useRef<ClusterPulseState[]>([
    { targetScale: 1.0, pulseStartTime: 0, nextPulseTime: 2000 },
    { targetScale: 1.0, pulseStartTime: 0, nextPulseTime: 3500 },
    { targetScale: 1.0, pulseStartTime: 0, nextPulseTime: 5000 },
  ]);

  // Calculate current pulse multiplier for a cluster with smooth easing
  const getClusterPulseMultiplier = useCallback((clusterIndex: number, elapsed: number): number => {
    const pulse = clusterPulsesRef.current[clusterIndex];

    // Check if it's time to start a new pulse
    if (elapsed >= pulse.nextPulseTime && pulse.targetScale === 1.0) {
      // Start new pulse - randomly grow or shrink
      pulse.targetScale = Math.random() > 0.5 ? PULSE_GROW_SCALE : PULSE_SHRINK_SCALE;
      pulse.pulseStartTime = elapsed;
    }

    // If not pulsing, return 1.0
    if (pulse.targetScale === 1.0) {
      return 1.0;
    }

    // Calculate pulse progress (0 to 1)
    const pulseElapsed = elapsed - pulse.pulseStartTime;
    const progress = Math.min(1, pulseElapsed / PULSE_DURATION_MS);

    // Ease in-out for smooth animation
    const easedProgress = progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;

    // Pulse goes: 1.0 → target → 1.0 (there and back)
    let multiplier: number;
    if (easedProgress < 0.5) {
      // Going toward target
      multiplier = 1.0 + (pulse.targetScale - 1.0) * (easedProgress * 2);
    } else {
      // Returning to normal
      multiplier = pulse.targetScale + (1.0 - pulse.targetScale) * ((easedProgress - 0.5) * 2);
    }

    // Pulse complete - schedule next one
    if (progress >= 1) {
      pulse.targetScale = 1.0;
      const randomInterval = PULSE_INTERVAL_MIN_MS +
        Math.random() * (PULSE_INTERVAL_MAX_MS - PULSE_INTERVAL_MIN_MS);
      pulse.nextPulseTime = elapsed + randomInterval;
    }

    return multiplier;
  }, []);

  // Intensity (0-1) drives all animation blending - no binary mode switching
  // BPM detection provides tempo for future rhythm-synced effects

  // Initialize blobs
  useEffect(() => {
    const initialBlobs = generateInitialBlobs(0, 0, config);
    setBlobs(initialBlobs);
    lastFrameRef.current = performance.now();
  }, [config]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Animation loop - blends behaviors based on intensity (0-1)
  const animate = useCallback((timestamp: number) => {
    const deltaMs = timestamp - lastFrameRef.current;
    lastFrameRef.current = timestamp;
    elapsedRef.current += deltaMs;

    setBlobs(currentBlobs => {
      let updatedBlobs = [...currentBlobs];

      // ===== UNIFIED MOTION: Blend drift and expansion based on intensity =====

      // 1. ALWAYS apply drift physics (swirling, direction wobble)
      //    Strength scales inversely with intensity (stronger when calm)
      const driftStrength = 1 - intensity * 0.7; // 1.0 at calm, 0.3 at max intensity
      if (driftStrength > 0.1) {
        updatedBlobs = applyDriftToBlobs(
          updatedBlobs,
          deltaMs * driftStrength,
          elapsedRef.current,
          viewport.width,
          viewport.height
        );
      }

      // 2. ALWAYS apply expansion physics (velocity toward edge)
      //    Strength scales with intensity
      const expansionStrength = intensity;
      if (expansionStrength > 0.1) {
        // Mids affect speed - higher mids = faster movement
        const midSpeedBoost = 1 + features.mid * 0.5;

        for (const blob of updatedBlobs) {
          const cluster = CLUSTERS[getClusterIndex(blob.id)];
          // Scale velocity update by intensity
          updateBlobVelocity(
            blob,
            config,
            elapsedRef.current,
            0.8 * cluster.speedMultiplier * midSpeedBoost * expansionStrength
          );
          updateBlobPosition(blob);
        }
      }

      // 3. ALWAYS apply center gravity - keeps blobs from dispersing too far
      //    Stronger at HIGH intensity (creates "frenzy concentrated in middle")
      const centerGravityBase = 0.00002;  // Gentle base pull
      const centerGravityIntensityBoost = 0.00008;  // Additional pull at max intensity
      const centerGravityStrength = centerGravityBase + intensity * centerGravityIntensityBoost;

      for (const blob of updatedBlobs) {
        const distFromCenter = Math.sqrt(blob.x * blob.x + blob.y * blob.y);
        if (distFromCenter > 30) {
          blob.x -= blob.x * centerGravityStrength * deltaMs;
          blob.y -= blob.y * centerGravityStrength * deltaMs;
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

      // 5. Spawning - rate scales with intensity and bass
      //    Even at low intensity, occasional spawning keeps things alive
      const baseSpawnInterval = config.spawnIntervalMs;
      const intensitySpawnBoost = intensity * 400;  // Faster spawning at high intensity
      const bassSpawnBoost = features.bass * 200;   // Bass hits trigger spawns
      const spawnInterval = Math.max(150, baseSpawnInterval - intensitySpawnBoost - bassSpawnBoost);

      if (elapsedRef.current - lastSpawnRef.current > spawnInterval) {
        const frontier = updatedBlobs.filter(b => b.isFrontier);
        if (frontier.length > 0) {
          const newBlobs = spawnFromFrontier(frontier, config);
          updatedBlobs = [...updatedBlobs, ...newBlobs];
        }
        lastSpawnRef.current = elapsedRef.current;
      }

      // Recycle blobs that have left the viewport
      updatedBlobs = recycleBlobsAtEdge(updatedBlobs, viewport.width, viewport.height, 200);

      // Re-seed if we're running low on blobs
      if (updatedBlobs.length < 50) {
        const newCoreBlobs = generateInitialBlobs(0, 0, config);
        updatedBlobs = [...updatedBlobs, ...newCoreBlobs];
      }

      // Limit total blob count for performance
      if (updatedBlobs.length > 500) {
        updatedBlobs = updatedBlobs
          .sort((a, b) => a.age - b.age)
          .slice(-400);
      }

      return updatedBlobs;
    });

    animationRef.current = requestAnimationFrame(animate);
  }, [config, features, viewport, intensity]);

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

    // Breathing effect - stronger at low intensity (calm state)
    const breathingAmount = (1 - intensity) * getSizeBreathingMultiplier(elapsedRef.current, index);
    const breathingMultiplier = 1 + (breathingAmount - 1) * (1 - intensity);

    // Cluster-wide pulsing - each cluster grows/shrinks together every 3-6s
    const clusterPulseMultiplier = getClusterPulseMultiplier(clusterIndex, elapsedRef.current);

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
  // Color shifts based on intensity: cool (purple/blue/teal) → warm (pink/orange)
  const getBlobBaseHSL = (blob: WaveFrontBlob): { h: number; s: number; l: number } => {
    const clusterIndex = getClusterIndex(blob.id);
    const coolRange = CLUSTER_HUE_RANGES_COOL[clusterIndex];
    const warmRange = CLUSTER_HUE_RANGES_WARM[clusterIndex];

    // Interpolate between cool and warm hue ranges based on intensity
    // Use easeInOut curve for smoother transitions
    const easedIntensity = intensity < 0.5
      ? 2 * intensity * intensity
      : 1 - Math.pow(-2 * intensity + 2, 2) / 2;

    // Handle hue interpolation (wrapping around 360°)
    let coolBase = coolRange.base;
    let warmBase = warmRange.base;
    // If warm is near 0° and cool is near 360°, adjust for shortest path
    if (warmBase < 60 && coolBase > 200) {
      warmBase += 360; // e.g., 25° → 385°
    }
    const interpolatedBase = coolBase + (warmBase - coolBase) * easedIntensity;
    const baseHue = ((interpolatedBase % 360) + 360) % 360;

    // Spread also interpolates
    const spread = coolRange.spread + (warmRange.spread - coolRange.spread) * easedIntensity;

    // Per-blob variation within cluster's spread
    const blobHueVariation = (blob.colorIndex % 5) * (spread / 5);

    // Bass/treble shifts add subtle audio-reactive color changes
    const audioHueShift = (features.bass - features.treble) * 20;
    const hue = ((baseHue + blobHueVariation + audioHueShift) % 360 + 360) % 360;

    // Saturation and lightness increase with intensity for that neon pop
    const baseSaturation = 70 + intensity * 20;  // 70% calm → 90% intense
    const saturation = baseSaturation + features.amplitude * 10;
    const lightness = 50 + intensity * 10 + features.amplitude * 10;  // 50-70%

    return { h: hue, s: Math.min(100, saturation), l: Math.min(75, lightness) };
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

  // Dynamic background color based on intensity
  // Interpolate between calm purple tint and energetic dark
  const bgLightness = 10 + intensity * 4;  // 10% at calm, 14% at max
  const bgSaturation = 20 - intensity * 15; // 20% purple at calm, 5% at max
  const backgroundColor = `hsl(270, ${bgSaturation}%, ${bgLightness}%)`;

  return (
    <div style={{ ...styles.container, backgroundColor }}>
      {/* Control Panel */}
      <div style={styles.controlPanel}>
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
          {intensity < 0.3 ? '🌊' : intensity < 0.7 ? '🔥' : '💥'} {blobs.length} blobs
        </p>
        {isListening && (
          <>
            <p style={{ ...styles.stats, fontSize: 10, marginTop: 4 }}>
              Intensity: {(intensity * 100).toFixed(0)}% | BPM: {bpm} {bpmConfidence > 0.5 ? '✓' : '~'}
            </p>
            <p style={{ ...styles.stats, fontSize: 10, marginTop: 2 }}>
              Thresh: {adaptiveThreshold.toFixed(3)} | Mean: {stats.mean.toFixed(3)}
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
