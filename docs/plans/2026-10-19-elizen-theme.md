# Elizen-style Ivy adaptation

Goal: Use the current elizen.me reading-column design on the existing Hugo site, with user-authored content.

Architecture: Retain the Ivy submodule and adapt the site's public Ivy styles through project-level overrides. The source theme identifies its license as Unlicense. Keep content and deployment independent of the visual layer.

1. Bring across the reading-column and homepage styles, excluding site-specific catalogs and comments. Preserve source attribution.
2. Add configurable homepage, header, archive, taxonomy and article templates. Preserve existing article URLs and use Hugo's built-in syntax highlighting.
3. Replace setup instructions on public pages with minimal empty states; retain the starter article as a draft. Document authoring and homepage fields.
4. Build with Hugo and verify desktop/mobile navigation, empty lists, draft exclusion, article rendering and local links. Use temporary content outside the production content directory for populated-page checks.

Reference: https://elizen.me/ and https://github.com/elizen/elizen-blog/tree/master/themes/ivy

No remote deployment or Git commits are part of this change.
