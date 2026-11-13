# Contributing to TileZip

Thanks for making a small tool better.

## Local setup

Use Node.js 22 or newer, then run `npm run dev`. There are no npm dependencies to install. The site is served at http://localhost:4173.

Before opening a pull request, run:

```bash
npm test
npm run check
npm run build
```

## Keep these promises

- Images are processed locally. Do not add analytics, uploads or third-party runtime requests.
- Preserve original source pixels. Crop boundaries must cover the entire image exactly once.
- Preview and export must share the same drawing logic.
- Spaces and visible Unicode characters occupy one slice each. Never silently discard text.
- Keep the core workflow short: choose, split, preview, download.
- Prefer a small browser-native implementation over new dependencies.
- Keep buttons, labels, keyboard interactions and reduced-motion behavior accessible.

Use ES modules, two-space indentation and descriptive names. Add a test for any changed cropping, filename, text or ZIP behavior. Describe visual changes and include a screenshot when helpful.

For bug reports, include your browser/version, operating system, image dimensions, chosen settings and reproduction steps. Please do not attach private photos; a synthetic image is usually enough.

Read the optional browser test instructions in the README before changing export or input behavior.
