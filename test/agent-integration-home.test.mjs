import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { resolveSetupHome } from "../src/agent-integration-home.mjs";

test("sudo home lookup does not execute getent from inherited PATH", async () => {
  if (process.platform === "win32") {
    return;
  }

  const root = await mkdtemp(join(tmpdir(), "skillboard-getent-path-test-"));
  try {
    const bin = join(root, "bin");
    const marker = join(root, "getent-ran");
    const user = `skillboard-path-${process.pid}`;
    await mkdir(bin, { recursive: true });
    const getent = join(bin, "getent");
    await writeFile(
      getent,
      `#!/bin/sh\nprintf ran > ${JSON.stringify(marker)}\nprintf '%s:x:1234:5678::/tmp/path-owned-home:/bin/sh\\n' ${JSON.stringify(user)}\n`,
      "utf8"
    );
    await chmod(getent, 0o755);

    const home = await resolveSetupHome({
      HOME: "/root",
      LOGNAME: "root",
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      SUDO_GID: "5678",
      SUDO_UID: "1234",
      SUDO_USER: user,
      USER: "root"
    }, {
      passwdPath: join(root, "missing-passwd")
    });

    assert.notEqual(home, "/tmp/path-owned-home");
    await assert.rejects(readFile(marker, "utf8"), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
