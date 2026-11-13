export const FONT_STYLES = {
  classic: { family: '"Times New Roman", Times, serif', weight: 700 },
  italic: { family: 'Georgia, "Times New Roman", serif', weight: 400, style: 'italic' },
  impact: { family: 'Impact, Haettenschweiler, "Arial Narrow", sans-serif', weight: 900 },
  rounded: { family: '"Trebuchet MS", Verdana, sans-serif', weight: 700 },
  handwritten: { family: '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive', weight: 400 },
  editorial: { family: 'Georgia, "Times New Roman", serif', weight: 400 },
  bold: { family: 'Arial, Helvetica, sans-serif', weight: 700 },
  mono: { family: '"Courier New", monospace', weight: 700 },
};
export const FORMATS = {
  png: { type: 'image/png', extension: 'png' },
  jpg: { type: 'image/jpeg', extension: 'jpg' },
  webp: { type: 'image/webp', extension: 'webp' },
};

/** One renderer is shared by the preview and full-resolution export. */
export function renderSlice(source, slice, options, character = '', maxHeight = Infinity) {
  const scale = Math.min(1, maxHeight / slice.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(slice.width * scale));
  canvas.height = Math.max(1, Math.round(slice.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not create an image canvas.');
  // Scale x/y independently only to account for preview pixel rounding.
  context.scale(canvas.width / slice.width, canvas.height / slice.height);
  context.imageSmoothingQuality = 'high';
  if (options.format === 'jpg') {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, slice.width, slice.height);
  }
  context.drawImage(source, slice.x, slice.y, slice.width, slice.height, 0, 0, slice.width, slice.height);
  if (options.textEnabled && character && !/^\s+$/u.test(character)) {
    drawCharacter(context, slice.width, slice.height, character, options);
  }
  return canvas;
}

function drawCharacter(context, width, height, character, options) {
  const style = FONT_STYLES[options.font] ?? FONT_STYLES.editorial;
  const maxWidth = width * 0.84;
  let size = Math.min(width * options.textSize, height * 0.24);
  context.font = `${style.style ?? "normal"} ${style.weight} ${size}px ${style.family}`;
  const measured = context.measureText(character).width;
  if (measured > maxWidth) size *= maxWidth / measured;
  context.font = `${style.style ?? "normal"} ${style.weight} ${size}px ${style.family}`;
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  const metrics = context.measureText(character);
  const ascent = metrics.actualBoundingBoxAscent || size * 0.8;
  const descent = metrics.actualBoundingBoxDescent || size * 0.15;
  const padding = height * 0.055;
  const y = options.position === 'middle' ? (height + ascent - descent) / 2
    : options.position === 'bottom' ? height - padding - descent : padding + ascent;
  if (options.shadow) {
    context.shadowColor = 'rgba(0, 0, 0, 0.48)';
    context.shadowBlur = Math.max(1, size * 0.1);
    context.shadowOffsetY = Math.max(0.5, size * 0.025);
  }
  context.fillStyle = options.color;
  context.fillText(character, width / 2, y);
}

export function encodeCanvas(canvas, format, quality = 0.94) {
  const expected = FORMATS[format];
  if (!expected) throw new TypeError('Unsupported image format.');
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(blob => {
        if (!blob) return reject(new Error('Not enough memory to encode this image. Try a smaller source.'));
        if (blob.type !== expected.type) {
          return reject(new Error(`${format.toUpperCase()} export is not supported in this browser. Choose PNG instead.`));
        }
        resolve(blob);
      }, expected.type, quality);
    } catch (error) { reject(error); }
  });
}
