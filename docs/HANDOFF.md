# HANDOFF — Agent HQ v2

## 한 줄 요약

Codex/Claude 에이전트 14개를 야간 빌딩 단면도 안에 배치한 픽셀 관제실. v1(트레이딩 플로어, DOM 박스)과 달리 **캔버스 픽셀 렌더링**으로 전면 재작성했다.

## v1 대비 바뀐 것

| | v1 (Codex) | v2 (현재) |
|---|---|---|
| 렌더링 | DOM 박스 + CSS | 저해상도 캔버스 → 3배 업스케일 |
| 공간 메타포 | 평면 트레이딩 플로어 | 빌딩 단면 (층 = 팀) |
| 모션 | 거의 없음 | 타이핑/플리커/엘리베이터/네온/유성 등 상시 |
| 파일 | 6개 분리 | 단일 index.html |

## 렌더 파이프라인

1. 오프스크린 캔버스 `low` (384×288)에 모든 픽셀 스프라이트를 그림
2. 메인 캔버스(1152×864, `imageSmoothingEnabled=false`)로 blit → 픽셀 크리스프 유지
3. 그 위에 고해상도 텍스트 레이어(`hiText()`): 네온 사인, 층 라벨, 이름표, 말풍선, 선택 브래킷
4. 프레임 틱 90ms(≈11fps) — 픽셀 감성 유지 목적, 올릴 필요 없음

**규칙: 스프라이트는 반드시 low 캔버스에, 텍스트는 반드시 hi 레이어에.** 저해상도에 텍스트를 그리면 깨지고, 고해상도에 스프라이트를 그리면 픽셀감이 사라진다.

## 좌표계 (low 캔버스 기준, SC=3 곱하면 hi 좌표)

- 빌딩: x 24–360, 옥상 y38, 층 높이 42, 지면 y254
- `fTop(i) = 44 + i*42`, `fBot(i) = fTop(i)+39` (슬래브 상단 = 캐릭터 바닥)
- 엘리베이터 샤프트: x 328–352
- 책상 배치: `deskGeom(agent)` — 층 내 에이전트 수(n)로 균등 분할, slot 순서
- 클릭 판정: `hits[]` 배열 (hi 좌표로 미리 계산)

## 데이터 모델

`AGENTS` 배열 하드코딩. 필드:

```js
{ id, name, origin: "Codex"|"Claude", role, team,
  status: "active"|"review"|"idle",
  floor: 0-4, slot: 0-3,          // v1의 x,y 퍼센트를 대체
  task, output, load, model, accent }
```

`FLOORS` 배열이 층 구성(5F→1F)을 정의. 층 배정을 바꾸려면 floor/slot만 수정하면 된다 — 좌표 자동 계산.

## 상태 → 표현 매핑

- `active`: 타이핑 애니메이션, 모니터 액센트색 플리커, 초록 LED, 화면에 코드 라인
- `review`: 고개 끄덕임, 모니터 앰버 펄스, 앰버 LED
- `idle`: 슬럼프 자세, 모니터 꺼짐, 회색 LED, "z" 부유

## 상태 저장

localStorage 키 `agent-hq-v2:*` — selected, filter, crt.

## 의존성

- Galmuri 픽셀 폰트 (jsDelivr CDN). 오프라인이면 monospace 폴백 — 깨지지 않음.
- 그 외 0. 프레임워크/빌드 없음.

## M1/M2 추가분 (2026-07-04 2차)

- **데이터 주입**: `AGENTS`/`FLOORS`는 이제 `let`. 부팅 시 `agents.json` fetch → 성공하면
  `applyData(d)` → `initScene()`이 층 수(NF), GROUND, 캔버스 H를 재계산. 실패하면 내장 데이터 폴백.
- **initScene()**: 캔버스 리사이즈(→ imageSmoothingEnabled 재설정 필수), hits 재계산,
  선택 상태 검증, 엘리베이터 리셋, 통계/티커/사이드 재렌더를 담당. 데이터가 바뀌면 반드시 이걸 호출.
- **동적 층 규칙**: H = 44 + NF*42 + 34. 기계실 판정은 층 라벨의 /ENGINE/i 매칭(isEngine).
- **콘솔 테스트**: `window.applyData({floors,agents})`로 브라우저에서 직접 주입 가능.
- **라이브 상태(M2)**: `/api/status` 10초 폴링. 성공하면 `live=true`가 되어 가짜 로그 생성 중단,
  상태만 갱신(레이아웃 불변). 서버가 없으면 catch로 조용히 무시.
- **serve.mjs**: 정적 서빙 + 상태 판정. `~/.claude/projects/**/*.jsonl` 최근 20개의 tail 64KB에서
  에이전트 이름/id 매칭 → 최근 5분 active / 30분 review / 그 외 idle. 8초 캐시.

## 알려진 한계

- 모바일 세로 화면에서 캔버스가 작아짐 — 핀치줌으로 커버, 전용 세로 레이아웃은 미구현
- 말풍선은 선택된 에이전트 1개만 표시 (의도된 절제)
- 상태 판정은 로그 텍스트 매칭 휴리스틱 — 동명이인 에이전트가 있으면 오탐 가능

## 검증 기록

- 인라인 JS `node --check` 통과
- 클릭 히트박스 = 렌더 좌표 동일 소스(`deskGeom`)에서 파생 — 어긋남 없음
