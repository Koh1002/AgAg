#!/usr/bin/env node
// リポジトリのデータとスクリプトの健全性を検証する。エージェントの自己変更後のゲートとして使う。
// 使い方: node scripts/validate.mjs  (エラーがあれば exit 1)

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

function fail(msg) {
  errors.push(msg);
}

function readJson(relPath) {
  try {
    return JSON.parse(readFileSync(join(ROOT, relPath), "utf8"));
  } catch (e) {
    fail(`${relPath}: JSONとして読めない (${e.message})`);
    return null;
  }
}

// ---------- scripts/ の構文チェック ----------

for (const f of readdirSync(join(ROOT, "scripts")).filter((f) => f.endsWith(".mjs"))) {
  const r = spawnSync(process.execPath, ["--check", join(ROOT, "scripts", f)], { encoding: "utf8" });
  if (r.status !== 0) fail(`scripts/${f}: 構文エラー\n${r.stderr}`);
}

// ---------- collect.mjs のパーサ自己テスト ----------

try {
  const { parseFeed, stripTags } = await import(pathToFileURL(join(ROOT, "scripts", "collect.mjs")).href);
  const rss = parseFeed(
    `<rss><channel><item><title><![CDATA[T &amp; T]]></title><link>https://e.com/a</link><pubDate>Wed, 01 Jul 2026 10:00:00 GMT</pubDate><description><p>d</p></description></item></channel></rss>`
  );
  if (rss.length !== 1 || rss[0].title !== "T & T" || rss[0].url !== "https://e.com/a") {
    fail("collect.mjs: parseFeed が RSS2 を正しくパースできない");
  }
  const atom = parseFeed(
    `<feed><entry><title>A</title><link href="https://e.com/b"/><published>2026-07-01T00:00:00Z</published><summary>s</summary></entry></feed>`
  );
  if (atom.length !== 1 || atom[0].url !== "https://e.com/b") {
    fail("collect.mjs: parseFeed が Atom を正しくパースできない");
  }
  if (stripTags("<p>あ&nbsp;い</p>") !== "あ い") fail("collect.mjs: stripTags の挙動が壊れている");
} catch (e) {
  fail(`collect.mjs: import に失敗 (${e.message})`);
}

// ---------- agent/sources.json ----------

const sources = readJson("agent/sources.json");
if (sources) {
  if (!Array.isArray(sources.keywords) || sources.keywords.length === 0) fail("sources.json: keywords が空");
  if (!Array.isArray(sources.rss)) fail("sources.json: rss が配列でない");
  for (const [i, f] of (sources.rss ?? []).entries()) {
    if (!f.name || !/^https?:\/\//.test(f.url ?? "")) fail(`sources.json: rss[${i}] に name / 有効な url がない`);
  }
  for (const key of ["hackernews", "reddit", "arxiv", "github"]) {
    if (sources[key] && typeof sources[key].enabled !== "boolean") fail(`sources.json: ${key}.enabled (boolean) がない`);
  }
}

// ---------- data/digests/*.json ----------

const CATEGORIES = new Set(["新モデル・新製品", "フレームワーク・ツール", "研究", "事例・ノウハウ", "議論・意見"]);
const GROWTH_TYPES = new Set(["knowledge", "skill", "source", "prompt", "script", "agent"]);
const digestsDir = join(ROOT, "data", "digests");

if (existsSync(digestsDir)) {
  for (const f of readdirSync(digestsDir).filter((f) => f.endsWith(".json"))) {
    const rel = `data/digests/${f}`;
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(f)) {
      fail(`${rel}: ファイル名が YYYY-MM-DD.json でない`);
      continue;
    }
    const d = readJson(rel);
    if (!d) continue;
    if (d.date !== f.replace(".json", "")) fail(`${rel}: date とファイル名が不一致`);
    if (!d.title || typeof d.title !== "string") fail(`${rel}: title がない`);
    if (!d.summary || typeof d.summary !== "string") fail(`${rel}: summary がない`);
    if (!Array.isArray(d.items) || d.items.length === 0) fail(`${rel}: items が空`);
    for (const [i, it] of (d.items ?? []).entries()) {
      if (!it.title) fail(`${rel}: items[${i}].title がない`);
      if (!/^https?:\/\//.test(it.url ?? "")) fail(`${rel}: items[${i}].url が不正`);
      if (!CATEGORIES.has(it.category)) fail(`${rel}: items[${i}].category が不正 (${it.category})`);
      if (!it.ja_summary) fail(`${rel}: items[${i}].ja_summary がない`);
      if (!it.why_useful) fail(`${rel}: items[${i}].why_useful がない`);
      if (!(Number.isInteger(it.score) && it.score >= 1 && it.score <= 5)) fail(`${rel}: items[${i}].score が 1〜5 でない`);
    }
    for (const [i, x] of (d.x_highlights ?? []).entries()) {
      if (!x.title || !/^https?:\/\//.test(x.url ?? "") || !x.ja_summary) fail(`${rel}: x_highlights[${i}] が不完全`);
    }
    for (const [i, g] of (d.growth_actions ?? []).entries()) {
      if (!GROWTH_TYPES.has(g.type) || !g.description) fail(`${rel}: growth_actions[${i}] が不完全`);
    }
  }
}

// ---------- data/growth-log.json ----------

const growth = readJson("data/growth-log.json");
if (growth) {
  if (!Array.isArray(growth)) fail("growth-log.json: 配列でない");
  for (const [i, g] of (Array.isArray(growth) ? growth : []).entries()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(g.date ?? "")) fail(`growth-log.json[${i}]: date が不正`);
    if (!GROWTH_TYPES.has(g.type)) fail(`growth-log.json[${i}]: type が不正 (${g.type})`);
    if (!g.description) fail(`growth-log.json[${i}]: description がない`);
  }
}

// ---------- agent/agents/*.md(サブエージェント定義) ----------

const agentsDir = join(ROOT, "agent", "agents");
const knownAgents = new Set();
if (existsSync(agentsDir)) {
  try {
    const { parseFrontmatter } = await import(pathToFileURL(join(ROOT, "scripts", "graph.mjs")).href);
    for (const f of readdirSync(agentsDir).filter((f) => f.endsWith(".md") && f !== "README.md")) {
      const rel = `agent/agents/${f}`;
      const fm = parseFrontmatter(readFileSync(join(agentsDir, f), "utf8"));
      if (!fm) {
        fail(`${rel}: frontmatter がない`);
        continue;
      }
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fm.name ?? "")) fail(`${rel}: name が kebab-case でない (${fm.name})`);
      if (fm.name && fm.name !== f.replace(/\.md$/, "")) fail(`${rel}: name とファイル名が不一致`);
      if (!fm.title) fail(`${rel}: title がない`);
      if (!fm.description) fail(`${rel}: description がない`);
      for (const [i, inp] of (fm.inputs ?? []).entries()) {
        if (!inp.name || !inp.description) fail(`${rel}: inputs[${i}] に name/description がない`);
      }
      knownAgents.add(fm.name);
    }
  } catch (e) {
    fail(`agents 検証に失敗 (${e.message})`);
  }
}

// ---------- data/runs/*.json(オンデマンド実行結果) ----------

const runsDir = join(ROOT, "data", "runs");
if (existsSync(runsDir)) {
  for (const f of readdirSync(runsDir).filter((f) => f.endsWith(".json"))) {
    const rel = `data/runs/${f}`;
    if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+-\d+\.json$/.test(f)) fail(`${rel}: ファイル名が YYYY-MM-DD-<agent>-<issue>.json でない`);
    const r = readJson(rel);
    if (!r) continue;
    for (const key of ["date", "agent", "title", "summary_ja", "status"]) {
      if (!r[key]) fail(`${rel}: ${key} がない`);
    }
    if (!["success", "error"].includes(r.status)) fail(`${rel}: status が success/error でない (${r.status})`);
    if (r.agent && knownAgents.size) {
      const skillMatch = String(r.agent).match(/^skill:(.+)$/);
      const known = skillMatch
        ? existsSync(join(ROOT, "agent", "skills", `${skillMatch[1]}.md`))
        : knownAgents.has(r.agent);
      if (!known) console.warn(`[validate] warning: ${rel} の agent "${r.agent}" の定義が見つからない`);
    }
  }
}

// ---------- グラフ導出の整合性 ----------

try {
  const { buildGraphData } = await import(pathToFileURL(join(ROOT, "scripts", "graph.mjs")).href);
  const g = buildGraphData(ROOT);
  if (!g.nodes.some((n) => n.id === "agent")) fail("graph: agent ノードが存在しない");
  const ids = new Set(g.nodes.map((n) => n.id));
  for (const e of g.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) fail(`graph: 不正なエッジ ${e.source} -> ${e.target}`);
  }
} catch (e) {
  fail(`graph.mjs の実行に失敗 (${e.message})`);
}

// ---------- assets(グラフUI) ----------

if (!existsSync(join(ROOT, "assets", "d3.v7.min.js"))) fail("assets/d3.v7.min.js がない(グラフが描画できない)");
for (const f of ["graph.js"]) {
  const p = join(ROOT, "assets", f);
  if (!existsSync(p)) {
    fail(`assets/${f} がない`);
  } else {
    const r = spawnSync(process.execPath, ["--check", p], { encoding: "utf8" });
    if (r.status !== 0) fail(`assets/${f}: 構文エラー\n${r.stderr}`);
  }
}

// ---------- build-site.mjs が実行できるか(ドライラン) ----------

const build = spawnSync(process.execPath, [join(ROOT, "scripts", "build-site.mjs")], { encoding: "utf8" });
if (build.status !== 0) fail(`build-site.mjs の実行に失敗:\n${build.stderr}`);

// ---------- 結果 ----------

if (errors.length) {
  console.error(`[validate] NG: ${errors.length} 件のエラー`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("[validate] OK");
