# Blobulator TODO

## Deployment

- [ ] Configure Kamal to deploy to Dell Optiplex with dual domain support:
  - `voidulator.fredrikbranstrom.se` → Blobulator app (Voidulator mode)
  - `blobulator.fredrikbranstrom.se` → Blobulator app (Blobulator mode)
  - Both domains should resolve to the same deployment
  - Consider: URL-based mode switching (e.g., `?mode=voidulator`) or subdomain detection

## Future Enhancements

- [ ] Tweak Voidulator visual parameters (beamWidth, maxBounces, rotationSpeed, glow settings, colors)
- [ ] Explore additional Voidulator parameters for audio mapping (beyond glow intensity)
- [ ] Add preset system for audio-to-visual mappings
- [ ] Consider beat-sync for pulse wave frequency
