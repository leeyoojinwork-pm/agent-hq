# registry — 로비 등록

`registry/<GitHub 로그인>.json` 파일 하나를 PR로 추가하면 뷰어의 CONNECT 목록(로비)에 빌딩이 나타납니다.

```json
{
  "handle": "내아이디",
  "name": "MY AGENT STUDIO",
  "source": "gh:내아이디/my-agents",
  "description": "한 줄 소개 (선택, 140자 이하)"
}
```

- 파일명 = `handle` = PR 작성자 GitHub 로그인
- `source`: `gh:owner/repo[@branch][:path.json]` 또는 `https://...json` — 공개 접근 가능해야 하고 스키마 검증을 통과해야 합니다
- `index.json`은 직접 고치지 마세요. main 반영 시 GitHub Actions가 다시 만듭니다

자세한 연결 방법: [docs/CONNECT.md](../docs/CONNECT.md)
