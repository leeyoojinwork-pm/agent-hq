# AGENT HQ — Night Shift

Codex와 Claude에서 만든 개인 에이전트들을 한 화면에서 보는 픽셀 관제실.
트레이딩 플로어 레퍼런스를 **야간 빌딩 단면도**로 변주한 v2 디자인입니다.

## 실행

빌드 없음. `index.html`을 브라우저로 열면 끝.

```bash
# 로컬 서버로 보고 싶다면
python3 -m http.server 4173
# → http://127.0.0.1:4173
```

GitHub Pages: Settings → Pages → Branch `main` / root 선택하면 바로 배포됩니다.

## 구조

- 5층 빌딩 단면: 5F 지휘부 / 4F 검수실 / 3F 디자인실 / 2F 리서치·콘텐츠 / 1F 기계실
- 캔버스 저해상도(384×288) 렌더 → 3배 업스케일로 픽셀 유지
- 애니메이션: 타이핑, 모니터 플리커, 엘리베이터, 네온 사인, 유성, 서버랙 LED, 고양이
- 인터랙션: 책상 클릭 / ←→ 키 선택, 말풍선, 상세 패널, 필터, 라이브 로그, 티커, CRT 토글

## 파일

| 파일 | 역할 |
|---|---|
| `index.html` | 앱 전체 (HTML+CSS+JS 단일 파일, 프레임워크 없음) |
| `docs/HANDOFF.md` | 설계 의도, 좌표계, 데이터 모델, 렌더 파이프라인 |
| `docs/OPUS-BRIEF.md` | 다음 단계(실데이터 연동) 요구사항 명세 + Opus 지시 프롬프트 |

## GitHub에 올리기

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
