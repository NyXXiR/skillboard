import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function withV2StalePolicyFixture(run) {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-stale-policy-"));
  const configPath = join(root, "skillboard.config.yaml");
  const skillsRoot = join(root, "skills");
  try {
    await mkdir(skillsRoot);
    await mkdir(join(root, ".skillboard"));
    await writeFile(configPath, `version: 2
skills:
  removed:
    enabled: true
    shared: false
  observed:
    enabled: true
    shared: false
`, "utf8");
    await writeFile(join(root, ".skillboard", "inventory.json"), `${JSON.stringify({
      format_version: 1,
      generated: true,
      authoritative_for_availability: false,
      skills: [{
        id: "observed",
        path: "observed",
        owner_install_unit: "codex.user-skills",
        installed_on: ["codex"]
      }],
      install_units: []
    })}\n`, "utf8");
    return await run({ root, configPath, skillsRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
