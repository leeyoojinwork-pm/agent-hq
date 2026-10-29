#!/usr/bin/env node
/**
 * hq.mjs — Agent HQ 커넥터 (의존성 0, Node 18+, 단일 파일)
 *
 * 어떤 멀티에이전트든 Agent HQ 빌딩에 연결한다. 이 파일 하나만 내려받아 쓰면 된다.
 *
 *   node hq.mjs init                     # 빈 agent-hq.json 생성 (또는 scan으로 채우기)
 *   node hq.mjs scan                     # ~/.claude/agents, ~/.codex/prompts → agent-hq.json
 *   node hq.mjs report <id> --status active --task "..." [--team T --origin O --role R --model M]
 *   node hq.mjs serve [--port 4173]      # 로컬 라이브 서버 (POST /api/report, GET /api/hq)
 *   node hq.mjs push owner/repo [--watch 60] [--path agent-hq.json] [--branch main]
 *   node hq.mjs validate [file]
 *
 * 데이터 포맷: agent-hq.json (schema/agent-hq.schema.json, version 1)
 * 뷰어: https://leeyoojinwork-pm.github.io/agent-hq/?gh=owner/repo  또는  ?src=local
 */
import { createServer } from "node:http";
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, openSync, readSync, closeSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename, extname, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

export const VIEWER = process.env.HQ_VIEWER || "https://leeyoojinwork-pm.github.io/agent-hq/";
export const STATUSES = ["active", "review", "idle"];
export const ACCENTS = ["amber", "green", "red", "blue", "pink", "purple", "yellow", "orange"];
const MAX_AGENTS = 200, MAX_EVENTS = 50;

/* ============================================================
   스키마 검증 (뷰어·레지스트리 Action과 같은 규칙)
============================================================ */
export function validate(d) {
  const errs = [];
  const str = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max && !/[\u0000-\u001f]/.test(v);
  if (!d || typeof d !== "object" || Array.isArray(d)) return ["최상위가 객체가 아님"];
  if (d.version !== undefined && d.version !== 1) errs.push(`지원하지 않는 version: ${d.version}`);
  if (d.hq !== undefined) {
    if (typeof d.hq !== "object" || !d.hq) errs.push("hq는 객체여야 함");
    else if (d.hq.name !== undefined && !str(d.hq.name, 60)) errs.push("hq.name은 1~60자 문자열");
  }
  if (!Array.isArray(d.agents)) return [...errs, "agents 배열 없음"];
  if (d.agents.length > MAX_AGENTS) errs.push(`agents는 최대 ${MAX_AGENTS}개`);
  const ids = new Set();
  d.agents.forEach((a, i) => {
    const at = `agents[${i}]`;
    if (!a || typeof a !== "object") return errs.push(`${at}: 객체가 아님`);
    if (!str(a.id, 64)) errs.push(`${at}.id: 1~64자 문자열 필요`);
    else if (ids.has(a.id)) errs.push(`${at}.id 중복: ${a.id}`);
    else ids.add(a.id);
    if (a.name !== undefined && !str(a.name, 60)) errs.push(`${at}.name: 1~60자`);
    if (a.status !== undefined && !STATUSES.includes(a.status)) errs.push(`${at}.status: ${STATUSES.join("|")}`);
    for (const k of ["origin", "team", "model"]) if (a[k] !== undefined && !str(a[k], 32)) errs.push(`${at}.${k}: 1~32자`);
    for (const k of ["role", "output"]) if (a[k] !== undefined && typeof a[k] !== "string") errs.push(`${at}.${k}: 문자열`);
    if (a.task !== undefined && typeof a.task !== "string") errs.push(`${at}.task: 문자열`);
    if (a.accent !== undefined && !ACCENTS.includes(a.accent)) errs.push(`${at}.accent: ${ACCENTS.join("|")}`);
    if (a.load !== undefined && (typeof a.load !== "number" || a.load < 0 || a.load > 100)) errs.push(`${at}.load: 0~100`);
    if (a.updatedAt !== undefined && isNaN(Date.parse(a.updatedAt))) errs.push(`${at}.updatedAt: ISO 시각`);
  });
  if (d.events !== undefined) {
    if (!Array.isArray(d.events)) errs.push("events는 배열");
    else if (d.events.length > 500) errs.push("events는 최대 500개");
  }
  return errs;
}

/* ============================================================
   파일 I/O
============================================================ */
export function emptyHQ(name) {
  return { version: 1, hq: { name: name || "MY HQ" }, agents: [], events: [] };
}
export function load(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}
function save(file, d) {
  d.version = 1;
  d.generatedAt = new Date().toISOString();
  if (Array.isArray(d.events)) d.events = d.events.slice(0, MAX_EVENTS);
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(d, null, 2) + "\n");
  renameSync(tmp, file);                       // 원자적 교체 (serve가 읽는 도중 깨지지 않게)
}

/* ============================================================
   report — 에이전트 상태 갱신 (없으면 자동 등록)
============================================================ */
const clip = (s, n) => String(s).replace(/[\u0000-\u001f]+/g, " ").slice(0, n);
export function applyReport(d, r) {
  if (!r || !r.id || typeof r.id !== "string") throw new Error("id 필요");
  const id = clip(r.id, 64);
  if (r.status !== undefined && !STATUSES.includes(r.status)) throw new Error("status는 " + STATUSES.join("|"));
  d.agents = Array.isArray(d.agents) ? d.agents : [];
  d.events = Array.isArray(d.events) ? d.events : [];
  let a = d.agents.find((x) => x.id === id);
  if (!a) {
    if (d.agents.length >= MAX_AGENTS) throw new Error("agents 최대 개수 초과");
    a = { id, name: id, origin: "Custom", team: "General", status: "idle",
      accent: ACCENTS[d.agents.length % ACCENTS.length] };
    d.agents.push(a);
  }
  for (const [k, n] of [["name", 60], ["origin", 32], ["team", 32], ["role", 60], ["model", 32], ["output", 120]])
    if (r[k] !== undefined && r[k] !== "") a[k] = clip(r[k], n);
  if (r.task !== undefined) a.task = clip(r.task, 140);
  if (r.status) a.status = r.status;
  if (r.load !== undefined && !isNaN(Number(r.load))) a.load = Math.max(0, Math.min(100, Number(r.load)));
  if (r.accent && ACCENTS.includes(r.accent)) a.accent = r.accent;
  a.updatedAt = new Date().toISOString();
  const text = r.event ? clip(r.event, 140) : (r.task ? `${a.status} · ${clip(r.task, 100)}` : a.status);
  d.events.unshift({ time: Date.now(), agent: a.id, text });
  d.events = d.events.slice(0, MAX_EVENTS);
  return a;
}

/* ============================================================
   scan — 로컬 Claude/Codex 에이전트 정의 수집
============================================================ */
const TEAM_KEYWORDS = [
  ["Review",      /review|critic|qa|audit|검토|검수|비평|평가/i],
  ["Design",      /design|ui|ux|wireframe|copy|asset|디자인|문구|와이어/i],
  ["Research",    /research|persona|test|리서치|조사|테스트/i],
  ["Content",     /writ|content|locale|translat|콘텐츠|번역|원고|글/i],
  ["Engineering", /engineer|image|build|deploy|lint|검증|빌드|생성/i],
  ["Control",     /orchestr|master|manager|pm|plan|지휘|총괄|관리/i],
];
function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fm = {};
  if (m) for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_-]+)\s*:\s*(.+)$/);
    if (kv) fm[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return { fm, body: (m ? text.slice(m[0].length) : text).trim() };
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9가-힣]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "agent";
function stableLoad(path) {
  let h = 0;
  for (const c of path) h = (h * 31 + c.charCodeAt(0)) | 0;
  return 25 + (Math.abs(h) % 70);
}
function mdFiles(dir) {
  try { return readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => join(dir, f)).filter((p) => statSync(p).isFile()); }
  catch { return []; }
}
export function scan(root = homedir(), cwd = process.cwd()) {
  const sources = [
    { origin: "Claude", dirs: [join(root, ".claude", "agents"), join(cwd, ".claude", "agents")] },
    { origin: "Codex",  dirs: [join(root, ".codex", "prompts"), join(root, ".codex", "agents")] },
  ];
  const agents = [], seen = new Set();
  for (const { origin, dirs } of sources) for (const dir of dirs) for (const file of mdFiles(dir)) {
    const { fm, body } = parseFrontmatter(readFileSync(file, "utf8"));
    const name = fm.name || basename(file, ".md");
    const id = slug(origin + "-" + name);
    if (seen.has(id)) continue;
    seen.add(id);
    const desc = (fm.description || body.split(/\r?\n/).find((l) => l.trim()) || "").trim();
    let team = fm.team;
    if (!team) team = (TEAM_KEYWORDS.find(([, re]) => re.test(name + " " + desc)) || ["General"])[0];
    agents.push({
      id, name: name.slice(0, 60), origin, team, status: "idle",
      role: desc.slice(0, 40) || "에이전트",
      task: desc.slice(0, 90) || "대기 중",
      output: fm.output || basename(file),
      load: stableLoad(file),
      model: (fm.model || "sonnet").split("-")[0].slice(0, 32),
      accent: ACCENTS[agents.length % ACCENTS.length],
      source: file.replace(homedir(), "~"),
    });
  }
  return agents;
}
/** scan 결과를 기존 파일에 병합: 정의는 갱신, report로 쌓인 상태/작업은 보존 */
export function mergeScan(d, scanned) {
  for (const s of scanned) {
    const a = d.agents.find((x) => x.id === s.id);
    if (!a) d.agents.push(s);
    else for (const k of ["name", "origin", "team", "role", "model", "source", "output"]) a[k] = s[k];
  }
  return d;
}

/* ============================================================
   Claude Code 세션 로그 휴리스틱 (serve 전용, 파일엔 기록 안 함)
============================================================ */
const DAY_MS = 24 * 3600 * 1000;
function recentLogs(root) {
  const base = join(root, ".claude", "projects"), out = [];
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name.endsWith(".jsonl")) {
        try { const st = statSync(p); if (Date.now() - st.mtimeMs < DAY_MS) out.push({ path: p, mtime: st.mtimeMs, size: st.size }); } catch {}
      }
    }
  };
  walk(base, 0);
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, 20);
}
function tail(path, size) {
  const N = 64 * 1024;
  try {
    const fd = openSync(path, "r"), len = Math.min(N, size), buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, Math.max(0, size - len));
    closeSync(fd);
    return buf.toString("utf8");
  } catch { return ""; }
}
/** 로그에서 해당 에이전트를 실제로 호출한(`"subagent_type":"<name>"`) 마지막 시각.
 *  이름이 텍스트에 나오기만 한 경우(에이전트 목록, 대화 내용)는 세지 않는다. */
function lastInvocation(text, name) {
  if (!name) return 0;
  const key = JSON.stringify(name);
  let last = 0;
  for (const line of text.split("\n")) {
    if (!line.includes(key) || !/"subagent_type"\s*:/.test(line)) continue;
    if (!new RegExp('"subagent_type"\\s*:\\s*' + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(line)) continue;
    const ts = Date.parse((line.match(/"timestamp"\s*:\s*"([^"]+)"/) || [])[1]);
    if (ts > last) last = ts;
  }
  return last;
}
/** report가 없는(=updatedAt이 호출 시각보다 오래된) Claude 에이전트에만 실제 호출 시각을 덧씌운다 */
function overlayLogs(d, root) {
  const logs = recentLogs(root).map((l) => ({ ...l, text: tail(l.path, l.size) }));
  for (const a of d.agents) {
    if (a.origin !== "Claude") continue;
    let last = 0;
    for (const l of logs) last = Math.max(last, lastInvocation(l.text, a.name));
    const reported = a.updatedAt ? Date.parse(a.updatedAt) : 0;
    if (last && last > reported) { a.status = "active"; a.updatedAt = new Date(last).toISOString(); }
  }
  return d;
}

/* ============================================================
   serve — 로컬 라이브 서버
============================================================ */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };

export function serve({ port = 4173, file, root = homedir(), token = "", allow = [], staticDir, logs = true } = {}) {
  const viewerOrigin = new URL(VIEWER).origin;
  const allowed = new Set([viewerOrigin, ...allow]);
  const isLocal = (o) => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(o);
  let cache = { at: 0, body: null };
  let viewerHtml = null;                         // hq.mjs만 받은 경우: 호스팅 뷰어를 가져와 같은 origin(http)으로 서빙
  const remoteViewer = async () => {
    if (viewerHtml) return viewerHtml;
    const r = await fetch(VIEWER, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error("viewer " + r.status);
    return (viewerHtml = await r.text());
  };

  const server = createServer((req, res) => {
    const origin = req.headers.origin || "";
    const cors = {};
    if (origin && (allowed.has(origin) || isLocal(origin))) {
      cors["access-control-allow-origin"] = origin;
      cors["vary"] = "origin";
      cors["access-control-allow-methods"] = "GET, POST, OPTIONS";
      cors["access-control-allow-headers"] = "content-type, authorization";
      cors["access-control-allow-private-network"] = "true";   // Chrome Private Network Access
    }
    const send = (code, body, type = "application/json") => {
      res.writeHead(code, { ...cors, "content-type": type, "cache-control": "no-store" });
      res.end(body);
    };
    const url = new URL(req.url, "http://x");
    if (req.method === "OPTIONS") return send(204, "");

    if (url.pathname === "/api/hq" && req.method === "GET") {
      if (Date.now() - cache.at > 3000 || !cache.body) {
        const d = load(file) || emptyHQ();
        if (logs) overlayLogs(d, root);
        d.live = true;
        cache = { at: Date.now(), body: JSON.stringify(d) };
      }
      return send(200, cache.body);
    }

    if (url.pathname === "/api/report" && req.method === "POST") {
      if (origin && !cors["access-control-allow-origin"]) return send(403, '{"error":"origin not allowed"}');
      if (token && req.headers.authorization !== "Bearer " + token) return send(401, '{"error":"bad token"}');
      let raw = "";
      req.on("data", (c) => { raw += c; if (raw.length > 64 * 1024) req.destroy(); });
      req.on("end", () => {
        try {
          const body = JSON.parse(raw || "{}");
          const list = Array.isArray(body) ? body : [body];
          const d = load(file) || emptyHQ();
          const out = list.map((r) => applyReport(d, r));
          save(file, d);
          cache.at = 0;
          send(200, JSON.stringify({ ok: true, agents: out.map((a) => ({ id: a.id, status: a.status })) }));
        } catch (e) { send(400, JSON.stringify({ error: String(e.message || e) })); }
      });
      return;
    }

    if (req.method !== "GET") return send(405, '{"error":"method"}');
    // 정적: 뷰어(index.html)가 옆에 있으면 서빙, 없으면 호스팅 뷰어로 리다이렉트
    const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    const base = resolve(staticDir), p = resolve(base, rel);
    if (rel === "index.html" && !existsSync(p)) {
      remoteViewer().then((html) => send(200, html, MIME[".html"])).catch(() => {
        res.writeHead(302, { location: `${VIEWER}?src=${encodeURIComponent(`http://127.0.0.1:${port}`)}` });
        res.end();
      });
      return;
    }
    if (!p.startsWith(base + "/") || p.slice(base.length).split("/").some((seg) => seg.startsWith("."))
        || !existsSync(p) || !statSync(p).isFile())
      return send(404, "not found", "text/plain");
    send(200, readFileSync(p), MIME[extname(p)] || "application/octet-stream");
  });
  server.listen(port, "127.0.0.1");
  return server;
}

/* ============================================================
   push — GitHub 리포에 agent-hq.json 게시 (git 불필요, Contents API)
============================================================ */
/** 공개용 정제: 로컬 경로 제거 */
export function publicCopy(d) {
  const c = JSON.parse(JSON.stringify(d));
  c.agents = (c.agents || []).map(({ source, ...a }) => a);
  delete c.live;
  delete c.root;
  return c;
}
function ghToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try { return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim(); } catch { return ""; }
}
export async function push({ repo, file, path = "agent-hq.json", branch, message = "chore: update agent-hq.json" }) {
  const token = ghToken();
  if (!token) throw new Error("GitHub 토큰이 없습니다. `gh auth login` 하거나 GITHUB_TOKEN을 설정하세요.");
  const d = load(file);
  if (!d) throw new Error(`${file}을 읽을 수 없습니다. 먼저 init/scan/report를 실행하세요.`);
  const errs = validate(d);
  if (errs.length) throw new Error("검증 실패:\n  " + errs.join("\n  "));
  const pub = publicCopy(d);
  delete pub.generatedAt;                       // 내용이 같으면 커밋하지 않도록 비교 전 제거
  const api = `https://api.github.com/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
  const H = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "agent-hq" };
  const cur = await fetch(api + (branch ? `?ref=${encodeURIComponent(branch)}` : ""), { headers: H });
  let sha;
  if (cur.ok) {
    const j = await cur.json();
    sha = j.sha;
    try {
      const prev = JSON.parse(Buffer.from(j.content, "base64").toString("utf8"));
      delete prev.generatedAt;
      if (JSON.stringify(prev) === JSON.stringify(pub)) return { changed: false };
    } catch {}
  } else if (cur.status !== 404) throw new Error(`GitHub API ${cur.status}: ${await cur.text()}`);
  pub.generatedAt = new Date().toISOString();
  const body = { message, content: Buffer.from(JSON.stringify(pub, null, 2) + "\n").toString("base64"), sha, branch };
  const r = await fetch(api, { method: "PUT", headers: H, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`GitHub API ${r.status}: ${await r.text()}`);
  return { changed: true };
}

/* ============================================================
   CLI
============================================================ */
function parseArgs(argv) {
  const pos = [], o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { const k = a.slice(2); const v = argv[i + 1]; if (v === undefined || v.startsWith("--")) o[k] = true; else { o[k] = v; i++; } }
    else pos.push(a);
  }
  return { pos, o };
}
const HELP = `Agent HQ 커넥터

  node hq.mjs init [--name "MY HQ"]          빈 agent-hq.json 생성
  node hq.mjs scan [--root ~]                Claude/Codex 에이전트 정의를 agent-hq.json에 병합
  node hq.mjs report <id> --status active|review|idle [--task "..."] [--team T] [--origin O]
                         [--role R] [--model M] [--name N] [--load 0-100] [--event "..."]
  node hq.mjs serve [--port 4173] [--token T] [--allow-origin https://x] [--no-logs]
  node hq.mjs push <owner/repo> [--path agent-hq.json] [--branch main] [--watch 60]
  node hq.mjs validate [file]

공통 옵션: --file agent-hq.json (기본: 현재 폴더)
뷰어: ${VIEWER}?gh=<owner/repo>   |   ${VIEWER}?src=local`;

export async function main() {
  const { pos, o } = parseArgs(process.argv.slice(2));
  const cmd = pos[0];
  const file = resolve(o.file || "agent-hq.json");
  const here = dirname(fileURLToPath(import.meta.url));

  if (cmd === "init") {
    if (existsSync(file)) { console.log(`이미 있음: ${file}`); return; }
    save(file, emptyHQ(o.name));
    console.log(`생성: ${file}\n다음: node hq.mjs report <agent-id> --status active --task "작업 내용"`);
  } else if (cmd === "scan") {
    const d = load(file) || emptyHQ(o.name);
    const scanned = scan(o.root ? resolve(o.root) : homedir());
    mergeScan(d, scanned);
    save(file, d);
    console.log(`agent-hq.json: 스캔 ${scanned.length}개, 총 ${d.agents.length}개 에이전트 -> ${file}`);
    if (!scanned.length) console.log("(참고) ~/.claude/agents 또는 ~/.codex/prompts에서 찾은 정의가 없습니다. report로 직접 등록해도 됩니다.");
  } else if (cmd === "report") {
    if (!pos[1]) throw new Error("사용법: node hq.mjs report <id> --status active --task \"...\"");
    const d = load(file) || emptyHQ();
    const a = applyReport(d, { ...o, id: pos[1], status: o.status === true ? undefined : o.status });
    save(file, d);
    console.log(`${a.id}: ${a.status}${a.task ? " · " + a.task : ""}`);
  } else if (cmd === "serve") {
    if (!existsSync(file)) save(file, emptyHQ());
    const port = Number(o.port || 4173);
    const token = o.token === true ? "" : o.token || process.env.HQ_TOKEN || "";
    const allow = o["allow-origin"] && o["allow-origin"] !== true ? String(o["allow-origin"]).split(",") : [];
    serve({ port, file, token, allow, staticDir: here, logs: !o["no-logs"],
      root: o.root ? resolve(o.root) : homedir() }).on("listening", () => {
      console.log(`Agent HQ 로컬 서버: http://127.0.0.1:${port}   ← 이 주소를 브라우저로 여세요`);
      console.log(`  (Chrome은 호스팅 뷰어도 가능: ${VIEWER}?src=local${port !== 4173 ? `&port=${port}` : ""})`);
      console.log(`  상태 보고: POST http://127.0.0.1:${port}/api/report  {"id":"writer","status":"active","task":"..."}`);
      if (token) console.log("  (POST에 Authorization: Bearer <token> 필요)");
    });
  } else if (cmd === "push") {
    const repo = pos[1];
    if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("사용법: node hq.mjs push <owner/repo>");
    const opts = { repo, file, path: o.path || "agent-hq.json", branch: o.branch && o.branch !== true ? o.branch : undefined };
    const once = async () => {
      const r = await push(opts);
      console.log(`${new Date().toLocaleTimeString()} ${r.changed ? "게시 완료" : "변경 없음"} → ${repo}/${opts.path}`);
    };
    await once();
    const view = `${VIEWER}?gh=${repo}${opts.branch ? "@" + opts.branch : ""}${opts.path !== "agent-hq.json" ? ":" + opts.path : ""}`;
    console.log(`  뷰어: ${view}\n  (agent-hq.json의 task 텍스트는 공개됩니다. 로컬 경로(source)는 제거 후 게시)`);
    if (o.watch) {
      const sec = Math.max(30, Number(o.watch) || 60);
      console.log(`  ${sec}초마다 변경 시에만 게시합니다. 종료: Ctrl+C`);
      setInterval(() => once().catch((e) => console.error(String(e.message || e))), sec * 1000);
    }
  } else if (cmd === "validate") {
    const f = resolve(pos[1] || file);
    const d = load(f);
    const errs = d ? validate(d) : [`JSON을 읽을 수 없음: ${f}`];
    if (errs.length) { console.error("검증 실패:\n  " + errs.join("\n  ")); process.exitCode = 1; }
    else console.log(`OK: ${f} (${d.agents.length} agents)`);
  } else {
    console.log(HELP);
    if (cmd && cmd !== "help" && cmd !== "--help") process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
}
