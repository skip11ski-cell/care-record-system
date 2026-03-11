# 介護現場向け LINE 記録自動生成システム

デイサービスの介護スタッフが LINE で利用者の様子を文章入力すると、AI が介護記録様式に自動変換するシステムです。サービス提供責任者は管理画面で確認・承認するだけで記録業務が完了します。

## システム構成

```
LINE（スタッフ入力）
    ↓
LINE Messaging API → Webhook
    ↓
Node.js サーバー → OpenAI API（記録変換）
    ↓
SQLite（記録保存）
    ↓
管理画面（確認・承認・CSVエクスポート）
```

## 機能一覧

- LINE からの自由文テキスト受信
- AI による介護記録フォーマット自動変換（OpenAI / Dify 切替対応）
- 変換結果の LINE 即時返信
- 管理画面（パスワード認証付き）
  - 記録の一覧表示・フィルタ検索・ページネーション
  - 記録の編集・承認・差し戻し（確認ダイアログ付き）
  - 統計ダッシュボード
  - CSV エクスポート
- 利用者マスタ管理（名前の揺れ自動正規化）

## セットアップ手順

### 1. 必要なもの

- Node.js 18 以上
- LINE Developers アカウント
- OpenAI API キー

### 2. LINE Messaging API の設定

1. [LINE Developers](https://developers.line.biz/ja/) にログイン
2. プロバイダーを作成 → Messaging API チャネルを作成
3. 以下をメモ：
   - **チャネルシークレット**（チャネル基本設定）
   - **チャネルアクセストークン**（Messaging API 設定で発行）
4. Webhook URL に `https://あなたのサーバー/webhook` を設定
5. 「Webhook の利用」をオン、「応答メッセージ」をオフ

### 3. インストール

```bash
cd care-record-system
npm install
```

### 4. 環境変数の設定

```bash
cp .env.example .env
```

`.env` を編集して以下を入力：

```
LINE_CHANNEL_SECRET=あなたのチャネルシークレット
LINE_CHANNEL_ACCESS_TOKEN=あなたのアクセストークン
AI_PROVIDER=openai
OPENAI_API_KEY=あなたのOpenAI APIキー
ADMIN_PASSWORD=管理画面のパスワード
PORT=3000
```

### 5. 起動

```bash
npm start
```

管理画面: http://localhost:3000

### 6. 外部公開（LINE Webhook 用）

ローカル開発時は ngrok を使って公開できます。

1. [ngrok](https://dashboard.ngrok.com/get-started/your-authtoken) で無料アカウントを作成し、Authtoken を取得
2. `.env` に `NGROK_AUTHTOKEN=あなたのトークン` を追加
3. 以下でサーバーとトンネルを同時起動：

```bash
npm run start:tunnel
```

表示される URL（`https://xxxx.ngrok-free.app/webhook`）を LINE Developers の Webhook URL に設定してください。

## Render へのデプロイ

1. GitHub にリポジトリを作成しプッシュ
2. [Render](https://render.com/) でアカウント作成
3. New → Web Service → GitHub リポジトリを選択
4. Root Directory に `care-record-system` を指定
5. Build Command: `npm install`
6. Start Command: `node server.js`
7. Environment Variables に `.env` の内容を設定
8. Deploy
9. デプロイ完了後、表示される URL + `/webhook` を LINE Developers の Webhook URL に設定

## リッチメニュー（呼び出しボタン）

「呼び出し・管理者」「呼び出し・看護師」を LINE のリッチメニューに追加し、タップで電話発信できるようにする機能です。

### 設定手順

1. `.env` に電話番号を追加（ハイフンなし）：
   ```
   MANAGER_PHONE=0312345678
   NURSE_PHONE=09012345678
   ```

2. 以下のコマンドを実行：
   ```bash
   npm run setup-rich-menu
   ```

3. LINE アプリでボットを開き、画面下部に青（管理者）・緑（看護師）のメニューが表示されることを確認

※ 画像をカスタマイズしたい場合は、2500×1686px の PNG を作成し、`setup-rich-menu.js` の画像生成部分を差し替えてください。

## 使い方

### スタッフ（LINE 側）

LINE 公式アカウントを友だち追加し、利用者の様子を自由に文章で送信します。

**入力例：**
> 田中さん、今日の入浴はいつもより時間がかかりました。少し疲れた様子でしたが、湯船につかると気持ちよさそうにされていました

**AI が自動変換して返信：**
```
📋 介護記録 #1
━━━━━━━━━━━━━━
📅 日付：2026年3月7日
👤 利用者：田中 様
🏥 サービス：入浴介助

【様子・観察】
入浴時間が通常より延長。疲労感あり。入浴中は表情穏やかで快適な様子。

【特記事項】
疲労感が見られるため、今後の入浴時間に配慮が必要。
━━━━━━━━━━━━━━
```

### サービス提供責任者（管理画面）

ブラウザで管理画面にアクセスし、パスワードでログイン後、AI が変換した記録を確認・修正・承認します。

## ファイル構成

```
care-record-system/
├── server.js          # Express サーバー + LINE Webhook + REST API + 認証
├── ai-converter.js    # AI による介護記録変換（OpenAI/Dify 切替対応）
├── database.js        # SQLite データベース操作（記録・スタッフ・利用者マスタ）
├── package.json
├── .env.example       # 環境変数テンプレート
├── .gitignore
├── render.yaml        # Render デプロイ設定
└── public/            # 管理画面
    ├── index.html     # 管理画面（記録管理タブ + 利用者マスタタブ）
    ├── style.css      # スタイル（レスポンシブ対応）
    └── app.js         # フロントエンド（認証・ページネーション・CSV出力）
```
