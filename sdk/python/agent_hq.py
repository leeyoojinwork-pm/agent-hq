"""
agent_hq.py — Agent HQ 상태 보고 클라이언트 (Python 3.8+, 표준 라이브러리만 사용)

로컬에서 `node hq.mjs serve`가 돌고 있으면 그 서버로 상태를 보낸다.
서버가 없거나 실패해도 예외를 던지지 않는다 — 관제실 때문에 에이전트가 멈추면 안 되니까.

    from agent_hq import HQ
    hq = HQ(origin="LangGraph")                      # HQ_URL / HQ_TOKEN 환경변수로 덮어쓰기 가능
    hq.report("planner", "active", task="요구사항 분해", team="Control")

    with hq.working("writer", task="초안 작성", team="Content"):
        ...                                          # 시작 시 active, 끝나면 idle (예외면 review)
"""
import json
import os
import threading
import urllib.request
from contextlib import contextmanager

__all__ = ["HQ"]


class HQ:
    def __init__(self, url=None, token=None, origin="Custom", timeout=2.0, background=True):
        self.url = (url or os.environ.get("HQ_URL") or "http://127.0.0.1:4173").rstrip("/")
        self.token = token or os.environ.get("HQ_TOKEN") or ""
        self.origin = origin
        self.timeout = timeout
        self.background = background

    def _post(self, payload):
        req = urllib.request.Request(
            self.url + "/api/report",
            data=json.dumps(payload).encode("utf-8"),
            headers={"content-type": "application/json",
                     **({"authorization": "Bearer " + self.token} if self.token else {})},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                return json.loads(r.read() or b"{}")
        except Exception:
            return None

    def report(self, agent_id, status=None, task=None, **fields):
        """status: 'active' | 'review' | 'idle'. fields: name, team, role, model, output, load, accent, event"""
        payload = {"id": agent_id, "origin": fields.pop("origin", self.origin)}
        if status:
            payload["status"] = status
        if task is not None:
            payload["task"] = task
        payload.update({k: v for k, v in fields.items() if v is not None})
        if self.background:
            threading.Thread(target=self._post, args=(payload,), daemon=True).start()
            return None
        return self._post(payload)

    def event(self, agent_id, text):
        return self.report(agent_id, event=text)

    @contextmanager
    def working(self, agent_id, task=None, **fields):
        self.report(agent_id, "active", task=task, **fields)
        try:
            yield self
        except Exception as e:
            self.report(agent_id, "review", event=f"오류: {type(e).__name__}")
            raise
        else:
            self.report(agent_id, "idle", event="완료" + (f" · {task}" if task else ""))


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 3:
        print("사용법: python agent_hq.py <agent-id> <active|review|idle> [task]")
        sys.exit(1)
    hq = HQ(background=False)
    print(hq.report(sys.argv[1], sys.argv[2], task=sys.argv[3] if len(sys.argv) > 3 else None) or "서버 응답 없음 (node hq.mjs serve 실행 중인지 확인)")
