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
import type { WaveFrontBlob, BlobFieldConfig, AnimationMode } from './types';
import { DEFAULT_CONFIG } from './types';
import {
  generateInitialBlobs,
  spawnFromFrontier,
  updateBlobPosition,
  updateBlobVelocity,
  recycleBlobsAtEdge,
} from './physics';
import { applyDriftToBlobs, getSizeBreathingMultiplier } from './drift';
import { useAudio } from './useAudio';

// Threshold for switching between drift and expansion modes
const AMPLITUDE_THRESHOLD = 0.15;

// Inline styles since we don't have Tailwind
const styles = {
  container: {
    position: 'fixed' as const,
    inset: 0,
    backgroundColor: '#18181b',
    overflow: 'hidden',
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
  const [mode, setMode] = useState<AnimationMode>('expanding');
  const { isListening, error, features, startListening, stopListening } = useAudio();

  const animationRef = useRef<number | null>(null);
  const lastSpawnRef = useRef<number>(0);
  const elapsedRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);

  // Switch between modes based on audio amplitude
  // Only switch to drift when microphone IS listening AND amplitude is low
  useEffect(() => {
    if (!isListening) {
      // Keep expanding as default when not listening
      setMode('expanding');
    } else if (features.amplitude > AMPLITUDE_THRESHOLD) {
      setMode('expanding');
    } else {
      setMode('drift');
    }
  }, [features.amplitude, isListening]);

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
        // EXPANDING MODE: Active wavefront expansion (when audio is playing)
        // Bass affects spawn rate (faster spawning on bass hits)
        const spawnInterval = Math.max(
          200,
          config.spawnIntervalMs - features.bass * 400
        );

        // Update existing blobs with physics
        for (const blob of updatedBlobs) {
          updateBlobVelocity(blob, config, elapsedRef.current, 0.8);
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
        // Ported from brf-auto - creates gentle metaball movement
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

  // Calculate display size with audio reactivity and drift breathing
  const getDisplaySize = (blob: WaveFrontBlob, index: number) => {
    const baseSize = blob.size;
    const growthMultiplier = 1 + config.growthFactor * 0.5;
    const audioBoost = 1 + features.amplitude * 0.5;

    // Add size breathing in drift mode (subtle pulsing effect)
    const breathingMultiplier = mode === 'drift'
      ? getSizeBreathingMultiplier(elapsedRef.current, index)
      : 1;

    return baseSize * growthMultiplier * audioBoost * breathingMultiplier;
  };

  // Dynamic color based on audio features
  const getDynamicColor = (blob: WaveFrontBlob) => {
    // Base hue from blob's color index (spread across pink/red spectrum)
    const baseHue = 330 + blob.colorIndex * 15; // 330-390 (wraps to 30)

    // Bass shifts toward red/orange (lower hue), treble toward purple (higher hue)
    const hueShift = (features.bass - features.treble) * 40;
    const hue = (baseHue + hueShift + 360) % 360;

    // Amplitude affects saturation and lightness
    const saturation = 70 + features.amplitude * 25; // 70-95%
    const lightness = 55 + features.amplitude * 15;  // 55-70%

    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  };

  const centerX = viewport.width / 2;
  const centerY = viewport.height / 2;

  return (
    <div style={styles.container}>
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
          Mode: {mode} | Blobs: {blobs.length} | Frontier: {blobs.filter(b => b.isFrontier).length}
        </p>
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
              fill={getDynamicColor(blob)}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
