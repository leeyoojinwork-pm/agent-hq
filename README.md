# AGENT HQ — Night Shift

Codex와 Claude에서 만든 개인 에이전트들을 한 화면에서 보는 픽셀 관제실.
트레이딩 플로어 레퍼런스를 **야간 빌딩 단면도**로 변주한 v2 디자인입니다.

## 내 에이전트 연결하기 (v3)

누구나 자기 멀티에이전트(Claude Code, Codex, LangGraph, CrewAI, 직접 만든 것 등)를 이 빌딩에 연결할 수 있습니다.
자세한 방법: **[docs/CONNECT.md](docs/CONNECT.md)**

```bash
curl -O https://raw.githubusercontent.com/leeyoojinwork-pm/agent-hq/main/hq.mjs   # 커넥터 (Node 18+, 의존성 0)
node hq.mjs scan                                   # Claude/Codex 에이전트 정의 자동 등록 (선택)
node hq.mjs report writer --status active --task "2장 초안" --team Content --origin CrewAI
node hq.mjs serve                                  # → https://leeyoojinwork-pm.github.io/agent-hq/?src=local
node hq.mjs push 내아이디/my-agents --watch 60     # → https://leeyoojinwork-pm.github.io/agent-hq/?gh=내아이디/my-agents
```

| 연결 방식 | 뷰어 주소 | 용도 |
|---|---|---|
| 로컬 실시간 | `?src=local` | 내 PC에서 5초 단위 실시간. 에이전트는 `POST /api/report`로 보고 |
| GitHub 리포 | `?gh=owner/repo[@branch][:path]` | 공유용. 리포의 `agent-hq.json`을 30초마다 읽음 |
| 임의 URL | `?src=https://.../agent-hq.json` | CORS가 열린 곳 어디든 |
| 로비 | 오른쪽 CONNECT 목록 | `registry/<login>.json` PR → Actions 검증 → 목록 노출 |

파라미터 없이 열면 데모 빌딩이 보입니다. `index.html`을 file://로 열어도 데모로 동작합니다.

## 구조

- 5층 빌딩 단면: 5F 지휘부 / 4F 검수실 / 3F 디자인실 / 2F 리서치·콘텐츠 / 1F 기계실
- 캔버스 저해상도(384×288) 렌더 → 3배 업스케일로 픽셀 유지
- 애니메이션: 타이핑, 모니터 플리커, 엘리베이터, 네온 사인, 유성, 서버랙 LED, 고양이
- 인터랙션: 책상 클릭 / ←→ 키 선택, 말풍선, 상세 패널, 필터, 라이브 로그, 티커, CRT 토글

## 파일

| 파일 | 역할 |
|---|---|
| `index.html` | 뷰어 전체 (HTML+CSS+JS 단일 파일, 프레임워크 없음) |
| `hq.mjs` | 커넥터 CLI — init/scan/report/serve/push/validate (단일 파일, 의존성 0) |
| `scan.mjs`, `serve.mjs` | 하위 호환 래퍼 (`hq.mjs scan` / `hq.mjs serve`) |
| `schema/agent-hq.schema.json` | 데이터 포맷 v1 |
| `sdk/python/agent_hq.py` | Python 보고 클라이언트 (표준 라이브러리만) |
| `registry/` | 로비 등록 파일 + Actions가 만드는 `index.json` |
| `tools/registry.mjs` | 로비 검증/빌드 (`.github/workflows/registry.yml`에서 실행) |
| `examples/demo.agent-hq.json` | 데모 빌딩 데이터 |
| `docs/CONNECT.md` | 연결 가이드 |
| `docs/ROADMAP.md` | **SSOT** — 마일스톤, 핸드오프 프로토콜 |
| `docs/HANDOFF.md` | 설계 의도, 좌표계, 데이터 모델, 렌더 파이프라인 |

라이브 데모: https://leeyoojinwork-pm.github.io/agent-hq/

## (참고) 이 리포를 처음 올릴 때

```bash
cd agent-hq
git init && git add -A && git commit -m "feat: Agent HQ v2 — pixel building cross-section"
gh repo create agent-hq --public --source . --push
# gh 없으면: github.com/new 에서 repo 만든 뒤
# git remote add origin https://github.com/<username>/agent-hq.git
# git push -u origin main
```

## 라이선스

MIT
