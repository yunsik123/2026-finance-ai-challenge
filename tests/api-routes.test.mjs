import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const config = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

test('모든 AI 화면 경로가 서버리스 모드로 연결된다', () => {
  const routes = new Map(config.rewrites.map(item => [item.source, item.destination]));
  assert.equal(routes.get('/api/ai/chat'), '/api/ai?mode=chat');
  assert.equal(routes.get('/api/ai/ocr'), '/api/ai?mode=ocr');
  assert.equal(routes.get('/api/ai/financial-verify'), '/api/ai?mode=financial-verify');
  assert.equal(routes.get('/api/ai/story-generator'), '/api/ai?mode=story-generator');
});
