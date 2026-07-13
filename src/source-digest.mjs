import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink } from "node:fs/promises";
import { join, relative } from "node:path";

const DIGEST_PREFIX = "sha256:";

export async function sourceDigest(path) {
  const hash = createHash("sha256");
  hash.update("skillboard-source-digest-v1\n");
  await addPathDigest(hash, path, path);
  return `${DIGEST_PREFIX}${hash.digest("hex")}`;
}

export async function skillContentDigest(skillFilePath) {
  const hash = createHash("sha256");
  hash.update(await readFile(skillFilePath));
  return `${DIGEST_PREFIX}${hash.digest("hex")}`;
}

async function addPathDigest(hash, root, path) {
  const stats = await lstat(path);
  const rel = relative(root, path).replace(/\\/g, "/") || ".";
  if (stats.isSymbolicLink()) {
    hash.update(`symlink\0${rel}\0${await readlink(path)}\n`);
    return;
  }
  if (stats.isDirectory()) {
    hash.update(`dir\0${rel}\n`);
    const entries = (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.name !== ".git" && entry.name !== "node_modules")
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) await addPathDigest(hash, root, join(path, entry.name));
    return;
  }
  if (!stats.isFile()) {
    hash.update(`other\0${rel}\n`);
    return;
  }
  hash.update(`file\0${rel}\0${stats.size}\0`);
  hash.update(await readFile(path));
  hash.update("\n");
}
