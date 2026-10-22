# Public Game Library Implementation Plan

**Goal:** Let visitors select and play the four owner-provided games directly from the website, without selecting local files or storing ROM binaries in Git.

**Architecture:** Preserve the existing same-origin Nginx directory listing when available. When the directory returns 403 or 404, load a bounded `index.json` catalog from the same directory. A server-side maintenance script generates that catalog from valid direct NES files. Publish copies of the four private ROMs to the public ROM directory while retaining their private backups.

**Tech Stack:** Hugo, vanilla JavaScript, JSNES 2.1.0, Python 3, SSH, Nginx static files.

## Design decisions

- The existing SSH account can publish website files but cannot reload the Docker Nginx configuration. A static JSON catalog works with its existing permissions and avoids changing server administration access.
- Keep directory listing support for installations that already enable it. Use the static catalog only for a missing or forbidden directory listing; preserve the same origin, bounded reads, request cancellation, timeout, and stale-result protections.
- The player flow is select a game, then click Start. Remove local-file controls and their copy. The Change Game action focuses the selector.
- Public ROM files and their generated catalog remain server-owned data excluded from Git and website rsync deletion. The private originals remain outside the web root.
- The owner explicitly requested public listing after being informed that age alone does not remove copyright risk. Do not claim authorization or legal safety.

## Task 1: Catalog compatibility

**Files:** `assets/js/nes-rom.mjs`, `tests/nes-player.test.cjs`.

- Add a same-directory `index.json` fallback on HTTP 403/404.
- Test direct listings, fallback success/failure, cancellation and stale responses, while retaining existing validation.

## Task 2: List-based player flow

**Files:** `assets/js/nes-player.js`, `layouts/_default/games.html`, `content/games.md`, `assets/css/nes-player.css`.

- Remove the local file input, buttons and event handler.
- Use clear list-selection instructions and a Change Game action that focuses the selector.
- Preserve keyboard/touch input, explicit playback, audio, pause/resume and restart.

## Task 3: Publish the server library

**Files:** `deploy/update-rom-library.py`, `README.md`, `static/roms/README.md`.

- Generate `index.json` atomically from direct, regular, valid iNES files only.
- Copy the four private files into `/var/www/ivy/roms/` with public-readable permissions and verify SHA-256 matches.
- Generate the server catalog and verify HTTP responses match the intended four files.
- Document uploading and refreshing the static catalog with the existing SSH account.

## Task 4: Verify and deploy

- Run the Node suite, meaningful catalog-script checks, and production Hugo build.
- Review the diff and confirm no ROMs or secrets are tracked.
- Publish the source change and confirm the production deployment succeeds.
- In Chromium, verify all four games load from the live list, render frames and respond to controls. Verify no local ROM picker remains and mobile layout fits.
