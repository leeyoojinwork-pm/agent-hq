# OPUS-BRIEF — 다음 단계 요구사항 명세

Opus(또는 다른 상위 모델)에게 넘길 작업 지시서. 아래 "복붙용 프롬프트"를 그대로 붙여넣고, 이 리포를 함께 제공하면 된다.

---

## 복붙용 프롬프트

```
너는 Agent HQ 프로젝트를 이어받는다. 리포의 docs/HANDOFF.md와 docs/OPUS-BRIEF.md를 먼저 읽어라.

목표: 지금 하드코딩된 AGENTS 배열을 실제 내 Codex/Claude 에이전트 정의에서 자동 생성하고,
실행 상태를 실시간으로 반영하는 것. 디자인과 렌더 파이프라인은 절대 건드리지 마라.

작업 순서는 OPUS-BRIEF.md의 Phase 1 → 2 → 3 순서를 따르고,
각 Phase 완료 시 수용 기준(AC)을 스스로 검증한 결과를 보고해라.
제약(§비기능 요구사항)을 위반하는 제안은 하지 마라. 특히:
- 프레임워크/빌드 도구 도입 금지
- low 캔버스(384×288) 해상도와 90ms 틱 변경 금지
- index.html의 씬 렌더링 코드는 데이터 주입부 외 수정 금지
막히면 임의로 우회하지 말고 어떤 결정이 필요한지 질문해라.
```

---

## Phase 1 — 에이전트 자동 스캔 (데이터 어댑터)

하드코딩된 `AGENTS`를 로컬 에이전트 정의 파일에서 생성한다.

**스캔 대상**

- Claude: `~/.claude/agents/*.md` (frontmatter: name, description, tools, model)
- Codex: `~/.codex/` 설정 및 프로젝트별 `AGENTS.md`
- 프로젝트 로컬: `.claude/agents/*.md`

**산출물**

- `scan.mjs` (Node 18+, 의존성 0): 위 경로를 읽어 `agents.json` 생성
- `agents.json` 스키마 = HANDOFF.md의 데이터 모델 + `source`(원본 파일 경로) 필드
- `index.html`은 `agents.json`이 있으면 fetch해서 쓰고, 없으면(file:// 포함) 현재 내장 데이터로 폴백
- floor/slot 자동 배정: team 기준 그룹핑, 층당 최대 4명, 넘치면 층 추가(FLOORS 동적 생성)

**AC (수용 기준)**

1. `node scan.mjs && python3 -m http.server` 후 실제 내 에이전트들이 화면에 나타난다
2. agents.json 없이 file://로 열어도 깨지지 않는다 (폴백 동작)
3. 에이전트 15개 이상일 때 층이 자동으로 늘어나고 레이아웃이 무너지지 않는다

## Phase 2 — 실행 상태 연동

**요구사항**

- `serve.mjs` (Node 내장 http만 사용): 정적 서빙 + `/api/status` 엔드포인트
- status 판정: 세션 로그 파일(`~/.claude/projects/**/*.jsonl` 등)의 최근 수정 시각 기반
  - 최근 5분 내 활동 → `active`, 5–30분 → `review`(마무리 중), 그 외 → `idle`
- 프론트는 10초 폴링. WebSocket 금지(과설계).
- task 필드: 로그의 마지막 사용자 메시지 or 도구 호출 요약 1줄 (100자 컷)

**AC**

1. 실제로 Claude Code 세션을 돌리면 해당 에이전트가 1분 내 active로 바뀐다
2. 서버 없이 열면 Phase 1 상태로 동작 (폴링 실패 시 조용히 폴백, 콘솔 에러 스팸 금지)

## Phase 3 — 인터랙션 확장

- 상세 패널에 `source` 파일 경로 표시 + "복사" 버튼
- 로그 패널: 가짜 로그 대신 `/api/status`가 주는 실제 이벤트 표시 (서버 있을 때만)
- 워크스페이스 전환: `agents.json`을 프로젝트별로 두고 드롭다운 전환 (localStorage 기억)

**AC**: 전환 시 캔버스 재초기화 없이 데이터만 교체되고, 선택/필터 상태는 워크스페이스별로 유지.

## 비기능 요구사항 (전 Phase 공통)

| 항목 | 요구 |
|---|---|
| 스택 | 순수 JS/Node. 프레임워크·번들러·npm 의존성 금지 |
| 렌더 | low 384×288 / SC=3 / 90ms 틱 고정. 스프라이트=low, 텍스트=hi 레이어 원칙 유지 |
| 파일 | 프론트는 index.html 단일 파일 유지. 서버/스캐너만 별도 .mjs |
| 폴백 | 네트워크·서버·폰트 어느 것이 없어도 화면이 깨지면 안 됨 |
| 저장 | localStorage 키는 `agent-hq-v2:` 프리픽스, 스키마 바뀌면 v3로 올릴 것 |
| 보안 | 로그 원문을 그대로 노출하지 말 것 (경로·요약만). agents.json은 .gitignore |
| 검증 | Phase마다 node --check + 실제 브라우저 콘솔 무오류 확인 후 보고 |

## 모델 운용 권장

- **Opus**: Phase 1–2의 설계·구현 (파일 스캔 휴리스틱, 상태 판정 로직이 핵심 난이도)
- **Sonnet**: Phase 3 UI 작업, 스프라이트 추가 같은 반복 작업
- **Haiku**: agents.json 검증 스크립트, 커밋 메시지 등 잡무

## 하지 말 것 (v1 실패 원인)

- DOM 박스로 UI 다시 짜기 — v1이 구렸던 이유. 캔버스 파이프라인 유지
- 실데이터 붙인다고 디자인 단순화하기
- "일단 React로" — 금지
