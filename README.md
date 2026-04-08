# 介護記録 LINE 連携（雛形）

LINE のテキストメッセージを Webhook で受け取り、SQLite に保存してブラウザで一覧表示します。

## 必要なもの

- Python 3.11 以上推奨
- LINE Developers の [Messaging API](https://developers.line.biz/ja/docs/messaging-api/) チャネル（チャネルシークレット・アクセストークン）

## セットアップ

```bash
cd このフォルダ
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# .env に LINE_CHANNEL_SECRET と LINE_CHANNEL_ACCESS_TOKEN を記入
```

## 起動

```bash
source .venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- 一覧: http://127.0.0.1:8000/
- JSON: http://127.0.0.1:8000/api/records
- Webhook URL（LINE に登録）: `https://（公開HTTPS）/callback` または同じホストの **`/webhook`**（どちらも同じ処理です）

ローカルでは [ngrok](https://ngrok.com/) などで HTTPS のトンネルを張り、その URL + `/callback` を LINE の Webhook に設定してください。テスト時のみ `.env` で `DEV_SKIP_LINE_SIGNATURE=true` にすると署名なしの POST で動作確認できます（本番では使わないでください）。

## リッチメニュー（項目分け）

画面下の **「記録メニュー」** から、バイタル・入浴・食事・体操レク・その他・サ責に連絡 のいずれかをタップしてから、内容をテキストで送ると、その区分で保存されます。

1. チャネルアクセストークンを環境変数に渡し、**プロジェクトのルートで** 次を実行します。  
   `export LINE_CHANNEL_ACCESS_TOKEN='（長期トークン）'`  
   `python scripts/create_rich_menu.py`
2. トーク画面にリッチメニューが表示されます（既に別メニューがある場合は上書きされます）。
3. **同じ区分で続けて入力する**場合は、メニューを何度も押さなくても、前回選んだ区分のまま保存されます。**別の区分に変えるときだけ**、もう一度メニューから選んでください。
4. メニューを一度も選ばずに送ったテキストは **未分類** として保存されます。

画像はスクリプトが自動生成する簡易プレースホルダです。あとから [LINE Official Account Manager](https://manager.line.biz/) などでデザイン差し替えも可能です。

## クラウドで動かす（概要）

パソコンを閉じても動かすには、**アプリをインターネット上のサーバーに載せる**必要があります。流れは次のとおりです。

1. **このプロジェクトを GitHub などにアップロード**（非公開リポジトリで可）
2. **PaaS を1つ選ぶ**（例: [Railway](https://railway.app/)、[Render](https://render.com/)、[Fly.io](https://fly.io/)）
3. そのサービスで **PostgreSQL を追加**し、発行された **`DATABASE_URL`** を環境変数に設定する
4. 同じく環境変数に **`LINE_CHANNEL_SECRET`** と **`LINE_CHANNEL_ACCESS_TOKEN`** を入れる（いまの「介護記録システム」チャネルの値）
5. デプロイ後に表示される **HTTPS の URL**（例: `https://xxx.onrender.com`）を、LINE Developers の **Webhook URL** に  
   **`https://（そのドメイン）/callback`** として登録する
6. ブラウザで **`https://（そのドメイン）/`** を開くと一覧が見られる

このリポジトリには **`Dockerfile`** があるので、Docker 対応のサービスなら「リポジトリを接続してビルド」でよいことが多いです。

**注意:** コンテナだけで SQLite を使うと、再起動でデータが消えることがあります。**本番は PostgreSQL + `DATABASE_URL` を推奨**します。

### Render でデプロイする（おすすめの流れ）

1. **GitHub にこのフォルダを push** する（アカウント作成とリポジトリ作成がまだなら先に実施）。
2. [Render](https://render.com/) にログインし、**Dashboard → New → Blueprint** を選ぶ。
3. GitHub を連携し、**このリポジトリ**と **`render.yaml` があるブランチ**（通常は `main`）を指定して進む。
4. 画面の指示で Blueprint を適用すると、**Web サービス（Docker）** と **PostgreSQL** が作成される。
5. デプロイが始まったら、**Web サービス `kaigo-line-app` → Environment** を開き、次の2つを手入力する（`sync: false` のため初回は空です）。
   - `LINE_CHANNEL_SECRET` … LINE Developers のチャネルシークレット
   - `LINE_CHANNEL_ACCESS_TOKEN` … チャネルアクセストークン（長期）
6. **Save** 後、**Manual Deploy** で再デプロイすると確実です。
7. Web サービスの **URL**（例: `https://kaigo-line-app.onrender.com`）をコピーする。
8. [LINE Developers](https://developers.line.biz/) で該当チャネルを開き、**Messaging API 設定 → Webhook URL** を  
   **`https://（手順7のホスト名）/callback`** にし、**Webhook の利用**をオン、**検証**が成功するか確認する。
9. ブラウザで **`https://（同じホスト名）/`** を開き、画面が表示されるか確認する。

**料金の目安:** Render の PostgreSQL は無料枠がない／制限がある場合があります。ダッシュボードでプランを確認してください。外部の無料 PostgreSQL（例: [Neon](https://neon.tech/)）を使う場合は、Blueprint の `databases` を外し、Web サービスの環境変数にだけ **`DATABASE_URL`**（接続文字列）を手動で設定する方法もあります。

**無料 Web サービスの挙動:** 無料プランの Web はしばらくアクセスがないとスリープし、**最初の1回目だけ数十秒かかる**ことがあります。

### Render のログに OpenAI / Node.js が出る場合

このリポジトリは **Python（FastAPI）+ Dockerfile** のみです。`ai-converter.js` や `OPENAI_API_KEY` は **含まれません**。ログに

- `OPENAI_API_KEY` が欠落
- `new OpenAI(`

などが出るときは、**Render 上でまだ古い「Node の Web サービス」が動いている**か、**ビルド／起動コマンドが Dockerfile ではなく `npm start` / `node server.js` のまま**になっている可能性が高いです。

**対処:**

1. **デプロイ先の Web サービス**が、この GitHub リポジトリの **最新 `main`（`Dockerfile` あり・`package.json` なし）** を向いているか確認する。
2. Render の **Settings → Build & Deploy** で次を確認する。  
   - **Environment** が **Docker** になっている（Native Node / 空の Buildpack ではない）。  
   - **Dockerfile Path** が `Dockerfile`（リポジトリ直下）になっている。  
   - **Start Command** に `node` や `npm` が入っていない（空なら Dockerfile の `CMD` が使われるのが正しい）。
3. 古い **Node 用の Web サービス**が別名で残っている場合は、ログがそちらを見ていることがある。**Python 用サービス**のログを開く。
4. 再デプロイ後、起動ログに `Starting care-record API (Python/FastAPI, uvicorn)` と出れば **Python が動いています**。AI 整形は **`GEMINI_API_KEY`** のみ（OpenAI は不要）。

## 構成

- `app/main.py` … FastAPI（`POST /callback` と `POST /webhook` は同一の LINE Webhook、`/`, `/api/records`）
- `app/models.py` … 記録テーブル `care_records`
- `care_records.db` … ローカル開発時は SQLite（初回起動時に自動作成）
- `DATABASE_URL` … 設定時は PostgreSQL などに接続（クラウド本番向け）
