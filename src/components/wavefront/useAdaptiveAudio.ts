/**
 * Adaptive Audio Analysis Hook
 *
 * Self-calibrating audio interpretation that adjusts to any volume level or music style.
 *
 * Key features:
 * 1. Rolling 60-second window of amplitude history
 * 2. Normalizes current amplitude relative to recent min/max/variance
 * 3. Target drift proportion (default 30%) - auto-adjusts threshold to achieve this
 * 4. Smooth threshold adjustments to avoid jarring transitions
 *
 * This ensures the visualization works well whether you're playing quiet ambient
 * music or loud electronic - it adapts to the dynamic range of whatever is playing.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { AudioFeatures } from './types';

// Configuration constants
const HISTORY_DURATION_MS = 60_000;  // 60 seconds of history
const SAMPLE_INTERVAL_MS = 100;      // Sample every 100ms
const MAX_SAMPLES = HISTORY_DURATION_MS / SAMPLE_INTERVAL_MS; // 600 samples

const TARGET_DRIFT_RATIO = 0.30;     // Target: 30% of time in drift mode
const THRESHOLD_ADJUST_RATE = 0.001; // How fast threshold adapts (per sample)
const MIN_THRESHOLD = 0.01;          // Never go below this
const MAX_THRESHOLD = 0.5;           // Never go above this
const INITIAL_THRESHOLD = 0.03;      // Starting threshold

interface AdaptiveState {
  amplitudeHistory: number[];
  modeHistory: ('expanding' | 'drift')[];  // Track which mode we've been in
  adaptiveThreshold: number;
  stats: {
    min: number;
    max: number;
    mean: number;
    stdDev: number;
    currentDriftRatio: number;  // Actual % time in drift
  };
}

interface AdaptiveAudioResult {
  // Original features
  features: AudioFeatures;
  // Normalized features (0-1 relative to recent history)
  normalizedFeatures: AudioFeatures;
  // Adaptive mode decision
  mode: 'expanding' | 'drift';
  // Current adaptive threshold
  adaptiveThreshold: number;
  // Statistics
  stats: AdaptiveState['stats'];
  // Audio control
  isListening: boolean;
  error: string | null;
  startListening: () => Promise<void>;
  stopListening: () => void;
}

export function useAdaptiveAudio(): AdaptiveAudioResult {
  // Raw audio state
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [features, setFeatures] = useState<AudioFeatures>({
    amplitude: 0,
    bass: 0,
    mid: 0,
    treble: 0,
  });

  // Adaptive state
  const [adaptiveState, setAdaptiveState] = useState<AdaptiveState>({
    amplitudeHistory: [],
    modeHistory: [],
    adaptiveThreshold: INITIAL_THRESHOLD,
    stats: {
      min: 0,
      max: 0.1,
      mean: 0.05,
      stdDev: 0.02,
      currentDriftRatio: 0.5,
    },
  });

  // Audio refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastSampleTimeRef = useRef<number>(0);

  // Calculate statistics from history
  const calculateStats = useCallback((history: number[]): Omit<AdaptiveState['stats'], 'currentDriftRatio'> => {
    if (history.length === 0) {
      return { min: 0, max: 0.1, mean: 0.05, stdDev: 0.02 };
    }

    const min = Math.min(...history);
    const max = Math.max(...history);
    const mean = history.reduce((a, b) => a + b, 0) / history.length;

    const squaredDiffs = history.map(x => Math.pow(x - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / history.length;
    const stdDev = Math.sqrt(variance);

    return { min, max, mean, stdDev };
  }, []);

  // Normalize a value relative to recent history
  const normalizeValue = useCallback((value: number, min: number, max: number): number => {
    const range = max - min;
    if (range < 0.001) return 0.5; // Avoid division by near-zero
    return Math.max(0, Math.min(1, (value - min) / range));
  }, []);

  // Start listening
  const startListening = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      audioContextRef.current = new AudioContext();
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;

      sourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
      sourceRef.current.connect(analyserRef.current);

      setIsListening(true);
      setError(null);
    } catch (err) {
      setError('Microphone access denied');
      console.error('Audio error:', err);
    }
  }, []);

  // Stop listening
  const stopListening = useCallback(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
    setIsListening(false);
  }, []);

  // Audio analysis loop
  useEffect(() => {
    if (!isListening || !analyserRef.current) return;

    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const analyze = () => {
      analyser.getByteFrequencyData(dataArray);

      // Calculate frequency bands
      const bassEnd = Math.floor(bufferLength * 0.1);
      const midEnd = Math.floor(bufferLength * 0.5);

      let bassSum = 0, midSum = 0, trebleSum = 0, total = 0;

      for (let i = 0; i < bufferLength; i++) {
        const value = dataArray[i] / 255;
        total += value;
        if (i < bassEnd) bassSum += value;
        else if (i < midEnd) midSum += value;
        else trebleSum += value;
      }

      const newFeatures: AudioFeatures = {
        amplitude: total / bufferLength,
        bass: bassSum / bassEnd,
        mid: midSum / (midEnd - bassEnd),
        treble: trebleSum / (bufferLength - midEnd),
      };

      setFeatures(newFeatures);

      // Update adaptive state at sample interval
      const now = performance.now();
      if (now - lastSampleTimeRef.current >= SAMPLE_INTERVAL_MS) {
        lastSampleTimeRef.current = now;

        setAdaptiveState(prev => {
          // Add to history, keeping only last 60s
          const newAmplitudeHistory = [...prev.amplitudeHistory, newFeatures.amplitude];
          if (newAmplitudeHistory.length > MAX_SAMPLES) {
            newAmplitudeHistory.shift();
          }

          // Calculate stats
          const baseStats = calculateStats(newAmplitudeHistory);

          // Determine current mode based on adaptive threshold
          const currentMode: 'expanding' | 'drift' = newFeatures.amplitude > prev.adaptiveThreshold ? 'expanding' : 'drift';

          // Track mode history
          const newModeHistory: ('expanding' | 'drift')[] = [...prev.modeHistory, currentMode];
          if (newModeHistory.length > MAX_SAMPLES) {
            newModeHistory.shift();
          }

          // Calculate actual drift ratio
          const driftCount = newModeHistory.filter(m => m === 'drift').length;
          const currentDriftRatio = newModeHistory.length > 0 ? driftCount / newModeHistory.length : 0.5;

          // Adjust threshold to move toward target drift ratio
          let newThreshold = prev.adaptiveThreshold;
          if (newModeHistory.length >= 100) { // Wait for some history before adjusting
            if (currentDriftRatio < TARGET_DRIFT_RATIO) {
              // Too little drift - raise threshold (make it harder to be in expanding)
              newThreshold += THRESHOLD_ADJUST_RATE;
            } else if (currentDriftRatio > TARGET_DRIFT_RATIO) {
              // Too much drift - lower threshold (make it easier to be in expanding)
              newThreshold -= THRESHOLD_ADJUST_RATE;
            }
            // Clamp threshold
            newThreshold = Math.max(MIN_THRESHOLD, Math.min(MAX_THRESHOLD, newThreshold));
          }

          return {
            amplitudeHistory: newAmplitudeHistory,
            modeHistory: newModeHistory,
            adaptiveThreshold: newThreshold,
            stats: {
              ...baseStats,
              currentDriftRatio,
            },
          };
        });
      }

      animationRef.current = requestAnimationFrame(analyze);
    };

    analyze();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isListening, calculateStats]);

  // Calculate normalized features
  const normalizedFeatures: AudioFeatures = {
    amplitude: normalizeValue(features.amplitude, adaptiveState.stats.min, adaptiveState.stats.max),
    bass: features.bass,    // Could normalize these too if needed
    mid: features.mid,
    treble: features.treble,
  };

  // Determine mode
  const mode = features.amplitude > adaptiveState.adaptiveThreshold ? 'expanding' : 'drift';

  return {
    features,
    normalizedFeatures,
    mode,
    adaptiveThreshold: adaptiveState.adaptiveThreshold,
    stats: adaptiveState.stats,
    isListening,
    error,
    startListening,
    stopListening,
  };
}
