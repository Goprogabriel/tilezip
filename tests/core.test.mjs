import test from 'node:test';
import assert from 'node:assert/strict';
import { getSlices, tileFilename, archiveFilename } from '../src/lib/slices.js';
import { characters, fallbackCharacters, normalizeMessage, textForSlices } from '../src/lib/text.js';
import { crc32, createZip } from '../src/lib/zip.js';
import { detectImageType, validateDimensions } from '../src/lib/image.js';

const bytes = value => new TextEncoder().encode(value);

test('equal-width slices have exact integer source coordinates', () => {
  assert.deepEqual(getSlices(100, 50, 4), [
    { index: 0, x: 0, y: 0, width: 25, height: 50 },
    { index: 1, x: 25, y: 0, width: 25, height: 50 },
    { index: 2, x: 50, y: 0, width: 25, height: 50 },
    { index: 3, x: 75, y: 0, width: 25, height: 50 },
  ]);
});

test('odd widths cover every pixel exactly once, for every supported count', () => {
  for (const width of [2, 3, 7, 20, 301, 1001, 3601, 16383, 16384]) {
    for (let count = 2; count <= Math.min(width, 20); count++) {
      const slices = getSlices(width, 777, count);
      let next = 0;
      for (const slice of slices) {
        assert.equal(slice.x, next);
        assert.ok(slice.width > 0);
        assert.equal(slice.height, 777);
        next += slice.width;
      }
      assert.equal(next, width);
      const widths = slices.map(s => s.width);
      assert.ok(Math.max(...widths) - Math.min(...widths) <= 1);
    }
  }
});

test('invalid dimensions and empty strips are rejected', () => {
  for (const args of [[0, 30, 2], [10, -1, 2], [3, 3, 4], [10, 5, 0], [3.5, 5, 2], [20, 30, NaN], [10, Infinity, 2]]) {
    assert.throws(() => getSlices(...args), RangeError);
  }
});

test('numeric filenames sort in left-to-right order', () => {
  const names = Array.from({ length: 20 }, (_, i) => tileFilename(i, 20, 'png'));
  assert.equal(names[0], '01.png');
  assert.equal(names[19], '20.png');
  assert.deepEqual([...names].sort(), names);
  assert.equal(tileFilename(0, 100, 'webp'), '001.webp');
  assert.equal(tileFilename(2, 8, 'jpg'), '03.jpg');
});

test('filenames reject invalid indices and image formats', () => {
  assert.throws(() => tileFilename(-1, 20, 'png'), RangeError);
  assert.throws(() => tileFilename(20, 20, 'png'), RangeError);
  assert.throws(() => tileFilename(0, 20, '../exe'), TypeError);
});

test('archive names are useful and path-safe', () => {
  assert.equal(archiveFilename('My lovely photo.jpg', 12), 'tilezip-My-lovely-photo-12-slices.zip');
  assert.equal(archiveFilename('../../hello.png', 2), 'tilezip-hello-2-slices.zip');
  assert.equal(archiveFilename('å.png', 3), 'tilezip-a-3-slices.zip');
});

test('spaces occupy an entire slice, including leading and trailing spaces', () => {
  assert.equal(characters('STAY CURIOUS').length, 12);
  assert.deepEqual(characters(' A '), [' ', 'A', ' ']);
  assert.deepEqual(characters('A  B'), ['A', ' ', ' ', 'B']);
});

test('accented letters and composed characters are counted correctly', () => {
  assert.deepEqual(characters('ÆØÅ'), ['Æ', 'Ø', 'Å']);
  assert.deepEqual(characters('e\u0301'), ['é']);
  assert.equal(characters('é').length, 1);
});

test('emoji families, skin tones and flags count as visible characters', () => {
  assert.deepEqual(characters('A👨‍👩‍👧‍👦🇩🇰👍🏽B'), ['A', '👨‍👩‍👧‍👦', '🇩🇰', '👍🏽', 'B']);
});

test('fallback preserves common emoji clusters and combining marks', () => {
  assert.deepEqual(fallbackCharacters('👨‍👩‍👧‍👦🇩🇰🇸🇪👍🏽e\u0301'), ['👨‍👩‍👧‍👦', '🇩🇰', '🇸🇪', '👍🏽', 'e\u0301']);
});

test('newlines and tabs become spaces, without trimming', () => {
  assert.equal(normalizeMessage(' A\r\nB\tC\n'), ' A B C ');
  assert.deepEqual(characters(''), []);
});

test('PNG, JPEG and WebP are validated by magic bytes', async () => {
  assert.equal(await detectImageType(new Blob([new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0])])), 'image/png');
  assert.equal(await detectImageType(new Blob([new Uint8Array([255,216,255,224])])), 'image/jpeg');
  assert.equal(await detectImageType(new Blob([bytes('RIFF0000WEBPVP8X')])), 'image/webp');
  await assert.rejects(() => detectImageType(new Blob(['<svg></svg>'], { type: 'image/png' })));
  await assert.rejects(() => detectImageType(new Blob(['GIF89a'])));
});

test('image guardrails reject oversized sources', () => {
  assert.doesNotThrow(() => validateDimensions(8000, 4000));
  assert.doesNotThrow(() => validateDimensions(2, 1));
  assert.throws(() => validateDimensions(1, 1));
  assert.throws(() => validateDimensions(8001, 4000));
  assert.throws(() => validateDimensions(16385, 2));
});

test('CRC32 matches the standard known vector', () => {
  assert.equal(crc32(bytes('123456789')), 0xcbf43926);
  assert.equal(crc32(bytes('')), 0);
});

test('ZIP contains valid local records, central directory offsets and checksums', async () => {
  const entries = [
    { name: '01.png', blob: new Blob([bytes('first payload')]) },
    { name: '02.png', blob: new Blob([new Uint8Array([0, 255, 42, 0])]) },
    { name: '03.png', blob: new Blob([]) },
  ];
  const progress = [];
  const zip = await createZip(entries, { onProgress: x => progress.push(x), date: new Date('2026-11-13T12:00:00Z') });
  assert.equal(zip.type, 'application/zip');
  const raw = new Uint8Array(await zip.arrayBuffer());
  const view = new DataView(raw.buffer);
  const locals = [];
  let offset = 0;
  for (const entry of entries) {
    locals.push(offset);
    assert.equal(view.getUint32(offset, true), 0x04034b50);
    assert.equal(view.getUint16(offset + 6, true), 0x0800);
    assert.equal(view.getUint16(offset + 8, true), 0);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    assert.equal(size, entry.blob.size);
    assert.equal(new TextDecoder().decode(raw.slice(offset + 30, offset + 30 + nameLength)), entry.name);
    const payload = raw.slice(offset + 30 + nameLength, offset + 30 + nameLength + size);
    assert.deepEqual(payload, new Uint8Array(await entry.blob.arrayBuffer()));
    assert.equal(view.getUint32(offset + 14, true), crc32(payload));
    offset += 30 + nameLength + size;
  }
  const centralOffset = offset;
  for (let i = 0; i < entries.length; i++) {
    assert.equal(view.getUint32(offset, true), 0x02014b50);
    assert.equal(view.getUint32(offset + 42, true), locals[i]);
    offset += 46 + bytes(entries[i].name).length;
  }
  assert.equal(view.getUint32(offset, true), 0x06054b50);
  assert.equal(view.getUint16(offset + 10, true), 3);
  assert.equal(view.getUint32(offset + 16, true), centralOffset);
  assert.equal(offset + 22, raw.length);
  assert.equal(progress.at(-1), 1);
});

test('ZIP handles UTF-8 filenames', async () => {
  const blob = await createZip([{ name: 'billede-å.png', blob: new Blob(['pixels']) }]);
  const raw = new Uint8Array(await blob.arrayBuffer());
  const length = new DataView(raw.buffer).getUint16(26, true);
  assert.equal(new TextDecoder().decode(raw.slice(30, 30 + length)), 'billede-å.png');
});

test('ZIP rejects directory traversal, duplicate names and no entries', async () => {
  const blob = new Blob(['x']);
  for (const name of ['../01.png', 'a/b.png', 'a\\b.png', '', '.', '..', 'a\0b']) {
    await assert.rejects(() => createZip([{ name, blob }]));
  }
  await assert.rejects(() => createZip([{ name: 'a.png', blob }, { name: 'a.png', blob }]));
  await assert.rejects(() => createZip([]));
});

test('ZIP can be cancelled before or during processing', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => createZip([{ name: '01.png', blob: new Blob(['x']) }], { signal: controller.signal }), { name: 'AbortError' });
  const active = new AbortController();
  await assert.rejects(() => createZip([
    { name: '01.png', blob: new Blob(['a']) }, { name: '02.png', blob: new Blob(['b']) },
  ], { signal: active.signal, onProgress: () => active.abort() }), { name: 'AbortError' });
});

test('message placement preserves characters and balances blank slices', () => {
  assert.deepEqual(textForSlices('HI', 6, 'start'), ['H', 'I']);
  assert.deepEqual(textForSlices('HI', 6, 'center'), ['', '', 'H', 'I']);
  assert.deepEqual(textForSlices('HI', 5, 'center'), ['', 'H', 'I']);
  assert.deepEqual(textForSlices(' A ', 7, 'center'), ['', '', ' ', 'A', ' ']);
  assert.deepEqual(textForSlices('👩‍👩‍👧‍👦Ø', 4, 'center'), ['', '👩‍👩‍👧‍👦', 'Ø']);
  assert.deepEqual(textForSlices('LONG', 2, 'center'), ['L', 'O', 'N', 'G']);
  assert.deepEqual(textForSlices('', 4, 'center'), ['', '']);
});
