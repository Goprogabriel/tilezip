# Release checks — TileZip 1.0.0

These checks were run against the source included in this archive. The GitHub repository and live Pages site have not been created or deployed as part of packaging.

## Automated core checks

**18 Node.js tests passed.**

The suite covers equal and uneven crop widths, all supported counts across several image sizes, rejection of empty strips, numeric filename sorting, safe archive names, spaces and line breaks, Danish and composed characters, emoji clusters and flags, image signatures, dimension limits, CRC32, ZIP local and central records, Unicode filenames, path traversal, duplicate entries and cancellation.

`npm run check` also passed: JavaScript syntax, referenced HTML IDs and required static assets. `npm run build` completed successfully.

## Browser checks

**38 Chromium checks passed.** The included `tests/browser.py` is the executable checklist.

The managed browser environment used for these checks does not permit HTTP navigation. Tests therefore used `--embedded`: the actual source modules, stylesheet, HTML and local demo asset were loaded into an isolated test document, preserving the ES module dependency graph. Local source and built-site HTTP responses were checked separately. This does not substitute for testing the production Content Security Policy or a real hosted deployment.

The browser checks include:

- Demo loading; native horizontal overflow; arrow, keyboard and mouse-drag navigation; original-image view.
- Character-driven count, spaces, overflowing text, no silent truncation and Unicode graphemes.
- Actual ZIP output read by Python's independent `zipfile` implementation, including its CRC verification.
- A 1001 × 311 opaque PNG exported to 20 strips, recombined in order and compared pixel-for-pixel with the source. The result was identical.
- Text present in the exported letter strips; the intervening space strip unchanged.
- PNG, JPEG and WebP output opened by Pillow, rather than merely checking filename extensions.
- Transparent PNG preservation, explicit white JPEG background, and phone-photo EXIF rotation.
- Rejection of disguised SVG and corrupt PNG input, with the previous image retained.
- File selection, synthetic local image paste/drop, reset and export cancellation.
- Layouts at 320, 390, 768, 1024 and 1440 pixels without page-level horizontal overflow.
- Reduced-motion behavior and no uncaught JavaScript errors.

The README demo is a recording of this actual interface, not a proposed design.

## Not covered

No live GitHub Pages deployment, real X upload, Firefox, Safari, iOS device or Android device was validated. Mobile-sized Chromium layouts are not equivalent to testing physical phones. Browser-specific file pickers, memory limits and download restrictions may differ.

PNG reconstruction was checked using an opaque, color-profile-free test image. Photos with embedded color profiles and partially transparent pixels pass through browser color management and canvas compositing; metadata and original encoded bytes are not preserved.

A manual **download again** link remains available because automatic Blob downloads can be restricted by browsers. The product preview deliberately does not claim to reproduce a social platform's exact crop or spacing rules.

## Re-run

```bash
npm test
npm run check
npm run build
```

Optional browser checks are documented in the README. Run the normal HTTP mode in an unrestricted local browser environment before making browser-compatibility claims.
