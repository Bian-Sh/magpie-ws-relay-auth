# Codex Proxy RS (WS) · Responses WebSocket 中継

> [!TIP]
> 公式 Responses WebSocket 対応の中継サーバーを magpie に接続するプラグインです。WebSocket フレームを標準の SSE に変換し、スイッチを切れば通常の HTTP/SSE カスタムプロバイダーになります。magpie 本体の変更は不要です。

[简体中文](./README.md) · [English](./README.en.md) · [繁體中文](./README.zh-TW.md) · **日本語** · [Deutsch](./README.de.md)

## 概要

多くの中継サーバーは同じ Responses API を 2 通りに公開しています：

| 経路 | magpie 標準で使える？ | 本プラグイン |
| --- | --- | --- |
| `POST /v1/responses` (HTTP/SSE) | はい（カスタムプロバイダー） | オフ時はそのまま透過 |
| `GET /v1/responses` (WebSocket Upgrade) | いいえ（出站は HTTP のみ） | ws 接続し `response.create` を 1 フレーム送信、各フレームを SSE に変換 |

したがって本プラグインは**任意の拡張**であり、中継サーバー接続の必須条件ではありません。公式 Codex/Responses の特徴（1 フレームのリクエスト、`response.*` イベント、`[DONE]` なし、接続内メタデータ）を持つ長接続パスを提供し、HTTP/SSE をいつでも戻れるフォールバックとして残します。

[zyycn/codex-proxy-rs](https://github.com/zyycn/codex-proxy-rs) および互換ゲートウェイを含め、OpenAI 公式の Responses WebSocket プロトコルを実装する中継サーバーであれば動作します。ホスト名の固定やベンダー名の判定はありません。互換ゲートウェイで実機検証済み（101 ハンドシェイク、13 イベント、エラーフレーム、`previous_response_id`）。

> [!WARNING]
> プラグインは他人のコードです。ログインとリクエストを代行するため、会話・ツール・結果を参照できます。信頼できる中継サーバーにだけ向けてください。鍵はローカルに保存され、ログには書きません。

## ログインと保存先

| 項目 | 内容 |
| --- | --- |
| 方式 | API key（`Client API key`、プレースホルダ `sk-…`） |
| 質問 | 1 つだけ：中継サーバーのベース URL（空なら `http://127.0.0.1:8080/v1`）。答えたら鍵を入力——**計 2 画面で完了**。カード名・モデル・モデルカタログ URL・残高はログインでは聞かれません（下記「高度な設定」） |
| 鍵 | magpie 設定ディレクトリの `plugin-auth.json`（権限 600） |
| 回答 | アカウントの `metadata` に、鍵と一緒に保存 |
| 複数アカウント | 同じプロバイダーに複数回ログイン可能（`id#xxxxxx`）。**各アカウントは独自のベース URL・名前・モデル一覧・残高設定を持ち**、loader はアカウント単位で実行 |
| 用量 / 残高 | `auth.usage` フックで残高を表示（設定時のみ；未設定なら非表示、後述） |
| アイコン | カードアイコンは `auth.icon`（組み込みの紫色インライン SVG も可）、`package.json` の `magpie.icon` も参照。https リンクまたは `data:image` を受理 |
| プロキシ | HTTP は magpie の設定、WebSocket は `HTTPS_PROXY` / `HTTP_PROXY` を参照（ループバックは直接） |

### 高度な設定（カード名 / モデル / モデルカタログ / 残高）

ログインはアドレスと鍵だけ聞き、残りの設定はログインを妨げない 2 つの経路から来ます：

| 設定 | 環境変数（インストール単位、全アカウント共有） | 旧アカウントの遺留（アカウント単位） |
| --- | --- | --- |
| カード名 | `MAGPIE_WS_RELAY_NAME` | 旧版ログインで保存した `display_name` |
| 手入力モデル id | `MAGPIE_WS_RELAY_MODELS` | 保存した `models` |
| モデルカタログ URL | `MAGPIE_WS_RELAY_MODELS_URL` | 保存した `models_url` |
| 残高エンドポイント | `MAGPIE_WS_RELAY_BALANCE_URL` | 保存した `balance_url` |
| 残高メソッド | `MAGPIE_WS_RELAY_BALANCE_METHOD`（GET/POST） | `balance_method` |
| 残高 POST 本文 | `MAGPIE_WS_RELAY_BALANCE_QUERY`（`{key}` = 鍵） | `balance_query` |
| 残高 JSON パス | `MAGPIE_WS_RELAY_BALANCE_PATH`（空なら自動） | `balance_path` |
| 残高単位 | `MAGPIE_WS_RELAY_BALANCE_CURRENCY` | `balance_currency` |

優先順位：**アカウント metadata（旧版ログインの遺留）> 環境変数 > 既定値**。0.4.0 以前でログインしたアカウントは変更不要。環境変数の変更はホスト再読み込みで反映。`MAGPIE_WS_RELAY_ACTOR_AUTH` を空文字にすると `x-openai-actor-authorization` ハンドシェイクヘッダーを省略します（旧名 `MAGPIE_CODEX_PROXY_*` も有効）。

> [!TIP]
> **なぜログインを内蔵「カスタムプロバイダー」のように一画面にできないのか**：magpie のプラグインログイン協定（`host.js` の `nextPrompt`）は 1 プロンプト = 1 画面で、答えを検証してから次を聞きます（OpenCode `auth login` 方式）。プラグインは複数欄のフォームを描けません——`magpie.panels` パネルはプロバイダー編集画面に埋め込めますが、サンドボックス内に文字列を永続化する経路がありません（options はブール値のみ、CSP でネット遮断）。そこで本プラグインは質問を最小に：**アドレス + 鍵の 2 画面**。内蔵フォームの必須 2 欄と同じ長さです。残りは既定値、必要なら環境変数で。

ヘッドレスインストールは全て環境変数でも可。`MAGPIE_WS_RELAY_BASE_URL` でログイン質問のアドレスを代用できます。

## モデル

| 出所 | 挙動 |
| --- | --- |
| ログイン時の手入力 id | 最優先、カンマ区切り（例 `gpt-5.6-terra, gpt-5.6`） |
| 空欄 | アカウントごとに `{base}/models` を 1 回読み、OpenAI 互換 `{"data":[{"id":…}]}` を解釈 |
| 取得失敗 / 未ログイン | magpie の既存リストを保持（初期値 `gpt-5.6-terra`） |

モデルは既定で `limit: { context: 272000, output: 128000 }`。中継サーバーの窓が異なる場合は `plugins.json` で上書きします。

### カスタムモデルカタログ URL

magpie 内蔵の「カスタムプロバイダー」はモデルカタログ URL を設定できます。本プラグインも同等：環境変数 **`MAGPIE_WS_RELAY_MODELS_URL`**（絶対 URL、例 `https://relay.example/v1/models`；旧版ログインで保存した `models_url` はアカウント単位で優先）。空欄なら `{base}/models`、両方失敗なら magpie の既存リストを保持。優先順位は「手入力 id > `models_url` > `/models`」。

### サプライヤーカード名のカスタマイズ

内蔵カスタムプロバイダーには名前欄がありますが、プラグインプロバイダーには名前編集の入口がありません（カード名は `config` フックが決定）。そこで本プラグインは環境変数 **`MAGPIE_WS_RELAY_NAME`** からカード名を読みます（旧版ログインで保存した `display_name` はアカウント単位で優先）。次回のホスト再読み込みで反映。どちらもなければ「Codex Proxy RS (WS)」。

> [!TIP]
> すぐ反映させるには：名前入力後、アプリでプラグインをオフ→オンしてください（端末の `magpie` は毎回現在のファイルを読みます）。初回インストール直後・未ログイン時はデフォルト名で、ログインして再読み込みすると入力した名前になります。

### 中継サーバー残高の取得とアプリ内での流れ

内蔵カスタムプロバイダーは「残高エンドポイント」を設定できます。本プラグインは **`auth.usage` フック**で同等機能を実装し、設定は環境変数から（旧版ログインで保存した同名 metadata はアカウント単位で優先）：

| 環境変数 | 意味 |
| --- | --- |
| `MAGPIE_WS_RELAY_BALANCE_URL` | 残高エンドポイントの GET/POST アドレス；**未設定なら残高を表示しない**（エラーにならない） |
| `MAGPIE_WS_RELAY_BALANCE_METHOD` | `GET`（既定）または `POST` |
| `MAGPIE_WS_RELAY_BALANCE_QUERY` | POST 時のリクエスト本文。`{key}` は Client Key に置換 |
| `MAGPIE_WS_RELAY_BALANCE_PATH` | JSON から値を取り出すドットパス。例 `data.balance`、`wallet.credits`。空欄なら最大の数値フィールドを自動選択 |
| `MAGPIE_WS_RELAY_BALANCE_CURRENCY` | 単位。例 `USD` / `ポイント`。表示のみ。例 `123.45 USD` |

アプリ内での残高の流れ（magpie と同一）：

1. **手動更新**：カードの「用量を更新 / Refresh allowance」を押すと `auth.usage` が呼ばれ、結果がアカウントの用量情報に書き込まれる。
2. **カード表示**：残高はプロバイダーのクォータ（`balance`）としてカードに表示され、プラン用量や制限ウィンドウと並ぶ。
3. **用量統計 / ルーティング**：`balance` は**前払いウォレット残高**（総額なし）。magpie は同一プロバイダーの複数アカウントのうち「同じ単位・残高最多」のアカウントを優先して試す（#3950）。それは**消費カウンターではない**——リクエストごとに magpie が差し引くことはなく、読み取って表示・並べ替えするだけ。
4. **任意のウィンドウ**：中継サーバーが「使用済/総額」式のレート制限ウィンドウを返す場合は、`auth.usage` で `windows`（`used` / `limit` / `unit` 付き）を返すよう変更する。現行は既定で `balance` のみ返し、大半の「ウォレット残高」シナリオをカバー。

> [!NOTE]
> `auth.usage` は読み取り専用・書き込みなし：中継サーバーの状態は変更しません。取得失敗時は `{ error }` を返し、カードは「読み取り失敗」と表示してクラッシュしません。

### アイコンの出所

カードアイコンは `auth.icon`（本プラグインは紫色のインライン SVG を内蔵）。magpie は `auth.icon` を優先し、`package.json` の `magpie.icon` をフォールバック。いずれも `https://` リンクまたは `data:image/…` インライン画像（≤1.5 MB）を受理。自分のアイコンにするには `index.js` 冒頭の `ICON` 定数か、`package.json` の `magpie.icon` を変更します。

## 導入

フォルダー方式（開発・自用）：

```sh
magpie plugin add ./ws-relay-plugin
magpie plugin login codex-proxy-ws      # Client Key・URL・モデル id
magpie provider test codex-proxy-ws
```

アプリでは「プラグイン → 追加 → フォルダー」の後、「プラグイン由来」の **Codex Proxy RS (WS)** でログインします。

> [!TIP]
> フォルダープラグインは絶対パスで登録されます。移動・改名しないでください。コード変更後はプラグインをオフ→オンで再読み込みします（端末の `magpie` コマンドは毎回現在のファイルを読みます）。

### スイッチ

プロバイダー編集画面 → **プラグインオプション → WebSocket 中継を使う → オフ / オン**。`auth.options` で宣言し、値は `settings.json` の `pluginOptions` にプロバイダー id 単位で保存されます。リクエストごとに読むため**再起動不要**です（既定はオン）。

| 状態 | 動作 |
| --- | --- |
| オン | `POST /responses` は WebSocket。それ以外・非 http(s)・握手失敗は HTTP にフォールバック |
| オフ | すべて `fetch` で透過、socket を作らない |

```sh
magpie plugin options codex-proxy-ws '{"ws": false}'
magpie plugin options codex-proxy-ws off     # プラグインの既定値に戻す
```

> [!NOTE]
> ラベル・説明・確認文は `zh` / `zh-TW` / `ja` / `de` に翻訳済み、英語がフォールバックです。

## プロトコル

| 段階 | 規約 |
| --- | --- |
| 握手 | `GET {base}/responses` Upgrade、`Authorization: Bearer <key>`、`OpenAI-Beta: responses_websockets=2026-02-06` |
| リクエスト | テキスト 1 フレーム `{"type":"response.create", ...body}`、`stream: true` を強制 |
| `previous_response_id` | 接続ローカル。新しい接続では 400 `previous_response_not_found`。プラグインは削除し、完全な履歴を送る |
| 応答 | 1 フレーム = 1 SSE イベント。`data:` にフレーム本文、`event:` に `type`。`usage`、`id`、`model`、レート制限ヘッダーも保持 |
| 前導フレーム | `response.metadata` / `codex.response.metadata` / `codex.rate_limits` / `response.created` / `response.in_progress` も SSE に出力（quota 計上用） |
| 終端 | `response.completed` / `failed` / `incomplete` / `done` / `error`。**`[DONE]` は作らない** |
| エラー | 最初の業務イベント前の `{"type":"error","status":503,…}` は HTTP エラーに変換し `Retry-After` / `x-request-id` を付与（フェイルオーバーが効く） |
| ハートビート | Ping/Pong は中継サーバーと Bun が処理、SSE には流さない |
| 寿命 | 1 ターン 1 接続。出力開始後は再送せず、AbortSignal で ws を閉じる |

## ヒント / FAQ

> [!TIP]
> **なぜ「カスタムプロバイダー」画面にスイッチが出ないのか**: あちらは magpie 内蔵プロバイダー（`providers.json`）の編集画面で、全プロバイダー共通です。プラグインオプションは `pluginOptions` にプラグインの id 単位で保存されます。内蔵画面に足すと本体の設定ロジックを変更し、表示判定のフィルターも必要になります。本プラグインは非侵入を選びます。

> [!TIP]
> **なぜ詳細ページの上部が、ストアの（npm）プラグインと違うのか**: **メタデータの出所が違う**だけでバグではありません。
> - **npm 公開**のプラグイン：詳細ページ上部の「作者、`vX.Y.Z`、週間ダウンロード数、ライセンス、更新日」や「npm / ソース」ボタンはすべて **npm registry + magpie コミュニティマニフェスト**（`market.json` / `registry.json`）由来です。そのデータがないローカルプラグインには表示されません。
> - **フォルダー（絶対パス）インストール**のプラグイン：詳細ページは `README.md` 1 本だけを読み、「更新日」はその mtime です。残りのメタデータは欠落——つまり「アイコン＋名前＋パス＋更新日＋README 本文」になります。
> - 揃える前に埋めるなら：`package.json` の `description` / `author` / `license` / `repository` / `homepage` と、`magpie.icon` を埋めれば**ローカルでも表示**されます。「週間ダウンロード数、npm/ソースボタン」は npm 公開後に magpie が取得します。
> - 結論：上部の差は「フォルダー vs npm インストール」の必然的な違いです。完全に揃えるには [PUBLISHING.md](./PUBLISHING.md) の npm 公開ルートを通してください。

> [!TIP]
> **複数の中継サーバー / 複数プロバイダー**: ドメイン固定はありません。1 プロバイダーに複数アカウントを作り、それぞれ URL を設定してください。独立したスイッチが欲しい場合はパッケージを複製し `ID` 定数を変えて 2 つ目のプロバイダーを登録します。

> [!TIP]
> **HTTP/SSE で済むなら ws は不要**。多くの場合 HTTP 側のデュアルスタックの方が安定し、トラブルシュートも簡単です。公式 Codex 指紋や接続内メタデータ、長寿命接続が必要なときだけオンにしてください。

> [!WARNING]
> `e2e.mjs` は **Bun** で実行してください（magpie 付属）。Node のグローバル `WebSocket` はカスタム握手ヘッダーを送れず `Authorization` が落ちます。`test.mjs` はモックなので Node で動きます。

> [!WARNING]
> 制限: 接続内継続なし、動的 `serviceTiers`・価格・アカウント別 WebSocket プロキシは未実装。`magpie.panels` パネルはソース上、文字列を永続化する経路がないことを確認済み（options はブール値のみ、サンドボックス CSP でネット遮断）のため、設定入口には使っていません。高度な設定の環境変数は**インストール単位**（この magpie の全アカウント共有）；アカウント単位の残高・名前設定は旧版ログインの遺留 metadata のみ。残高は「表示＋ルーティング」用途、`auth.usage` は実装済みですが、magpie は**リクエストごとに差し引きません**（残高の意味自体が消費カウンターではない）。

## テスト

```sh
node test.mjs                      # 23 個のプロトコル/スイッチ/複数アカウント/モデル/名前/残高/env シナリオ（ネット不要）
CPRS_KEY=sk-… CPRS_BASE=https://your-relay/v1 bun run e2e.mjs
```

実機テストは 4 つの短い（課金される）リクエストを送ります：WS オン、WS オフ、上流エラーフレーム、`previous_response_id`。鍵は環境変数からのみ読み込み、ディスクには残りません。

## 公開

[PUBLISHING.md](./PUBLISHING.md) に npm・GitHub `magpie-plugin` topic・コミュニティ `registry.json` の手順（「発見」ページの各ブロック准入条件も含む）を記載しています。本パッケージは**未公開・GitHub 未プッシュ**で、ローカルフォルダーからインストールしています。

## ライセンス

MIT
