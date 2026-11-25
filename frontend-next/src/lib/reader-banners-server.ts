import sharp from 'sharp';
import { readerBannerBounds } from './reader-banners';

function sampleBox12x12(raw: Buffer, width: number, top: number, bandHeight: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(12 * 12 * 4);
  let idx = 0;
  for (let by = 0; by < 12; by++) {
    const y0 = top + Math.floor((by * bandHeight) / 12);
    const y1 = Math.max(y0 + 1, top + Math.floor(((by + 1) * bandHeight) / 12));
    for (let bx = 0; bx < 12; bx++) {
      const x0 = Math.floor((bx * width) / 12);
      const x1 = Math.max(x0 + 1, Math.floor(((bx + 1) * width) / 12));
      let r = 0;
      let g = 0;
      let b = 0;
      let cnt = 0;
      for (let y = y0; y < y1; y++) {
        let offset = (y * width + x0) * 4;
        for (let x = x0; x < x1; x++) {
          r += raw[offset];
          g += raw[offset + 1];
          b += raw[offset + 2];
          offset += 4;
          cnt++;
        }
      }
      out[idx++] = Math.round(r / cnt);
      out[idx++] = Math.round(g / cnt);
      out[idx++] = Math.round(b / cnt);
      out[idx++] = 255;
    }
  }
  return out;
}

export async function stripTruyenGgBanner(
  input: Buffer,
  contentType: string
): Promise<{ buffer: Buffer; contentType: string; cropped: boolean }> {
  try {
    const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height } = info;
    if (!width || !height || height < 200) {
      return { buffer: input, contentType, cropped: false };
    }
    const { top, bottom } = readerBannerBounds(width, height, (y, bandHeight) =>
      sampleBox12x12(data, width, y, bandHeight)
    );
    if (top <= 0 && bottom >= height) {
      return { buffer: input, contentType, cropped: false };
    }
    const cropped = await sharp(input)
      .extract({ left: 0, top, width, height: bottom - top })
      .jpeg({ quality: 92 })
      .toBuffer();
    return { buffer: cropped, contentType: 'image/jpeg', cropped: true };
  } catch {
    return { buffer: input, contentType, cropped: false };
  }
}
