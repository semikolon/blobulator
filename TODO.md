# Blobulator TODO

## Deployment

- [x] DNS: Update wildcard A record `*.fredrikbranstrom.se` → `213.164.219.201` (Dell Optiplex)
- [x] Create `config/deploy.yml` with Kamal config (+ Dockerfile, nginx.conf, .dockerignore)
- [ ] Run `kamal deploy` to register with kamal-proxy
- [ ] Consider: URL-based mode switching (e.g., `?mode=voidulator`) or subdomain detection to auto-select mode

## Future Enhancements

- [ ] Tweak Voidulator visual parameters (beamWidth, maxBounces, rotationSpeed, glow settings, colors)
- [ ] Explore additional Voidulator parameters for audio mapping (beyond glow intensity)
- [ ] Add preset system for audio-to-visual mappings
- [ ] Consider beat-sync for pulse wave frequency
