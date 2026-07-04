# agent-auth-demo

ブラウザ内 LLM（**WebLLM**）をエージェントとし、そのエージェントが **OAuth 2.1 / PKCE** で保護された
**MCP リソースサーバ**へツール呼び出しを行い、サーバ内の **Cedar** がロールに基づいて動的に認可する —
という一連の流れを実際に触って学べる公開デモです。

仕様の全文は [`docs/spec_webllm_oauth_mcp_cedar.md`](docs/spec_webllm_oauth_mcp_cedar.md) を参照してください。

> 仕様書は SPA / AS / MCP-RS を別オリジン3プロジェクトに分ける構成を推奨していますが、本リポジトリは
> **単一 Next.js (App Router) アプリ**にすべての役割を同居させた実装です。ディスカバリ
> （401 → PRM → AS メタデータ → PKCE → token → MCP）は同一オリジン内で再現し、画面のフローログで可視化します。

## アーキテクチャ（単一アプリ内の役割）

| 役割 | OAuth ロール | 実装 |
|---|---|---|
| Browser SPA | 公開クライアント / MCP クライアント | `app/page.tsx` ＋ `lib/client/*`（WebLLM・PKCE・MCP クライアント・フローログ） |
| Minimal AS | 認可サーバ | `app/authorize`・`app/api/authorize`・`app/api/token`・`app/jwks.json`・`app/.well-known/oauth-authorization-server` |
| MCP Server | リソースサーバ | `app/mcp`（PEP: Bearer 検証）＋ `lib/mcp.ts` ＋ `lib/cedar.ts`（PDP: Cedar）＋ `app/.well-known/oauth-protected-resource` |

- **PEP（門番）** = `lib/jwt.ts` の `verifyAccessToken`（JWKS 署名検証 ＋ `iss/aud/exp/scope`）。
- **PDP（判定）** = `lib/cedar.ts`（`@cedar-policy/cedar-wasm`）。ポリシーは `policies/policy.cedar`。

## 仮想ユーザーとロール

| ユーザー | role | read | write | delete |
|---|---|:--:|:--:|:--:|
| alice | admin | ✅ | ✅ | ✅ |
| bob | editor | ✅ | ✅ | ❌ |
| carol | viewer | ✅ | ❌ | ❌ |

すべて架空ユーザーで PII はありません。JWT にも PII は載せません。

上の表はロールだけで決まる**静的**な認可です。これに加えて、`policies/policy.cedar` には
リクエスト時の情報で結果が変わる**動的**な認可を 2 つ実装しています（同じ role・同じ action でも
状況によって allow/deny が変わります）。

1. **ABAC（リソース属性ベース）**: レコード `r2` は `sensitivity: "confidential"` として登録されています
   （`lib/store.ts` の seed データ）。viewer は `r2` を read できず、editor は `r2` を write できません
   （通常のレコードなら read/write できるのに、です）。判定は `resource.sensitivity` を見て動的に行われます。
2. **コンテキストベースの一括削除ガード**: `deleteRecord` は `{ id }` または `{ ids: [...] }` で複数指定できますが、
   1 回の呼び出しで 2 件以上を対象にすると **admin でも常に拒否**されます（`context.targetCount` を見た
   forbid ポリシー）。誤操作や暴走したエージェントが一度に大量削除するのを防ぐ、爆発半径の制限です。

DB ビューアではレコードごとに sensitivity バッジが表示され、チェックボックスで複数選択して
「選択レコードを一括削除」を押すと、ガードによる拒否をその場で体験できます。

## ツールチェーン（mise）

node と bun は [mise](https://mise.jdx.dev/) で管理します（`mise.toml`）。

```bash
mise install           # node / bun を導入
mise exec -- bun install
```

> 注: この環境では `mise.run` のインストールスクリプトがブロックされていたため mise 自体は
> `npm i -g mise` で導入しています。

## 起動

```bash
mise exec -- bun run dev      # http://localhost:3000
```

ブラウザで開き「ログイン」を押すと、ディスカバリ → PKCE → token → MCP の各ホップがフローログに出ます。
alice / bob / carol を切り替えて、手動ツールボタン（read/write/delete）で Cedar の allow/deny を観察できます。

**WebLLM エージェント**: WebGPU 対応ブラウザ（Chrome/Edge 113+ 等）で「モデルをロード」を押すとブラウザ内で
LLM が起動し、自然言語からツール呼び出し（JSON 構造化出力 → MCP `tools/call`）を行います。
WebGPU 非対応環境では手動ツールで同じ認可フローを体験できます。

## 動作確認（受け入れ条件 §14）

ディスカバリの確認:

```bash
curl -s localhost:3000/.well-known/oauth-protected-resource | jq .
curl -s localhost:3000/.well-known/oauth-authorization-server | jq .
curl -i -X POST localhost:3000/mcp     # => 401 + WWW-Authenticate (resource_metadata)
```

自動受け入れテスト（サーバ起動中に別ターミナルで）:

```bash
BASE_URL=http://localhost:3000 mise exec -- bun run verify
```

alice/bob/carol の認可マトリクス（#2〜#7）、`aud` 不一致トークンの拒否（#8）、各 well-known（#1,#10）を検証します。
`#9 期限切れトークン`はトークン TTL（10分）の都合で手動確認です。

## セキュリティ上の注意（学習用デモ）

- 公開クライアントのためトークンはブラウザに乗ります（学習用途では許容、仕様 §11.10 / §12 BFF 案参照）。
- 認可コードは**署名付き JWT（ステートレス）**です（`lib/authcode.ts`）。サーバレスのインスタンス分散下でも
  共有ストア無しでコード交換できます。トレードオフとして「1回限り使用」のサーバ側無効化はできません（PKCE と
  60 秒 TTL で代替）。
- レコードは**インメモリ**で、サーバ再起動やサーバレスのインスタンス分散で揮発します（デモ用途）。
- 署名鍵は env `SIGNING_PRIVATE_KEY` 未指定時はプロセス起動ごとに生成します（JWKS と常に整合）。
  **サーバレス（Vercel 等）では `SIGNING_PRIVATE_KEY` の設定が実質必須**です。未設定だとインスタンスごとに
  鍵が変わり、別インスタンスが署名した認可コード／アクセストークンを検証できません。

## 主な環境変数（任意）

| 変数 | 用途 |
|---|---|
| `AS_ISSUER` | AS issuer（既定: リクエストオリジン） |
| `RESOURCE_URL` | トークン `aud` / RS 識別子（既定: `<origin>/mcp`） |
| `SIGNING_PRIVATE_KEY` / `SIGNING_KID` | JWT 署名鍵（JWK JSON）。未指定なら自動生成 |
| `SPA_ORIGIN` | CORS 許可オリジン（既定: `*`） |
| `NEXT_PUBLIC_WEBLLM_MODEL` | 使用する WebLLM モデル ID |
