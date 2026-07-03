// allow: SIZE_OK - advisor action fixture split is deferred from the 0.2.7 release gate.
export function actionsConfig() {
  return `${baseConfig()}
skills:
  user.local-manual:
    path: local-manual
    status: active
    invocation: manual-only
    exposure: exported
    category: user
  matt.tdd:
    path: matt-tdd
    status: active
    invocation: workflow-auto
    exposure: unit-managed
    category: plugin
    owner_install_unit: matt.pack
  omo.runtime:
    path: omo-runtime
    status: active
    invocation: workflow-auto
    exposure: unit-managed
    category: plugin
    owner_install_unit: omo.pack
  safe.helper:
    path: safe-helper
    status: active
    invocation: workflow-auto
    exposure: unit-managed
    category: plugin
    owner_install_unit: safe.pack
  medium.helper:
    path: medium-helper
    status: active
    invocation: workflow-auto
    exposure: unit-managed
    category: plugin
    owner_install_unit: medium.pack
  runtime.helper:
    path: runtime-helper
    status: active
    invocation: workflow-auto
    exposure: unit-managed
    category: plugin
    owner_install_unit: runtime.low
  user.blocked:
    path: blocked-helper
    status: blocked
    invocation: blocked
    exposure: exported
    category: user
capabilities: {}
harnesses:
  codex:
    status: primary
    workflows:
      - agent
      - research
workflows:
  agent:
    harness: codex
    active_skills:
      - user.local-manual
      - omo.runtime
    blocked_skills: []
  research:
    harness: codex
    active_skills:
      - matt.tdd
      - safe.helper
      - medium.helper
      - runtime.helper
    blocked_skills: []
install_units:
  matt.pack:
    kind: plugin
    source: npx matt install
    scope: user-global
    enabled: true
    trust_level: reviewed
    permission_risk: medium
    source_digest: sha256:matt
    provided_components:
      - skills
    components:
      skills:
        - matt.tdd
  omo.pack:
    kind: plugin
    source: npx omo install
    scope: user-global
    enabled: true
    trust_level: unreviewed
    permission_risk: high
    provided_components:
      - skills
    components:
      skills:
        - omo.runtime
  safe.pack:
    kind: skill
    source: npx safe-skills install
    scope: user-global
    enabled: true
    trust_level: unreviewed
    permission_risk: low
    provided_components:
      - skills
    components:
      skills:
        - safe.helper
  medium.pack:
    kind: plugin
    source: npx medium install
    scope: user-global
    enabled: true
    trust_level: unreviewed
    permission_risk: medium
    provided_components:
      - skills
    components:
      skills:
        - medium.helper
  runtime.low:
    kind: plugin
    source: npx runtime-helper install
    scope: user-global
    enabled: true
    trust_level: unreviewed
    permission_risk: low
    source_digest: sha256:runtime
    provided_components:
      - skills
      - commands
    components:
      skills:
        - runtime.helper
      commands:
        - runtime-helper
`;
}

export function missingProvenanceConfig() {
  return `${baseConfig()}
skills:
  broken.auto:
    path: broken-auto
    status: active
    invocation: workflow-auto
    exposure: unit-managed
    category: plugin
capabilities: {}
harnesses:
  codex:
    status: primary
    workflows:
      - agent
      - research
workflows:
  agent:
    harness: codex
    active_skills: []
    blocked_skills: []
  research:
    harness: codex
    active_skills:
      - broken.auto
    blocked_skills: []
install_units: {}
`;
}

export function reviewedQuarantinedConfig() {
  return `${baseConfig()}
skills:
  omo:programming:
    path: omo-programming
    status: quarantined
    invocation: blocked
    exposure: exported
    category: plugin
    owner_install_unit: omo.pack
capabilities: {}
harnesses:
  codex:
    status: primary
    workflows:
      - agent
workflows:
  agent:
    harness: codex
    active_skills: []
    blocked_skills: []
install_units:
  omo.pack:
    kind: plugin
    source: ~/.codex/plugins/cache/sisyphuslabs/omo
    scope: user-global
    enabled: true
    trust_level: reviewed
    permission_risk: high
    provided_components:
      - skills
      - hook
      - mcp-server
    components:
      skills:
        - omo:programming
      hooks:
        - user-prompt-submit-loading-project-rules
      mcp_servers:
        - context7
`;
}

export function reviewedBlockedConfig() {
  return `${baseConfig()}
skills:
  omo:blocked:
    path: omo-blocked
    status: blocked
    invocation: blocked
    exposure: exported
    category: plugin
    owner_install_unit: omo.pack
capabilities: {}
harnesses:
  codex:
    status: primary
    workflows:
      - agent
workflows:
  agent:
    harness: codex
    active_skills: []
    blocked_skills: []
install_units:
  omo.pack:
    kind: plugin
    source: ~/.codex/plugins/cache/sisyphuslabs/omo
    scope: user-global
    enabled: true
    trust_level: reviewed
    permission_risk: high
    provided_components:
      - skills
    components:
      skills:
        - omo:blocked
`;
}

function baseConfig() {
  return `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true
`;
}
