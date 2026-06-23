#!/usr/bin/env bash
set -u
ROOT="$(pwd)"
EVIDENCE="$ROOT/.omo/evidence/skillboard-cli-qa-20260623"
CLI="node bin/skillboard.mjs"
BASE=(--config examples/multi-source.config.yaml --skills examples/multi-source-skills)
mkdir -p "$EVIDENCE"
: > "$EVIDENCE/summary.tsv"
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
run_case S01_help "CLI help lists public surfaces" node bin/skillboard.mjs --help
run_case S02_list_skills "list skills workflow filter" node bin/skillboard.mjs list skills "${BASE[@]}" --workflow codex-night-workflow
run_case S03_list_workflows_json "list workflows JSON" node bin/skillboard.mjs list workflows "${BASE[@]}" --json
run_case S04_list_harnesses "list harnesses" node bin/skillboard.mjs list harnesses "${BASE[@]}"
run_case S05_list_install_units_json "list install units JSON" node bin/skillboard.mjs list install-units "${BASE[@]}" --json
run_case S06_explain_private "explain a user/private skill" node bin/skillboard.mjs explain private.tdd-work-continuity "${BASE[@]}"
run_case S07_can_use_allowed_json "can-use allowed private router-only skill" node bin/skillboard.mjs can-use private.tdd-work-continuity "${BASE[@]}" --workflow codex-night-workflow --json
run_case S08_can_use_denied_json "can-use denied blocked skill" node bin/skillboard.mjs can-use matt.grill-me "${BASE[@]}" --workflow codex-night-workflow --json
run_case S09_guard_allow "guard use allowed output" node bin/skillboard.mjs guard use private.tdd-work-continuity "${BASE[@]}" --workflow codex-night-workflow
run_case S10_guard_deny "guard use denied blocked skill" node bin/skillboard.mjs guard use matt.grill-me "${BASE[@]}" --workflow codex-night-workflow
run_case S11_audit_sources_json "audit sources JSON" node bin/skillboard.mjs audit sources "${BASE[@]}" --json
run_case S12_audit_sources_verify_json "audit sources --verify JSON against example sources" node bin/skillboard.mjs audit sources "${BASE[@]}" --verify --json
TMP_ROOT="$(mktemp -d)"
echo "$TMP_ROOT" > "$EVIDENCE/tmp_root.txt"
HOOK="$TMP_ROOT/codex-night-guard.sh"
run_case S13_hook_install_node_command "hook install with --skillboard-bin 'node bin/skillboard.mjs'" node bin/skillboard.mjs hook install "${BASE[@]}" --workflow codex-night-workflow --out "$HOOK" --skillboard-bin "node bin/skillboard.mjs"
run_case S14_generated_hook_allow "generated hook executes allowed skill" "$HOOK" private.tdd-work-continuity
run_case S15_generated_hook_deny "generated hook denies blocked skill" "$HOOK" matt.grill-me
run_case S16_hook_existing_reject "hook install rejects existing path" node bin/skillboard.mjs hook install "${BASE[@]}" --workflow codex-night-workflow --out "$HOOK" --skillboard-bin "node bin/skillboard.mjs"
SYMLINK="$TMP_ROOT/symlink-hook.sh"
ln -s "$TMP_ROOT/nonexistent-target.sh" "$SYMLINK"
run_case S17_hook_symlink_reject "hook install rejects symlink path" node bin/skillboard.mjs hook install "${BASE[@]}" --workflow codex-night-workflow --out "$SYMLINK" --skillboard-bin "node bin/skillboard.mjs"
LOCK="$TMP_ROOT/skillboard.lock.yaml"
run_case S18_lock_write_json "lock write to temp lockfile" node bin/skillboard.mjs lock write "${BASE[@]}" --out "$LOCK" --json
run_case S19_lock_write_existing_no_replace "lock write rejects existing lockfile without --replace" node bin/skillboard.mjs lock write "${BASE[@]}" --out "$LOCK" --json
run_case S20_lock_write_replace "lock write replaces existing lockfile with --replace" node bin/skillboard.mjs lock write "${BASE[@]}" --out "$LOCK" --replace --json
CFG="$TMP_ROOT/control.config.yaml"
cp examples/multi-source.config.yaml "$CFG"
run_case S21_control_prefer_dry_run "prefer dry-run reports change without write" node bin/skillboard.mjs prefer private.tdd-work-continuity --workflow codex-night-workflow --capability test-first-implementation --config "$CFG" --skills examples/multi-source-skills --dry-run --json
run_case S22_control_activate_dry_run "activate dry-run validates mode" node bin/skillboard.mjs activate private.workflow-router --workflow large-refactor-workflow --mode router-only --config "$CFG" --skills examples/multi-source-skills --dry-run --json
run_case S23_control_block_dry_run "block dry-run validates removal impact" node bin/skillboard.mjs block matt.tdd --workflow codex-night-workflow --config "$CFG" --skills examples/multi-source-skills --dry-run --json
run_case S24_control_quarantine_dry_run "quarantine dry-run validates global effect" node bin/skillboard.mjs quarantine matt.tdd --config "$CFG" --skills examples/multi-source-skills --dry-run --json
run_case S25_control_prefer_real_temp "prefer writes only temp config" node bin/skillboard.mjs prefer private.tdd-work-continuity --workflow codex-night-workflow --capability test-first-implementation --config "$CFG" --skills examples/multi-source-skills --json
run_case S26_control_check_temp "check temp config after real prefer" node bin/skillboard.mjs check --config "$CFG" --skills examples/multi-source-skills
run_case S27_can_use_unknown "can-use unknown skill is denied" node bin/skillboard.mjs can-use missing.skill "${BASE[@]}" --workflow codex-night-workflow --json
run_case S28_can_use_unknown_workflow "can-use unknown workflow is denied" node bin/skillboard.mjs can-use matt.tdd "${BASE[@]}" --workflow missing-workflow --json
run_case S29_guard_missing_args "guard use missing workflow fails usage" node bin/skillboard.mjs guard use matt.tdd "${BASE[@]}"
run_case S30_hook_default_sanitize "hook install sanitizes default workflow filename" node bin/skillboard.mjs hook install --workflow "../bad workflow" --config "$TMP_ROOT/sanitize.config.yaml" --skills "$TMP_ROOT/skills" --skillboard-bin "node bin/skillboard.mjs"
