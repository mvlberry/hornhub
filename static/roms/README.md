# Server-managed NES ROMs

Upload ROMs directly to the server's site-root `roms/` directory, normally
`/var/www/ivy/roms/` on the host or `/usr/share/nginx/html/roms/` inside its
existing Nginx container. Do not put ROMs in this repository or edit YAML.

Enable `deploy/nginx-roms.conf.example` in the site's Nginx server block.
The games page reads its same-origin JSON directory listing at `/roms/`.
Refresh the list after uploading, renaming or removing a game; no rebuild
is required. GitHub Actions excludes the entire server ROM directory from
rsync so deployments cannot replace or delete it.

Use a real directory, without symlinks or subdirectories, and keep only
ROMs suitable for public distribution there. Upload with a temporary
non-`.nes` extension, then atomically rename the completed file to `.nes`.

Only uncompressed iNES `.nes` files up to 8 MiB are supported. ZIP, FDS and
NES 2.0 files are not supported. No ROMs are bundled. Names, file metadata
and ROM downloads are public; this directory is not private storage.

For local development, the browser's local ROM picker reads a file without
uploading it. Hugo's development server does not provide Nginx JSON listings.
