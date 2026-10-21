# Server ROM Library Implementation Plan

> Execute the implementation and verification in this session; the user authorized committing and pushing the completed changes.

**Goal:** Publish the first article and let visitors select NES games uploaded directly to the owner's server, without committing ROM files or rebuilding Hugo for each upload.

**Architecture:** Nginx exposes a JSON listing of the site's `roms/` directory. The games page fetches that listing and offers a selector with explicit start and refresh actions. Deployments exclude the entire server-owned ROM directory, preserving uploaded games. Existing emulator controls and browser-local file loading remain available.

**Tech Stack:** Hugo, Nginx autoindex JSON, vendored JSNES 2.1.0, vanilla JavaScript/CSS, Node built-in tests, GitHub Actions and rsync.

---

### Task 1: Publish the completed article

- Change only `draft` to `false` in `content/post/sunyuchen-alan-interview.md`.
- Preserve the user's reflection wording and its accepted formatting.

### Task 2: Load the server catalog

**Files:** `assets/js/nes-rom.mjs`, `assets/js/nes-player.js`, `assets/css/nes-player.css`, `layouts/_default/games.html`, `content/games.md`, `tests/nes-player.test.cjs`.

- Replace the two build-time game slots with a server-backed selector, start button and refresh button.
- Parse only direct `.nes` file entries, encode filenames safely, preserve same-origin downloads, size limits and timeout behavior, and render names as text.
- Keep loading, empty and error states independent of active gameplay; cancel superseded listing requests.
- Cover encoded/unsafe filenames, empty/error/oversized listings and request races with meaningful tests; retain existing ROM/core/audio checks.

### Task 3: Preserve and serve uploaded ROMs

**Files:** `.github/workflows/deploy.yml`, `deploy/nginx-ivy.conf.example`, `deploy/nginx-roms.conf.example`, `.gitignore`, `README.md`, `static/roms/README.md`; remove obsolete `data/games.yaml`.

- Exclude `/roms/***` from both synchronization and deletion.
- Configure JSON directory listing without cache; serve only direct ROM files and reject unsupported paths and symlink access.
- Document server upload location, container root mapping, permissions and temporary-name uploads followed by rename.
- Ensure ROM binaries and local secrets cannot enter the commit.

### Task 4: Verify and push

- Run `node --test tests/nes-player.test.cjs` and production Hugo build.
- Verify the article is published, the game selector works, and NES scripts remain scoped to the games page.
- Inspect the actual server configuration through its existing authenticated connection; apply the bounded Nginx change with backup, `nginx -t` and reload if access permits.
- Verify the deployed catalog and key routes; use an original synthetic ROM for gameplay checks.
- Review/stage the current content and game changes, commit, push the current `main` branch without force, and check the resulting deployment status.

## Verification results

- All 17 Node tests pass, including catalog parsing, encoded filenames, bounded reads, cancellation, ROM execution and audio behavior.
- Production Hugo build passes. The first article appears on the homepage; emulator assets are scoped to `/games/`.
- Eighteen Chrome checks pass: encoded Chinese filenames, explicit start, rendered frames, catalog refresh without restarting gameplay, empty/error/retry states, local ROMs, pause/resume and 390/360/320 px layouts.
- A temporary rsync experiment on the server confirms that uploaded ROMs survive while stale site files are removed, and build-time `roms/` files are not copied into the server-owned directory.
- `/var/www/ivy/roms/` has been created and is writable by the existing deployment user. That account cannot run Docker or sudo; the Nginx snippet still requires a one-time administrator installation and reload. Until then the live `/roms/` route returns HTTP 403.
