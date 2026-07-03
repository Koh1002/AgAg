# AgAg 🤖 — 自己成長型 AIエージェント・デイリーウォッチ

AIエージェント分野の動向を **1日1回自動調査** し、日本語ダイジェストを **GitHub Pages** に公開、有用な学びを **自分自身のコード・知識・スキルに取り込んで成長し続ける** エージェントです。

- 📰 サイト: `https://koh1002.github.io/AgAg/`(下記セットアップ後に有効)
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
  4. scripts/build-site.mjs … docs/ に静的サイト + feed.xml を生成
  5. bot が main にコミット → GitHub Pages が自動更新
```

エージェントの「脳」はすべてリポジトリ内にあります:

| パス | 役割 |
|---|---|
| `agent/AGENT.md` | エージェント自身の指示書(エージェントが自分で改善する) |
| `agent/skills/` | キュレーション基準などのスキル(自分で追加・改善) |
| `agent/knowledge/` | 日々の学びの蓄積(自分で追記) |
| `agent/sources.json` | 監視する情報源(自分で追加・無効化) |
| `data/digests/` | 日次ダイジェスト(サイトの元データ) |
| `data/growth-log.json` | 自己成長の全履歴 |

安全のため `.github/workflows/` はエージェント編集禁止(改善案は `agent/knowledge/proposals.md` に提案として書かれます)。スクリプトの自己変更は検証ゲートを通らないと巻き戻されます。

## セットアップ(初回のみ・約3分)

GitHub Pages のデプロイは Actions(`deploy-pages` ワークフロー)が自動で行うため、Settings の操作は不要です。

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
