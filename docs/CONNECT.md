# 내 멀티에이전트를 Agent HQ에 연결하기

Agent HQ는 **에이전트 상태를 담은 JSON 파일 하나(`agent-hq.json`)** 를 읽어 픽셀 빌딩으로 그립니다.
Claude Code, Codex, LangGraph, CrewAI, AutoGen, 직접 만든 파이프라인 등 무엇을 쓰든 이 파일만 만들면 연결됩니다.

```
내 에이전트들 ──report──▶ agent-hq.json ──┬─ node hq.mjs serve ──▶ 뷰어 ?src=local      (내 PC, 실시간)
                                          └─ node hq.mjs push  ──▶ 내 GitHub 리포 ──▶ 뷰어 ?gh=me/repo (공유용)
                                                                         └─ registry/ PR ──▶ 로비 목록
```

필요한 것: Node 18 이상. 설치할 패키지는 없습니다.

## 1. 커넥터 받기

```bash
curl -O https://raw.githubusercontent.com/leeyoojinwork-pm/agent-hq/main/hq.mjs
```

`hq.mjs` 한 파일이 전부입니다. 작업 폴더 아무 곳에 두세요.

## 2. 에이전트 등록하기

방법 A — Claude Code/Codex 에이전트 정의 자동 스캔 (`~/.claude/agents/*.md`, `~/.codex/prompts/*.md`)

```bash
node hq.mjs scan
```

방법 B — 아무 프레임워크나 직접 보고. 처음 보고하는 id는 자동으로 등록됩니다.

```bash
node hq.mjs report planner --status active --task "요구사항 분해" --team Control --origin LangGraph
node hq.mjs report writer  --status idle --team Content --origin LangGraph
```

| 필드 | 뜻 |
|---|---|
| `status` | `active`(작업 중) · `review`(검토/마무리) · `idle`(대기) |
| `team` | 같은 팀끼리 같은 층. `Control` `Review` `Design` `Research` `Content` `Engineering` `General` 순으로 위층, 그 외 이름은 아래에 추가 |
| `origin` | 이름표 점 색과 필터. 자유 문자열 (`Claude`, `Codex`, `CrewAI` …) |
| `task` | 말풍선·상세 패널에 보이는 지금 하는 일 한 줄 |

보고가 끊기면 `active`는 5분 뒤 `review`, 30분 뒤 `idle`로 자동으로 내려갑니다.
전체 형식: [`schema/agent-hq.schema.json`](../schema/agent-hq.schema.json)

## 3-A. 내 PC에서 실시간으로 보기

```bash
node hq.mjs serve
```

브라우저에서 **https://leeyoojinwork-pm.github.io/agent-hq/?src=local** 을 엽니다.
(Safari는 https 페이지에서 localhost 접속을 막습니다 → http://127.0.0.1:4173 을 직접 여세요.)

서버가 떠 있으면 에이전트 코드에서 HTTP로 바로 보고할 수 있습니다.

```bash
curl -X POST http://127.0.0.1:4173/api/report -H 'content-type: application/json' \
  -d '{"id":"writer","status":"active","task":"2장 초안","team":"Content","origin":"CrewAI"}'
```

**Python** — [`sdk/python/agent_hq.py`](../sdk/python/agent_hq.py) 를 프로젝트에 복사 (표준 라이브러리만 사용, 실패해도 에이전트를 멈추지 않음)

```python
from agent_hq import HQ
hq = HQ(origin="LangGraph")

hq.report("planner", "active", task="요구사항 분해", team="Control")

with hq.working("writer", task="2장 초안", team="Content"):
    run_writer()            # 시작 active → 끝나면 idle, 예외면 review
```

LangGraph 노드, CrewAI 태스크 콜백, AutoGen 메시지 훅 등 "에이전트가 일을 시작/끝내는 지점"에 위 한 줄을 넣으면 됩니다.

**JavaScript**

```js
const report = (b) => fetch("http://127.0.0.1:4173/api/report", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b),
}).catch(() => {});
report({ id: "reviewer", status: "active", task: "PR 리뷰", origin: "Custom" });
```

옵션: `--port 5000` (뷰어는 `?src=local&port=5000`), `--token 비밀값` (POST에 `Authorization: Bearer 비밀값` 필요),
`--no-logs` (Claude Code 세션 로그 기반 자동 감지 끄기).

## 3-B. GitHub로 공유하기

다른 사람이 내 빌딩을 보려면 `agent-hq.json`을 **내 public 리포**에 올립니다.

```bash
gh auth login                       # 또는 GITHUB_TOKEN 환경변수 (repo contents 쓰기 권한)
node hq.mjs push 내아이디/my-agents             # 한 번 게시
node hq.mjs push 내아이디/my-agents --watch 60  # 60초마다 바뀐 경우만 게시
```

- git 명령 없이 GitHub API로 파일 하나만 커밋합니다. 리포는 미리 만들어 두세요(빈 리포 가능).
- 게시 전 스키마 검증을 하고, 로컬 파일 경로(`source`)는 지웁니다. **`task` 문구와 이벤트는 공개됩니다.** 고객명, 내부 경로, 토큰을 넣지 마세요.
- 보기: **https://leeyoojinwork-pm.github.io/agent-hq/?gh=내아이디/my-agents**
  - 브랜치/경로 지정: `?gh=owner/repo@dev:hq/agent-hq.json`
  - GitHub raw 캐시 때문에 반영까지 최대 몇 분 걸릴 수 있습니다. 실시간은 3-A.
- 직접 커밋해도 됩니다. 리포 루트에 `agent-hq.json`이 있으면 끝입니다.
- GitHub가 아닌 곳: CORS가 열린 https URL이면 `?src=https://.../agent-hq.json`.

## 4. 로비에 등록하기 (선택)

뷰어 오른쪽 CONNECT 패널의 목록(로비)에 내 빌딩을 올립니다.

1. 이 리포를 Fork
2. `registry/<내 GitHub 로그인>.json` 파일 하나 추가

   ```json
   {
     "handle": "내아이디",
     "name": "MY AGENT STUDIO",
     "source": "gh:내아이디/my-agents",
     "description": "리서치·작성·검수 3인 팀 (CrewAI)"
   }
   ```

3. PR 생성 → GitHub Actions가 자동 검증 (파일명=PR 작성자, source 접근 가능, 스키마 통과)
4. 머지되면 Actions가 `registry/index.json`을 다시 만들고 로비에 나타납니다

`source` 형식: `gh:owner/repo`, `gh:owner/repo@branch`, `gh:owner/repo:path/file.json`, 또는 `https://...json`

## 문제 해결

| 증상 | 확인 |
|---|---|
| `?src=local`이 연결 실패 | `node hq.mjs serve`가 켜져 있는지. Safari면 http://127.0.0.1:4173 직접 접속. Chrome의 "로컬 네트워크 접근" 권한 팝업 허용 |
| `?gh=`가 HTTP 404 | 리포가 public인지, 파일이 루트에 `agent-hq.json` 이름으로 있는지, 브랜치/경로 지정이 맞는지 |
| 화면에 반영이 늦음 | GitHub raw 캐시(최대 5분). 실시간이 필요하면 serve 사용 |
| 검증 실패 | `node hq.mjs validate` 로 어떤 필드가 문제인지 확인 |
| 에이전트가 계속 '작업 중' | `updatedAt` 없는 수동 파일이면 감쇠가 적용되지 않습니다. report를 쓰면 자동으로 들어갑니다 |
