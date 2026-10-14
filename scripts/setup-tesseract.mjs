import { copyFile, mkdir, readdir, access } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { get } from "node:https";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workerSource = join(root, "node_modules", "tesseract.js", "dist", "worker.min.js");
const coreSource = join(root, "node_modules", "tesseract.js-core");
const workerTarget = join(root, "public", "tesseract", "worker.min.js");
const coreTarget = join(root, "public", "tesseract", "core");
const tessdataDir = join(root, "public", "tessdata");

await mkdir(dirname(workerTarget), { recursive: true });
await mkdir(coreTarget, { recursive: true });
await mkdir(tessdataDir, { recursive: true });
await copyFile(workerSource, workerTarget);
for (const file of await readdir(coreSource)) {
  if (/^tesseract-core.*\.(?:js|wasm)$/.test(file)) await copyFile(join(coreSource, file), join(coreTarget, file));
}

/** Download a file via HTTPS following redirects */
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    const req = (u) => get(u, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) { req(res.headers.location); return; }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode} for ${u}`)); return; }
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
    });
    req(url);
    file.on("error", reject);
  });
}

const TESSDATA_BASE = "https://github.com/tesseract-ocr/tessdata/raw/main";
for (const lang of ["vie", "eng"]) {
  const dest = join(tessdataDir, `${lang}.traineddata`);
  try {
    await access(dest);
    console.log(`tessdata/${lang}.traineddata already present, skipping download.`);
  } catch {
    console.log(`Downloading tessdata/${lang}.traineddata …`);
    await download(`${TESSDATA_BASE}/${lang}.traineddata`, dest);
    console.log(`tessdata/${lang}.traineddata downloaded.`);
  }
}
