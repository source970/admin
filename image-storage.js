import {
  BUNNY_ACCESS_KEY,
  BUNNY_CDN_BASE_URL,
  BUNNY_STORAGE_BASE_URL,
} from "./bunny-config.js";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_EMBEDDED_BYTES = 480 * 1024;

function bunnyIsConfigured() {
  return Boolean(
    BUNNY_ACCESS_KEY.trim()
    && BUNNY_STORAGE_BASE_URL.trim()
    && BUNNY_CDN_BASE_URL.trim(),
  );
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function imageExtension(type) {
  return { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[type];
}

function createRemotePath(file, folder) {
  const extension = imageExtension(file.type);
  const uniquePart = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const safeFolder = folder === "categories" ? "categories" : "products";
  return `uploads/${safeFolder}/${Date.now()}-${uniquePart}.${extension}`;
}

export async function uploadFileToBunny(file, folder) {
  const path = createRemotePath(file, folder);
  const response = await fetch(
    `${BUNNY_STORAGE_BASE_URL.replace(/\/$/, "")}/${encodePath(path)}`,
    {
      method: "PUT",
      headers: {
        AccessKey: BUNNY_ACCESS_KEY,
        "Content-Type": "application/octet-stream",
      },
      body: file,
    },
  );

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`تعذر رفع الصورة إلى Bunny (${response.status})${details ? `: ${details}` : ""}`);
  }

  return {
    path,
    url: `${BUNNY_CDN_BASE_URL.replace(/\/$/, "")}/${encodePath(path)}`,
  };
}

function readBlobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("تعذر قراءة الصورة"));
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
}

async function loadImageSource(file) {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fall back to a regular image element for older mobile browsers.
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function createEmbeddedImage(file) {
  if (!file) throw new Error("اختر صورة أولاً");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("حجم الصورة يجب ألا يتجاوز 5MB");
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("الصورة يجب أن تكون JPG أو PNG أو WEBP");
  }

  const source = await loadImageSource(file);
  const sourceWidth = source.width || source.naturalWidth;
  const sourceHeight = source.height || source.naturalHeight;
  const longestSide = Math.max(sourceWidth, sourceHeight);
  let scale = Math.min(1, 1600 / longestSide);
  let quality = 0.84;

  try {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(sourceWidth * scale));
      canvas.height = Math.max(1, Math.round(sourceHeight * scale));
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) throw new Error("المتصفح لا يدعم معالجة الصور");
      context.drawImage(source, 0, 0, canvas.width, canvas.height);

      const optimized = await canvasToBlob(canvas, quality);
      if (!optimized) throw new Error("تعذر تجهيز الصورة للحفظ");
      if (optimized.size <= MAX_EMBEDDED_BYTES) return readBlobAsDataUrl(optimized);

      scale *= 0.82;
      quality = Math.max(0.55, quality - 0.06);
    }
  } finally {
    source.close?.();
  }

  throw new Error("تعذر ضغط الصورة إلى حجم مناسب. اختر صورة أبسط أو أصغر");
}

export async function uploadImage(file, folder) {
  if (!file) return null;
  if (file.size > MAX_SOURCE_BYTES) throw new Error("حجم الصورة يجب ألا يتجاوز 5MB");
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("الصورة يجب أن تكون JPG أو PNG أو WEBP");
  }

  if (bunnyIsConfigured()) {
    return uploadFileToBunny(file, folder);
  }

  return { url: await createEmbeddedImage(file), path: "" };
}

export async function deleteImage(path) {
  if (!path || !bunnyIsConfigured()) return;
  try {
    const response = await fetch(
      `${BUNNY_STORAGE_BASE_URL.replace(/\/$/, "")}/${encodePath(path)}`,
      { method: "DELETE", headers: { AccessKey: BUNNY_ACCESS_KEY } },
    );
    if (!response.ok && response.status !== 404) {
      throw new Error(`Bunny delete failed (${response.status})`);
    }
  } catch (error) {
    console.warn("Could not remove Bunny image", path, error);
  }
}
