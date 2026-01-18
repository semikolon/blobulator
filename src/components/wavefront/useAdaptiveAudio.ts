/**
 * Adaptive Audio Analysis Hook
 *
 * Self-calibrating audio interpretation with BPM detection and intensity tracking.
 *
 * Key features:
 * 1. Rolling 60-second window of amplitude history
 * 2. Normalizes current amplitude relative to recent min/max/variance
 * 3. BPM detection via realtime-bpm-analyzer library
 * 4. Energy-based intensity (0-1 continuous scale)
 * 5. Smooth transitions for all values
 *
 * This ensures the visualization works well whether you're playing quiet ambient
 * music or loud electronic - it adapts to the dynamic range of whatever is playing.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { createRealTimeBpmProcessor, getBiquadFilter } from 'realtime-bpm-analyzer';
import type { AudioFeatures } from './types';

// Configuration constants
const HISTORY_DURATION_MS = 60_000;  // 60 seconds of history
const SAMPLE_INTERVAL_MS = 100;      // Sample every 100ms
const MAX_SAMPLES = HISTORY_DURATION_MS / SAMPLE_INTERVAL_MS; // 600 samples

// Intensity smoothing
const INTENSITY_SMOOTHING = 0.15;    // How fast intensity responds (0=instant, 1=never)
const ENERGY_HISTORY_SIZE = 10;      // Frames to average for energy comparison

// BPM detection
const DEFAULT_BPM = 120;             // Fallback BPM before detection stabilizes

interface AdaptiveState {
  amplitudeHistory: number[];
  energyHistory: number[];           // Recent energy values for derivative calculation
  adaptiveThreshold: number;
  smoothedIntensity: number;         // Smoothed 0-1 intensity value
  bpm: number;                       // Current detected BPM
  bpmConfidence: number;             // How confident we are in the BPM (0-1)
  stats: {
    min: number;
    max: number;
    mean: number;
    stdDev: number;
  };
}

interface AdaptiveAudioResult {
  // Original features
  features: AudioFeatures;
  // Normalized features (0-1 relative to recent history)
  normalizedFeatures: AudioFeatures;
  // Continuous intensity (0-1) - replaces binary mode
  intensity: number;
  // BPM detection
  bpm: number;
  bpmConfidence: number;
  // Current adaptive threshold (for display)
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
    energyHistory: [],
    adaptiveThreshold: 0.05,
    smoothedIntensity: 0,
    bpm: DEFAULT_BPM,
    bpmConfidence: 0,
    stats: {
      min: 0,
      max: 0.1,
      mean: 0.05,
      stdDev: 0.02,
    },
  });

  // Audio refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const bpmProcessorRef = useRef<AudioWorkletNode | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastSampleTimeRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  // Calculate statistics from history
  const calculateStats = useCallback((history: number[]): AdaptiveState['stats'] => {
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

  // Calculate energy-based intensity from recent history
  const calculateIntensity = useCallback((
    currentAmplitude: number,
    energyHistory: number[],
    stats: AdaptiveState['stats']
  ): number => {
    if (energyHistory.length < 3) {
      // Not enough history, use normalized amplitude
      return normalizeValue(currentAmplitude, stats.min, stats.max);
    }

    // Calculate average recent energy
    const recentAvg = energyHistory.reduce((a, b) => a + b, 0) / energyHistory.length;

    // Calculate energy derivative (rate of change)
    const energyDerivative = currentAmplitude - recentAvg;

    // Combine normalized amplitude with energy derivative for intensity
    // High amplitude OR rising energy = high intensity
    const normalizedAmp = normalizeValue(currentAmplitude, stats.min, stats.max);
    const derivativeBoost = Math.max(0, energyDerivative * 10); // Boost for rising energy

    // Combine: base intensity from amplitude, boosted by energy changes
    const rawIntensity = Math.min(1, normalizedAmp + derivativeBoost * 0.3);

    return rawIntensity;
  }, [normalizeValue]);

  // Start listening
  const startListening = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;
      source.connect(analyser);

      // Set up BPM detection
      try {
        // Create low-pass filter for BPM detection (isolates bass/kick)
        const lowpassFilter = getBiquadFilter(audioContext);
        source.connect(lowpassFilter);

        // Create BPM processor
        const realtimeBpmProcessor = await createRealTimeBpmProcessor(audioContext, {
          continuousAnalysis: true,
          stabilizationTime: 5000, // 5 seconds to stabilize
        });
        bpmProcessorRef.current = realtimeBpmProcessor;

        lowpassFilter.connect(realtimeBpmProcessor);

        // Listen for BPM events
        realtimeBpmProcessor.port.onmessage = (event) => {
          if (event.data.message === 'BPM') {
            const { bpm, confidence } = event.data.result;
            if (bpm && confidence) {
              setAdaptiveState(prev => ({
                ...prev,
                bpm: Math.round(bpm),
                bpmConfidence: confidence,
              }));
            }
          } else if (event.data.message === 'BPM_STABLE') {
            const { bpm, confidence } = event.data.result;
            if (bpm) {
              setAdaptiveState(prev => ({
                ...prev,
                bpm: Math.round(bpm),
                bpmConfidence: confidence || 1,
              }));
            }
          }
        };
      } catch (bpmError) {
        console.warn('BPM detection not available:', bpmError);
        // Continue without BPM detection
      }

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
    if (bpmProcessorRef.current) {
      bpmProcessorRef.current.disconnect();
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
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
          // Add to amplitude history, keeping only last 60s
          const newAmplitudeHistory = [...prev.amplitudeHistory, newFeatures.amplitude];
          if (newAmplitudeHistory.length > MAX_SAMPLES) {
            newAmplitudeHistory.shift();
          }

          // Add to energy history (shorter window for responsiveness)
          const newEnergyHistory = [...prev.energyHistory, newFeatures.amplitude];
          if (newEnergyHistory.length > ENERGY_HISTORY_SIZE) {
            newEnergyHistory.shift();
          }

          // Calculate stats
          const newStats = calculateStats(newAmplitudeHistory);

          // Calculate raw intensity
          const rawIntensity = calculateIntensity(
            newFeatures.amplitude,
            newEnergyHistory,
            newStats
          );

          // Smooth the intensity (exponential moving average)
          const newSmoothedIntensity = prev.smoothedIntensity * INTENSITY_SMOOTHING +
            rawIntensity * (1 - INTENSITY_SMOOTHING);

          // Update adaptive threshold based on smoothed intensity
          // This helps maintain the visual character across different music styles
          let newThreshold = prev.adaptiveThreshold;
          if (newAmplitudeHistory.length >= 100) {
            const targetThreshold = newStats.mean + newStats.stdDev * 0.5;
            newThreshold = prev.adaptiveThreshold * 0.99 + targetThreshold * 0.01;
            newThreshold = Math.max(0.02, Math.min(0.5, newThreshold));
          }

          return {
            ...prev,
            amplitudeHistory: newAmplitudeHistory,
            energyHistory: newEnergyHistory,
            adaptiveThreshold: newThreshold,
            smoothedIntensity: newSmoothedIntensity,
            stats: newStats,
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
  }, [isListening, calculateStats, calculateIntensity]);

  // Calculate normalized features
  const normalizedFeatures: AudioFeatures = {
    amplitude: normalizeValue(features.amplitude, adaptiveState.stats.min, adaptiveState.stats.max),
    bass: features.bass,
    mid: features.mid,
    treble: features.treble,
  };

  return {
    features,
    normalizedFeatures,
    intensity: adaptiveState.smoothedIntensity,
    bpm: adaptiveState.bpm,
    bpmConfidence: adaptiveState.bpmConfidence,
    adaptiveThreshold: adaptiveState.adaptiveThreshold,
    stats: adaptiveState.stats,
    isListening,
    error,
    startListening,
    stopListening,
  };
}
