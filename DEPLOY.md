# 本番環境デプロイ手順（Render）

PCを閉じても24時間稼働する本番用システムの構築手順です。

## 事前準備

- GitHub アカウント
- Render アカウント（https://render.com で無料登録）
- 現在の `.env` の内容をメモ（後で入力します）

---

## ステップ1: GitHub にコードをアップロード

### 1-1. GitHub でリポジトリを作成

1. https://github.com にログイン
2. 右上の「+」→「New repository」
3. リポジトリ名を入力（例: `care-record-system`）
4. 「Create repository」をクリック

### 1-2. ターミナルでコードをプッシュ

Cursor のターミナルで以下を実行（`あなたのユーザー名` と `リポジトリ名` を置き換え）：

```bash
cd /Users/gotoukazuyo/Cursor1/care-record-system
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/あなたのユーザー名/リポジトリ名.git
git push -u origin main
```

※ 初回は GitHub のログインが求められます。

---

## ステップ2: Render にデプロイ

### 2-1. 新規 Web サービス作成

1. https://dashboard.render.com にログイン
2. 「New +」→「Web Service」をクリック
3. 「Connect a repository」で GitHub を選択
4. 先ほど作成したリポジトリを選択
5. 「Connect」をクリック

### 2-2. 設定

| 項目 | 入力値 |
|------|--------|
| **Name** | care-record-system（そのままでOK） |
| **Root Directory** | `care-record-system`（リポジトリ直下に置いた場合は空欄） |
| **Runtime** | Node |
| **Build Command** | `npm install` |
| **Start Command** | `node server.js` |

### 2-3. 環境変数を設定

「Environment」セクションで「Add Environment Variable」をクリックし、以下を1つずつ追加：

| Key | Value（.env の値を使う） |
|-----|--------------------------|
| `LINE_CHANNEL_SECRET` | （.env からコピー） |
| `LINE_CHANNEL_ACCESS_TOKEN` | （.env からコピー） |
| `AI_PROVIDER` | `gemini` |
| `GEMINI_API_KEY` | （.env からコピー） |
| `ADMIN_PASSWORD` | （管理画面のパスワード） |
| `MANAGER_PHONE` | （リッチメニュー用・ハイフンなし） |
| `NURSE_PHONE` | （リッチメニュー用・ハイフンなし） |

### 2-4. デプロイ実行

1. 「Create Web Service」をクリック
2. デプロイが完了するまで数分待つ
3. 画面上部に表示される URL（例: `https://care-record-system-xxxx.onrender.com`）をメモ

---

## ステップ3: LINE の設定を変更

1. [LINE Developers](https://developers.line.biz/) にログイン
2. チャネル → Messaging API 設定
3. **Webhook URL** を以下に変更：
   ```
   https://あなたのサービス名.onrender.com/webhook
   ```
4. 「更新」をクリック
5. 「Webhook の利用」をオン
6. 「応答メッセージ」をオフ

---

## ステップ4: リッチメニューの再設定

本番用の LINE チャネルでリッチメニューを使う場合、環境変数を設定したうえで、**ローカル**で以下を実行：

```bash
cd /Users/gotoukazuyo/Cursor1/care-record-system
npm run setup-rich-menu
```

※ 本番の `LINE_CHANNEL_ACCESS_TOKEN` が .env に設定されている必要があります。

---

## 管理画面へのアクセス

デプロイ後の URL にアクセス：
```
https://あなたのサービス名.onrender.com
```

パスワードは `ADMIN_PASSWORD` で設定した値です。

---

## 注意事項

### 無料プランの場合

- **スリープ**: 15分間アクセスがないとサービスが停止し、次のアクセス時に約50秒かけて起動します
- **データ**: 再起動時に SQLite のデータが消える場合があります

### データを永続化したい場合（有料）

1. Render のサービス → 「Disks」→「Add Disk」
2. 名前: `data`、マウントパス: `/data`
3. 環境変数に追加：`DATABASE_PATH` = `/data/care_records.db`
4. 再デプロイ

---

## トラブルシューティング

**LINE に返信が届かない**
- Webhook URL が正しいか確認
- 「Webhook の利用」がオンか確認
- 「応答メッセージ」がオフか確認

**管理画面にログインできない**
- `ADMIN_PASSWORD` の値を確認

**デプロイが失敗する**
- 環境変数がすべて正しく設定されているか確認
- Build ログでエラー内容を確認
