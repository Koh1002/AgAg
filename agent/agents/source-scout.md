---
name: source-scout
title: 新情報源スカウト
description: 現在の情報源の偏りを分析し、手薄な領域の新しい RSS/API 情報源を発見・検証して sources.json に追加する。
created: 2026-07-03
inputs:
  - name: focus
    description: 重点的に探す分野(例「日本語の実務事例」「マルチエージェント研究」)。省略時は自動判断
    required: false
output: agent/sources.json への追加 + data/runs/<日付>-source-scout-<issue番号>.json に評価レポート
---

# 新情報源スカウトの手順

**前提: `agent/AGENT.md` の「安全境界」をすべて遵守すること。**

1. `agent/sources.json` と直近 7 日分の `data/digests/*.json` の `items[].source` 分布を分析し、情報源の偏り(カテゴリ・言語・ソース種別)を把握する
2. 入力 `focus`(なければ分析結果から手薄な領域を自動選定)に合う RSS フィード・API を WebSearch で 3〜5 候補探す
3. 各候補のフィード URL を WebFetch で実際に取得し、(a) 生きている (b) AIエージェント関連の記事が実際に流れている (c) 更新頻度が週1以上、を確認する
4. 合格した 1〜2 件を `agent/sources.json` の `rss` に追加する(トピック特化フィードは `"filter": false`)。**追加後に `node scripts/validate.mjs` を実行して通ること**
5. run スキーマの `sections` に「現状分析 / 候補と評価 / 追加した情報源」を日本語で記録する
6. `data/growth-log.json` に `type: "source"` のエントリを追記する(何をなぜ追加したか)
