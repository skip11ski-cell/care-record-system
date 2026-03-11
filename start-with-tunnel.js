#!/usr/bin/env node
/**
 * サーバーとngrokトンネルを同時に起動
 * LINE Webhook用の公開URLを自動で表示します
 *
 * 事前準備:
 * 1. .env に NGROK_AUTHTOKEN を設定
 * 2. https://dashboard.ngrok.com/get-started/your-authtoken で無料トークン取得
 */

require('dotenv').config();
const { spawn } = require('child_process');
const { execSync } = require('child_process');
const ngrok = require('@ngrok/ngrok');

const PORT = process.env.PORT || 3000;

// ポートを使用中のプロセスを解放（既存のサーバーを停止）
try {
  execSync(`pkill -f "node server.js" 2>/dev/null; sleep 1`, { stdio: 'ignore' });
} catch (_) {}

// サーバーを起動
const server = spawn('node', ['server.js'], {
  stdio: 'inherit',
  cwd: __dirname
});

server.on('error', (err) => {
  console.error('サーバー起動エラー:', err);
  process.exit(1);
});

server.on('exit', (code) => {
  process.exit(code || 0);
});

// サーバー起動を待ってからngrokを開始
setTimeout(async () => {
  try {
    if (!process.env.NGROK_AUTHTOKEN) {
      console.log('\n⚠️  NGROK_AUTHTOKEN が .env に設定されていません');
      console.log('   https://dashboard.ngrok.com/get-started/your-authtoken で無料トークンを取得し、');
      console.log('   .env に NGROK_AUTHTOKEN=あなたのトークン を追加してください。\n');
      return;
    }

    const listener = await ngrok.forward({
      addr: PORT,
      authtoken_from_env: true
    });

    const url = listener.url();
    console.log('\n========================================');
    console.log('✅ 公開URL（LINE Webhook設定用）');
    console.log(`   ${url}/webhook`);
    console.log('========================================\n');
    console.log('LINE Developers の Webhook URL に上記を設定してください。');
    console.log('このターミナルを閉じるとトンネルも終了します。\n');
  } catch (err) {
    console.error('\nngrok起動エラー:', err.message);
    console.log('NGROK_AUTHTOKEN が正しいか確認してください。\n');
  }
}, 2500);
