# CLAUDE.md - Blobulator Audio-Reactive Visualization

## Project Purpose

Audio-reactive metaball visualization engine with wavefront expansion animation, ported from brf-auto's loading animation system.

## Current State (January 2026)

**Working visualization** with unified intensity-based animation, BPM detection, and 6 enhancement phases complete.

### v2 - Intensity-Based System (January 18, 2026)

Major upgrade implementing all 6 user-requested enhancements:

1. **Unified Motion System** - Smooth intensity spectrum (0-1) replaces binary drift/expansion mode
2. **Intensity-Driven Colors** - Cool (purple/blue/teal) at low intensity → warm (pink/orange) at high
3. **Always-On Center Gravity** - Strength scales WITH intensity (creates "frenzy concentrated in middle")
4. **Cluster Size Pulsing** - Each cluster randomly grows (1.5x) or shrinks (0.75x) every 3-6s
5. **Blob-to-Blob Influence** - Nearby blobs affect each other's size and direction (like color blending)
6. **BPM Detection** - Real-time BPM via `realtime-bpm-analyzer` library

### Baseline v1 - "Beautiful" (January 16, 2026)

Reference screenshots saved in `docs/reference-screenshots/baseline-v1-*.png`

**User feedback (verbatim):**
> "it's beautiful. I want this stored as a baseline of one mode that I really enjoy. The audio/music interpretation/sensitivity can always be changed/tweaked, but I enjoy this resultant visualization definitely."

> "It's also a bit cool when it switches from expanding to drift mode, in electronic songs when that corresponds to the bass/beat and the background hum of ambient music like Carbon Based Lifeforms etc. :)"

This configuration represents a validated aesthetic baseline. Future audio sensitivity tweaks should preserve this visual character.

### Unified Intensity System (v2)

Animation behaviors blend smoothly on a 0-1 **intensity** scale:
- 🌊 **Low intensity (0-0.3)**: Calm swirling, strong drift physics, cool colors (purple/blue/teal)
- 🔥 **Medium intensity (0.3-0.7)**: Blended behaviors, transitional colors
- 💥 **High intensity (0.7-1.0)**: Active expansion, fast spawning, warm colors (pink/orange)

**Key behaviors that scale with intensity:**
- Drift physics strength: `1 - intensity * 0.7` (stronger when calm)
- Expansion physics strength: `intensity` (stronger when energetic)
- Center gravity: `base + intensity * boost` (creates frenzy in middle at high intensity)
- Spawn rate: Faster at high intensity + bass hits
- Color palette: Interpolates cool→warm based on intensity
- Breathing effect: Stronger at low intensity

### Adaptive Audio System (January 2026)

Self-calibrating audio interpretation with BPM detection.

**Intensity calculation:**
1. Rolling 60-second amplitude history
2. Statistics (min, max, mean, stdDev) from recent history
3. Energy derivative (rate of change) for responsiveness
4. Combined normalized amplitude + derivative boost
5. Exponential smoothing for stable output

**BPM detection** via `realtime-bpm-analyzer`:
- Low-pass filter isolates bass frequencies
- Emits 'bpm' events during analysis
- Emits 'bpmStable' when confident
- ~5 seconds to stabilize

**Display:** Stats panel shows intensity %, BPM, confidence, and threshold.

### 3-Cluster System
Blobs assigned to clusters by ID, creating visual variety:

| Cluster | Size | Speed | Character |
|---------|------|-------|-----------|
| 0 | 0.7x | 1.4x | Small & fast |
| 1 | 1.0x | 1.0x | Medium |
| 2 | 1.5x | 0.6x | Large & slow |

### Audio → Visual Mapping
| Audio Feature | Effect |
|---------------|--------|
| Amplitude | Size pulse (all blobs, 0.4x boost at max) |
| Bass | Spawn rate (faster spawning on bass hits) |
| Mids | Speed boost in expanding mode (0.5x at max) |
| Mids | Per-blob wobble (different phase per blob) |
| Bass/Treble | Color hue shift (bass=warm, treble=cool) |

Plus: ±15% individual size variation per blob, breathing effect in drift mode.

---

## Design Principles (User Feedback)

> "don't go overboard with mapping different aspects of the animation to different elements of the audio. Just do the lowest hanging fruit first."

> "Try to mirror [brf-auto wavefront settings] as exactly as possible for the foundation!"

## Reference Documentation in brf-auto

### Core Wavefront System
- `/frontend/src/components/LoadingAnimations/wavefront/types.ts` - Core types, BlobFieldConfig, DEFAULT_CONFIG
- `/frontend/src/components/LoadingAnimations/wavefront/physics.ts` - Velocity gradients, spawning, position updates
- `/frontend/src/components/LoadingAnimations/wavefront/flowField.ts` - Curl noise implementation
- `/frontend/src/components/LoadingAnimations/wavefront/drift.ts` - Drift mode for ambient motion
- `/frontend/src/components/LoadingAnimations/wavefront/blobField.ts` - State management, frontier tracking
- `/frontend/src/components/LoadingAnimations/WaveFrontTestMode.tsx` - **TEST MODE WITH SLIDERS** - study this!

### Architecture Docs
- `/docs/architecture/wavefront_animation_overview.md` - Complete technical overview
- `/docs/architecture/gooey_wavefront_expansion_plan.md` - Master plan with requirements

## Tuned Slider Settings from WaveFrontTestMode

From user's screenshot - these create the desired multi-blob gooey effect:

| Setting | Value | Description |
|---------|-------|-------------|
| Spawn Interval | 600ms | How often new frontier blobs spawn |
| Acceleration | 3.00 | Speed multiplier per generation (frontier races ahead!) |
| Growth Factor | 15.0x → 16x | Blob size multiplier at 100% progress |
| Edge Threshold | 95% | % of diagonal for 'covered' |
| Curl Noise | ON | Organic flow vs random |
| Curl Scale | 0.0090 | Lower = sweeping, higher = tight |
| Flow Lerp | 0.02 | **KEY: LOW value preserves momentum** |
| Time Evolution | 0.00030 | Flow field change rate |

## Core Animation Rules

### 1. Many Small Blobs, Not Few Huge Ones
`baseBlobSize=18` creates many distinct blobs (200-300 typically). If blobs are too large, they merge into one amorphous mass and lose the metaball effect.

### 2. Active Spawning Creates Wavefront
Frontier blobs (outer edge) continuously spawn new blobs outward. Each generation is smaller (`shrinkFactor=0.92`) and faster (`accelerationFactor=3.0`), creating the "wave" expanding outward.

### 3. Metaball/Gooey Effect = Blobs Merge When Close
SVG gooey filter (`feGaussianBlur` + `feColorMatrix`) creates liquid merging where blobs overlap. Sweet spot: many medium blobs with partial overlap. Too big = one mass. Too small/far = no merging.

### 4. Curl Noise Creates Organic Flow
Blobs don't move in straight lines - curl noise field guides direction with sweeping curves. `Flow Lerp 0.02` (low value) preserves momentum for sweeping paths. Higher lerp = snappy, less organic.

### 5. Velocity Gradient = Frontier Races Ahead
Generation 0 (core) blobs are nearly static. Each subsequent generation moves faster. This creates the expanding wavefront visual where outer blobs race ahead of inner ones.

### 6. Audio Reactivity
See mapping table above. Key principle: "don't go overboard" - subtle, low-hanging-fruit mappings that enhance without overwhelming the core animation.

## Current Code Structure (blobulator)

```
src/components/wavefront/
├── types.ts            # WaveFrontBlob, BlobFieldConfig, DRIFT_CONFIG
├── physics.ts          # Velocity, spawning, position updates
├── flowField.ts        # Curl noise implementation
├── drift.ts            # Ambient swirling mode
├── useAdaptiveAudio.ts # Self-calibrating audio with adaptive threshold
├── Blobulator.tsx      # Main React component
└── index.ts            # Module exports
```

## Repository

- GitHub: https://github.com/semikolon/blobulator
- Dev server: http://localhost:5175/

## Quick Start

```bash
npm run dev          # Start at http://localhost:5175
```

Click "Start Microphone" → play music → watch blobs react.

**What to observe:**
- 💥 Expanding mode when music plays (amplitude > 0.03)
- 🌊 Drift mode during quiet passages
- Size pulse on amplitude peaks
- Faster spawning on bass hits
- Color shifts (bass=warm, treble=cool)

---

## Future Enhancement: Audio Input Options

*Researched January 2026 - documented for future implementation*

### Current: Microphone Input
Works well for ambient room audio (speakers playing music). Simple `getUserMedia({ audio: true })`.

### Option 1: Tab Audio Capture (getDisplayMedia)

Captures audio from a specific browser tab only.

```javascript
const stream = await navigator.mediaDevices.getDisplayMedia({
  video: true,  // Required even for audio-only (API quirk)
  audio: { systemAudio: 'include' }
});
const source = audioContext.createMediaStreamSource(stream);
source.connect(analyser);
```

**Limitations:**
- Chrome/Edge only (Firefox/Safari silently ignore audio)
- User must manually check "Share tab audio" checkbox
- Only captures audio from shared tab, NOT system-wide
- macOS: Tab audio works, but NOT full system audio

**Sources:**
- [MDN: getDisplayMedia()](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)
- [Dev.to: System Audio in Browser](https://dev.to/flo152121063061/i-tried-to-capture-system-audio-in-the-browser-heres-what-i-learned-1f99)

### Option 2: Virtual Audio Device (BlackHole) - RECOMMENDED

For true system audio on macOS (Spotify app, any audio source):

1. Install [BlackHole](https://existential.audio/blackhole/) (free, open source)
2. Create Multi-Output Device in Audio MIDI Setup (speakers + BlackHole)
3. Blobulator captures BlackHole as a "microphone" via regular `getUserMedia`

**Benefits:**
- Captures ALL system audio (any app, any source)
- No screen sharing picker needed
- Works with existing mic capture code
- Flexible - play music from anywhere

### Option 3: Play Our Own Audio

Load and play audio files directly, connect to AnalyserNode:

```javascript
const audio = new Audio('/path/to/music.mp3');
const source = audioContext.createMediaElementSource(audio);
source.connect(analyser);
source.connect(audioContext.destination); // Also play to speakers
audio.play();
```

**Benefits:**
- Simplest implementation
- No permissions needed
- Guaranteed audio quality

**Limitations:**
- Only plays files we provide
- Less flexible than system audio capture

### Implementation Priority

1. **BlackHole setup** - best flexibility, works now with mic input
2. **Own audio playback** - simple addition for demos
3. **Tab audio** - nice-to-have for Chrome users

---

## SVG Gooey Filter Insight (January 17, 2026)

**Key discovery**: The `feComposite in="SourceGraphic"` step in SVG gooey filters composites SHARP original circles back on top of the blur. Removing it creates truly merged internal blobs.

| Filter Approach | Internal Blob Edges | Use Case |
|-----------------|---------------------|----------|
| With `feComposite` | Sharp circles visible inside mass | Distinct blob identity |
| **Without `feComposite`** | Soft, merged, lava-lamp effect | True metaball merging |

**gooey-react library** defaults to `composite=false` (no feComposite). brf-auto already uses this correctly.

**Current blobulator filter** (strong intensity, no composite):
```svg
<filter id="goo" colorInterpolationFilters="sRGB">
  <feGaussianBlur in="SourceGraphic" stdDeviation="16" />
  <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 96 -48" />
</filter>
```

Formula: `blur=16`, `alpha = blur × 6 = 96`, `shift = alpha / -2 = -48`

---

## Implemented: BPM & Intensity-Driven Animation (January 18, 2026)

✅ **All 6 enhancements implemented** - see v2 section above.

*User direction preserved for reference:*

### 1. ✅ BPM/Intensity Color Variation
> "Make it vary the color (but only introduce more reddish orange hues and more neon pink and toward neon purple/blue/teal/turquoise) based on the estimated BPM / intensity of the music"

**Implementation**: Two color palettes interpolate based on intensity:
- Cool (low): Purple 270°, Teal 200°, Blue 230°
- Warm (high): Neon Pink 320°, Hot Pink 345°, Orange 25°

### 2. ✅ BPM/Intensity Speed Variation
Expansion physics strength scales directly with intensity. BPM detected and displayed.

### 3. ✅ Smooth Spectrum Between Modes
Binary mode switching replaced with continuous intensity blending (0-1 scale).

### 4. ✅ Always-On Center Gravity
`centerGravityStrength = 0.00002 + (intensity * 0.00008)` - stronger pull at high intensity.

### 5. ✅ Cluster Size Pulsing
Each cluster pulses every 3-6s: grow to 1.5x OR shrink to 0.75x over 1s (easeInOut).

### 6. ✅ Blob-to-Blob Influence
- **Direction**: Nearby blobs align velocities (flocking behavior)
- **Size**: Larger neighbors make this blob slightly larger
- Radius: 80px (same as color blending)

---

## BPM Detection Implementation (January 18, 2026)

**Library**: `realtime-bpm-analyzer` (zero dependencies, TypeScript)

**Setup**:
```typescript
const lowpassFilter = getBiquadFilter(audioContext);
source.connect(lowpassFilter);

const bpmAnalyzer = await createRealtimeBpmAnalyzer(audioContext, {
  continuousAnalysis: true,
  stabilizationTime: 5000,
});
lowpassFilter.connect(bpmAnalyzer.node);

bpmAnalyzer.on('bpm', (data) => { /* update BPM state */ });
bpmAnalyzer.on('bpmStable', (data) => { /* confident detection */ });
```

**Hybrid approach**: Energy-based intensity for immediate response + BPM for display/future tempo sync.
