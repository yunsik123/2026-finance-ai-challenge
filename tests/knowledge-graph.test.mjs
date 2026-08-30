import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoleKnowledgeGraph, answerRoleProcessQuestion, isRoleProcessQuestion, serializeKnowledgeGraph } from '../src/knowledge-graph.js';

test('투자자 지식그래프는 참여부터 회수까지 순서가 연결된다', () => {
  const graph = buildRoleKnowledgeGraph({ role: 'investor' });
  assert.equal(graph.role, 'investor');
  assert.equal(graph.nodes.filter(item => item.type === 'GuideStep').length, 7);
  assert.match(answerRoleProcessQuestion('어떤 식으로 투자해?', graph), /위험 동의 후 참여/);
});

test('개별 투자 위험 질문은 절차 답변으로 가로채지 않는다', () => {
  assert.equal(isRoleProcessQuestion('이 투자에서 가장 큰 위험은?'), false);
  assert.equal(isRoleProcessQuestion('투자 방법을 순서대로 알려줘'), true);
});

test('소상공인 지식그래프는 재무 주장과 문서 검증을 분리한다', () => {
  const graph = buildRoleKnowledgeGraph({ role: 'owner' });
  const answer = answerRoleProcessQuestion('등록하려면 무엇을 준비해서 업로드해?', graph);
  assert.match(answer, /근거자료 업로드/);
  assert.match(answer, /운영자 원본 확인/);
  assert.match(serializeKnowledgeGraph(graph, '재무 문서'), /owner:documents/);
});
