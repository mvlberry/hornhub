# Fighter Article Embed Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Publish the fighter game at `/fighter/` and embed it directly in a new 2026-11-17 article titled “32kb的飞机游戏，纯Claude生成，夸张”.

**Architecture:** Build the existing Vite app and commit its generated files beneath Hugo's `static/fighter/`. Render the game in the article through a reusable same-origin iframe shortcode, with narrowly scoped responsive styles in the existing site stylesheet.

**Tech Stack:** Vite 6, React 19, TypeScript, Hugo 0.168, HTML iframe, CSS.

---

### Task 1: Build and vendor the game

**Files:**
- Create: `static/fighter/**`

1. Run `npm run build` in `D:\asuspc1\Documents\cocos_game_test\NewProject\fighter-web` and require a zero exit code.
2. Copy the complete `dist/` tree to `static/fighter/`.
3. Compare relative file paths, sizes, and SHA-256 hashes between `dist/` and `static/fighter/`; require an exact match.

### Task 2: Add the iframe component

**Files:**
- Create: `layouts/shortcodes/fighter-game.html`
- Modify: `assets/css/site.css`

1. Add a shortcode containing a titled iframe whose `src` is `{{ "fighter/" | relURL }}` and whose permissions include autoplay, fullscreen, and gamepad.
2. Add `.fighter-embed` styles that break out of the reading column, preserve a practical game viewport, remove mobile side gutters, and retain a visible focus state.

### Task 3: Publish the article

**Files:**
- Create: `content/post/32kb-fighter-game.md`

1. Add published front matter dated `2026-11-17T00:00:00+08:00`, slug `32kb-fighter-game`, the exact requested title, and a concise homepage description.
2. Make `{{< fighter-game >}}` the only article body content so entering the article immediately presents the game.

### Task 4: Verify and publish

1. Run `hugo --gc --minify --cleanDestinationDir` and require a zero exit code.
2. Confirm `public/post/2026/11/17/32kb-fighter-game/index.html` contains `/fighter/`, and all generated game assets exist in `public/fighter/`.
3. Serve the production output locally; require HTTP 200 for the article, iframe, JavaScript, CSS, and audio.
4. Inspect desktop and mobile screenshots for overflow, clipping, and iframe sizing.
5. Commit the scoped files, fast-forward `main`, and push `main` so the existing GitHub Actions workflow deploys to ECS.
