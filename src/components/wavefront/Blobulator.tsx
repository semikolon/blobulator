/**
 * Blobulator - Audio-Reactive Metaball Visualization
 *
 * Two-mode animation engine ported from brf-auto:
 * 1. Expanding: Wavefront blobs spawn and expand outward (when audio is active)
 * 2. Drift: Calm ambient swirling motion (when audio is quiet)
 *
 * Audio reactivity:
 * - Amplitude affects size + triggers expansion mode
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

// Color blending configuration
const COLOR_BLEND_RADIUS = 60;      // Pixels - only very close blobs influence each other
const COLOR_BLEND_STRENGTH = 0.35;  // 0-1 - subtle blending, preserves cluster identity
const COLOR_BLEND_MIN_AGE = 2000;   // ms - blobs must be this old before they blend (avoids spawn pool infection)

// Cluster color palettes - each cluster has its own hue range
// Two warm clusters (original baseline) + one cool purple cluster
const CLUSTER_HUE_RANGES = [
  { base: 285, spread: 25 },   // Cluster 0 (small/fast): Purple/violet - the NEW cool accent
  { base: 345, spread: 20 },   // Cluster 1 (medium): Warm pink (original baseline)
  { base: 10, spread: 20 },    // Cluster 2 (large/slow): Coral/red-orange (original baseline)
];

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
    mode,
    adaptiveThreshold,
    stats,
    startListening,
    stopListening,
  } = useAdaptiveAudio();

  const animationRef = useRef<number | null>(null);
  const lastSpawnRef = useRef<number>(0);
  const elapsedRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);

  // Mode is now managed by useAdaptiveAudio hook
  // It auto-adjusts the threshold to achieve target drift ratio (~30%)

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

  // Animation loop - switches between expanding and drift modes
  const animate = useCallback((timestamp: number) => {
    const deltaMs = timestamp - lastFrameRef.current;
    lastFrameRef.current = timestamp;
    elapsedRef.current += deltaMs;

    setBlobs(currentBlobs => {
      let updatedBlobs = [...currentBlobs];

      if (mode === 'expanding') {
        // EXPANDING MODE: Active wavefront expansion
        // Bass affects spawn rate (faster spawning on bass hits)
        const spawnInterval = Math.max(
          200,
          config.spawnIntervalMs - features.bass * 400
        );

        // Mids affect speed - higher mids = faster movement
        const midSpeedBoost = 1 + features.mid * 0.5;

        // Update existing blobs with physics
        for (const blob of updatedBlobs) {
          const cluster = CLUSTERS[blob.id.charCodeAt(0) % 3];
          updateBlobVelocity(blob, config, elapsedRef.current, 0.8 * cluster.speedMultiplier * midSpeedBoost);
          updateBlobPosition(blob);
        }

        // Spawn new blobs from frontier
        if (elapsedRef.current - lastSpawnRef.current > spawnInterval) {
          const frontier = updatedBlobs.filter(b => b.isFrontier);
          if (frontier.length > 0) {
            const newBlobs = spawnFromFrontier(frontier, config);
            updatedBlobs = [...updatedBlobs, ...newBlobs];
          }
          lastSpawnRef.current = elapsedRef.current;
        }
      } else {
        // DRIFT MODE: Calm ambient swirling (when audio is quiet)
        updatedBlobs = applyDriftToBlobs(
          updatedBlobs,
          deltaMs,
          elapsedRef.current,
          viewport.width,
          viewport.height
        );
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
  }, [config, features, viewport, mode]);

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
    const clusterIndex = blob.id.charCodeAt(0) % 3;
    const cluster = CLUSTERS[clusterIndex];

    // Base size with cluster multiplier
    const baseSize = blob.size * cluster.sizeMultiplier;

    // Per-blob variation using index for uniqueness (±15%)
    const blobVariation = 1 + Math.sin(index * 1.7) * 0.15;

    // Amplitude affects all blobs (pulse effect)
    const amplitudeBoost = 1 + features.amplitude * 0.4;

    // Mids create subtle per-blob wobble (different phase per blob)
    const midWobble = 1 + features.mid * 0.2 * Math.sin(elapsedRef.current * 0.003 + index * 0.5);

    // Breathing effect in drift mode
    const breathingMultiplier = mode === 'drift'
      ? getSizeBreathingMultiplier(elapsedRef.current, index)
      : 1;

    return baseSize * blobVariation * amplitudeBoost * midWobble * breathingMultiplier;
  };

  // Calculate base HSL color for a blob (without neighbor blending)
  const getBlobBaseHSL = (blob: WaveFrontBlob): { h: number; s: number; l: number } => {
    // Determine which cluster this blob belongs to
    const clusterIndex = blob.id.charCodeAt(0) % 3;
    const clusterHue = CLUSTER_HUE_RANGES[clusterIndex];

    // Base hue from cluster + per-blob variation within cluster's spread
    const baseHue = clusterHue.base + (blob.colorIndex % 5) * (clusterHue.spread / 5);

    // Bass shifts toward red/orange (lower hue), treble toward purple (higher hue)
    const hueShift = (features.bass - features.treble) * 30;
    const hue = (baseHue + hueShift + 360) % 360;

    // Amplitude affects saturation and lightness
    // Purple cluster gets higher saturation for that neon pop
    const baseSaturation = clusterIndex === 0 ? 85 : 70;
    const saturation = baseSaturation + features.amplitude * 15; // 70-95% or 85-100%
    const lightness = 55 + features.amplitude * 15;  // 55-70%

    return { h: hue, s: saturation, l: lightness };
  };

  // Dynamic color with neighbor blending - blobs become more similar when close
  const getDynamicColor = (blob: WaveFrontBlob, index: number) => {
    const baseColor = getBlobBaseHSL(blob);

    // Skip blending for young blobs - prevents "infection" in spawn pool
    if (blob.age < COLOR_BLEND_MIN_AGE) {
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
      if (other.age < COLOR_BLEND_MIN_AGE) continue;

      const dx = blob.x - other.x;
      const dy = blob.y - other.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < COLOR_BLEND_RADIUS) {
        // Weight falls off with distance (1 at center, 0 at radius edge)
        const weight = 1 - (distance / COLOR_BLEND_RADIUS);
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

  // Dynamic background color based on mode
  const backgroundColor = mode === 'drift'
    ? '#1a1525'  // Subtle purple tint for drift
    : '#18181b'; // Dark neutral for expanding

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
          {mode === 'drift' ? '🌊' : '💥'} {blobs.length} blobs
        </p>
        {isListening && (
          <p style={{ ...styles.stats, fontSize: 10, marginTop: 4 }}>
            Drift: {(stats.currentDriftRatio * 100).toFixed(0)}% (target 30%) | Thresh: {adaptiveThreshold.toFixed(3)}
          </p>
        )}
      </div>

      {/* Blob Visualization with Gooey SVG Filter */}
      <svg style={styles.svg} viewBox={`0 0 ${viewport.width} ${viewport.height}`}>
        <defs>
          {/* Gooey metaball filter */}
          <filter id="goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9"
              result="goo"
            />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
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
