# CLAUDE.md - Blobulator Audio-Reactive Visualization

## Project Purpose

Audio-reactive metaball visualization engine with wavefront expansion animation, ported from brf-auto's loading animation system.

## Current State (January 2026)

**Working visualization** with 3-cluster system, audio reactivity, and two animation modes.

### Animation Modes
- **Expanding** (💥): Active wavefront expansion when audio amplitude > 0.03
- **Drift** (🌊): Calm ambient swirling when quiet, with center gravity + breathing effect

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
├── types.ts        # WaveFrontBlob, BlobFieldConfig, DRIFT_CONFIG
├── physics.ts      # Velocity, spawning, position updates
├── flowField.ts    # Curl noise implementation
├── drift.ts        # Ambient swirling mode
├── useAudio.ts     # Web Audio API microphone input
├── Blobulator.tsx  # Main React component
└── index.ts        # Module exports
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
