import { randomUUID } from "node:crypto";

const storageEndpoint = (process.env.BUNNY_STORAGE_ENDPOINT || "https://storage.bunnycdn.com/jhfsf").replace(/\/$/, "");
const cdnEndpoint = (process.env.BUNNY_CDN_URL || "https://hgghh.b-cdn.net").replace(/\/$/, "");
const accessKey = process.env.BUNNY_STORAGE_ACCESS_KEY;
const maxBytes = 5 * 1024 * 1024;
const imageTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

function json(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("IMAGE_TOO_LARGE");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function handleBunnyRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
  if (url.pathname !== "/api/images") return false;

  if (!accessKey) {
    json(response, 503, { error: "Bunny Storage is not configured on the server" });
    return true;
  }

  const origin = request.headers.origin;
  if (origin && new URL(origin).host !== request.headers.host) {
    json(response, 403, { error: "Origin is not allowed" });
    return true;
  }

  try {
    if (request.method === "POST") {
      const contentType = String(request.headers["content-type"] || "").split(";")[0].toLowerCase();
      const extension = imageTypes.get(contentType);
      if (!extension) {
        json(response, 415, { error: "Only JPG, PNG, and WEBP images are allowed" });
        return true;
      }
      const folder = url.searchParams.get("folder") === "categories" ? "categories" : "products";
      const body = await readBody(request);
      if (!body.length) {
        json(response, 400, { error: "Image body is empty" });
        return true;
      }
      const path = `uploads/${folder}/${Date.now()}-${randomUUID()}.${extension}`;
      const upload = await fetch(`${storageEndpoint}/${encodePath(path)}`, {
        method: "PUT",
        headers: { AccessKey: accessKey, "Content-Type": "application/octet-stream" },
        body,
      });
      if (!upload.ok) throw new Error(`Bunny upload failed (${upload.status})`);
      json(response, 201, { path, url: `${cdnEndpoint}/${encodePath(path)}` });
      return true;
    }

    if (request.method === "DELETE") {
      const path = String(url.searchParams.get("path") || "").replace(/^\/+/, "");
      if (!path.startsWith("uploads/") || path.includes("..")) {
        json(response, 400, { error: "Invalid image path" });
        return true;
      }
      const removal = await fetch(`${storageEndpoint}/${encodePath(path)}`, {
        method: "DELETE",
        headers: { AccessKey: accessKey },
      });
      if (!removal.ok && removal.status !== 404) throw new Error(`Bunny delete failed (${removal.status})`);
      json(response, 200, { removed: true });
      return true;
    }

    json(response, 405, { error: "Method not allowed" });
    return true;
  } catch (error) {
    const status = error.message === "IMAGE_TOO_LARGE" ? 413 : 502;
    json(response, status, { error: status === 413 ? "Image must not exceed 5MB" : error.message });
    return true;
  }
}
