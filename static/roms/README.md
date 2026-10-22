# Server-managed NES ROMs

Upload ROMs directly to the server's site-root `roms/` directory, normally
`/var/www/ivy/roms/` on the host or `/usr/share/nginx/html/roms/` inside its
existing Nginx container. Do not put ROMs in this repository or edit YAML.

The games page first reads a same-origin JSON directory listing at `/roms/`.
Enable `deploy/nginx-roms.conf.example` in the site's Nginx server block to
generate that listing automatically. If the directory returns 403 or 404,
the player reads `/roms/index.json` instead. Generate this static catalog
with the existing upload account; administrator access is not required:

```bash
python3 ~/.local/bin/update-rom-library.py /var/www/ivy/roms/
```

First upload `deploy/update-rom-library.py` to that account's private
`~/.local/bin/` directory. Run it after uploading, renaming or removing a
game, then refresh the list. No website rebuild is required. GitHub Actions
excludes the entire server ROM directory, including the catalog, from rsync
so deployments cannot replace or delete it.

Use a real directory, without symlinks or subdirectories, and keep only
ROMs suitable for public distribution there. Upload with a temporary
non-`.nes` extension, then atomically rename the completed file to `.nes`.

Only uncompressed iNES `.nes` files up to 8 MiB are supported. ZIP, FDS and
NES 2.0 files are not supported. No ROMs are bundled. Names, file metadata
and ROM downloads are public; this directory is not private storage. Game
age, free access, and keeping binaries out of Git do not grant distribution
rights. Keep private backups outside the web root.

Players select a server-hosted game and click Start; there is no local-file
picker. Hugo's development server does not provide Nginx JSON listings.
