const segmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

/** Preserve spaces. A newline occupies one blank strip, not a new text row. */
export function normalizeMessage(value) {
  return value.normalize('NFC').replace(/\r\n|[\r\n\t]/g, ' ');
}

/** Count visible characters, not UTF-16 code units. */
export function characters(value) {
  const normalized = normalizeMessage(value);
  if (segmenter) return Array.from(segmenter.segment(normalized), part => part.segment);
  return fallbackCharacters(normalized);
}

/** Conservative fallback for older engines: marks, ZWJ emoji and flag pairs. */
export function fallbackCharacters(value) {
  const result = [];
  let regionalRun = 0;
  for (const point of value) {
    const isRegional = /[\u{1F1E6}-\u{1F1FF}]/u.test(point);
    const extendsPrevious = /[\p{Mark}\uFE0E\uFE0F\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]/u.test(point);
    const previous = result.at(-1);
    if (previous && (extendsPrevious || point === '\u200D' || previous.endsWith('\u200D')
      || (isRegional && regionalRun % 2 === 1))) {
      result[result.length - 1] += point;
    } else {
      result.push(point);
    }
    regionalRun = isRegional ? regionalRun + 1 : 0;
  }
  return result;
}

/** Place the complete message across slices, preserving intentional spaces. */
export function textForSlices(value, count, alignment = 'start') {
  const letters = characters(value);
  const offset = alignment === 'center' ? Math.max(0, Math.floor((count - letters.length) / 2)) : 0;
  return [...Array(offset).fill(''), ...letters];
}
