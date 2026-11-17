# Fighter article embed design

Goal: publish the existing `fighter-web` build as a same-origin interactive page and make a new 2026-11-17 blog article open directly onto the game.

The game remains an isolated Vite application at `/fighter/`. Hugo copies the compiled files from `static/fighter/` without rewriting them, and the Vite build's relative asset base keeps JavaScript, CSS, and audio URLs valid. The article uses a small Hugo shortcode to render a same-origin iframe, preventing the game's full-screen CSS and keyboard handlers from affecting the blog shell.

The article keeps the normal site header, title, and date. Its first and only body element is a wide responsive iframe. On desktop the frame breaks out of the reading column up to 1280 pixels; on mobile it reaches the viewport edges and uses nearly the full dynamic viewport height. The iframe permits fullscreen, audio, and gamepad access. A fallback link remains available when iframe rendering is unavailable.

Verification covers the Vite production build, exact copying of generated assets, Hugo's production build, the generated article and iframe URLs, local HTTP responses, and desktop/mobile visual rendering.
