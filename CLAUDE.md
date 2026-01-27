# CLAUDE.md - Blobulator Audio-Reactive Visualization

## Project Purpose

Audio-reactive metaball visualization engine with wavefront expansion animation, ported from brf-auto's loading animation system.

## Current State (January 2026)

**Working visualization** with unified intensity-based animation, BPM detection, and 7 enhancement phases complete.

### v6 - Drift-Mode Physics & BPM Curl Modulation (January 27, 2026)

**Smoother drift-to-expansion spectrum:**

1. **Center gravity scales with drift mode** - `gravityStrength = base * (0.5 + driftFactor * 1.5)`. Quiet→2x gravity (keeps blobs clustered), loud→0.5x (lets them expand freely). Drift/expansion is continuous spectrum via intensity.

2. **BPM modulates curl noise scale** (confidence-gated) - Higher BPM = lower `curlScale` = broader sweeping curves (vs tight swirls). Only applies when `bpmConfidence > 0.5` to avoid jitter from unreliable detection.

**Audio-driven curl parameters (existing, documented):**
- Mids → `curlLerpFactor`: snappier flow field response
- Treble → `curlTimeEvolution`: faster field changes
- Bass → `curlScale`: broader sweeping curves
- BPM → `curlScale`: broader sweeping at high tempos (NEW)

### v5 - Dynamic Population & UI Polish (January 25, 2026)

**Population is now intensity-driven** (was stuck at ~82 blobs forever after seeding):

| Intensity | Spawn Rate | Death Rate | Effect |
|-----------|------------|------------|--------|
| < 50% | 0.3/sec | 0.6/sec | Population shrinks toward MIN_POPULATION (40) |
| ≥ 50% | 3.0/sec | 0.2/sec | Population grows toward SOFT_CAP_START (200) |

**Bug fixed**: After 5-second seeding, new blob creation was gated behind `&& isSeeding` - spawns calculated but ignored. Now spawns when `population < SOFT_CAP_START`.

**Other changes:**
- UI overlays: Purple-pink tinted text/buttons (hue 290-295°), fixed 250px width
- Background blobs: Orbital motion with drifting anchors (was rectangular bouncing)
- BPM detection: Volatility-based half-time correction for lofi/ambient music

### v4 - BPM Pulse & Background Layer (January 25, 2026)

Enhanced BPM reactivity and layered depth:

1. **Beat-Synchronized Pulse** - Blobs pulse in time with detected BPM using exponential decay (sharp attack, smooth release). Each blob has slight phase offset for organic variation.
2. **Background Blob Layer** - 25 larger (2.5x), darker, slower blobs behind the main field with separate gooey filter (larger blur for dreamlike edges)
3. **Layered Audio Reactivity** - Background responds to bass (outward push), amplitude (gentle size boost), and BPM (speed modulation) differently than foreground
4. **Opposite Movement** - Background blobs drift in opposite direction to foreground, creating dynamic visual contrast

**Background layer parameters:**
- `BG_SIZE_MULTIPLIER: 2.5` (±60% variation)
- `BG_SPEED_MULTIPLIER: 0.25` (4x slower)
- `BG_LIGHTNESS_OFFSET: -20` (darker)
- `BG_GOOEY_BLUR: 24` (softer edges than foreground's 16)

### v3 - Population & Physics Polish (January 19-22, 2026)

Smooth dynamics and dual-mode architecture:

1. **Soft Population Cap** - Death rate scales exponentially as population approaches 350, eliminating jarring instant culls (was: hard cap 300→250 caused visible "mass extinction")
2. **Dynamic Gravity Centers** - Blobs congregate around detected density clusters; centers lerp smoothly toward targets (0.03/frame) to prevent jerky rearrangement
3. **Voidulator Mode** - App.tsx lifted audio to shared hook; ModeSwitcher toggles between Blobulator and Voidulator visualizations
4. **Energy Metric** - `bpmNormalized * 0.4 + inertiaIntensity * 0.6` drives cluster-specific effects (Cluster 0 speed boost, Cluster 2 size boost)
5. **Smooth Blob Lifecycle** (Jan 22) - Fixed animation jerkiness via lifecycle-scaled neighbor influence + SVG circle recycling. See "Smooth Blob Lifecycle System" section below.

**Debug features**: White dots show gravity center positions; colored flash indicators correlate code events to visual effects (toggle via `DEBUG_FLASH_ENABLED`).

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
- **15x gain boost** for microphone input (mic signal too weak without amplification)
- Emits 'bpm' events during analysis
- Emits 'bpmStable' when confident
- ~10 seconds to stabilize for microphone input

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
| Bass | Background blob outward push |
| Mids | Speed boost in expanding mode (0.5x at max) |
| Mids | Per-blob wobble (different phase per blob) |
| Bass/Treble | Color hue shift (bass=warm, treble=cool) |
| **BPM** | **Beat-synchronized size pulse (35% boost, exponential decay)** |
| **BPM** | **Background layer speed modulation** |

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
src/
├── App.tsx                    # Mode switching, subdomain detection, shared audio provider
├── shared/
│   ├── useAdaptiveAudio.ts   # Lifted audio hook (shared between modes)
│   ├── types.ts              # VisualizationMode, AdaptiveAudioResult
│   └── index.ts
├── components/
│   ├── ModeSwitcher.tsx      # Blobulator/Voidulator toggle UI
│   ├── wavefront/
│   │   ├── Blobulator.tsx    # Main blob visualization
│   │   ├── types.ts          # WaveFrontBlob, BlobFieldConfig
│   │   ├── physics.ts        # Velocity, spawning, curl noise
│   │   ├── drift.ts          # Ambient swirling mode
│   │   └── flowField.ts      # Curl noise implementation
│   └── voidulator/
│       └── Voidulator.tsx    # Laser reflection visualization
```

## Deployment & URLs

**Production** (Dell Optiplex via Kamal):
- `blobulator.fredrikbranstrom.se` → Blobulator mode (default)
- `voidulator.fredrikbranstrom.se` → Voidulator mode (auto-detected)

**Subdomain detection** (`App.tsx:getInitialMode`): Hostname starting with `voidulator` sets initial mode to Voidulator. Manual switching via UI still works.

**Deploy**: `kamal deploy` (uses Knot registry on Dell, no local Docker needed)

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

**Critical Fix**: Microphone input requires **gain amplification** - the signal is too weak for the BPM algorithm's peak detection without boosting. Low-pass filter (designed for direct audio sources) actually cuts too much signal from microphone input.

**Setup**:
```typescript
const bpmAnalyzer = await createRealtimeBpmAnalyzer(audioContext, {
  continuousAnalysis: true,
  stabilizationTime: 10000, // 10s for microphone (weaker signal)
});

// Gain boost for microphone input (15x amplification)
const gainNode = audioContext.createGain();
gainNode.gain.value = 15;

// Connect: source → gain → BPM analyzer
source.connect(gainNode);
gainNode.connect(bpmAnalyzer.node);

bpmAnalyzer.on('bpm', (data) => { /* update BPM state */ });
bpmAnalyzer.on('bpmStable', (data) => { /* confident detection */ });
```

**Why gain boost works**: The BPM algorithm scans amplitude thresholds from 0.95 down to 0.20 looking for peaks. Microphone input (captured via room speakers) is much weaker than direct audio sources, so peaks don't reach detection thresholds. The 15x gain boost amplifies the signal enough for peak detection while not clipping (since we're not outputting to speakers).

**Hybrid approach**: Energy-based intensity for immediate response + BPM for display/future tempo sync.

---

## Performance Optimization (January 19, 2026)

### Identified Issue: O(n²) Neighbor Calculations

Three loops iterate ALL blobs against ALL blobs every frame:
1. **Direction influence** (Blobulator.tsx ~620) - aligns velocities with neighbors
2. **Size influence** (`getDisplaySize`) - larger neighbors increase size
3. **Color blending** (`getDynamicColor`) - nearby blobs blend colors

**Impact**: At 350 blobs = 350² × 3 = **367,500 distance calculations per frame**.

### Solution: Spatial Hashing (Implemented)

Viewport divided into 100px grid cells. All three neighbor loops now use spatial hash - only check blobs in same + adjacent cells (9 cells max).

```typescript
class SpatialHash {
  rebuild(blobs)           // O(n) - assign each blob to its cell
  getNeighborIndices(x, y) // O(1) - return indices from 9 nearby cells
}
```

**Achieved improvement**: 122,500 checks → ~2,000 checks per loop (50-60x reduction).

**Implementation notes**:
- Hash rebuilt twice per frame: once before direction influence, once after spawn/death for render
- Render functions (`getDisplaySize`, `getDynamicColor`) check hash freshness before using
- Cell size (100px) >= influence radius (80px) ensures correct neighbor detection

### Other Performance Notes

- **SVG `feGaussianBlur`**: CPU-heavy in Safari; Firefox 132+ has WebRender GPU acceleration
- **Frame-skipping**: Could run neighbor influence every 2-3 frames (imperceptible at 60fps)
- **React optimization**: Already using refs for animation state (avoids re-render overhead)

---

## Smooth Blob Lifecycle System (January 22, 2026)

### The Jerkiness Bug: Root Cause Discovery

**Symptom**: Jarring visual "jumps" even after implementing lifecycle fade (blobs spawning at 0 size and dying by shrinking to 0).

**Discovery process**: Added debug flash indicators (colored dots at top center) that light up when specific events fire. Human pattern recognition correlated magenta flashes (`deathRemoved` - when blobs are actually filtered from array) with visual jerks.

**Key insight**: The jerk wasn't from the dying blob's SIZE change (that was smooth). It was from **surviving blobs suddenly losing a neighbor's influence**. When a blob is removed from the array, all blobs within 80px of it instantly recalculate their color/size/direction without that neighbor - causing visible discontinuity.

### Fix 1: Lifecycle-Scaled Influence

**Solution**: Dying blobs gradually reduce their influence on neighbors as they fade out. All three neighbor influence calculations now multiply weight by `other.lifecycle`:

```typescript
// Weight = distance falloff × lifecycle (0→1 for spawning, 1→0 for dying)
const weight = distanceWeight * other.lifecycle;
```

**Affected systems**:
1. **Color blending** (`getDynamicColor`) - dying blobs fade out of color average
2. **Size influence** (`getDisplaySize`) - dying blobs fade out of size calculations
3. **Direction influence** (animation loop) - dying blobs fade out of velocity alignment

### Fix 2: SVG Circle Recycling (DOM Stability)

**Discovery**: Even after lifecycle-scaled influence, significant jerkiness remained. The SVG gooey filter (`feGaussianBlur` + `feColorMatrix`) processes ALL circles together. When a circle is **removed from the DOM**, the entire filter recalculates, causing visible jumps regardless of the removed circle's size.

**Solution**: Never change the SVG circle count.
1. Dead blobs are NOT removed from the array
2. Dead blobs render with `r=0` (zero area, no filter contribution)
3. Dead blobs get **recycled** as new spawns (reset position, lifecycle=0, dying=false)
4. Circle count stays constant → no filter recalculation → smooth animation

```typescript
// In render: truly dead blobs get r=0 but stay in DOM
const isTrulyDead = blob.dying && blob.lifecycle <= LIFECYCLE_REMOVE_THRESHOLD;
r={isTrulyDead ? 0 : getDisplaySize(blob, index)}

// In spawn logic: recycle dead blobs instead of creating new ones
for (const deadBlob of deadBlobs) {
  deadBlob.x = newRandomX;
  deadBlob.lifecycle = 0;
  deadBlob.dying = false;
  // ... reset other properties
}
```

**Result**: Significantly reduced jerkiness. The combination of lifecycle-scaled influence (smooth neighbor transitions) + DOM stability (no filter recalculation) produces fluid animation.

**Additionally**: `LIFECYCLE_REMOVE_THRESHOLD` lowered from 0.02 to 0.005 (blobs nearly invisible before going to r=0).

### Debug Flash Indicators

Visual debugging tool for correlating code events with visual effects. Enable/disable via `DEBUG_FLASH_ENABLED` constant.

| Color | Event | Meaning |
|-------|-------|---------|
| 🟢 Green | `spawn` | New blob created (or recycled from dead pool) |
| 🔴 Red | `deathMarked` | Blob marked as dying (starts fade-out) |
| 🟣 Magenta | `deathRemoved` | Blob entered "truly dead" state (r=0, awaiting recycling) |
| 🟡 Yellow | `edgeRecycle` | Blob hit viewport edge, marked dying |
| 🟠 Orange | `hardCapCull` | Emergency population cull |
| 🩵 Cyan | `emergencyReseed` | Population too low, reseeding |
| 🔵 Light Blue | `gravityRecalc` | Gravity centers recalculated |

**Pattern**: Fixed-position slots (7 dots, always same order) so human eye can track patterns. Dots show faint border when inactive, light up with glow when active (150ms duration).

### Debug Toggle: Dynamic Gravity

`ENABLE_DYNAMIC_GRAVITY = false` disables cluster-based gravity centers (uses only fixed center pull). Useful for isolating jerkiness causes - proved that dynamic gravity wasn't the culprit in this case.

---

## Development Notes

### Browser MCP Selection (Jan 2026)

**Recommendation**: Use **Chrome DevTools MCP fork** with token optimizations.

**Fork**: https://github.com/semikolon/chrome-devtools-mcp (branch: `feature/token-optimization`)
**Upstream PR**: https://github.com/ChromeDevTools/chrome-devtools-mcp/pull/833

This fork combines Chrome DevTools MCP's speed/GPU benefits with fast-playwright-mcp's token efficiency:
- `maxLength` parameter on `take_snapshot` - truncates output
- `selector` parameter on `take_snapshot` - limits to CSS selector subtree
- `maxWidth`/`maxHeight` on `take_screenshot` - resizes images

**Key research findings (Jan 2026):**

1. **Chrome DevTools MCP + `--autoConnect`** connects to your normal GPU-enabled Chrome (no Playwright GPU issues)

2. **Playwright WebKit is 2-3x SLOWER than Chromium** - counterintuitive since Safari is fastest natively

3. **Avoid `channel: "chrome"` on Apple Silicon** - can cause x86 vs arm64 architecture issues

Restart Claude Code after config changes (MCP caches config at startup).

### Why Playwright MCP Feels Slow (Animation-Heavy Pages)

**Root cause**: Headed mode rendering overhead, NOT CDP protocol overhead.

> "Headless mode is faster because the browser skips rendering pixels, GPU compositing, and painting frames/animations. Headful mode is a common reason scripts feel 'mysteriously slow' because of the rendering overhead."

For Blobulator specifically:
- **60fps SVG animation** with `feGaussianBlur` gooey filter = heavy GPU/CPU per frame
- **Headed mode** = browser renders EVERY frame to screen
- **Each Playwright action** waits for browser "idle" state before responding
- **Screenshots** block until paint completion

This is a **fundamental architecture mismatch**: Playwright designed for discrete automation (click, type, navigate), not real-time visual feedback of continuous animation.

### Why GPU is Disabled (Root Cause)

**Playwright/Puppeteer disable GPU by default for stability:**
1. GPU process crashes caused `await Page()` to hang forever (GitHub #4761)
2. `--disable-gpu-compositing` implicitly added in headless mode (GitHub #6083)
3. CI/Docker compatibility - most automation runs on servers without GPUs

**The fix**: Use Chrome DevTools MCP with `--autoConnect` to connect to your normal GPU-enabled Chrome browser (see "Browser MCP Selection" above).

### MCP Tool Selection Framework

| Aspect | Playwright MCP | fast-playwright-mcp | Chrome DevTools MCP | **CDT Fork** |
|--------|---------------|---------------------|---------------------|--------------|
| **Engine** | Playwright | Playwright | Puppeteer | Puppeteer |
| **Speed** | Baseline | Baseline | **15-20% faster** | **15-20% faster** |
| **Token usage** | High | **Low** | High | **Low** |
| **GPU via --autoConnect** | No | No | **Yes** | **Yes** |
| **maxLength/selector** | No | Yes | No | **Yes** |
| **Image resizing** | No | Yes | No | **Yes** |

**Decision guide:**
- **GPU + speed + token efficiency**: Chrome DevTools MCP fork (see "Browser MCP Selection" above)
- **GPU + speed only**: Chrome DevTools MCP + `--autoConnect`
- **Token efficiency only**: fast-playwright-mcp

### Alternative: Chrome DevTools MCP

Official Google alternative (released Sep 2025), uses Puppeteer:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest"]
    }
  }
}
```

**Killer feature - `--autoConnect`**: Connects to your NORMAL Chrome (with GPU working!):

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["chrome-devtools-mcp@latest", "--autoConnect", "--channel=stable"]
    }
  }
}
```

Requires: Chrome M144+, enable remote debugging at `chrome://inspect/#remote-debugging`.

### fast-playwright-mcp (Token Optimization)

Worth using for **token savings** regardless of rendering issues:

| Feature | Effect |
|---------|--------|
| `includeSnapshot: false` | **70-80% token reduction** |
| `includeCode: false` | Suppresses code generation in response |
| `includeConsole: false` | Excludes console messages |
| Image compression | JPEG format, quality setting, maxWidth |
| Batch execution | Multiple actions in one request |

**Note**: These features are now available in the Chrome DevTools MCP fork (see above).
