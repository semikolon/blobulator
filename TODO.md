# Blobulator TODO

## Deployment

- [x] DNS: Update wildcard A record `*.fredrikbranstrom.se` → `213.164.219.201` (Dell Optiplex)
- [x] Create `config/deploy.yml` with Kamal config (+ Dockerfile, nginx.conf, .dockerignore)
- [x] Run `kamal deploy` to register with kamal-proxy (verified Jan 23, 2026: `blobulator-web` routing both subdomains)
- [ ] **Dell wildcard SSL**: Get cert via `certbot --authenticator dns-loopia -d "*.fredrikbranstrom.se" -d "fredrikbranstrom.se"`
- [ ] **Dell nginx catch-all**: Create `/etc/nginx/sites-available/wildcard-fredrikbranstrom` forwarding to kamal-proxy:3003
- [ ] Update `deploy.yml` to use Knot registry (`registry.fredrikbranstrom.se`) instead of `localhost:5555`
- [ ] Remove per-project nginx configs (brf-auto) once wildcard is working
- [ ] Consider: URL-based mode switching (e.g., `?mode=voidulator`) or subdomain detection to auto-select mode

## Future Enhancements

- [ ] Tweak Voidulator visual parameters (beamWidth, maxBounces, rotationSpeed, glow settings, colors)
- [ ] Explore additional Voidulator parameters for audio mapping (beyond glow intensity)
- [ ] Add preset system for audio-to-visual mappings
- [ ] Consider beat-sync for pulse wave frequency
