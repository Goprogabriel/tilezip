import { MAX_FILE_BYTES, MAX_IMAGE_PIXELS, MAX_IMAGE_DIMENSION } from '../config.js';

export async function detectImageType(file) {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const ascii = new TextDecoder().decode(bytes);
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
  throw new Error('Choose a JPG, PNG or WebP image.');
}

export function validateDimensions(width, height) {
  if (width < 2 || height < 1) throw new Error('That image is too small to split.');
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || width * height > MAX_IMAGE_PIXELS) {
    throw new Error('That image is too large. Use up to 32 megapixels and 16,384 pixels per side.');
  }
}

function decodedImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        validateDimensions(image.naturalWidth, image.naturalHeight);
        resolve(image);
      } catch (error) { reject(error); }
    };
    image.onerror = () => reject(new Error('This image could not be opened. Try another JPG, PNG or WebP.'));
    image.src = url;
  });
}

/** Browser decoding respects the source photo's EXIF orientation. */
export async function loadFile(file) {
  if (!file.size) throw new Error('That file is empty. Choose an image.');
  if (file.size > MAX_FILE_BYTES) throw new Error('Choose an image smaller than 40 MB.');
  await detectImageType(file);
  const url = URL.createObjectURL(file);
  try {
    const image = await decodedImage(url);
    return { image, url, name: file.name, isDemo: false, revoke: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export async function loadDemo(url) {
  return { image: await decodedImage(url), url, name: 'desert-study.jpg', isDemo: true, revoke() {} };
}
