// src/engine/assets/image-meta.js — מדידת תמונות מבתים אמיתיים (שלב 3, §3.1-3)
'use strict';

/**
 * **חוזה:** spec/00_CURRENT_ENGINE_COMPLETION_PLAN.md §3.1-3 — "למדוד תמונות
 * לפי bytes/metadata אמיתיים, כולל width/height, orientation, aspect ratio,
 * fit/scale, גבולות ויחידות."
 *
 * פרסר כותרים בינארי טהור — **בלי DOM, בלי Image(), בלי decode מלא**: אותן
 * המידות ב-Node ובדפדפן בדיוק ביט-לביט (parity מבני מקור-אחד).
 *
 * **הפורמטים שהמוצר תומך בהם בפועל** (מקור: inline-content.js IMAGE_EXTENSIONS
 * לתמונות inline + מרשם העיטורים ל-SVG): PNG · JPEG · GIF · BMP · WebP.
 * רשימה זו אינה מורחבת על סמך הצהרה תיעודית — פורמט לא נתמך = אבחון מפורש.
 *
 * החזרה תמיד {ok, code?, ...}: פריט שלא ניתן למדוד אינו נעלם (§3.1-11).
 */

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SOI = [0xff, 0xd8, 0xff];

function u16be(b, o) { return (b[o] << 8) | b[o + 1]; }
function u16le(b, o) { return b[o] | (b[o + 1] << 8); }
function u32be(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
function u32le(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
function sigMatches(b, sig) { for (let i = 0; i < sig.length; i++) if (b[i] !== sig[i]) return false; return true; }
function ascii(b, o, n) { let s = ''; for (let i = 0; i < n && o + i < b.length; i++) s += String.fromCharCode(b[o + i]); return s; }

/** PNG: IHDR (חובה ראשון אחרי החתימה) — width/height/bitDepth/colorType/interlace. */
function parsePng(b) {
  if (b.length < 33) return { ok: false, code: 'png-truncated', message: 'PNG קצר מ-IHDR' };
  if (ascii(b, 12, 4) !== 'IHDR') return { ok: false, code: 'png-no-ihdr', message: 'חסר IHDR ב-PNG' };
  const width = u32be(b, 16);
  const height = u32be(b, 20);
  if (!width || !height) return { ok: false, code: 'png-zero-dims', message: 'מידות אפס ב-PNG' };
  return { ok: true, format: 'png', width, height, bitDepth: b[24], colorType: b[25], interlace: b[28], orientation: 1, animated: hasPngActl(b) };
}

function hasPngActl(b) {
  let off = 8;
  while (off + 8 <= b.length) {
    const len = u32be(b, off);
    const type = ascii(b, off + 4, 4);
    if (type === 'acTL') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    if (len > 0x7fffffff) return false;
    off += 12 + len;
  }
  return false;
}

/** JPEG: סריקת סמנים עד SOS — SOF (מידות) + App1/Exif (orientation). */
function parseJpeg(b) {
  if (b.length < 4) return { ok: false, code: 'jpeg-truncated', message: 'JPEG קצר' };
  let off = 2;
  let dims = null, orientation = null;
  while (off + 4 <= b.length) {
    if (b[off] !== 0xff) { off++; continue; }
    const marker = b[off + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { off += 2; continue; }
    if (marker === 0xda) break; // SOS — המידות חייבות להופיע לפניו
    if (marker === 0xff) { off++; continue; }
    const segLen = u16be(b, off + 2);
    if (segLen < 2 || off + 2 + segLen > b.length) return { ok: false, code: 'jpeg-bad-segment', message: 'מקטע JPEG שגוי ב-offset ' + off };
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc9 && marker <= 0xcb)) {
      dims = { width: u16be(b, off + 7), height: u16be(b, off + 5), progressive: marker === 0xc2 || marker === 0xca };
    }
    if (marker === 0xe1 && orientation == null && ascii(b, off + 4, 4) === 'Exif') {
      orientation = jpegExifOrientation(b, off + 10, off + 2 + segLen);
    }
    off += 2 + segLen;
  }
  if (!dims || !dims.width || !dims.height) return { ok: false, code: 'jpeg-no-sof', message: 'לא נמצא SOF עם מידות ב-JPEG' };
  return { ok: true, format: 'jpeg', width: dims.width, height: dims.height, progressive: !!dims.progressive, orientation: orientation || 1 };
}

/** EXIF מינימלי: TIFF header (II/MM) → IFD0 → תג 0x0112. ערך לא-חוקי = null. */
function jpegExifOrientation(b, tiffStart, end) {
  if (tiffStart + 8 > end) return null;
  const le = ascii(b, tiffStart, 2) === 'II';
  const rd16 = (o) => (le ? u16le(b, o) : u16be(b, o));
  const rd32 = (o) => (le ? u32le(b, o) : u32be(b, o));
  if (rd16(tiffStart + 2) !== 42) return null;
  const ifd = tiffStart + rd32(tiffStart + 4);
  if (ifd + 2 > end) return null;
  const count = rd16(ifd);
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > end) break;
    if (rd16(e) === 0x0112) {
      const v = rd16(e + 8);
      return (v >= 1 && v <= 8) ? v : null;
    }
  }
  return null;
}

function parseGif(b) {
  if (b.length < 10) return { ok: false, code: 'gif-truncated', message: 'GIF קצר' };
  const ver = ascii(b, 0, 6);
  if (!/^GIF8[79]a$/.test(ver)) return { ok: false, code: 'gif-bad-version', message: 'חתימת GIF שגויה' };
  const width = u16le(b, 6), height = u16le(b, 8);
  if (!width || !height) return { ok: false, code: 'gif-zero-dims', message: 'מידות אפס ב-GIF' };
  return { ok: true, format: 'gif', width, height, orientation: 1 };
}

function parseBmp(b) {
  if (b.length < 26) return { ok: false, code: 'bmp-truncated', message: 'BMP קצר' };
  const dibSize = u32le(b, 14);
  let width, height;
  if (dibSize >= 40) { width = u32le(b, 18) | 0; height = Math.abs(u32le(b, 22) | 0); }
  else if (dibSize === 12) { width = u16le(b, 18); height = u16le(b, 20); }
  else return { ok: false, code: 'bmp-bad-dib', message: 'DIB לא נתמך: ' + dibSize + ' בתים' };
  if (!width || !height) return { ok: false, code: 'bmp-zero-dims', message: 'מידות אפס ב-BMP' };
  return { ok: true, format: 'bmp', width, height, orientation: 1 };
}

function parseWebp(b) {
  if (b.length < 30) return { ok: false, code: 'webp-truncated', message: 'WebP קצר' };
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8 ') {
    const f = 20;
    if (b[f] !== 0x9d || b[f + 1] !== 0x01 || b[f + 2] !== 0x2a) return { ok: false, code: 'webp-bad-vp8', message: 'מסגרת VP8 שגויה' };
    const w = (b[f + 6] | ((b[f + 7] & 0x3f) << 8)) & 0x3fff;
    const h = (b[f + 8] | ((b[f + 9] & 0x3f) << 8)) & 0x3fff;
    if (!w || !h) return { ok: false, code: 'webp-zero-dims', message: 'מידות אפס ב-WebP' };
    return { ok: true, format: 'webp', width: w, height: h, orientation: 1 };
  }
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return { ok: false, code: 'webp-bad-vp8l', message: 'חתימת VP8L שגויה' };
    const bits = u32le(b, 21);
    const w = (bits & 0x3fff) + 1;
    const h = ((bits >> 14) & 0x3fff) + 1;
    return { ok: true, format: 'webp', width: w, height: h, orientation: 1 };
  }
  if (chunk === 'VP8X') {
    const canvasW = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
    const canvasH = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
    if (!canvasW || !canvasH) return { ok: false, code: 'webp-zero-dims', message: 'מידות קנבס אפס' };
    return { ok: true, format: 'webp', width: canvasW, height: canvasH, orientation: 1 };
  }
  return { ok: false, code: 'webp-bad-chunk', message: 'מקטע WebP לא נתמך: ' + chunk };
}

/** SVG: מידות מ-width/height/viewBox בשורש (בלי DOM — ביטויים קבועים בלבד). */
function parseSvg(b) {
  let text;
  if (typeof TextDecoder !== 'undefined') text = new TextDecoder('utf-8').decode(b);
  else text = Buffer.from(b).toString('utf8');
  const vb = text.match(/viewBox\s*=\s*["']\s*([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)/);
  const wAttr = text.match(/\bwidth\s*=\s*["']\s*([\d.]+)\s*(?:px)?["']/);
  const hAttr = text.match(/\bheight\s*=\s*["']\s*([\d.]+)\s*(?:px)?["']/);
  const width = wAttr ? Number(wAttr[1]) : (vb ? Number(vb[3]) : null);
  const height = hAttr ? Number(hAttr[1]) : (vb ? Number(vb[4]) : null);
  if (width == null || height == null || !isFinite(width) || !isFinite(height) || width <= 0 || height <= 0) {
    return { ok: false, code: 'svg-no-dims', message: 'ל-SVG אין width/height/viewBox קבועים וחיוביים' };
  }
  return { ok: true, format: 'svg', width, height, orientation: 1 };
}

/**
 * measureImageMeta — המדידה הקנונית של מטא-נתוני תמונה מבתים.
 * @param {Uint8Array|Buffer} bytes
 * @returns {{ok:boolean, code?:string, message?:string, format?:string, width?:number, height?:number,
 *            orientation?:number, displayWidth?:number, displayHeight?:number, aspectRatio?:number,
 *            swapOrientation?:boolean, animated?:boolean}}
 */
function measureImageMeta(bytes) {
  if (!bytes || !bytes.length) return { ok: false, code: 'empty-bytes', message: 'נכס תמונה ריק (0 בתים)' };
  const b = bytes;
  let r;
  if (sigMatches(b, PNG_SIG)) r = parsePng(b);
  else if (sigMatches(b, JPEG_SOI)) r = parseJpeg(b);
  else if (ascii(b, 0, 4) === 'GIF8') r = parseGif(b);
  else if (ascii(b, 0, 2) === 'BM') r = parseBmp(b);
  else if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') r = parseWebp(b);
  else if (/^\s*(?:<\?xml[\s\S]{0,200}?\?>\s*)?<svg[\s>]/i.test(ascii(b, 0, 512))) r = parseSvg(b);
  else return { ok: false, code: 'unsupported-format', message: 'פורמט תמונה לא נתמך (הנתמכים: PNG/JPEG/GIF/BMP/WebP/SVG עם מידות קבועות)' };
  if (!r.ok) return r;
  const swap = r.orientation >= 5;
  const effW = swap ? r.height : r.width;
  const effH = swap ? r.width : r.height;
  return {
    ok: true, format: r.format, width: r.width, height: r.height,
    orientation: r.orientation,
    displayWidth: effW, displayHeight: effH,
    aspectRatio: effW / effH,
    swapOrientation: swap,
    animated: !!r.animated
  };
}

module.exports = { measureImageMeta };
