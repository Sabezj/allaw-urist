import { jest } from '@jest/globals';

process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.USE_PY_SEARCH = 'false';

const mockChatCreate = jest.fn().mockResolvedValue({
  choices: [
    {
      message: {
        content: '{"confidence":0.9}',
        tool_calls: [
          { function: { name: 'search_products', arguments: '{"query_text":"лист"}' } }
        ]
      }
    }
  ]
});
const mockEmbedCreate = jest.fn().mockResolvedValue({ data: [{ embedding: [0, 0, 0] }] });

await jest.unstable_mockModule('openai', () => ({
  OpenAI: class {
    chat = { completions: { create: mockChatCreate } };
    embeddings = { create: mockEmbedCreate };
  }
}));
await jest.unstable_mockModule('pg', () => {
  const Pool = class {
    constructor() {}
    query = jest.fn().mockResolvedValue({ rows: [ { id:1, name:'лист', price_rub_m2:100, final_score: 0.9 } ] });
    connect = jest.fn().mockResolvedValue();
    end = jest.fn().mockResolvedValue();
    on = jest.fn();
  };
  return { default: { Pool }, Pool };
});
await jest.unstable_mockModule('pgvector/pg', () => ({ toSql: () => [0,0,0] }));
await jest.unstable_mockModule('redis', () => ({
  createClient: () => ({
    connect: jest.fn().mockResolvedValue(),
    on: jest.fn()
  })
}));

import request from 'supertest';
import jwt from 'jsonwebtoken';
const { app, server, pool } = await import('../server.js');

afterAll(async () => {
  await pool.end();
  server.close();
});

describe('API integration', () => {
  test('GET /api/products/search returns results', async () => {
    const res = await request(app)
      .get('/api/products/search')
      .query({ q: 'лист', mode: 'fuzzy' });
    expect(res.status).toBe(200);
    expect(mockEmbedCreate).toHaveBeenCalledWith(expect.objectContaining({ input: ['лист'] }));
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('POST /api/classify-intent returns tool call', async () => {
    const token = jwt.sign({ id: 1 }, process.env.JWT_SECRET || 'devsecret', {
      expiresIn: '1h'
    });
    const agent = request.agent(app);
    const csrf = await agent.get('/api/csrf-token');
    const res = await agent
      .post('/api/classify-intent')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', csrf.body.csrfToken)
      .send({ transcript: 'найди лист' });
    expect(res.status).toBe(200);
    expect(res.body.toolCall.function.name).toBe('search_products');
  });

  test('POST /api/classify-intent returns clarification fallback when no tool call', async () => {
    mockChatCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: '{"confidence":0.2,"clarification_question":"Уточните, пожалуйста, что именно нужно сделать."}'
          }
        }
      ]
    });
    const token = jwt.sign({ id: 1 }, process.env.JWT_SECRET || 'devsecret', {
      expiresIn: '1h'
    });
    const agent = request.agent(app);
    const csrf = await agent.get('/api/csrf-token');
    const res = await agent
      .post('/api/classify-intent')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', csrf.body.csrfToken)
      .send({ transcript: 'мне нужно вот это, но не знаю как сформулировать' });
    expect(res.status).toBe(200);
    expect(res.body.toolCall.function.name).toBe('clarify_intent');
    expect(res.body.meta.clarify).toBe(true);
  });

  test('POST /api/classify-intent detects detention scenario in lawvoice mode', async () => {
    const token = jwt.sign({ id: 1 }, process.env.JWT_SECRET || 'devsecret', {
      expiresIn: '1h'
    });
    const agent = request.agent(app);
    const csrf = await agent.get('/api/csrf-token');
    const res = await agent
      .post('/api/classify-intent')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', csrf.body.csrfToken)
      .send({ transcript: 'Меня задержали, что мне делать?', mode: 'lawvoice' });
    expect(res.status).toBe(200);
    expect(res.body.toolCall.function.name).toBe('detention_help');
  });

  test('POST /api/classify-intent handles noisy transcript with clarification', async () => {
    const token = jwt.sign({ id: 1 }, process.env.JWT_SECRET || 'devsecret', {
      expiresIn: '1h'
    });
    const agent = request.agent(app);
    const csrf = await agent.get('/api/csrf-token');
    const res = await agent
      .post('/api/classify-intent')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', csrf.body.csrfToken)
      .send({ transcript: 'ネンティフ', mode: 'lawvoice' });
    expect(res.status).toBe(200);
    expect(res.body.toolCall.function.name).toBe('clarify_intent');
    expect(res.body.meta.clarify).toBe(true);
  });

  test('GET /api/profiles returns array', async () => {
    const res = await request(app).get('/api/profiles');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
