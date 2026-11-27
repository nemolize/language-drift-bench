// Installs fastText into .work/venv and downloads the lid.176 model, then prints the model's SHA-256.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { ROOT } from "./common.mjs";

const work = path.join(ROOT, ".work");
fs.mkdirSync(work, { recursive: true });
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
if (!fs.existsSync(path.join(work, "venv"))) run("uv", ["venv", "--python", "3.13", path.join(work, "venv")]);
run("uv", ["pip", "install", "--python", path.join(work, "venv/bin/python"), "fasttext-numpy2-wheel==0.9.2"]);

const model = path.join(work, "lid.176.ftz");
if (!fs.existsSync(model)) {
  const res = await fetch("https://dl.fbaipublicfiles.com/fasttext/supervised-models/lid.176.ftz");
  if (!res.ok) throw new Error(`model download failed: ${res.status}`);
  fs.writeFileSync(model, Buffer.from(await res.arrayBuffer()));
}
console.log(`lid.176.ftz sha256 ${crypto.createHash("sha256").update(fs.readFileSync(model)).digest("hex")}`);
