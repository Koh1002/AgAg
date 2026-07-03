# AgAg 🤖 — 自己成長型 AIエージェント・デイリーウォッチ

AIエージェント分野の動向を **1日1回自動調査** し、日本語ダイジェストを **GitHub Pages** に公開、有用な学びを **自分自身のコード・知識・スキルに取り込んで成長し続ける** エージェントです。

- 🕸 サイト: `https://koh1002.github.io/AgAg/` — トップは **Obsidian 風のグラフビュー**。本体・サブエージェント・スキル・知識・情報源・日次活動がネットワークとして表示され、成長するたびにノードが増えていく(最近7日の成長は脈動ハイライト)
- ▶ 実行: グラフのノードや「実行」ページからサブエージェントをオンデマンド実行できる(Issue 発行 → GitHub Actions で実行 → 結果がサイトと Issue コメントに反映)
- 📡 通知: RSS/Atom フィード `https://koh1002.github.io/AgAg/feed.xml` を RSS リーダーで購読
- 🌱 成長ログ: エージェントが自分に取り込んだ変更のタイムラインをサイトで公開

## 仕組み

```
毎日 07:30 JST (GitHub Actions cron)
  1. scripts/collect.mjs   … HN / Reddit / arXiv / GitHub / RSS から生データ収集(無料ソースのみ)
  2. claude-code-action    … エージェント(Claude)が agent/AGENT.md の手順に従い
                             ・キュレーション+日本語要約 → data/digests/YYYY-MM-DD.json
                             ・WebSearch で X(x.com)の話題を補完
                             ・学びを自分に取り込む(知識・スキル・情報源・指示書・コード)
  3. scripts/validate.mjs  … スキーマ検証。エージェントの自己変更が壊れていたら巻き戻す
  4. scripts/build-site.mjs … リポジトリルートに静的サイト + feed.xml を生成
  5. bot が main にコミット → GitHub Pages が自動更新
```

エージェントの「脳」はすべてリポジトリ内にあります:

| パス | 役割 |
|---|---|
| `agent/AGENT.md` | エージェント自身の指示書(エージェントが自分で改善する) |
| `agent/agents/` | サブエージェント定義(▶実行 で起動できる。エージェント自身が増やしていく) |
| `agent/skills/` | キュレーション基準などのスキル(自分で追加・改善) |
| `agent/knowledge/` | 日々の学びの蓄積(自分で追記) |
| `agent/sources.json` | 監視する情報源(自分で追加・無効化) |
| `data/digests/` | 日次ダイジェスト(サイトの元データ) |
| `data/runs/` | オンデマンド実行の結果 |
| `data/growth-log.json` | 自己成長の全履歴(グラフの成長イベントの元データ) |
| `scripts/graph.mjs` | リポジトリの状態から `graph.json`(ノード/エッジ)を導出 |
| `assets/graph.js` | グラフビューの描画(d3 同梱: `assets/d3.v7.min.js`) |
| `index.html` など | 生成された静的サイト(直接編集しない。`scripts/build-site.mjs` が再生成) |

## オンデマンド実行(▶ 実行ボタン)

グラフのサブエージェントノード、または「実行」ページの ▶ボタンを押すと、入力済みの Issue 作成画面が開きます。
入力欄(`topic:` など)を埋めて Issue を発行すると `run-agent.yml` が起動し、結果は Issue へのコメントと
[実行ページ](https://koh1002.github.io/AgAg/runs.html) に反映されます。

- **オーナー(あなた)が起票した `▶ run:` で始まる Issue のみ実行されます**(第三者の Issue ではワークフローが起動しません)
- サブエージェントは `agent/agents/*.md` に定義があり、日次エージェントが成長アクションとして新しいサブエージェントを増やしていきます

安全のため `.github/workflows/` はエージェント編集禁止(改善案は `agent/knowledge/proposals.md` に提案として書かれます)。スクリプトの自己変更は検証ゲートを通らないと巻き戻されます。

## セットアップ(初回のみ・約3分)

サイトはリポジトリルートに生成されるため、GitHub Pages は「ブランチ配信(main / ルート)」でも「GitHub Actions 配信」でもそのまま動きます。ブランチ配信の場合、Actions のデプロイステップは GitHub 側のビルドと競合することがありますが失敗扱いにはしていません(Settings → Pages → Source を "GitHub Actions" にすると競合自体が消えます)。

1. **Claude 認証トークンを登録**
   手元のターミナルで:
   ```bash
   claude setup-token
   ```
   表示されたトークンを、リポジトリの **Settings → Secrets and variables → Actions → New repository secret** で
   `CLAUDE_CODE_OAUTH_TOKEN` という名前で登録します(Claude Pro/Max のサブスクリプションで動きます)。

2. **初回実行**
   **Actions タブ → daily-agent → Run workflow** で手動実行して動作確認。
   以降は毎朝 07:30 (JST) に自動実行されます。

3. **通知の購読**
   RSS リーダー(Feedly、Reeder など)で `https://koh1002.github.io/AgAg/feed.xml` を購読すると、毎朝のダイジェストが届きます。

## ローカルでの動作確認

```bash
node scripts/collect.mjs        # 生データ収集 → data/raw/
node scripts/validate.mjs       # データとスクリプトの検証
node scripts/build-site.mjs     # サイト生成 → docs/
```

依存パッケージはゼロ(Node 20+ のみ)。`docs/index.html` をブラウザで開けばプレビューできます。

## 運用メモ

- 毎日の実行は Claude Pro/Max の利用枠を消費します(1回あたり数分のエージェント実行)
- エージェントの成長が気に入らない場合は、該当コミットを revert すれば元に戻ります(すべての自己変更は `data/growth-log.json` とコミット履歴に記録されます)
- 情報源を増やしたいときは `agent/sources.json` に RSS を足すだけでも OK(エージェント自身も追加していきます)
