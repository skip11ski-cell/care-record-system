#!/usr/bin/env node
/**
 * LINEリッチメニュー設定スクリプト
 * 「呼び出し・管理者」「呼び出し・看護師」を追加し、タップで電話発信
 *
 * 使い方:
 * 1. .env に MANAGER_PHONE と NURSE_PHONE を設定（例: 0312345678, 09012345678）
 * 2. node setup-rich-menu.js
 */

require('dotenv').config();
const { createCanvas, registerFont } = require('canvas');
const fs = require('fs');
const path = require('path');

// 日本語フォント（環境に応じてパスを試す）
const JP_FONT_PATHS = [
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  '/Library/Fonts/Arial Unicode.ttf',
  path.join(__dirname, 'fonts', 'NotoSansJP-Regular.ttf')
];
const JP_FONT_FAMILY = 'Arial Unicode MS';

const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const MANAGER_PHONE = (process.env.MANAGER_PHONE || '').replace(/\D/g, '');
const NURSE_PHONE = (process.env.NURSE_PHONE || '').replace(/\D/g, '');

if (!CHANNEL_ACCESS_TOKEN) {
  console.error('エラー: LINE_CHANNEL_ACCESS_TOKEN が .env に設定されていません');
  process.exit(1);
}

if (!MANAGER_PHONE || !NURSE_PHONE) {
  console.error('エラー: .env に MANAGER_PHONE と NURSE_PHONE を設定してください');
  console.error('  例: MANAGER_PHONE=0312345678');
  console.error('  例: NURSE_PHONE=09012345678');
  process.exit(1);
}

const RICH_MENU_SIZE = { width: 2500, height: 843 };
const COLOR_BLUE = '#1565c0';
const COLOR_GREEN = '#2e7d32';

function registerJapaneseFont() {
  for (const fontPath of JP_FONT_PATHS) {
    if (fs.existsSync(fontPath)) {
      registerFont(fontPath, { family: JP_FONT_FAMILY });
      return fontPath;
    }
  }
  console.warn('警告: 日本語フォントが見つかりません。フォントなしで描画します。');
}

async function createRichMenuImage() {
  registerJapaneseFont();

  const canvas = createCanvas(RICH_MENU_SIZE.width, RICH_MENU_SIZE.height);
  const ctx = canvas.getContext('2d');

  const halfWidth = RICH_MENU_SIZE.width / 2;

  // 左半分（青）
  ctx.fillStyle = COLOR_BLUE;
  ctx.fillRect(0, 0, halfWidth, RICH_MENU_SIZE.height);

  // 右半分（緑）
  ctx.fillStyle = COLOR_GREEN;
  ctx.fillRect(halfWidth, 0, halfWidth, RICH_MENU_SIZE.height);

  // テキスト描画（白）
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold 100px "${JP_FONT_FAMILY}"`;

  // 左: 呼び出し・管理者
  ctx.fillText('呼び出し・管理者', halfWidth / 2, RICH_MENU_SIZE.height / 2);

  // 右: 呼び出し・看護師
  ctx.fillText('呼び出し・看護師', halfWidth + halfWidth / 2, RICH_MENU_SIZE.height / 2);

  const imagePath = path.join(__dirname, 'rich-menu-temp.png');
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(imagePath, buffer);
  return imagePath;
}

async function setupRichMenu() {
  console.log('リッチメニュー画像を作成中...');
  const imagePath = await createRichMenuImage();

  const richMenuBody = {
    size: { width: RICH_MENU_SIZE.width, height: RICH_MENU_SIZE.height },
    selected: true,
    name: 'care-record-call-menu',
    chatBarText: 'メニュー',
    areas: [
      {
        bounds: { x: 0, y: 0, width: 1250, height: 843 },
        action: {
          type: 'uri',
          label: '呼び出し・管理者',
          uri: `tel:${MANAGER_PHONE}`
        }
      },
      {
        bounds: { x: 1250, y: 0, width: 1250, height: 843 },
        action: {
          type: 'uri',
          label: '呼び出し・看護師',
          uri: `tel:${NURSE_PHONE}`
        }
      }
    ]
  };

  console.log('リッチメニューをLINEに登録中...');

  const createRes = await fetch('https://api.line.me/v2/bot/richmenu', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(richMenuBody)
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    console.error('リッチメニュー作成エラー:', err);
    try { fs.unlinkSync(imagePath); } catch (_) {}
    process.exit(1);
  }

  const { richMenuId } = await createRes.json();
  console.log('リッチメニュー作成OK, ID:', richMenuId);

  const imageBuffer = fs.readFileSync(imagePath);
  const uploadRes = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`,
      'Content-Type': 'image/png'
    },
    body: imageBuffer
  });

  try { fs.unlinkSync(imagePath); } catch (_) {}

  if (!uploadRes.ok) {
    console.error('画像アップロードエラー:', await uploadRes.text());
    process.exit(1);
  }

  console.log('画像アップロードOK');

  const defaultRes = await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}` }
  });

  if (!defaultRes.ok) {
    console.error('デフォルト設定エラー:', await defaultRes.text());
    process.exit(1);
  }

  console.log('');
  console.log('✅ リッチメニュー設定完了！');
  console.log('  - 左: 呼び出し・管理者 →', MANAGER_PHONE);
  console.log('  - 右: 呼び出し・看護師 →', NURSE_PHONE);
  console.log('');
  console.log('LINEアプリでボットを開き、画面下部のメニューを確認してください。');
}

setupRichMenu().catch(e => {
  console.error(e);
  process.exit(1);
});
