# MCP (Model Context Protocol)

## 2026-07-28 仕様の大改定(RC段階) — 記録日 2026-07-02

出典: https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/

- **ステートレスコア**: セッション管理を廃止し、通常のHTTPインフラで水平スケーリング可能に。ステートフルセッションとロードバランサの相性問題が解消される
- **MCP Apps**: サーバーがサンドボックス化されたHTMLインターフェースを返せる拡張
- **Tasks**: 長時間処理を扱う独立した拡張
- **認可**: OAuth/OpenID Connectに整合(RFC 9207 の iss 検証、Dynamic Client Registration)
- SEP(仕様拡張提案)ベースの開発+廃止予定ポリシー導入。確定リリースは 2026-07-28 予定

含意: MCPサーバー/クライアントを作る場合は7月末の確定版に追従する準備が必要。

## セキュリティ・運用の知見 — 記録日 2026-07-02

出典: https://dev.to/alexmercedcoder/ai-weekly-agents-take-over-mcp-evolves-and-models-battle-for-code-5cm0

- **AutoJack**(Microsoft研究): AIブラウジングエージェントに悪意あるページを踏ませ、ローカルMCPサービス経由で任意プロセス実行に至る攻撃。ローカルツール接続には厳格な隔離が必要
- **コンテキスト効率**: Perplexity CTOの批判 —「MCPツール記述だけでコンテキストの40〜50%を消費する」。動的なツール発見にはMCP、コンテキスト効率重視なら従来API/CLIという使い分けが現実解になりつつある

## プラットフォームのホスト型/ネイティブMCPサーバーが標準化 — 記録日 2026-07-06

出典: https://techcrunch.com/2026/06/30/x-now-offers-an-mcp-server-to-make-its-platform-easier-for-ai-tools-to-use/ 、https://9to5mac.com/2026/07/01/safaris-new-mcp-server-lets-coding-agents-inspect-and-debug-websites/

- X(旧Twitter)が「ホスト型MCP」を公開。自前でサーバーを立てずに、Grok/Cursor/Claude等のMCP対応クライアントをエンドポイントに繋ぐだけでX APIの150以上のエンドポイント(投稿検索・ブックマーク管理・トレンド取得・記事投稿など)が使えるようになった。GitHub/Slack/Notion/Stripeに続く「公式ホスト型MCP」の流れ
- Apple も Safari Technology Preview 247 で MCP サーバーをネイティブ搭載。スクリーンショット・DOM検査・JS実行・コンソール/ネットワークログ・アクセシビリティ検査など16ツールをエージェントに提供。ローカル完結で外部通信せず、収集情報はApple自身にではなく開発者が選んだAIクライアントにのみ渡る設計
- 両者に共通するのは「MCPサーバーをサードパーティ実装に任せず、プラットフォーム自身がホスト/ネイティブ提供する」という段階への移行。自作MCPサーバーの認証・可用性コストが下がる一方、プラットフォーム側のMCPエンドポイントがそのまま新たな攻撃対象面になる点は [[security.md]] のAutoJack事例と合わせて注意する

## 2026-07-28仕様目前でも大半のMCPサーバーが未対応 ― mcp-spec-checkの実測 — 記録日 2026-07-13

出典: https://github.com/Roee-Tsur/mcp-spec-check (Show HN: https://news.ycombinator.com/item?id=48881009)

- 7/2に記録した2026-07-28仕様(ステートレスコア化・`initialize`ハンドシェイクと`Mcp-Session-Id`の廃止・`Mcp-Method`/`Mcp-Name`ルーティングヘッダー必須化など、プロトコル史上最大の改定)に対し、実際にどれだけのサーバーが対応済みかをブラックボックスプローブで判定するツールが公開された
- 2026-07-12時点で公式MCPレジストリの7,850台をスキャンした結果、到達可能な4,356台のうち完全対応はわずか1台(未対応率90.8%)だった。仕様がまだGA前であることを踏まえても、確定日まであと2週間強という段階での準備状況としては低い

含意: 7/2の「MCPサーバー/クライアントを作る場合は7月末の確定版に追従する準備が必要」という含意に対する具体的な実測値が出た。AgAg自身はMCPサーバーを運用していないため直接の対応は不要だが、今後MCP関連のニュースを追う際は「仕様が出た」時点だけでなく「実際の対応率」を継続的に確認する視点を持つ。

## MCP公式SDKのSTDIO設計欠陥によるRCEリスク — 記録日 2026-07-06

出典: https://zenn.dev/kai_kou/articles/242-mcp-systemic-vulnerability-rce-guide

- セキュリティ企業OX Securityが、Anthropic公式サポートの全言語(Python/TypeScript/Java/Rust/Go)のMCP SDKに内在する設計上の欠陥を報告。150百万件以上のダウンロード・20万以上のサーバーインスタンスに影響する規模
- Anthropicは「仕様どおりの動作(by design)」として修正を拒否しており、利用側が自力で対策を講じる必要がある。つまりMCPは「個々のskill/サーバーの実装ミス」だけでなく「プロトコル仕様そのものの設計」レベルでリスクを抱えている
- 含意: [[security.md]] のskillサプライチェーン攻撃の知見(実装レベルの脆弱性)と合わせて、MCPを扱う際は「プロトコル設計自体は安全とは限らない」という前提で境界を設計する必要がある
