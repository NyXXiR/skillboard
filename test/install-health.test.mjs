import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { inspectInstallation } from "../src/install-health.mjs";

test("install health reports one PATH-selected installation as healthy", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-install-health-single-"));
  try {
    const installed = await writePosixInstall(root, "current", "0.3.1");
    const result = await inspectInstallation({
      entrypointPath: installed.entrypoint,
      env: { PATH: installed.bin },
      packageVersion: "0.3.1"
    });

    assert.equal(result.current.version, "0.3.1");
    assert.equal(result.pathSelected?.path, installed.command);
    assert.equal(result.pathSelected?.current, true);
    assert.equal(result.installations.length, 1);
    assert.equal(result.duplicateInstallations, false);
    assert.equal(result.shadowed, false);
    assert.deepEqual(result.warnings, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("install health distinguishes duplicate and shadowed npm installations", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-install-health-duplicate-"));
  try {
    const stale = await writePosixInstall(root, "stale", "0.2.15");
    const current = await writePosixInstall(root, "current", "0.3.1");
    const result = await inspectInstallation({
      entrypointPath: current.entrypoint,
      env: { PATH: [stale.bin, current.bin].join(delimiter) },
      packageVersion: "0.3.1"
    });

    assert.equal(result.pathSelected?.path, stale.command);
    assert.equal(result.pathSelected?.version, "0.2.15");
    assert.equal(result.installations.length, 2);
    assert.equal(result.duplicateInstallations, true);
    assert.equal(result.shadowed, true);
    assert.match(result.warnings.join("\n"), /PATH selects.*0\.2\.15.*instead of.*0\.3\.1/is);
    assert.match(result.warnings.join("\n"), /multiple SkillBoard installations/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("install health never executes an unknown PATH candidate", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-install-health-no-exec-"));
  try {
    const bin = join(root, "bin");
    const marker = join(root, "executed");
    const command = join(bin, "skillboard");
    await mkdir(bin, { recursive: true });
    await writeFile(command, `#!/bin/sh\nprintf executed > ${JSON.stringify(marker)}\n`, "utf8");
    await chmod(command, 0o755);

    const result = await inspectInstallation({
      entrypointPath: join(root, "source", "bin", "skillboard.mjs"),
      env: { PATH: bin },
      packageVersion: "0.3.1"
    });

    assert.equal(result.pathSelected?.path, command);
    assert.equal(result.pathSelected?.version, null);
    assert.equal(result.shadowed, true);
    await assert.rejects(access(marker), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("install health recognizes a Windows npm command shim without running it", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-install-health-windows-"));
  try {
    const bin = join(root, "prefix");
    const packageRoot = join(bin, "node_modules", "agent-skillboard");
    const entrypoint = join(packageRoot, "bin", "skillboard.mjs");
    const command = join(bin, "skillboard.cmd");
    await mkdir(join(packageRoot, "bin"), { recursive: true });
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "agent-skillboard", version: "0.3.1" }), "utf8");
    await writeFile(entrypoint, "#!/usr/bin/env node\n", "utf8");
    await writeFile(command, "@ECHO off\r\nnode \"%~dp0\\node_modules\\agent-skillboard\\bin\\skillboard.mjs\" %*\r\n", "utf8");

    const result = await inspectInstallation({
      entrypointPath: entrypoint,
      env: { PATH: bin },
      packageVersion: "0.3.1",
      pathDelimiter: ";",
      platform: "win32"
    });

    assert.equal(result.pathSelected?.path, command);
    assert.equal(result.pathSelected?.packageRoot, packageRoot);
    assert.equal(result.pathSelected?.version, "0.3.1");
    assert.equal(result.pathSelected?.current, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("install health ignores a looping executable symlink", async () => {
  if (process.platform === "win32") return;
  const root = await mkdtemp(join(tmpdir(), "skillboard-install-health-loop-"));
  try {
    const bin = join(root, "bin");
    const command = join(bin, "skillboard");
    await mkdir(bin, { recursive: true });
    await symlink(command, command);

    const result = await inspectInstallation({
      entrypointPath: join(root, "source", "bin", "skillboard.mjs"),
      env: { PATH: bin },
      packageVersion: "0.3.1"
    });

    assert.equal(result.pathSelected, null);
    assert.deepEqual(result.pathCandidates, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writePosixInstall(root, name, version) {
  const prefix = join(root, name);
  const bin = join(prefix, "bin");
  const packageRoot = join(prefix, "lib", "node_modules", "agent-skillboard");
  const entrypoint = join(packageRoot, "bin", "skillboard.mjs");
  const command = join(bin, "skillboard");
  await mkdir(join(packageRoot, "bin"), { recursive: true });
  await mkdir(bin, { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "agent-skillboard", version }), "utf8");
  await writeFile(entrypoint, "#!/usr/bin/env node\n", "utf8");
  await chmod(entrypoint, 0o755);
  await symlink(entrypoint, command);
  return { bin, command, entrypoint };
}
