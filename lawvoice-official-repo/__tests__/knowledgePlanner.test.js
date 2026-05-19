import { describe, expect, jest, test } from '@jest/globals';
import {
  buildGroundedActionPlan,
  estimateTokens,
  normalizeKnowledgeDocumentPayload,
  splitTextIntoChunks
} from '../services/knowledgePlanner.js';

describe('knowledgePlanner', () => {
  test('normalizes document payload from base64 content', () => {
    const payload = {
      title: '  Мой документ  ',
      content_base64: Buffer.from('Первая строка\r\n\r\nВторая строка', 'utf-8').toString('base64'),
      tags: [' law ', '', null, 'urgent'],
      mime_type: 'text/plain'
    };

    const normalized = normalizeKnowledgeDocumentPayload(payload);
    expect(normalized.title).toBe('Мой документ');
    expect(normalized.sourceName).toBe('Мой документ');
    expect(normalized.mimeType).toBe('text/plain');
    expect(normalized.tags).toEqual(['law', 'urgent']);
    expect(normalized.content).toBe('Первая строка\n\nВторая строка');
  });

  test('splits text into multiple chunks', () => {
    const text = `${'A'.repeat(950)}. ${'B'.repeat(950)}. ${'C'.repeat(950)}.`;
    const chunks = splitTextIntoChunks(text, {
      maxChars: 1000,
      overlapChars: 120,
      minChunkChars: 200
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(chunk => chunk.length >= 40)).toBe(true);
  });

  test('returns fallback corrected plan when model is not available', async () => {
    const plan = await buildGroundedActionPlan({
      openai: null,
      model: '',
      objective: 'Сформировать порядок действий',
      contextText: 'Есть запрос от пользователя',
      constraints: ['Не давать неподтвержденные советы'],
      currentPlan: [
        {
          id: 'step_1',
          action: 'Уточнить факты',
          rationale: 'Без фактов нельзя продолжать',
          status: 'todo'
        }
      ],
      knowledgeHits: []
    });

    expect(plan.mode).toBe('corrected');
    expect(plan.steps.length).toBe(1);
    expect(plan.steps[0].action).toBe('Уточнить факты');
  });

  test('keeps only allowed evidence ids from model output', async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: 'Обновленный план',
              steps: [
                {
                  id: 'step_1',
                  action: 'Проверить обстоятельства',
                  rationale: 'Основано на знаниях',
                  evidence_ids: [101, 999, 102, 'bad'],
                  status: 'todo'
                }
              ]
            })
          }
        }
      ]
    });
    const openai = {
      chat: {
        completions: {
          create: mockCreate
        }
      }
    };

    const plan = await buildGroundedActionPlan({
      openai,
      model: 'gpt-4o-mini',
      objective: 'Нужно составить безопасный план',
      contextText: 'Пользователь просит юридическую консультацию',
      constraints: [],
      currentPlan: [],
      knowledgeHits: [
        { chunk_id: 101, document_id: 'doc_1', document_title: 'Документ 1', excerpt: 'Факт 1' },
        { chunk_id: 102, document_id: 'doc_2', document_title: 'Документ 2', excerpt: 'Факт 2' }
      ]
    });

    expect(mockCreate).toHaveBeenCalled();
    expect(plan.mode).toBe('draft');
    expect(plan.summary).toBe('Обновленный план');
    expect(plan.steps[0].evidence_ids).toEqual([101, 102]);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcdefgh')).toBe(2);
  });
});
