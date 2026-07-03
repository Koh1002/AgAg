#!/usr/bin/env node
// data/digests/ と data/growth-log.json からリポジトリのルートに静的サイトと Atom フィードを生成する。
// (GitHub Pages のブランチ配信(main / ルート)でもルート URL で UI が表示されるようにするため。
//  .nojekyll を置くので README の Jekyll レンダリングは行われない)
// 依存パッケージなし。使い方: node scripts/build-site.mjs

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
};

// ---------- HTML パーツ ----------

function pageShell({ title, body, depth = 0 }) {
  const base = "../".repeat(depth);
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="${base}style.css">
<link rel="alternate" type="application/atom+xml" title="${esc(SITE_TITLE)}" href="${base}feed.xml">
</head>
<body>
<header class="site-header">
  <a class="brand" href="${base}index.html">🤖 AgAg</a>
  <nav>
    <a href="${base}index.html">今日</a>
    <a href="${base}archive.html">アーカイブ</a>
    <a href="${base}growth.html">成長ログ</a>
    <a href="${base}feed.xml" title="RSSフィードを購読">RSS</a>
  </nav>
</header>
<main>
${body}
</main>
<footer class="site-footer">
  <p>毎朝 7:30 (JST) に自動更新。AIエージェントの動向を調査し、自分自身も成長するエージェント <a href="https://github.com/Koh1002/AgAg">AgAg</a> が生成しています。</p>
</footer>
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

function buildIndex(digests) {
  const body = digests.length
    ? digestSection(digests[0], { heading: "h1" }) +
      (digests.length > 1
        ? `<section class="recent"><h2>過去のダイジェスト</h2><ul>${digests
            .slice(1, 8)
            .map((d) => `<li><a href="archive/${d.date}.html">${esc(d.date)} — ${esc(d.title)}</a></li>`)
            .join("")}</ul><p><a href="archive.html">すべて見る →</a></p></section>`
        : "")
    : `<section class="digest"><h1>まだダイジェストがありません</h1><p class="lead">最初の実行をお待ちください。</p></section>`;
  writeFileSync(join(DOCS, "index.html"), pageShell({ title: SITE_TITLE, body }));
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
  mkdirSync(DOCS, { recursive: true });
  writeFileSync(join(DOCS, ".nojekyll"), "");
  writeFileSync(join(DOCS, "style.css"), STYLE);
  buildIndex(digests);
  buildArchive(digests);
  buildGrowth(growthLog);
  build404();
  buildFeed(digests);
  console.log(`[build-site] ${digests.length} digests, ${growthLog.length} growth entries -> リポジトリルート`);
}

main();
