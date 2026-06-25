# skillboard-mvp-review

- Skill: tdd-work-continuity
- Agent: codex
- Created: 2026-06-25T08:00:25Z
- Updated: 2026-06-25T08:45:00Z
- Workdir: /mnt/d/workspace/skill-control-plane
- Status: pending

## Goal

SkillBoard(`skill-control-plane`)의 MVP 기능과 낶부 도메인 설계를 검토하고, **처음 사용자가 skill을 가져다 붙이고 이용 및 삭제하는 불편을 해소하는 방향인지**, **도메인 설계가 적합하고 확장 가능한지**를 평가한다. 이전 대화에서 제안한 4.1~4.3 UX 개선 항목도 포함된 실행 계획을 문서화한다.

## Context

- Repo: `/mnt/d/workspace/skill-control-plane`
- Relevant files:
  - `src/cli.mjs` — CLI 라우터
  - `src/control.mjs` — skill/workflow/harness/capability CRUD, `can-use`, `guard`, trust/source 분류
  - `src/domain/rules/*.mjs` — 정책 규칙 엔진
  - `src/workspace.mjs` — config 파싱, `SKILL.md` frontmatter 파싱
  - `src/agent-inventory.mjs` — 설치된 agent skill 자동 스캔/병합
  - `src/brief-cli.mjs`, `src/brief-renderer.mjs`, `src/advisor.mjs` — AI/사용자 브리핑
  - `src/impact.mjs`, `src/reconcile.mjs` — 영향도/재조정 분석
  - `src/init.mjs`, `src/uninstall.mjs` — 생명주기
- Constraints:
  - MVP 단계, npm publish 전 (`version: 0.1.0`)
  - Node.js >= 20, ESM, yaml 의존성 하나
  - cross-platform CI (ubuntu/macOS/windows × node 20/22)

## Findings Summary

### 1. 도메인 설계: 적합하고 확장 가능함 (Score: 8/10)

**핵심 엔티티 5개**가 skill 생태계의 실제 관심사를 잘 반영한다.

| Entity | 역할 | 적합성 |
|--------|------|--------|
| `skills` | 선언된 스킬의 상태/호출방식/노출범위 | ✅ 적절. status/invocation/exposure 3중 분리로 정책 표현력 높음 |
| `capabilities` | 역할 기반 스킬 추상화 | ✅ 적절. canonical/alternatives/default_policy로 교체/대안 추천 가능 |
| `workflows` | 스킬이 활성화되는 맥락 | ✅ 적절. active_skills/blocked_skills/required_capabilities로 명시적 제어 |
| `harnesses` | runtime/command 제공자 추적 | ✅ 적절. harness 제거 시 workflow 영향도 파악 가능 |
| `install_units` | plugin/marketplace/harness 등의 부모 단위 | ✅ 매우 적절. skill 평탄화 문제 해결 |

**확장 가능성**
- `INSTALL_UNIT_KIND_VALUES`에 `skill`, `plugin`, `marketplace`, `harness`, `mcp-server`, `hook`, `agent`, `lsp`, `custom`을 두어 새로운 runtime primitive 추가가 용이함.
- `source_classes.mjs`의 우선순위/분류 함수가 데이터 기반으로 되어 있어 새 source class 추가가 쉬움.
- `source profile` 어댑터 모델이 하드코딩을 피하고 데이터 주도 import를 지향함.

**위험 요소**
- `src/control.mjs`가 1000줄에 달해 단일 책임 위반. `can-use`, CRUD, trust/source, YAML 쓰기, hook 설치 등이 한 파일에 있어 장기 유지보수 부담.
- `status` 값이 14개로 많고, `status`와 `invocation` 간의 유효 조합 규칙이 복잡(`SKILL-STATUS-001`). 새로운 상태 추가 시 규칙 행렬이 기하급수적으로 늘어날 수 있음.
- `capability`가 workflow-scoped `required_capabilities`와 global `capabilities`로 이중 정의됨. 의도는 명확하지만 사용자 입장에서 학습 곡선이 있음.

### 2. 사용자 불편 해소 vs 가중

#### 해소하는 설계

| 기능 | 불편 해소 메커니즘 |
|------|------------------|
| `init` 시 자동 스캔 + `active-manual` 연결 | 기존 수동 스킬을 따로 등록하지 않아도 `can-use`/`guard`로 계속 사용 가능 |
| `deny-by-default` + quarantine | 설치만으로 AI가 스킬을 부르는 것을 원천 차단 |
| `impact disable` | 스킬 제거 전 영향받는 workflow/capability를 사전에 노출 |
| 대부분의 mutating 명령에 `--dry-run` | 실수로 config를 망치는 위험 감소 |
| `brief --json` | 에이전트가 정책을 직접 해석하지 않고 control plane에 질의 |
| `uninstall`이 사용자 파일 보존 | 도구를 빼도 skill 파일과 사용자 config는 남음 |

#### 가중할 수 있는 설계

| 지점 | 불편 가능성 | 심각도 |
|------|------------|--------|
| 매번 `--config skillboard.config.yaml --skills skills` 필요 | 일상 명령이 번거로움 | 중간 |
| `SKILL.md` frontmatter 누락 시 메시지가 모호함 | 처음 사용자가 문서를 찾아야 함 | 높음 |
| `doctor` 출력이 길고 `--summary` 부재 | 매일 보기에 피로함 | 중간 |
| `add workflow` 시 `--harness`를 명시해야 함 | harness 개념을 모르는 사용자에게 진입 장벽 | 중간 |
| `status`/`invocation`/`exposure`/`trust_level` 용어가 많음 | 정책 도구이므로 불가피하지만, 온볭딩 문서가 중요 | 중간 |
| `init` 후 생성되는 config가 수십 개 스킬로 즉시 커짐 | 실제로 설치된 게 많으면 압도적 | 낮음~중간 |

**종합 판단**: 보안/통제를 얻는 대가로 적정 수준의 복잡성을 요구한다. 다만 **처음 사용자의 첫 5분**을 더 부드럽게 만들면 Adoption이 크게 올라갈 것이다.

### 3. MVP 기능 검증 결과

| 기능 | 상태 | 비고 |
|------|------|------|
| `init` | ✅ 정상 | bridge 파일, config, 디렉토리 생성, 자동 스캔 |
| `doctor`/`status` | ✅ 정상 | safe-mode, strict 모드, JSON 출력 |
| `brief` | ✅ 정상 | text/JSON, action cards, unknown workflow 처리 |
| `add skill/workflow/harness` | ✅ 정상 | dry-run, 자동 status 승격 |
| `activate`/`block`/`quarantine` | ✅ 정상 | workflow-scoped |
| `can-use`/`guard` | ✅ 정상 | 정책 위반 시 거부 |
| `impact disable` | ✅ 정상 | affected workflows/alternatives/risk |
| `remove skill` | ✅ 정상 | 참조 시 거부, `--force`로 정리 |
| `uninstall` | ✅ 정상 | 보수적 제거, dry-run |
| `inventory refresh`/`detect` | ✅ 정상 | runtime component 감지 |
| `sources refresh`/`audit` | ✅ 정상 | Git source digest pin |
| `import`/`merge` | ✅ 정상 | built-in profiles |
| `check` | ✅ 정상 | policy reference/rules |
| `dashboard` | ✅ 정상 | markdown 보고서 |
| `hook install` | ✅ 정상 | dry-run preview |

### 4. 핵심 코드 품질 관찰

- **정책 엔진**: `src/domain/rules/*.mjs`가 rule-id 기반으로 깔끔하게 분리되어 있어 새 규칙 추가가 쉬움.
- **workspace 로딩**: `workspace.mjs`가 config 파싱과 설치 skill discovery를 분리. `SKILL.md` frontmatter 강제는 정합성을 위해 필요하지만, 에러 메시지가 개선되어야 함.
- **control.mjs**: 거대 파일. CRUD, policy runtime, source classification, hook 설치 등을 분리하면 가독성과 테스트 용이성이 향상.
- **writeCheckedConfig**: 임시 파일에 쓰고 policy + usability 검증 후 rename하는 방식은 안전함. dry-run과 실제 적용의 경계도 명확.
- **agent-inventory**: detector 기반 스캔이 확장 가능. 다만 detector matching이 경로 suffix에 의존해 Windows/Linux 경로를 모두 고려한 점은 긍정적.

## Plan

### Phase 1: 첫 5분 UX 다듬기 (4.1)

- [ ] `workspace.mjs`의 `parseSkillFrontmatter` 에러 메시지 개선
  - "SKILL.md is missing YAML frontmatter" → 필요한 frontmatter 예시와 docs/user-flow.md 링크 포함
  - 예상 영향: `src/workspace.mjs` 1함수, test 1~2개 추가
- [ ] `add workflow`에서 `--harness` 누락 시 usage dump 대신 사용 가능한 harness 목록 제시
  - 예상 영향: `src/cli.mjs` 또는 `src/control.mjs`의 `addWorkflow`
- [ ] `doctor`에 `--summary` 플래그 추가 (또는 기본 출력에서 1줄 status + 핵심 warnings만)
  - 예상 영향: `src/doctor.mjs`, `src/report.mjs` 수정
- [ ] CLI 글로벌 defaults 파일/디렉토리 탐지: `--config`, `--skills` 미지정 시 현재 디렉토리의 `skillboard.config.yaml`과 `skills/`를 기본으로 사용하도록 개선
  - 예상 영향: `src/cli.mjs` option parser, test 보강

### Phase 2: 생태계 연결 및 문서 (4.2)

- [ ] `CONTRIBUTING.md` 작성: 개발 환경, 테스트 실행, source profile 추가 방법
- [ ] built-in profile 추가 가이드 문서화 (`docs/adapters.md` 보강 또는 `docs/profiles.md` 신규)
- [ ] README의 install 전/후 명령어 섹션 정리 (`skillboard` vs `node bin/skillboard.mjs` 구분 강조)
- [ ] 본 프로젝트에 `AGENTS.md`/`CLAUDE.md` bridge 적용 검토 (dogfooding)

### Phase 3: 성능 및 구조 (4.3)

- [ ] `npm test` 실행 시간 프로파일링
  - 병목이 되는 CLI 통합 테스트 식별
  - 가능하다면 독립적인 단위 테스트와 통합 테스트 분리 (`npm run test:unit`, `npm run test:integration`)
- [ ] `src/control.mjs` 분리
  - `skill-crud.mjs`, `workflow-crud.mjs`, `trust-source.mjs`, `can-use-guard.mjs`, `config-write.mjs` 등으로 쪼개기
  - 예상 영향: 낶부 구조 개선, 기존 테스트 그대로 통과해야 함
- [ ] `doctor`/`brief`의 중복 workspace 로딩 최소화 (cache 또는 단일 로드 경로)

### Phase 4: 도메인 정제 (선택, 높은 가치)

- [ ] `status`/`invocation` 매트릭스 검토: 14×6 조합 중 실제로 사용되는 조합을 문서화하고, 불필요한 조합은 deprecate 또는 명시적 금지
- [ ] `capability`의 global 정의와 workflow-scope `required_capabilities` 관계를 docs에 명확히 시각화
- [ ] `install_unit`의 `trust_level`과 `permission_risk` 조합에 따른 자동 권고 정책을 advisor action cards로 노출

## TDD Notes

- Red: 현재는 코드 리뷰/검토 단계이므로 새로운 failing test 없음
- Green: 기존 `npm test`, `npm run diagnostics`, README 예제, 임시 프로젝트 라이프사이클 모두 통과함
- Refactor: Phase 3의 `control.mjs` 분리가 핵심 리팩터링. 기존 인터페이스(`src/index.mjs` exports)는 유지해야 함

## Verification

- Commands to run:
  - `npm run diagnostics`
  - `npm test`
  - `node bin/skillboard.mjs check --config examples/multi-source.config.yaml --skills examples/multi-source-skills`
  - 임시 디렉토리에서 `init → add skill → add workflow → activate → impact → remove → uninstall` 시뮬레이션
- Results:
  - TypeScript diagnostics: 통과
  - `npm test`: 47개+ 테스트 통과 (timeout은 길지만 실패 없음)
  - README 예제: 정상 동작
  - 임시 프로젝트 라이프사이클: 정상 동작

## Decisions

- **즉시 개선 권장**: 4.1 frontmatter 에러 메시지, `--config/--skills` 기본값, `doctor --summary`
- **중기 개선 권장**: `control.mjs` 분리, test suite 분리, `CONTRIBUTING.md`
- **도메인 설계는 유지**: 5개 엔티티 구조와 deny-by-default 정책은 변경하지 않음. 세부 상태/호출 매트릭스만 정제

## Resume State

- Done: 도메인 모델 audit, 사용자 불편 분석, MVP 기능 동작 검증, 개선 계획 초안
- In progress: plan 문서 작성 및 사용자 피드백 수렴
- Next command: 사용자가 Phase 1~4 중 우선순위를 확인하면 해당 항목부터 구현 시작
- Open risks:
  - `control.mjs` 분리 시 public API 변화 없이 진행해야 함
  - `--config/--skills` 기본값 추가는 기존 테스트의 명시적 인자 의존에 영향 없음 (기존 동작 유지)

## Progress Log

- 2026-06-25T08:00:25Z: Plan created.
- 2026-06-25T08:45:00Z: Domain audit, friction analysis, and improvement plan written.
