/**
 * Document checks (computer vision) — Challenge 08 "fake documents", Challenge 07 "blurry photos".
 *
 * 1. Image quality: Laplacian variance (blur) + brightness, via sharp. Blurry → spoken "retake" prompt.
 * 2. Signed QR: mock CNICs carry a QR holding an Asli-signed payload (issued by the mock NADRA).
 *    Decoded with jsQR; signature verified; fields compared with the claim. Edited QR → forgery signal.
 * 3. Vision read (Claude, when configured): printed fields + visible edit signs.
 * 4. Tamper score combines: printed fields ≠ signed QR fields, visible edit signs, editing-software metadata.
 * All checks report what they could NOT check, so false alarms and blind spots are visible.
 */
import sharp from "sharp";
import jsQR from "jsqr";
import QRCode from "qrcode";
import type { DB } from "../db/client";
import { verifyToken, signPayload } from "../lib/signing";
import { normalizeCnic, nameSimilarity } from "./names";
import type { DocumentReading } from "../ai/claude";

export type ImageQuality = { width: number; height: number; blurVariance: number; brightness: number; blurry: boolean; tooDark: boolean };
export type QrCheck = { found: boolean; valid: boolean | null; payload: Record<string, unknown> | null; reason?: string };

export type DocumentCheckResult = {
  quality: ImageQuality | null;
  qr: QrCheck;
  reading: DocumentReading | null;
  extracted: { fullName?: string | null; fatherName?: string | null; cnic?: string | null; dob?: string | null; monthlyIncome?: number | null };
  tamperScore: number;
  tamperReasons: string[];
  readable: boolean;
  blurry: boolean;
  notChecked: string[];
};

export const BLUR_THRESHOLD = 60; // Laplacian variance below this ≈ blurry for card photos

export async function imageQuality(buf: Buffer): Promise<ImageQuality | null> {
  try {
    const img = sharp(buf).rotate();
    const meta = await img.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    // Downscale for speed, greyscale, Laplacian kernel.
    const target = Math.min(800, width || 800);
    const lap = await sharp(buf)
      .rotate()
      .resize({ width: target, withoutEnlargement: true })
      .greyscale()
      .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], scale: 1, offset: 128 })
      .raw()
      .toBuffer();
    let sum = 0;
    let sumSq = 0;
    for (const v of lap) {
      sum += v;
      sumSq += v * v;
    }
    const n = lap.length || 1;
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    const stats = await sharp(buf).greyscale().stats();
    const brightness = stats.channels[0]?.mean ?? 0;
    return {
      width,
      height,
      blurVariance: Math.round(variance * 10) / 10,
      brightness: Math.round(brightness),
      blurry: variance < BLUR_THRESHOLD,
      tooDark: brightness < 45,
    };
  } catch {
    return null;
  }
}

export async function decodeQr(buf: Buffer): Promise<string | null> {
  try {
    const { data, info } = await sharp(buf).rotate().resize({ width: 1000, withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const code = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), info.width, info.height);
    return code?.data ?? null;
  } catch {
    return null;
  }
}

export async function checkQr(db: DB, buf: Buffer): Promise<QrCheck> {
  const raw = await decodeQr(buf);
  if (!raw) return { found: false, valid: null, payload: null };
  const v = await verifyToken(db, raw);
  if (!v.ok) return { found: true, valid: false, payload: v.payload ?? null, reason: v.reason };
  if (v.payload.typ !== "mock_cnic") return { found: true, valid: false, payload: v.payload, reason: "WRONG_TYPE" };
  return { found: true, valid: true, payload: v.payload };
}

async function editingSoftware(buf: Buffer): Promise<string | null> {
  try {
    const meta = await sharp(buf).metadata();
    const exif = meta.exif?.toString("latin1") ?? "";
    const m = exif.match(/(Adobe Photoshop|GIMP|Snapseed|PicsArt|Canva|Pixlr)[^\0]{0,20}/i);
    return m ? m[0] : null;
  } catch {
    return null;
  }
}

export async function checkDocument(
  db: DB,
  buf: Buffer,
  mime: string,
  claim: { fullName?: string | null; fatherName?: string | null; cnic?: string | null; dob?: string | null },
  reading: DocumentReading | null,
): Promise<DocumentCheckResult> {
  const notChecked: string[] = [];
  const isImage = /^image\//.test(mime);
  const quality = isImage ? await imageQuality(buf) : null;
  if (!isImage) notChecked.push("image_quality");
  const qr = isImage ? await checkQr(db, buf) : { found: false, valid: null, payload: null };
  if (!reading) notChecked.push("printed_text (vision model not configured)");

  const tamperReasons: string[] = [];
  let tamper = 0;
  if (qr.valid === false) {
    tamper = Math.max(tamper, 0.9);
    tamperReasons.push(`QR signature check failed (${qr.reason})`);
  }
  const qrFields = qr.valid ? (qr.payload as Record<string, string>) : null;
  if (qrFields && reading) {
    if (reading.cnic && normalizeCnic(reading.cnic) !== normalizeCnic(qrFields.cnic)) {
      tamper = Math.max(tamper, 0.8);
      tamperReasons.push("Printed CNIC number differs from the signed QR");
    }
    if (reading.fullName && nameSimilarity(reading.fullName, qrFields.fullName ?? "") < 0.8) {
      tamper = Math.max(tamper, 0.7);
      tamperReasons.push("Printed name differs from the signed QR");
    }
  }
  if (reading?.editSigns?.length) {
    tamper = Math.max(tamper, Math.min(0.5, 0.2 * reading.editSigns.length));
    tamperReasons.push(...reading.editSigns.map((s) => `Visible edit sign: ${s}`));
  }
  const software = isImage ? await editingSoftware(buf) : null;
  if (software) {
    tamper = Math.max(tamper, 0.3);
    tamperReasons.push(`Image metadata mentions editing software (${software}) — weak signal, often innocent`);
  }

  const extracted = {
    fullName: qrFields?.fullName ?? reading?.fullName ?? null,
    fatherName: qrFields?.fatherName ?? reading?.fatherName ?? null,
    cnic: normalizeCnic(qrFields?.cnic ?? reading?.cnic ?? null),
    dob: qrFields?.dob ?? reading?.dob ?? null,
    monthlyIncome: reading?.monthlyIncome ?? null,
  };
  const blurry = !!quality && (quality.blurry || quality.tooDark) && !qr.valid;
  const readable = !!qr.valid || (reading ? reading.readable : !!quality && !quality.blurry && !quality.tooDark);
  void claim;
  return { quality, qr, reading, extracted, tamperScore: Math.round(tamper * 100) / 100, tamperReasons, readable, blurry, notChecked };
}

// ───────────── mock CNIC generator (seed + red-team demo) ─────────────

export type MockCnicFields = { fullName: string; fatherName: string; cnic: string; dob: string; gender: string; district: string };

/** Render a mock CNIC card as PNG with a signed QR. `printed` lets the red-team panel print different text (a forgery). */
export async function renderMockCnic(db: DB, fields: MockCnicFields, opts: { printed?: Partial<MockCnicFields>; tamperQr?: boolean; blur?: boolean } = {}): Promise<Buffer> {
  const signed = await signPayload(db, {
    typ: "mock_cnic",
    iss: "mock-nadra",
    fullName: fields.fullName,
    fatherName: fields.fatherName,
    cnic: fields.cnic,
    dob: fields.dob,
    gender: fields.gender,
    iat: new Date().toISOString(),
    exp: new Date(Date.now() + 10 * 365 * 864e5).toISOString(),
  });
  let qrText = signed.token;
  if (opts.tamperQr) {
    // Flip the CNIC inside the payload but keep the old signature → signature check must fail.
    const [p, body, sig] = qrText.split(".");
    const obj = JSON.parse(Buffer.from(body!, "base64url").toString("utf8"));
    obj.cnic = obj.cnic.slice(0, 12) + String((Number(obj.cnic.at(-1)) + 1) % 10);
    qrText = `${p}.${Buffer.from(JSON.stringify(obj)).toString("base64url")}.${sig}`;
  }
  const qrPng = await QRCode.toBuffer(qrText, { errorCorrectionLevel: "M", margin: 1, width: 300 });
  const shown = { ...fields, ...opts.printed };
  const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="630">
  <rect width="1000" height="630" rx="28" fill="#e9f3ea"/>
  <rect x="0" y="0" width="1000" height="90" rx="28" fill="#0b6b3a"/>
  <text x="40" y="58" font-family="Arial" font-size="34" font-weight="bold" fill="#fff">MOCK IDENTITY CARD — PROTOTYPE ONLY</text>
  <text x="40" y="160" font-family="Arial" font-size="24" fill="#333">Name</text>
  <text x="40" y="200" font-family="Arial" font-size="36" font-weight="bold" fill="#111">${esc(shown.fullName)}</text>
  <text x="40" y="260" font-family="Arial" font-size="24" fill="#333">Father / Husband Name</text>
  <text x="40" y="300" font-family="Arial" font-size="32" fill="#111">${esc(shown.fatherName)}</text>
  <text x="40" y="360" font-family="Arial" font-size="24" fill="#333">Identity Number</text>
  <text x="40" y="400" font-family="Arial" font-size="34" font-weight="bold" fill="#111">${esc(shown.cnic.replace(/^(\d{5})(\d{7})(\d)$/, "$1-$2-$3"))}</text>
  <text x="40" y="460" font-family="Arial" font-size="24" fill="#333">Date of Birth</text>
  <text x="40" y="500" font-family="Arial" font-size="32" fill="#111">${esc(shown.dob)}</text>
  <text x="40" y="580" font-family="Arial" font-size="22" fill="#555">${esc(shown.district)} · ${esc(shown.gender)} · NOT A REAL DOCUMENT</text>
</svg>`;
  let card = sharp(Buffer.from(svg)).composite([{ input: qrPng, left: 660, top: 170 }]).png();
  if (opts.blur) card = sharp(await card.toBuffer()).blur(9).png();
  return card.toBuffer();
}
