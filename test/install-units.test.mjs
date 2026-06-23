import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadWorkspace, renderDashboard } from "../src/index.mjs";

async function withInstallUnitFixture(run) {
  const root = await mkdtemp(join(tmpdir(), "skillboard-install-unit-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await mkdir(skillsRoot, { recursive: true });
    await writeFile(configPath, INSTALL_UNIT_CONFIG, "utf8");
    return await run({ configPath, skillsRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const INSTALL_UNIT_CONFIG = `
version: 1
install_units:
  lazycodex.omo:
    kind: harness
    source: npx lazycodex-ai install
    scope: user-global
    manifest_path: ~/.codex/plugins/cache/sisyphuslabs/omo/plugin.json
    cache_path: ~/.codex/plugins/cache/sisyphuslabs/omo
    provided_components:
      - skills
      - commands
      - mcp-server
      - hook
    components:
      skills:
        - lazycodex.ulw-plan
      commands:
        - $ulw-plan
        - $start-work
      hooks:
        - post-tool-use
      mcp_servers:
        - omo-docs
    modified_config_files:
      - ~/.codex/config.toml
      - ~/.local/bin
    auto_update: false
    enabled: true
    workflow_dependencies:
      - large-refactor-workflow
    permission_risk: high
    rollback: manual
`;

test("scan records install units for packaged harness and plugin bundles", async () => {
  await withInstallUnitFixture(async ({ configPath, skillsRoot }) => {
    const workspace = await loadWorkspace({ configPath, skillsRoot });

    assert.deepEqual(workspace.installUnits, [
      {
        id: "lazycodex.omo",
        kind: "harness",
        sourceClass: undefined,
        priority: undefined,
        trustLevel: "unreviewed",
        sourceDigest: undefined,
        signature: undefined,
        publicKey: undefined,
        verifiedAt: undefined,
        source: "npx lazycodex-ai install",
        scope: "user-global",
        manifestPath: "~/.codex/plugins/cache/sisyphuslabs/omo/plugin.json",
        cachePath: "~/.codex/plugins/cache/sisyphuslabs/omo",
        providedComponents: ["skills", "commands", "mcp-server", "hook"],
        components: {
          skills: ["lazycodex.ulw-plan"],
          commands: ["$ulw-plan", "$start-work"],
          hooks: ["post-tool-use"],
          mcpServers: ["omo-docs"]
        },
        modifiedConfigFiles: ["~/.codex/config.toml", "~/.local/bin"],
        autoUpdate: false,
        enabled: true,
        workflowDependencies: ["large-refactor-workflow"],
        permissionRisk: "high",
        rollback: "manual"
      }
    ]);
  });
});

test("dashboard shows install units without flattening bundles into skills", async () => {
  await withInstallUnitFixture(async ({ configPath, skillsRoot }) => {
    const workspace = await loadWorkspace({ configPath, skillsRoot });
    const markdown = renderDashboard(workspace);

    assert.match(markdown, /Agent Runtime Install Units/);
    assert.match(markdown, /lazycodex\.omo/);
    assert.match(markdown, /user-global/);
    assert.match(markdown, /~\/\.codex\/config\.toml/);
    assert.match(markdown, /permission risk: `high`/);
    assert.match(markdown, /Skills: `lazycodex\.ulw-plan`/);
    assert.match(markdown, /Commands: `\$ulw-plan`, `\$start-work`/);
    assert.match(markdown, /Hooks: `post-tool-use`/);
    assert.match(markdown, /MCP servers: `omo-docs`/);
  });
});
