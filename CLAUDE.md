# CLAUDE.md - Blobulator Audio-Reactive Visualization

## Project Purpose

Audio-reactive metaball visualization engine with wavefront expansion animation, ported from brf-auto's loading animation system.

## CRITICAL: User Feedback (Verbatim)

### Initial Vision
> "I love these settings for the wavefront animation. Could you use these as default for this new music visualization? And only slightly tweak it or tweak colors and other aspects based on the music? Would be great to start testing out with."

> "don't go overboard with mapping different aspects of the animation to different elements of the audio. Just do the lowest hanging fruit first."

### On the Wavefront Foundation
> "I told you those specific default slider settings from the brf-auto animation test mode (read about wavefrontTestmode! and its sliders and note the values in the screenshot! especially the curl noise variables influence!) because they resulted in this kind of very nice multi-blobby gooey overlapping metaball-merging expansion which flows organically over time. Try to mirror it as exactly as possible for the foundation!"

### Current Problems (MUST FIX)
> "It doesn't at ALL look the same. It's just a bunch of HUGE blobs in the middle of the page wobbling to a slightly bigger size and back again, expanding super slowly out from the center of the page. I want more action and smaller blobs and more metaball effect merging of the different blobs! Maybe you haven't understood the metaball effect!"

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

## Desired Behavior Specification

### RULE 1: Many Small Blobs, Not Few Huge Ones
- Base blob size should be small (~20-30px, not 50px)
- Growth factor affects EXPANSION animation, not resting size
- Should have 100+ visible distinct blobs, not 66 merged into ~5 shapes

### RULE 2: Active Spawning Creates Wavefront
- Frontier blobs (outer edge) spawn new blobs outward
- Spawning should be CONTINUOUS and VISIBLE
- New generations should be SMALLER and FASTER (shrinkFactor, accelerationFactor)
- This creates the "wave" expanding outward

### RULE 3: Metaball/Gooey Effect = Blobs MERGE When Close
- SVG gooey filter (feGaussianBlur + feColorMatrix) creates liquid merging
- Requires MULTIPLE DISTINCT BLOBS that overlap
- If blobs are too big, they merge into one mass = BAD
- If blobs are too small/far apart, no merging = BAD
- Sweet spot: many medium blobs with partial overlap

### RULE 4: Curl Noise Creates Organic Flow
- Blobs don't move in straight lines
- Curl noise field guides direction with sweeping curves
- Flow Lerp (0.02) = slow blending = preserves momentum = sweeping paths
- Higher lerp = snappy direction changes = less organic

### RULE 5: Velocity Gradient = Frontier Races Ahead
- Generation 0 (core) blobs: nearly static
- Generation 1+: progressively faster
- accelerationFactor: 3.0 means each generation is 3x faster
- This creates the "expanding wavefront" visual

### RULE 6: Audio Reactivity (Lowest Hanging Fruit)
- Amplitude → blob size boost (subtle pulse)
- Bass → spawn rate (faster spawning on bass hits)
- Bass/Treble ratio → color hue shift (bass=warm, treble=cool)

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

## What's Wrong Currently

1. **Blobs too large**: baseBlobSize=50, growthFactor=15x = massive blobs
2. **Not enough blobs**: Only 66 blobs, should be 200+
3. **Blobs not spreading**: They stay clustered in center
4. **Spawning not visible**: New blobs spawn but merge immediately into mass
5. **No distinct wavefront**: Should see frontier racing outward

## Next Steps to Fix

1. **Reduce blob sizes**: baseBlobSize=20, shrinkFactor=0.9
2. **Increase blob count**: spawnCountRange=[2,3], lower spawnIntervalMs
3. **Increase acceleration**: So frontier visibly races ahead
4. **Study brf-auto physics.ts**: Especially `generateCoreBlobsForButton` and frontier logic
5. **Match the gooey filter**: stdDeviation and colorMatrix values from brf-auto

## Repository

- GitHub: https://github.com/semikolon/blobulator
- Dev server: http://localhost:5175/

## Audio Features Available

```typescript
interface AudioFeatures {
  amplitude: number;  // 0-1 overall loudness
  bass: number;       // 0-1 low frequency energy
  mid: number;        // 0-1 mid frequency energy
  treble: number;     // 0-1 high frequency energy
}
```

## Test Protocol

1. Run dev server: `npm run dev`
2. Open http://localhost:5175
3. Click "Start Microphone"
4. Play music
5. Observe: Should see MANY small-to-medium blobs expanding outward in organic wavefront
6. Blobs should MERGE where they overlap (gooey effect)
7. Colors should shift with bass/treble
8. Bass hits should trigger faster spawning
