#!/usr/bin/env bash
set -u
ROOT="$(pwd)"
EVIDENCE="$ROOT/.omo/evidence/skillboard-cli-qa-20260623"
mkdir -p "$EVIDENCE"
run_case() {
  local id="$1"; shift
  local desc="$1"; shift
  local outfile="$EVIDENCE/${id}.txt"
  {
    echo "SCENARIO: $id"
    echo "DESCRIPTION: $desc"
    echo "SURFACE: CLI"
    echo "INVOCATION: $*"
    echo "--- stdout/stderr ---"
  } > "$outfile"
  set +e
  "$@" >> "$outfile" 2>&1
  local code=$?
  set -e
  {
    echo "--- exit_code ---"
    echo "$code"
  } >> "$outfile"
  printf '%s\t%s\t%s\n' "$id" "$code" "$outfile" >> "$EVIDENCE/summary.tsv"
  return 0
}
set -e
TMP_ROOT="$(cat "$EVIDENCE/tmp_root.txt")"
mkdir -p "$TMP_ROOT/verified-source" "$TMP_ROOT/skills"
printf 'verified local source\n' > "$TMP_ROOT/verified-source/README.md"
VERIFY_CFG="$TMP_ROOT/verify.config.yaml"
cat > "$VERIFY_CFG" <<YAML
version: 1
skills: {}
workflows: {}
install_units:
  local.verified:
    kind: skill
    source: $TMP_ROOT/verified-source
    scope: project
    enabled: true
    trust_level: trusted
    permission_risk: low
YAML
run_case S31_audit_verify_temp_unpinned "audit sources --verify computes digest for temp local source" node bin/skillboard.mjs audit sources --config "$VERIFY_CFG" --skills "$TMP_ROOT/skills" --verify --json
DIGEST="$(node -e 'const fs=require("fs"); const p=process.argv[1]; const text=fs.readFileSync(p,"utf8"); const m=text.match(/"actualDigest": "([^"]+)"/); if (!m) process.exit(1); process.stdout.write(m[1]);' "$EVIDENCE/S31_audit_verify_temp_unpinned.txt")"
cat > "$VERIFY_CFG" <<YAML
version: 1
skills: {}
workflows: {}
install_units:
  local.verified:
    kind: skill
    source: $TMP_ROOT/verified-source
    scope: project
    source_digest: $DIGEST
    enabled: true
    trust_level: trusted
    permission_risk: low
YAML
run_case S32_audit_verify_temp_pinned "audit sources --verify passes with matching digest" node bin/skillboard.mjs audit sources --config "$VERIFY_CFG" --skills "$TMP_ROOT/skills" --verify --json
SAN_CFG="$TMP_ROOT/sanitize.config.yaml"
cat > "$SAN_CFG" <<'YAML'
version: 1
skills: {}
workflows:
  "../bad workflow":
    harness: codex
    active_skills: []
    blocked_skills: []
harnesses:
  codex:
    status: primary
    workflows:
      - "../bad workflow"
YAML
run_case S33_hook_default_sanitize_valid "hook install sanitizes default workflow filename" node bin/skillboard.mjs hook install --workflow "../bad workflow" --config "$SAN_CFG" --skills "$TMP_ROOT/skills" --skillboard-bin "node bin/skillboard.mjs"
run_case S34_node_check "node syntax check for CLI and source/test modules" bash -lc "node --check bin/skillboard.mjs && find src test -name '*.mjs' -print0 | xargs -0 -n1 node --check"
run_case S35_tsc_fallback "project-local TypeScript fallback diagnostics" ./node_modules/.bin/tsc --allowJs --noEmit --module NodeNext --moduleResolution NodeNext --target ES2022 --skipLibCheck bin/skillboard.mjs src/*.mjs src/domain/*.mjs src/domain/rules/*.mjs test/*.mjs
run_case S36_npm_check "npm run check regression suite" npm run check
