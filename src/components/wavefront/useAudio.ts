/**
 * Audio Analysis Hook
 * Captures microphone input and extracts audio features
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { AudioFeatures } from './types';

export function useAudio() {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [features, setFeatures] = useState<AudioFeatures>({
    amplitude: 0,
    bass: 0,
    mid: 0,
    treble: 0,
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const smoothedFeaturesRef = useRef<AudioFeatures>({
    amplitude: 0,
    bass: 0,
    mid: 0,
    treble: 0,
  });

  const analyze = useCallback(() => {
    if (!analyserRef.current) return;

    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    // Calculate features from frequency data
    // FFT bins are linearly spaced from 0 to sampleRate/2 (typically 22050Hz)
    // With 2048 FFT size, each bin ≈ 21.5Hz

    const bassEnd = Math.floor(bufferLength * 0.1);      // ~0-2200Hz
    const midEnd = Math.floor(bufferLength * 0.4);       // ~2200-8800Hz

    let bassSum = 0;
    let midSum = 0;
    let trebleSum = 0;
    let totalSum = 0;

    for (let i = 0; i < bufferLength; i++) {
      const value = dataArray[i] / 255;
      totalSum += value;

      if (i < bassEnd) {
        bassSum += value;
      } else if (i < midEnd) {
        midSum += value;
      } else {
        trebleSum += value;
      }
    }

    const raw: AudioFeatures = {
      amplitude: totalSum / bufferLength,
      bass: bassSum / bassEnd,
      mid: midSum / (midEnd - bassEnd),
      treble: trebleSum / (bufferLength - midEnd),
    };

    // Smooth the values for visual continuity
    const smoothing = 0.8;
    const smoothed = smoothedFeaturesRef.current;
    smoothedFeaturesRef.current = {
      amplitude: smoothed.amplitude * smoothing + raw.amplitude * (1 - smoothing),
      bass: smoothed.bass * smoothing + raw.bass * (1 - smoothing),
      mid: smoothed.mid * smoothing + raw.mid * (1 - smoothing),
      treble: smoothed.treble * smoothing + raw.treble * (1 - smoothing),
    };

    setFeatures({ ...smoothedFeaturesRef.current });
    animationFrameRef.current = requestAnimationFrame(analyze);
  }, []);

  const startListening = useCallback(async () => {
    try {
      setError(null);

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
      });
      streamRef.current = stream;

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;

      source.connect(analyser);
      analyserRef.current = analyser;

      setIsListening(true);
      analyze();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to access microphone');
      console.error('Audio error:', err);
    }
  }, [analyze]);

  const stopListening = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    analyserRef.current = null;
    setIsListening(false);
    setFeatures({ amplitude: 0, bass: 0, mid: 0, treble: 0 });
    smoothedFeaturesRef.current = { amplitude: 0, bass: 0, mid: 0, treble: 0 };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopListening();
    };
  }, [stopListening]);

  return {
    isListening,
    error,
    features,
    startListening,
    stopListening,
  };
}
