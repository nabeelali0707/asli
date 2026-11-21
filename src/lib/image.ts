"use client";

/** Shrink a phone photo before upload: long edge ≤ 1600px, JPEG. A 6 MB camera shot becomes ~250 KB, which also works on 2G. */
export async function fileToUpload(file: File): Promise<{ mime: string; base64: string; sizeKB: number }> {
  if (file.type === "application/pdf") {
    if (file.size > 4 * 1024 * 1024) throw new Error("This PDF is too big. Please use a photo instead.");
    return { mime: file.type, base64: await toBase64(file), sizeKB: Math.round(file.size / 1024) };
  }
  if (!file.type.startsWith("image/")) throw new Error("Please choose a photo or a PDF.");
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Could not read the photo."))), "image/jpeg", 0.85));
  return { mime: "image/jpeg", base64: await toBase64(blob), sizeKB: Math.round(blob.size / 1024) };
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] ?? "");
    r.onerror = () => rej(new Error("Could not read the file."));
    r.readAsDataURL(blob);
  });
}
