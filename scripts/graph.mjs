// AgAg の「脳」をグラフ(ノード+エッジ)として導出するモジュール。依存パッケージなし。
// build-site.mjs が graph.json の生成に、validate.mjs が整合性検証に使う。
//
// ノードID規約:
//   agent | subagent:<name> | skill:<name> | knowledge:<name> | source:<key> |
//   script:<file> | digest:<date> | growth:<date>:<idx> | run:<filebase> | archive:<YYYY-MM>
// エッジ kind:
//   owns(agent→能力) watches(agent→情報源) fed(情報源→digest, weightあり)
//   grew(digest→growth) changed(growth→変更対象) ran(subagent→run)

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

export const REPO_URL = "https://github.com/Koh1002/AgAg";
const RECENT_DAYS = 60; // これより古い digest/growth/run は月単位ノードに集約

// ---------- frontmatter パーサ(限定YAML: key: value と1段のオブジェクトリストのみ) ----------

export function parseFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm = {};
  let listKey = null;
  for (const raw of m[1].split("\n")) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const top = raw.match(/^([A-Za-z_][\w-]*):\s*(.*)$/); // インデントなしの key
    if (top) {
      const [, key, value] = top;
      if (value === "") {
        fm[key] = [];
        listKey = key;
      } else {
        fm[key] = coerce(value);
        listKey = null;
      }
      continue;
    }
    const itemStart = raw.match(/^\s+-\s+([\w-]+):\s*(.*)$/); // "  - name: topic"
    if (itemStart && listKey) {
      fm[listKey].push({ [itemStart[1]]: coerce(itemStart[2]) });
      continue;
    }
    const itemCont = raw.match(/^\s+([\w-]+):\s*(.*)$/); // "    description: ..."
    if (itemCont && listKey && fm[listKey].length) {
      fm[listKey][fm[listKey].length - 1][itemCont[1]] = coerce(itemCont[2]);
    }
  }
  return fm;
}

function coerce(v) {
  v = String(v).trim().replace(/^["']|["']$/g, "");
  if (v === "true") return true;
  if (v === "false") return false;
  return v;
}

// Markdown からタイトル(最初の # 見出し)と説明(最初の段落)を抜く
function mdSummary(md) {
  const body = md.replace(/^---\n[\s\S]*?\n---/, "");
  const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
  const para = body
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#") && !l.startsWith("|") && !l.startsWith("-") && !l.startsWith(">"));
  return { title, description: para ? truncate(para, 180) : "" };
}

function truncate(s, n) {
  s = String(s ?? "");
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// ---------- 実行ボタン用の Issue プリフィル URL ----------

export function runIssueUrl(fm) {
  const title = `▶ run: ${fm.name}`;
  const inputs = (fm.inputs ?? []).map(
    (i) => `${i.name}: ${i.required === true ? "" : "(任意)"}  # ${i.description ?? ""}`
  );
  const body = [`agent: ${fm.name}`, "", "## 入力", ...(inputs.length ? inputs : ["(入力なし)"])].join("\n");
  return `${REPO_URL}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=run`;
}

// ---------- グラフ導出 ----------

export function buildGraphData(ROOT) {
  const nodes = new Map(); // id -> node
  const edges = new Map(); // "src|dst|kind" -> edge
  const today = new Date();
  const cutoff = new Date(today.getTime() - RECENT_DAYS * 86400_000);

  const addNode = (n) => {
    if (!nodes.has(n.id)) nodes.set(n.id, n);
    return nodes.get(n.id);
  };
  const addEdge = (source, target, kind) => {
    if (!nodes.has(source) || !nodes.has(target)) return;
    const key = `${source}|${target}|${kind}`;
    const e = edges.get(key);
    if (e) e.weight = (e.weight ?? 1) + 1;
    else edges.set(key, { source, target, kind });
  };
  const readIf = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);
  const listDir = (p, ext) =>
    existsSync(p) ? readdirSync(p).filter((f) => f.endsWith(ext)).sort() : [];

  // growth-log を先に読み、ファイル→初出/最終更新日のマップを作る
  const growthLog = JSON.parse(readIf(join(ROOT, "data", "growth-log.json")) ?? "[]");
  const fileDates = new Map(); // repoPath -> {first, last}
  for (const g of growthLog) {
    for (const f of g.files ?? []) {
      const d = fileDates.get(f);
      if (!d) fileDates.set(f, { first: g.date, last: g.date });
      else {
        if (g.date < d.first) d.first = g.date;
        if (g.date > d.last) d.last = g.date;
      }
    }
  }
  const datesOf = (repoPath) => {
    const d = fileDates.get(repoPath);
    return { date: d?.first ?? null, updated: d?.last ?? null };
  };

  // --- 本体 ---
  addNode({
    id: "agent",
    type: "agent",
    label: "AgAg 本体",
    description: "自己成長するエージェントの中核。この指示書(AGENT.md)自体もエージェントが改善していく。",
    repoUrl: `${REPO_URL}/blob/main/agent/AGENT.md`,
    ...datesOf("agent/AGENT.md"),
  });

  // --- サブエージェント ---
  const agentFms = [];
  for (const f of listDir(join(ROOT, "agent", "agents"), ".md")) {
    if (f === "README.md") continue;
    const md = readFileSync(join(ROOT, "agent", "agents", f), "utf8");
    const fm = parseFrontmatter(md) ?? {};
    const name = fm.name ?? basename(f, ".md");
    agentFms.push(fm);
    const id = `subagent:${name}`;
    addNode({
      id,
      type: "subagent",
      label: fm.title ?? name,
      description: truncate(fm.description ?? "", 200),
      repoUrl: `${REPO_URL}/blob/main/agent/agents/${f}`,
      runnable: true,
      runUrl: runIssueUrl({ name, inputs: fm.inputs ?? [] }),
      date: fm.created ?? datesOf(`agent/agents/${f}`).date,
      updated: datesOf(`agent/agents/${f}`).updated ?? fm.created ?? null,
    });
    addEdge("agent", id, "owns");
  }

  // --- スキル / 知識 ---
  for (const [dir, type] of [["skills", "skill"], ["knowledge", "knowledge"]]) {
    for (const f of listDir(join(ROOT, "agent", dir), ".md")) {
      if (f === "README.md") continue;
      const md = readFileSync(join(ROOT, "agent", dir, f), "utf8");
      const { title, description } = mdSummary(md);
      const id = `${type}:${basename(f, ".md")}`;
      addNode({
        id,
        type,
        label: title ?? basename(f, ".md"),
        description,
        repoUrl: `${REPO_URL}/blob/main/agent/${dir}/${f}`,
        ...datesOf(`agent/${dir}/${f}`),
      });
      addEdge("agent", id, "owns");
    }
  }

  // --- スクリプト ---
  for (const f of listDir(join(ROOT, "scripts"), ".mjs")) {
    const id = `script:${f}`;
    addNode({
      id,
      type: "script",
      label: f,
      description: { "collect.mjs": "情報収集スクリプト", "build-site.mjs": "サイト生成スクリプト", "validate.mjs": "検証ゲート", "graph.mjs": "このグラフの導出ロジック" }[f] ?? "スクリプト",
      repoUrl: `${REPO_URL}/blob/main/scripts/${f}`,
      ...datesOf(`scripts/${f}`),
    });
    addEdge("agent", id, "owns");
  }

  // --- 情報源 ---
  const sources = JSON.parse(readIf(join(ROOT, "agent", "sources.json")) ?? "{}");
  const SOURCE_LABEL = { hackernews: "Hacker News", reddit: "Reddit", arxiv: "arXiv", github: "GitHub" };
  for (const key of ["hackernews", "reddit", "arxiv", "github"]) {
    if (sources[key]?.enabled) {
      addNode({
        id: `source:${key}`, type: "source", label: SOURCE_LABEL[key],
        description: "監視中の情報源", repoUrl: `${REPO_URL}/blob/main/agent/sources.json`,
        ...datesOf("agent/sources.json"),
      });
      addEdge("agent", `source:${key}`, "watches");
    }
  }
  for (const feed of sources.rss ?? []) {
    addNode({
      id: `source:rss:${feed.name}`, type: "source", label: feed.name,
      description: `RSS: ${feed.url}`, url: feed.url,
      ...datesOf("agent/sources.json"),
    });
    addEdge("agent", `source:rss:${feed.name}`, "watches");
  }
  addNode({
    id: "source:websearch", type: "source", label: "Web検索 / X",
    description: "WebSearch による X(x.com)や Web の話題の補完調査",
  });
  addEdge("agent", "source:websearch", "watches");

  // --- 月集約ノードのヘルパー ---
  const monthNode = (date) => {
    const ym = date.slice(0, 7);
    return addNode({
      id: `archive:${ym}`, type: "archive", label: `${ym} のアーカイブ`,
      description: "60日より前の活動(月単位に集約)", url: "archive.html", date: `${ym}-01`,
    }).id;
  };
  const isOld = (date) => new Date(date) < cutoff;

  // --- ダイジェスト ---
  const digestsDir = join(ROOT, "data", "digests");
  const digestNodeId = new Map(); // date -> node id(集約後)
  for (const f of listDir(digestsDir, ".json")) {
    const d = JSON.parse(readFileSync(join(digestsDir, f), "utf8"));
    let id;
    if (isOld(d.date)) {
      id = monthNode(d.date);
    } else {
      id = `digest:${d.date}`;
      addNode({
        id, type: "digest", label: d.date,
        description: truncate(`${d.title} — ${d.summary}`, 220),
        url: `archive/${d.date}.html`, date: d.date, updated: d.date,
        items: (d.items ?? []).slice(0, 10).map((i) => ({ title: i.title, url: i.url })),
      });
    }
    digestNodeId.set(d.date, id);
    addEdge("agent", id, "owns");
    // 情報源 → ダイジェスト
    for (const item of d.items ?? []) {
      const sid = mapSourceId(item.source, nodes);
      if (sid) addEdge(sid, id, "fed");
    }
  }

  // --- 成長イベント ---
  growthLog.forEach((g, idx) => {
    let id;
    if (isOld(g.date)) {
      id = monthNode(g.date);
    } else {
      id = `growth:${g.date}:${idx}`;
      addNode({
        id, type: "growth", label: `成長 ${g.date}`,
        description: truncate(g.description, 220), growthType: g.type,
        url: "growth.html", date: g.date, updated: g.date,
      });
    }
    const dig = digestNodeId.get(g.date);
    if (dig) addEdge(dig, id, "grew");
    else addEdge("agent", id, "owns");
    for (const f of g.files ?? []) {
      const target = mapFileId(f);
      if (target) addEdge(id, target, "changed");
    }
  });

  // --- オンデマンド実行結果 ---
  for (const f of listDir(join(ROOT, "data", "runs"), ".json")) {
    const r = JSON.parse(readFileSync(join(ROOT, "data", "runs", f), "utf8"));
    let id;
    if (isOld(r.date)) {
      id = monthNode(r.date);
    } else {
      id = `run:${basename(f, ".json")}`;
      addNode({
        id, type: "run", label: truncate(r.title ?? `run ${r.date}`, 40),
        description: truncate(r.summary_ja ?? "", 220),
        url: "runs.html", date: r.date, updated: r.date, status: r.status,
      });
    }
    addEdge(`subagent:${r.agent}`, id, "ran");
  }

  const nodeArr = [...nodes.values()];
  const edgeArr = [...edges.values()].filter((e) => nodes.has(e.source) && nodes.has(e.target));
  return {
    meta: {
      generatedAt: new Date().toISOString(),
      counts: { nodes: nodeArr.length, edges: edgeArr.length },
    },
    nodes: nodeArr,
    edges: edgeArr,
  };
}

// digest items[].source 文字列 → 情報源ノードID(未知の情報源はノードを作らず null)
function mapSourceId(source, nodes) {
  const s = String(source ?? "");
  let id = null;
  if (s === "hackernews") id = "source:hackernews";
  else if (s.startsWith("reddit")) id = "source:reddit";
  else if (s === "arxiv") id = "source:arxiv";
  else if (s === "github") id = "source:github";
  else if (s.startsWith("rss:")) id = `source:${s}`;
  else if (s === "web" || s === "x") id = "source:websearch";
  return id && nodes.has(id) ? id : null;
}

// growth-log の files[] のパス → ノードID
function mapFileId(path) {
  if (path === "agent/AGENT.md") return "agent";
  let m;
  if ((m = path.match(/^agent\/agents\/(.+)\.md$/))) return `subagent:${m[1]}`;
  if ((m = path.match(/^agent\/skills\/(.+)\.md$/))) return `skill:${m[1]}`;
  if ((m = path.match(/^agent\/knowledge\/(.+)\.md$/))) return m[1] === "README" ? null : `knowledge:${m[1]}`;
  if ((m = path.match(/^scripts\/(.+\.mjs)$/))) return `script:${m[1]}`;
  return null;
}
