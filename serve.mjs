#!/usr/bin/env node
// 하위 호환 래퍼 — 실제 구현은 hq.mjs (`node hq.mjs serve`)
import { main } from "./hq.mjs";
process.argv.splice(2, 0, "serve");
main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
