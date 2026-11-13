/**
 * Partition integer pixels without overlaps or missing columns.
 * The final strip includes the rightmost pixel, even for odd image widths.
 */
export function getSlices(width, height, count) {
  if (![width, height, count].every(Number.isSafeInteger)
    || width < 1 || height < 1 || count < 1 || count > width) {
    throw new RangeError('Choose a slice count no greater than the image width.');
  }
  return Array.from({ length: count }, (_, index) => {
    const x = Math.floor(index * width / count);
    const right = Math.floor((index + 1) * width / count);
    return { index, x, y: 0, width: right - x, height };
  });
}

/** At least two digits: 01.png, 02.png, …, 20.png. */
export function tileFilename(index, count, extension) {
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new RangeError('Invalid tile index.');
  }
  if (!['png', 'jpg', 'webp'].includes(extension)) {
    throw new TypeError('Unsupported file extension.');
  }
  return `${String(index + 1).padStart(Math.max(2, String(count).length), '0')}.${extension}`;
}

export function archiveFilename(originalName, count) {
  const stem = originalName.replace(/\.[^.]+$/, '').normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 60) || 'image';
  return `tilezip-${stem}-${count}-slices.zip`;
}
