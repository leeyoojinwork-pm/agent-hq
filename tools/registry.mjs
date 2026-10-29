#!/usr/bin/env node
/**
 * tools/registry.mjs — 로비(registry) 검증·빌드 (GitHub Actions에서 실행, 의존성 0)
 *
 *   node tools/registry.mjs check [--author <github-login>] [--fetch] [files...]
 *   node tools/registry.mjs build          # registry/index.json 생성
 *
 * 등록 파일: registry/<github-login>.json
 *   { "handle": "<github-login>", "name": "MY HQ", "source": "gh:owner/repo[@branch][:path.json]" | "https://...json",
 *     "description": "한 줄 소개 (선택)" }
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { validate } from "../hq.mjs";

const DIR = "registry";
const GH_RE = /^gh:([\w.-]+)\/([\w.-]+)(?:@([\w./-]+?))?(?::([\w./-]+\.json))?$/;

export function sourceUrl(src) {
  const m = GH_RE.exec(src);
  if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3] || "HEAD"}/${m[4] || "agent-hq.json"}`;
  if (/^https:\/\/[^\s]+$/.test(src)) return src;
  return null;
}

export function checkEntry(file, e) {
  const errs = [];
  const handle = basename(file, ".json");
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(handle)) errs.push("파일명은 GitHub 로그인이어야 함: registry/<login>.json");
  if (!e || typeof e !== "object") return [...errs, "JSON 객체가 아님"];
  const allowed = ["handle", "name", "source", "description"];
  for (const k of Object.keys(e)) if (!allowed.includes(k)) errs.push(`알 수 없는 필드: ${k}`);
  if (e.handle !== handle) errs.push(`handle(${e.handle})이 파일명(${handle})과 다름`);
  if (typeof e.name !== "string" || !e.name.trim() || e.name.length > 60) errs.push("name: 1~60자");
  if (typeof e.source !== "string" || !sourceUrl(e.source)) errs.push("source: gh:owner/repo[@branch][:path.json] 또는 https:// URL");
  if (e.description !== undefined && (typeof e.description !== "string" || e.description.length > 140)) errs.push("description: 140자 이하");
  return errs;
}

function entries() {
  return readdirSync(DIR).filter((f) => f.endsWith(".json") && f !== "index.json").sort()
    .map((f) => { const p = join(DIR, f); let e = null; try { e = JSON.parse(readFileSync(p, "utf8")); } catch {} return { p, e }; });
}

async function check(args) {
  const ai = args.indexOf("--author");
  const author = ai >= 0 ? args[ai + 1] : null;
  const doFetch = args.includes("--fetch");
  const files = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--author");
  const targets = files.length ? files.map((p) => { let e = null; try { e = JSON.parse(readFileSync(p, "utf8")); } catch {} return { p, e }; }) : entries();
  let bad = 0;
  for (const { p, e } of targets) {
    if (!p.startsWith(DIR + "/") || !p.endsWith(".json") || basename(p) === "index.json") {
      console.error(`✗ ${p}: registry/<login>.json 파일만 PR로 추가/수정할 수 있습니다`); bad++; continue;
    }
    const errs = e ? checkEntry(p, e) : ["JSON 파싱 실패"];
    if (author && basename(p, ".json").toLowerCase() !== author.toLowerCase())
      errs.push(`PR 작성자(${author})는 registry/${author}.json만 수정할 수 있습니다`);
    if (!errs.length && doFetch) {
      try {
        const r = await fetch(sourceUrl(e.source), { signal: AbortSignal.timeout(10000) });
        if (!r.ok) errs.push(`source를 가져올 수 없음: HTTP ${r.status}`);
        else { const v = validate(await r.json()); if (v.length) errs.push("source 스키마 오류: " + v.slice(0, 5).join("; ")); }
      } catch (x) { errs.push(`source 가져오기 실패: ${x.message}`); }
    }
    if (errs.length) { bad++; console.error(`✗ ${p}\n    ` + errs.join("\n    ")); }
    else console.log(`✓ ${p}`);
  }
  if (bad) process.exit(1);
}

function build() {
  const list = entries().filter(({ p, e }) => e && !checkEntry(p, e).length).map(({ e }) => e);
  writeFileSync(join(DIR, "index.json"), JSON.stringify({ version: 1, count: list.length, entries: list }, null, 2) + "\n");
  console.log(`registry/index.json: ${list.length} entries`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "check") await check(rest);
else if (cmd === "build") build();
else { console.log("사용법: node tools/registry.mjs check|build"); process.exit(1); }
