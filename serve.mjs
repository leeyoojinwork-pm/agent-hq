#!/usr/bin/env node
/**
 * serve.mjs — Agent HQ M2 상태 서버 (의존성 0, Node 18+)
 *
 * 정적 파일 서빙 + /api/status 엔드포인트.
 * 세션 로그(~/.claude/projects/** /*.jsonl)의 mtime과 내용으로
 * 에이전트별 active / review / idle 상태를 판정한다.
 *
 *   active : 최근 5분 내 활동 흔적
 *   review : 5–30분
 *   idle   : 그 외
 *
 * 사용:
 *   node scan.mjs && node serve.mjs          # http://127.0.0.1:4173
 *   node serve.mjs --port 5000 --root ~      # 옵션
 */
import { createServer } from "node:http";
import { readFileSync, readdirSync, statSync, existsSync, openSync, readSync, closeSync } from "node:fs";
import { homedir } from "node:os";
import { join, extname } from "node:path";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const PORT = Number(opt("port", 4173));
const ROOT = opt("root", homedir());
const CWD = process.cwd();

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".md": "text/plain; charset=utf-8" };

/* ---------- 세션 로그 수집 ---------- */
const ACTIVE_MS = 5 * 60 * 1000, REVIEW_MS = 30 * 60 * 1000, DAY_MS = 24 * 3600 * 1000;

function recentLogs() {
  const base = join(ROOT, ".claude", "projects");
  const out = [];
  if (!existsSync(base)) return out;
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name.endsWith(".jsonl")) {
        try { const st = statSync(p);
          if (Date.now() - st.mtimeMs < DAY_MS) out.push({ path: p, mtime: st.mtimeMs, size: st.size });
        } catch {}
      }
    }
  };
  walk(base, 0);
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, 20);
}

/** 파일 끝 64KB만 읽기 (대형 로그 대비) */
function tail(path, size) {
  const N = 64 * 1024;
  try {
    const fd = openSync(path, "r");
    const len = Math.min(N, size);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, Math.max(0, size - len));
    closeSync(fd);
    return buf.toString("utf8");
  } catch { return ""; }
}

/* ---------- 상태 판정 (8초 캐시) ---------- */
let cache = { at: 0, body: null };
function status() {
  if (Date.now() - cache.at < 8000 && cache.body) return cache.body;
  let agents = [];
  try { agents = JSON.parse(readFileSync(join(CWD, "agents.json"), "utf8")).agents || []; } catch {}
  const logs = recentLogs();
  const texts = logs.map(l => ({ ...l, text: tail(l.path, l.size) }));
  const now = Date.now();

  const result = agents.map(a => {
    let last = 0, evidence = null;
    for (const l of texts) {
      const hit = (a.name && l.text.includes(a.name)) || (a.id && l.text.includes(a.id));
      if (hit && l.mtime > last) { last = l.mtime; evidence = l.path; }
    }
    // 이름 매칭이 전혀 없으면 최신 로그 활동을 약한 신호로만 사용하지 않고 idle 유지
    const age = now - last;
    const st = !last ? "idle" : age < ACTIVE_MS ? "active" : age < REVIEW_MS ? "review" : "idle";
    return { id: a.id, status: st, lastActive: last || null, evidence };
  });

  const events = logs.slice(0, 10).map(l => ({
    time: l.mtime,
    text: l.path.split("/").slice(-2).join("/") + " 갱신",
  }));

  cache = { at: Date.now(), body: JSON.stringify({ generatedAt: new Date().toISOString(), agents: result, events }) };
  return cache.body;
}

/* ---------- 서버 ---------- */
createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/api/status") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    return res.end(status());
  }
  let file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  file = file.replace(/\.\./g, "");          // path traversal 방지
  const p = join(CWD, file);
  if (!existsSync(p) || !statSync(p).isFile()) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(p));
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Agent HQ: http://127.0.0.1:${PORT}  (root=${ROOT})`);
});
