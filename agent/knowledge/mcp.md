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
