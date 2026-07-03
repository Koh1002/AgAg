---
name: deep-dive
title: トピック深掘り調査
description: 指定されたトピックについて Web を深掘り調査し、一次情報に基づく日本語レポートを作成する。
created: 2026-07-03
inputs:
  - name: topic
    description: 調査するトピック(例「MCP Apps の実装状況」)
    required: true
  - name: depth
    description: 調査の深さ(quick / normal / deep)。省略時は normal
    required: false
output: data/runs/<日付>-deep-dive-<issue番号>.json にレポートを保存
---

# トピック深掘り調査の手順

**前提: `agent/AGENT.md` の「安全境界」をすべて遵守すること。**

1. 入力 `topic` を確認する。曖昧な場合は最も一般的な解釈で進め、解釈をレポート冒頭に明記する
2. WebSearch で一次情報(公式ブログ・論文・リポジトリ・発表)を 5〜10 件収集する。`depth` が deep なら 10〜15 件、quick なら 3〜5 件
3. 重要な情報は WebFetch で本文を確認して裏取りする(未確認の URL をレポートに書かない)
4. run スキーマ(AGENT.md 参照)の `sections` に次の構成で日本語レポートを書く:
   - **概要**: 3〜5文の全体像
   - **詳細**: 主要な発見を項目ごとに(出典URL付き)
   - **含意**: AgAg 自身の成長に使える点があれば具体的に(なければ「なし」と書く)
5. 参照した一次ソースを `links` に列挙する
6. 自分(AgAg)の知識ベースに残す価値がある発見は、`summary_ja` の末尾に「→ 知識ベース追記候補: …」として提案する(このエージェントは knowledge を直接編集しない。取り込みは日次エージェントの判断)
