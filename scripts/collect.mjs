#!/usr/bin/env node
// AIエージェント関連の情報を無料ソースから収集し data/raw/YYYY-MM-DD.json に保存する。
// 依存パッケージなし(Node 20+ の組み込み fetch のみ)。
// 使い方: node scripts/collect.mjs [--date YYYY-MM-DD]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UA = "AgAg-collector/1.0 (+https://github.com/Koh1002/AgAg)";
const FETCH_TIMEOUT_MS = 20_000;

// ---------- 共通ユーティリティ ----------

export function jstDateString(d = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(d);
}

async function fetchText(url, headers = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, ...headers },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function fetchJson(url, headers = {}) {
  return JSON.parse(await fetchText(url, { Accept: "application/json", ...headers }));
}

function unwrapCdata(s) {
  return String(s ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function decodeEntities(s) {
  return unwrapCdata(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, " ");
}

export function stripTags(s) {
  return decodeEntities(unwrapCdata(s).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function tagContent(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

function truncate(s, n = 400) {
  s = String(s ?? "");
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function hoursAgo(h) {
  return new Date(Date.now() - h * 3600_000);
}

// ---------- ソース別コレクター ----------

async function collectHackerNews(cfg) {
  const since = Math.floor(hoursAgo(cfg.lookbackHours ?? 36).getTime() / 1000);
  const items = [];
  for (const q of cfg.queries) {
    const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(q)}&tags=story&numericFilters=created_at_i>${since}&hitsPerPage=${cfg.hitsPerQuery ?? 20}`;
    const json = await fetchJson(url);
    for (const hit of json.hits ?? []) {
      items.push({
        source: "hackernews",
        title: hit.title,
        url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
        discussionUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
        score: hit.points ?? 0,
        comments: hit.num_comments ?? 0,
        publishedAt: hit.created_at,
        excerpt: truncate(stripTags(hit.story_text ?? "")),
        lang: "en",
      });
    }
  }
  return items;
}

async function collectReddit(cfg) {
  const items = [];
  for (const sub of cfg.subreddits) {
    const url = `https://www.reddit.com/r/${sub}/${cfg.listing ?? "top"}.json?t=${cfg.t ?? "day"}&limit=${cfg.limit ?? 15}&raw_json=1`;
    const json = await fetchJson(url);
    for (const child of json?.data?.children ?? []) {
      const p = child.data;
      if (!p || p.stickied) continue;
      items.push({
        source: `reddit/r/${sub}`,
        title: p.title,
        url: p.is_self ? `https://www.reddit.com${p.permalink}` : p.url,
        discussionUrl: `https://www.reddit.com${p.permalink}`,
        score: p.score ?? 0,
        comments: p.num_comments ?? 0,
        publishedAt: new Date((p.created_utc ?? 0) * 1000).toISOString(),
        excerpt: truncate(stripTags(p.selftext ?? "")),
        lang: "en",
      });
    }
  }
  return items;
}

async function collectArxiv(cfg) {
  const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(cfg.query)}&sortBy=submittedDate&sortOrder=descending&max_results=${cfg.maxResults ?? 25}`;
  const xml = await fetchText(url);
  const cutoff = hoursAgo(cfg.lookbackHours ?? 72);
  const items = [];
  for (const entry of xml.split(/<entry>/).slice(1)) {
    const published = tagContent(entry, "published");
    if (published && new Date(published) < cutoff) continue;
    const link = entry.match(/<id>\s*(\S+?)\s*<\/id>/)?.[1] ?? "";
    items.push({
      source: "arxiv",
      title: stripTags(tagContent(entry, "title")),
      url: link.replace("http://", "https://"),
      score: 0,
      publishedAt: published,
      excerpt: truncate(stripTags(tagContent(entry, "summary")), 600),
      lang: "en",
    });
  }
  return items;
}

async function collectGithub(cfg) {
  const sinceDate = hoursAgo((cfg.createdWithinDays ?? 14) * 24).toISOString().slice(0, 10);
  const headers = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const items = [];
  for (const q of cfg.queries) {
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(`${q} created:>${sinceDate}`)}&sort=stars&order=desc&per_page=${cfg.perQuery ?? 10}`;
    const json = await fetchJson(url, headers);
    for (const repo of json.items ?? []) {
      items.push({
        source: "github",
        title: `${repo.full_name}: ${truncate(repo.description ?? "", 120)}`,
        url: repo.html_url,
        score: repo.stargazers_count ?? 0,
        publishedAt: repo.created_at,
        excerpt: truncate(stripTags(repo.description ?? "")),
        lang: "en",
      });
    }
  }
  return items;
}

export function parseFeed(xml) {
  // RSS2 (<item>) と Atom (<entry>) の両方を最小限のパースで扱う
  const chunks = xml.includes("<item") ? xml.split(/<item(?:\s[^>]*)?>/).slice(1)
    : xml.split(/<entry(?:\s[^>]*)?>/).slice(1);
  return chunks.map((c) => {
    const linkAttr = c.match(/<link[^>]*?href=["']([^"']+)["'][^>]*\/?>/i)?.[1];
    return {
      title: stripTags(tagContent(c, "title")),
      url: linkAttr || stripTags(tagContent(c, "link")) || stripTags(tagContent(c, "guid")),
      publishedAt: tagContent(c, "pubDate") || tagContent(c, "published") || tagContent(c, "updated") || tagContent(c, "dc:date"),
      excerpt: truncate(stripTags(tagContent(c, "description") || tagContent(c, "summary") || tagContent(c, "content"))),
    };
  });
}

async function collectRss(feeds, { lookbackHours = 72, keywords = [] }) {
  const cutoff = hoursAgo(lookbackHours);
  const kw = keywords.map((k) => k.toLowerCase());
  const items = [];
  for (const feed of feeds) {
    const xml = await fetchText(feed.url, { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" });
    for (const e of parseFeed(xml)) {
      if (!e.title || !e.url) continue;
      const t = e.publishedAt ? new Date(e.publishedAt) : null;
      if (t && !Number.isNaN(t.getTime()) && t < cutoff) continue;
      // filter: false のフィード(トピック特化型)以外はキーワードで絞り込む
      if (feed.filter !== false) {
        const text = `${e.title} ${e.excerpt}`.toLowerCase();
        if (kw.length && !kw.some((k) => text.includes(k))) continue;
      }
      items.push({
        source: `rss:${feed.name}`,
        title: e.title,
        url: e.url,
        score: 0,
        publishedAt: t && !Number.isNaN(t.getTime()) ? t.toISOString() : null,
        excerpt: e.excerpt,
        lang: feed.lang ?? "en",
      });
    }
  }
  return items;
}

// ---------- メイン ----------

async function main() {
  const dateArgIdx = process.argv.indexOf("--date");
  const date = dateArgIdx > -1 ? process.argv[dateArgIdx + 1] : jstDateString();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(`invalid date: ${date}`);
    process.exit(1);
  }

  const sources = JSON.parse(readFileSync(join(ROOT, "agent", "sources.json"), "utf8"));
  const errors = [];
  const all = [];

  const runs = [
    ["hackernews", () => (sources.hackernews?.enabled ? collectHackerNews(sources.hackernews) : [])],
    ["reddit", () => (sources.reddit?.enabled ? collectReddit(sources.reddit) : [])],
    ["arxiv", () => (sources.arxiv?.enabled ? collectArxiv(sources.arxiv) : [])],
    ["github", () => (sources.github?.enabled ? collectGithub(sources.github) : [])],
    ["rss", () => collectRss(sources.rss ?? [], { lookbackHours: sources.rssLookbackHours, keywords: sources.keywords ?? [] })],
  ];

  for (const [name, run] of runs) {
    try {
      const items = await run();
      console.log(`[collect] ${name}: ${items.length} items`);
      all.push(...items);
    } catch (e) {
      console.warn(`[collect] ${name} FAILED: ${e.message}`);
      errors.push({ source: name, error: e.message });
    }
  }

  // URL 正規化 + 重複排除(スコアの高い方を残す)
  const byUrl = new Map();
  for (const item of all) {
    const key = String(item.url).replace(/[?#].*$/, "").replace(/\/$/, "");
    const prev = byUrl.get(key);
    if (!prev || (item.score ?? 0) > (prev.score ?? 0)) byUrl.set(key, item);
  }
  const items = [...byUrl.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const out = {
    date,
    collectedAt: new Date().toISOString(),
    itemCount: items.length,
    errors,
    items,
  };
  const outDir = join(ROOT, "data", "raw");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${date}.json`);
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  console.log(`[collect] wrote ${items.length} items (${errors.length} source errors) -> ${outPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
