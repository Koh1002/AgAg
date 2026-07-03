#!/usr/bin/env node
// data/digests/ と data/growth-log.json からリポジトリのルートに静的サイトと Atom フィードを生成する。
// (GitHub Pages のブランチ配信(main / ルート)でもルート URL で UI が表示されるようにするため。
//  .nojekyll を置くので README の Jekyll レンダリングは行われない)
// 依存パッケージなし。使い方: node scripts/build-site.mjs

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraphData, parseFrontmatter, mdSummary, runIssueUrl, REPO_URL } from "./graph.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE_URL = process.env.SITE_URL || "https://koh1002.github.io/AgAg";
const SITE_TITLE = "AgAg — AIエージェント・デイリーウォッチ";
const DOCS = ROOT; // サイト生成先(リポジトリルート)

// ---------- ユーティリティ ----------

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function loadDigests() {
  const dir = join(ROOT, "data", "digests");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .reverse()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
}

function loadGrowthLog() {
  const p = join(ROOT, "data", "growth-log.json");
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, "utf8"));
}

function loadRuns() {
  const dir = join(ROOT, "data", "runs");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse()
    .map((f) => ({ file: f, ...JSON.parse(readFileSync(join(dir, f), "utf8")) }));
}

function loadAgents() {
  const dir = join(ROOT, "agent", "agents");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .sort()
    .map((f) => {
      const fm = parseFrontmatter(readFileSync(join(dir, f), "utf8")) ?? {};
      return { file: f, name: fm.name ?? basename(f, ".md"), ...fm };
    });
}

function loadSkills() {
  const dir = join(ROOT, "agent", "skills");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .sort()
    .map((f) => {
      const { title, description } = mdSummary(readFileSync(join(dir, f), "utf8"));
      return { file: f, name: basename(f, ".md"), title, description };
    });
}

const CATEGORY_CLASS = {
  "新モデル・新製品": "cat-product",
  "フレームワーク・ツール": "cat-tool",
  "研究": "cat-research",
  "事例・ノウハウ": "cat-howto",
  "議論・意見": "cat-opinion",
};

const GROWTH_TYPE_LABEL = {
  knowledge: "知識",
  skill: "スキル",
  source: "情報源",
  prompt: "指示書",
  script: "コード",
  agent: "エージェント",
};

// ---------- HTML パーツ ----------

function pageShell({ title, body, depth = 0, bodyClass = "", extraHead = "", fullBleed = false }) {
  const base = "../".repeat(depth);
  const main = fullBleed ? body : `<main>\n${body}\n</main>`;
  const footer = fullBleed
    ? ""
    : `<footer class="site-footer">
  <p>毎朝 7:30 (JST) に自動更新。AIエージェントの動向を調査し、自分自身も成長するエージェント <a href="${REPO_URL}">AgAg</a> が生成しています。</p>
</footer>`;
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="${base}style.css">
<link rel="alternate" type="application/atom+xml" title="${esc(SITE_TITLE)}" href="${base}feed.xml">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🤖</text></svg>">
${extraHead}
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ""}>
<header class="site-header">
  <a class="brand" href="${base}index.html">🤖 AgAg</a>
  <nav>
    <a href="${base}index.html">グラフ</a>
    <a href="${base}digest.html">今日</a>
    <a href="${base}archive.html">アーカイブ</a>
    <a href="${base}growth.html">成長ログ</a>
    <a href="${base}runs.html">実行</a>
    <a href="${base}feed.xml" title="RSSフィードを購読">RSS</a>
  </nav>
</header>
${main}
${footer}
</body>
</html>
`;
}

function itemCard(item) {
  const catClass = CATEGORY_CLASS[item.category] ?? "cat-other";
  const stars = "★".repeat(item.score ?? 0) + "☆".repeat(Math.max(0, 5 - (item.score ?? 0)));
  return `<article class="card">
  <div class="card-meta">
    <span class="badge ${catClass}">${esc(item.category)}</span>
    <span class="score" title="重要度 ${esc(item.score)}/5">${stars}</span>
    <span class="source">${esc(item.source)}</span>
  </div>
  <h3><a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.title)}</a></h3>
  <p>${esc(item.ja_summary)}</p>
  <p class="why">💡 ${esc(item.why_useful)}</p>
</article>`;
}

function digestSection(digest, { heading = "h2" } = {}) {
  const h = heading;
  const items = (digest.items ?? []).map(itemCard).join("\n");
  const xh = (digest.x_highlights ?? []).length
    ? `<section class="x-highlights">
  <h3>𝕏 での話題</h3>
  <ul>
${digest.x_highlights.map((x) => `    <li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a> — ${esc(x.ja_summary)}</li>`).join("\n")}
  </ul>
</section>`
    : "";
  const ga = (digest.growth_actions ?? []).length
    ? `<section class="growth-note">
  <h3>🌱 今日の成長</h3>
  <ul>
${digest.growth_actions.map((g) => `    <li><span class="badge badge-growth">${esc(GROWTH_TYPE_LABEL[g.type] ?? g.type)}</span> ${esc(g.description)}</li>`).join("\n")}
  </ul>
</section>`
    : "";
  return `<section class="digest">
  <${h}>${esc(digest.date)} — ${esc(digest.title)}</${h}>
  <p class="lead">${esc(digest.summary)}</p>
  <div class="cards">
${items}
  </div>
${xh}
${ga}
</section>`;
}

// ---------- ページ生成 ----------

// トップページ = エージェントの「脳」を表示する全画面グラフ(Obsidian のグラフビュー風)
function buildGraphPage() {
  const body = `<div id="graph-root">
  <svg id="graph" aria-label="AgAg のエージェント・スキル・知識のネットワーク図"></svg>
  <div id="graph-legend"></div>
  <div id="graph-hint">ノードをクリックで詳細 · ドラッグで移動 · スクロール/ピンチでズーム</div>
  <aside id="side-panel" hidden></aside>
</div>
<script src="assets/d3.v7.min.js"></script>
<script src="assets/graph.js"></script>`;
  writeFileSync(
    join(DOCS, "index.html"),
    pageShell({
      title: SITE_TITLE,
      body,
      bodyClass: "graph-page",
      extraHead: `<link rel="stylesheet" href="assets/graph.css">`,
      fullBleed: true,
    })
  );
}

function buildDigest(digests) {
  const body = digests.length
    ? digestSection(digests[0], { heading: "h1" }) +
      (digests.length > 1
        ? `<section class="recent"><h2>過去のダイジェスト</h2><ul>${digests
            .slice(1, 8)
            .map((d) => `<li><a href="archive/${d.date}.html">${esc(d.date)} — ${esc(d.title)}</a></li>`)
            .join("")}</ul><p><a href="archive.html">すべて見る →</a></p></section>`
        : "")
    : `<section class="digest"><h1>まだダイジェストがありません</h1><p class="lead">最初の実行をお待ちください。</p></section>`;
  writeFileSync(join(DOCS, "digest.html"), pageShell({ title: `今日のダイジェスト | ${SITE_TITLE}`, body }));
}

// 実行ページ: サブエージェント/スキル一覧(▶実行) + オンデマンド実行履歴 + 日次実行サマリー
function buildRuns(runs, digests, agents, skills) {
  const skillCards = skills
    .map((s) => {
      const url = runIssueUrl({
        name: `skill:${s.name}`,
        inputs: [{ name: "input", description: "このスキルを何に適用するか(自由記述)", required: false }],
      });
      return `<article class="card">
  <div class="card-meta"><span class="badge">スキル</span></div>
  <h3>${esc(s.title ?? s.name)} <code class="agent-name">skill:${esc(s.name)}</code></h3>
  <p>${esc(s.description ?? "")}</p>
  <p><a class="run-btn" href="${esc(url)}" target="_blank" rel="noopener">▶ 実行(Issue を作成)</a></p>
</article>`;
    })
    .join("\n");
  const agentCards = agents
    .map(
      (a) => `<article class="card">
  <div class="card-meta"><span class="badge badge-subagent">サブエージェント</span></div>
  <h3>${esc(a.title ?? a.name)} <code class="agent-name">${esc(a.name)}</code></h3>
  <p>${esc(a.description ?? "")}</p>
  ${(a.inputs ?? []).length ? `<p class="muted">入力: ${a.inputs.map((i) => `<code>${esc(i.name)}</code>${i.required === true ? "(必須)" : ""}`).join(" ")}</p>` : ""}
  <p><a class="run-btn" href="${esc(runIssueUrl(a))}" target="_blank" rel="noopener">▶ 実行(Issue を作成)</a></p>
</article>`
    )
    .join("\n");

  const runRows = runs.length
    ? runs
        .map(
          (r) => `<article class="card">
  <div class="card-meta">
    <span class="badge ${r.status === "success" ? "badge-growth" : "badge-error"}">${esc(r.status ?? "?")}</span>
    <span class="muted">${esc(r.date)} · ${esc(r.agent)}</span>
  </div>
  <h3>${esc(r.title ?? "")}</h3>
  <p>${esc(r.summary_ja ?? "")}</p>
  ${(r.sections ?? [])
    .map((s) => `<details><summary>${esc(s.heading)}</summary><p class="run-body">${esc(s.body_md ?? "").replace(/\n/g, "<br>")}</p></details>`)
    .join("\n")}
  ${(r.links ?? []).length ? `<p class="muted">リンク: ${r.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title)}</a>`).join(" · ")}</p>` : ""}
  <p class="muted"><a href="${esc(r.issue_url ?? "#")}" target="_blank" rel="noopener">Issue #${esc(r.issue)}</a>${r.run_url ? ` · <a href="${esc(r.run_url)}" target="_blank" rel="noopener">実行ログ</a>` : ""}</p>
</article>`
        )
        .join("\n")
    : `<p class="muted">まだオンデマンド実行はありません。上の ▶ 実行ボタンから試せます。</p>`;

  const dailyRows = digests
    .map(
      (d) => `  <li><a href="archive/${d.date}.html">${esc(d.date)}</a> — ${esc(d.title)} <span class="muted">(記事${(d.items ?? []).length}件 / 成長${(d.growth_actions ?? []).length}件)</span></li>`
    )
    .join("\n");

  const body = `<h1>実行</h1>
<p class="lead">サブエージェントをページから実行できます(GitHub の Issue 作成画面が開き、発行すると GitHub Actions 上で実行されます。オーナーの Issue のみ実行されます)。</p>
<div id="live-status"></div>
<h2>サブエージェント</h2>
<div class="cards">
${agentCards || `<p class="muted">まだサブエージェントがいません。</p>`}
</div>
<h2>スキル</h2>
<div class="cards">
${skillCards || `<p class="muted">まだスキルがありません。</p>`}
</div>
<h2>オンデマンド実行履歴</h2>
<div class="cards">
${runRows}
</div>
<h2>日次実行(毎朝 7:30 JST)</h2>
<ul class="archive-list">
${dailyRows}
</ul>
<p class="muted"><a href="${REPO_URL}/actions" target="_blank" rel="noopener">GitHub Actions で全実行ログを見る →</a></p>
<script>
// 直近のワークフロー実行状態をライブ表示(未認証の公開API。失敗時は黙って非表示)
fetch("https://api.github.com/repos/Koh1002/AgAg/actions/runs?per_page=5")
  .then((r) => (r.ok ? r.json() : Promise.reject()))
  .then((d) => {
    const runs = (d.workflow_runs || []).map((r) => {
      const icon = r.status !== "completed" ? "⏳" : r.conclusion === "success" ? "✅" : "❌";
      return \`<a href="\${r.html_url}" target="_blank" rel="noopener">\${icon} \${r.name}</a>\`;
    });
    if (runs.length) {
      document.getElementById("live-status").innerHTML =
        '<p class="muted">直近の実行: ' + runs.join(" · ") + "</p>";
    }
  })
  .catch(() => {});
</script>`;
  writeFileSync(join(DOCS, "runs.html"), pageShell({ title: `実行 | ${SITE_TITLE}`, body }));
}

function buildGraph() {
  const graph = buildGraphData(ROOT);
  writeFileSync(join(DOCS, "graph.json"), JSON.stringify(graph, null, 1) + "\n");
  return graph;
}

function buildArchive(digests) {
  const body = `<h1>アーカイブ</h1>
<ul class="archive-list">
${digests.map((d) => `  <li><a href="archive/${d.date}.html">${esc(d.date)}</a> — ${esc(d.title)} <span class="muted">(${(d.items ?? []).length}件)</span></li>`).join("\n")}
</ul>`;
  writeFileSync(join(DOCS, "archive.html"), pageShell({ title: `アーカイブ | ${SITE_TITLE}`, body }));
  mkdirSync(join(DOCS, "archive"), { recursive: true });
  for (const d of digests) {
    writeFileSync(
      join(DOCS, "archive", `${d.date}.html`),
      pageShell({ title: `${d.date} ${d.title} | ${SITE_TITLE}`, body: digestSection(d, { heading: "h1" }), depth: 1 })
    );
  }
}

function buildGrowth(growthLog) {
  const entries = [...growthLog].reverse();
  const body = `<h1>成長ログ</h1>
<p class="lead">AgAg が自分自身に取り込んだ変更の履歴。新しい順。</p>
<ol class="timeline">
${entries
  .map(
    (g) => `  <li>
    <div class="timeline-date">${esc(g.date)}</div>
    <div class="timeline-body">
      <span class="badge badge-growth">${esc(GROWTH_TYPE_LABEL[g.type] ?? g.type)}</span>
      ${esc(g.description)}
      ${(g.files ?? []).length ? `<div class="files">${g.files.map((f) => `<code>${esc(f)}</code>`).join(" ")}</div>` : ""}
    </div>
  </li>`
  )
  .join("\n")}
</ol>`;
  writeFileSync(join(DOCS, "growth.html"), pageShell({ title: `成長ログ | ${SITE_TITLE}`, body }));
}

function build404() {
  const body = `<section class="digest">
  <h1>ページが見つかりません</h1>
  <p class="lead">お探しのページは存在しないか、移動しました。</p>
  <p><a href="/AgAg/index.html">トップページへ戻る →</a></p>
</section>`;
  writeFileSync(join(DOCS, "404.html"), pageShell({ title: `404 | ${SITE_TITLE}`, body }));
}

function buildFeed(digests) {
  const updated = digests[0]?.date ? `${digests[0].date}T00:00:00+09:00` : "1970-01-01T00:00:00Z";
  const entries = digests
    .slice(0, 30)
    .map((d) => {
      const itemsHtml = (d.items ?? [])
        .map((i) => `<li><a href="${esc(i.url)}">${esc(i.title)}</a> [${esc(i.category)}]<br>${esc(i.ja_summary)}</li>`)
        .join("");
      const content = `<p>${esc(d.summary)}</p><ul>${itemsHtml}</ul><p><a href="${SITE_URL}/archive/${d.date}.html">サイトで読む</a></p>`;
      return `  <entry>
    <title>${esc(d.date)} — ${esc(d.title)}</title>
    <link href="${SITE_URL}/archive/${d.date}.html"/>
    <id>${SITE_URL}/archive/${d.date}.html</id>
    <updated>${d.date}T00:00:00+09:00</updated>
    <content type="html">${esc(content)}</content>
  </entry>`;
    })
    .join("\n");
  const feed = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${esc(SITE_TITLE)}</title>
  <link href="${SITE_URL}/"/>
  <link rel="self" href="${SITE_URL}/feed.xml"/>
  <id>${SITE_URL}/</id>
  <updated>${updated}</updated>
  <author><name>AgAg</name></author>
${entries}
</feed>
`;
  writeFileSync(join(DOCS, "feed.xml"), feed);
}

const STYLE = `:root {
  --bg: #f7f7f5; --fg: #1c1c1a; --muted: #6b6b66; --card: #ffffff;
  --border: #e4e4df; --accent: #3b6ecc; --accent-soft: #e8eefb;
  --growth: #2e7d4f; --growth-soft: #e5f3ea;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #16161a; --fg: #ececea; --muted: #9d9d97; --card: #1f1f25;
    --border: #33333b; --accent: #7aa2e8; --accent-soft: #263349;
    --growth: #6fbf8f; --growth-soft: #223528;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font-family: "Hiragino Sans", "Noto Sans JP", system-ui, -apple-system, sans-serif;
  line-height: 1.7;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
main { max-width: 780px; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
.site-header {
  display: flex; justify-content: space-between; align-items: center;
  max-width: 780px; margin: 0 auto; padding: 1rem;
}
.brand { font-weight: 700; font-size: 1.2rem; color: var(--fg); }
.site-header nav a { margin-left: 1rem; color: var(--muted); font-size: .95rem; }
.site-header nav a:hover { color: var(--accent); }
h1 { font-size: 1.5rem; line-height: 1.4; }
h2 { font-size: 1.25rem; margin-top: 2.5rem; }
.lead { color: var(--muted); }
.cards { display: flex; flex-direction: column; gap: 1rem; margin-top: 1.25rem; }
.card {
  background: var(--card); border: 1px solid var(--border);
  border-radius: 12px; padding: 1rem 1.25rem;
}
.card h3 { margin: .4rem 0; font-size: 1.05rem; line-height: 1.5; }
.card p { margin: .4rem 0; font-size: .95rem; }
.card-meta { display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; font-size: .8rem; }
.badge {
  display: inline-block; padding: .1rem .55rem; border-radius: 999px;
  background: var(--accent-soft); color: var(--accent); font-size: .75rem; font-weight: 600;
}
.badge-growth { background: var(--growth-soft); color: var(--growth); }
.badge-subagent { background: #efe6fb; color: #7a3fbf; }
.badge-error { background: #fbe6e6; color: #bf3f3f; }
@media (prefers-color-scheme: dark) {
  .badge-subagent { background: #322544; color: #c5a2ee; }
  .badge-error { background: #442525; color: #ee9d9d; }
}
.run-btn {
  display: inline-block; padding: .35rem .9rem; border-radius: 8px;
  background: var(--accent); color: #fff !important; font-weight: 600; font-size: .9rem;
}
.run-btn:hover { text-decoration: none; opacity: .9; }
.agent-name { font-size: .75rem; background: var(--accent-soft); color: var(--accent); padding: .1rem .4rem; border-radius: 6px; }
.run-body { white-space: normal; }
.score { color: #d9a406; letter-spacing: .1em; }
.source { color: var(--muted); }
.why { color: var(--muted); font-size: .9rem; }
.x-highlights, .growth-note {
  margin-top: 2rem; padding: 1rem 1.25rem; border-radius: 12px;
  background: var(--card); border: 1px solid var(--border);
}
.x-highlights h3, .growth-note h3 { margin-top: 0; font-size: 1rem; }
.x-highlights ul, .growth-note ul { margin: .5rem 0 0; padding-left: 1.2rem; }
.x-highlights li, .growth-note li { margin: .4rem 0; font-size: .95rem; }
.recent ul, .archive-list { padding-left: 1.2rem; }
.recent li, .archive-list li { margin: .35rem 0; }
.muted { color: var(--muted); }
.timeline { list-style: none; padding: 0; margin: 1.5rem 0; }
.timeline li {
  display: flex; gap: 1rem; padding: .8rem 0;
  border-bottom: 1px solid var(--border);
}
.timeline-date { flex: 0 0 7em; color: var(--muted); font-variant-numeric: tabular-nums; }
.timeline-body { flex: 1; }
.files { margin-top: .3rem; }
.files code {
  font-size: .78rem; background: var(--accent-soft); color: var(--accent);
  padding: .05rem .4rem; border-radius: 6px;
}
.site-footer {
  max-width: 780px; margin: 0 auto; padding: 1rem;
  color: var(--muted); font-size: .85rem; border-top: 1px solid var(--border);
}
`;

// ---------- メイン ----------

function main() {
  const digests = loadDigests();
  const growthLog = loadGrowthLog();
  const runs = loadRuns();
  const agents = loadAgents();
  const skills = loadSkills();
  mkdirSync(DOCS, { recursive: true });
  writeFileSync(join(DOCS, ".nojekyll"), "");
  writeFileSync(join(DOCS, "style.css"), STYLE);
  const graph = buildGraph();
  buildGraphPage();
  buildDigest(digests);
  buildArchive(digests);
  buildGrowth(growthLog);
  buildRuns(runs, digests, agents, skills);
  build404();
  buildFeed(digests);
  console.log(
    `[build-site] ${digests.length} digests, ${growthLog.length} growth entries, ${agents.length} subagents, ${runs.length} runs, graph ${graph.meta.counts.nodes}n/${graph.meta.counts.edges}e -> リポジトリルート`
  );
}

main();
