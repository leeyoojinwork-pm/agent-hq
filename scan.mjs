#!/usr/bin/env node
/**
 * scan.mjs — Agent HQ M1 데이터 어댑터 (의존성 0, Node 18+)
 *
 * 로컬 Codex/Claude 에이전트 정의 파일을 스캔해 agents.json을 생성한다.
 *
 * 스캔 대상:
 *   Claude: <root>/.claude/agents/*.md, ./.claude/agents/*.md
 *   Codex : <root>/.codex/prompts/*.md, <root>/.codex/agents/*.md
 *
 * 사용:
 *   node scan.mjs                 # root = $HOME
 *   node scan.mjs --root /path    # 테스트용 root 지정
 *   node scan.mjs --out out.json  # 출력 경로 지정 (기본 ./agents.json)
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const ROOT = opt("root", homedir());
const OUT = opt("out", "agents.json");

const ACCENTS = ["amber", "green", "red", "blue", "pink", "purple", "yellow", "orange"];
const TEAM_ORDER = ["Control", "Review", "Design", "Research", "Content", "Engineering", "General"];
const TEAM_KEYWORDS = [
  ["Review",      /review|critic|qa|audit|검토|검수|비평|평가/i],
  ["Design",      /design|ui|ux|wireframe|copy|asset|디자인|문구|와이어/i],
  ["Research",    /research|persona|test|리서치|조사|테스트/i],
  ["Content",     /writ|content|locale|translat|콘텐츠|번역|원고|글/i],
  ["Engineering", /engineer|image|build|deploy|lint|검증|빌드|생성/i],
  ["Control",     /orchestr|master|manager|pm|plan|지휘|총괄|관리/i],
];

/** 아주 단순한 frontmatter 파서 (한 줄 key: value 만) */
function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fm = {};
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z_-]+)\s*:\s*(.+)$/);
      if (kv) fm[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  const body = m ? text.slice(m[0].length) : text;
  return { fm, body: body.trim() };
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9가-힣]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "agent";
}
function inferTeam(fm, text) {
  if (fm.team) return fm.team;
  for (const [team, re] of TEAM_KEYWORDS) if (re.test(text)) return team;
  return "General";
}
/** 파일 경로 기반 안정적 의사난수 (재실행해도 같은 값) */
function stableLoad(path) {
  let h = 0;
  for (const c of path) h = (h * 31 + c.charCodeAt(0)) | 0;
  return 25 + (Math.abs(h) % 70);
}

function mdFiles(dir) {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => join(dir, f))
      .filter((p) => statSync(p).isFile());
  } catch {
    return [];
  }
}

function collect() {
  const sources = [
    { origin: "Claude", dirs: [join(ROOT, ".claude", "agents"), join(process.cwd(), ".claude", "agents")] },
    { origin: "Codex",  dirs: [join(ROOT, ".codex", "prompts"), join(ROOT, ".codex", "agents")] },
  ];
  const agents = [];
  const seen = new Set();
  for (const { origin, dirs } of sources) {
    for (const dir of dirs) {
      for (const file of mdFiles(dir)) {
        const raw = readFileSync(file, "utf8");
        const { fm, body } = parseFrontmatter(raw);
        const name = fm.name || basename(file, ".md");
        const id = slug(origin + "-" + name);
        if (seen.has(id)) continue;
        seen.add(id);
        const desc = (fm.description || body.split(/\r?\n/).find((l) => l.trim()) || "").trim();
        agents.push({
          id,
          name,
          origin,
          role: desc.slice(0, 40) || "에이전트",
          team: inferTeam(fm, name + " " + desc),
          status: "idle",
          task: desc.slice(0, 90) || "대기 중",
          output: fm.output || basename(file),
          load: stableLoad(file),
          model: (fm.model || "sonnet").split("-")[0],
          accent: ACCENTS[agents.length % ACCENTS.length],
          source: file,
        });
      }
    }
  }
  return agents;
}

/** team 그룹핑 → 층당 최대 4명으로 floor/slot 배정, FLOORS 동적 생성 */
function assignFloors(agents) {
  const groups = new Map();
  for (const t of TEAM_ORDER) groups.set(t, []);
  for (const a of agents) {
    if (!groups.has(a.team)) groups.set(a.team, []);
    groups.get(a.team).push(a);
  }
  const floors = [];
  for (const [team, members] of groups) {
    if (!members.length) continue;
    for (let i = 0; i < members.length; i += 4) {
      const chunk = members.slice(i, i + 4);
      const fi = floors.length;
      floors.push({ id: `${fi + 1}F`, label: team.toUpperCase(), kr: team });
      chunk.forEach((a, s) => { a.floor = fi; a.slot = s; });
    }
  }
  // 층 번호는 위(높은 층)부터 보이도록 뒤집기
  const n = floors.length;
  floors.forEach((f, i) => (f.id = `${n - i}F`));
  return floors;
}

const agents = collect();
const floors = assignFloors(agents);
const result = {
  generatedAt: new Date().toISOString(),
  root: ROOT,
  count: agents.length,
  floors,
  agents,
};
writeFileSync(OUT, JSON.stringify(result, null, 2));
console.log(`agents.json: ${agents.length} agents, ${floors.length} floors -> ${OUT}`);
if (!agents.length) {
  console.log("(경고) 에이전트를 찾지 못했습니다. --root 경로에 .claude/agents 또는 .codex/prompts가 있는지 확인하세요.");
}
