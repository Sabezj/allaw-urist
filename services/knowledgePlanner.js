function tryParseJson(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;

  try {
    return JSON.parse(raw);
  } catch {
    const fromFence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (!fromFence?.[1]) return null;
    try {
      return JSON.parse(fromFence[1].trim());
    } catch {
      return null;
    }
  }
}

function ensureString(value, fallback = '') {
  if (typeof value === 'string') return value.trim();
  if (value == null) return fallback;
  return String(value).trim();
}

function estimateTokens(text = '') {
  // Practical rough estimate for RU/EN mixed text.
  return Math.max(1, Math.ceil(String(text).length / 4));
}

function decodeBase64Utf8(input = '') {
  try {
    return Buffer.from(String(input), 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

export function normalizeKnowledgeDocumentPayload(payload = {}) {
  const title = ensureString(payload.title || payload.name || payload.filename, 'Документ');
  const sourceName = ensureString(payload.source_name || payload.sourceName || payload.filename || title, title);
  const mimeType = ensureString(payload.mime_type || payload.mimeType || 'text/plain', 'text/plain');
  const tagsRaw = Array.isArray(payload.tags) ? payload.tags : [];
  const tags = tagsRaw.map(tag => ensureString(tag)).filter(Boolean).slice(0, 25);

  const content =
    ensureString(payload.content) ||
    ensureString(payload.text) ||
    decodeBase64Utf8(payload.content_base64 || payload.contentBase64);

  const normalized = content
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    title,
    sourceName,
    mimeType,
    tags,
    content: normalized
  };
}

export function splitTextIntoChunks(text, options = {}) {
  const source = ensureString(text);
  if (!source) return [];

  const maxChars = Number(options.maxChars || 1400);
  const overlapChars = Number(options.overlapChars || 180);
  const minChunkChars = Number(options.minChunkChars || 260);

  const chunks = [];
  let cursor = 0;
  while (cursor < source.length) {
    let end = Math.min(cursor + maxChars, source.length);
    if (end < source.length) {
      // Prefer splitting on sentence boundary within the window.
      const windowText = source.slice(cursor, end);
      const splitPoint = Math.max(
        windowText.lastIndexOf('. '),
        windowText.lastIndexOf('! '),
        windowText.lastIndexOf('? '),
        windowText.lastIndexOf('\n')
      );
      if (splitPoint >= minChunkChars) {
        end = cursor + splitPoint + 1;
      }
    }

    const chunk = source.slice(cursor, end).trim();
    if (chunk.length >= Math.min(40, minChunkChars)) {
      chunks.push(chunk);
    }

    if (end >= source.length) break;
    cursor = Math.max(cursor + 1, end - overlapChars);
  }

  return chunks;
}

function normalizeConstraintList(constraints) {
  if (!Array.isArray(constraints)) return [];
  return constraints
    .map(item => ensureString(item))
    .filter(Boolean)
    .slice(0, 20);
}

function normalizeCurrentPlan(currentPlan) {
  if (!Array.isArray(currentPlan)) return [];
  return currentPlan
    .map((step, index) => {
      const action = ensureString(step?.action || step?.title || step?.step);
      const rationale = ensureString(step?.rationale || step?.reason || step?.note);
      const status = ensureString(step?.status || 'todo').toLowerCase();
      if (!action) return null;
      return {
        id: ensureString(step?.id || `step_${index + 1}`),
        action,
        rationale,
        status: ['todo', 'in_progress', 'done'].includes(status) ? status : 'todo'
      };
    })
    .filter(Boolean)
    .slice(0, 20);
}

function coerceEvidenceIds(rawIds, allowedIds) {
  if (!Array.isArray(rawIds)) return [];
  const allowed = new Set(allowedIds);
  const result = [];
  for (const item of rawIds) {
    const num = Number(item);
    if (!Number.isInteger(num)) continue;
    if (!allowed.has(num)) continue;
    if (!result.includes(num)) result.push(num);
  }
  return result;
}

function fallbackPlan({ objective, contextText, knowledgeHits, currentPlan }) {
  const summaryBase = objective || contextText || 'Сформирован рабочий план действий.';
  if (currentPlan.length > 0) {
    return {
      summary: `План скорректирован: ${summaryBase.slice(0, 180)}`,
      steps: currentPlan.map((step, index) => ({
        id: step.id || `step_${index + 1}`,
        action: step.action,
        rationale: step.rationale || 'Сохранён из текущего плана. Требуется уточнение по контексту.',
        evidence_ids: [],
        status: step.status || 'todo'
      }))
    };
  }

  const topHit = knowledgeHits[0];
  const evidenceIds = topHit?.chunk_id ? [topHit.chunk_id] : [];
  return {
    summary: `Черновой план: ${summaryBase.slice(0, 180)}`,
    steps: [
      {
        id: 'step_1',
        action: 'Уточнить ключевые факты и ограничения ситуации.',
        rationale: topHit
          ? `Основано на документе "${topHit.document_title || 'источник'}".`
          : 'Недостаточно знаний в базе, нужен дополнительный контекст.',
        evidence_ids: evidenceIds,
        status: 'todo'
      },
      {
        id: 'step_2',
        action: 'Сформировать безопасный и юридически корректный следующий шаг.',
        rationale: 'Шаг обязателен для перевода ситуации в управляемое состояние.',
        evidence_ids: evidenceIds,
        status: 'todo'
      }
    ]
  };
}

export async function buildGroundedActionPlan({
  openai,
  model,
  objective = '',
  contextText = '',
  constraints = [],
  currentPlan = [],
  knowledgeHits = []
}) {
  const objectiveNorm = ensureString(objective);
  const contextNorm = ensureString(contextText);
  const constraintsNorm = normalizeConstraintList(constraints);
  const currentPlanNorm = normalizeCurrentPlan(currentPlan);
  const allowedEvidenceIds = knowledgeHits
    .map(hit => Number(hit.chunk_id))
    .filter(id => Number.isInteger(id));

  if (!openai || !model) {
    return {
      ...fallbackPlan({
        objective: objectiveNorm,
        contextText: contextNorm,
        knowledgeHits,
        currentPlan: currentPlanNorm
      }),
      mode: currentPlanNorm.length > 0 ? 'corrected' : 'draft'
    };
  }

  const promptPayload = {
    objective: objectiveNorm,
    context: contextNorm,
    constraints: constraintsNorm,
    current_plan: currentPlanNorm,
    knowledge_hits: knowledgeHits.map(hit => ({
      chunk_id: hit.chunk_id,
      document_id: hit.document_id,
      document_title: hit.document_title,
      relevance: hit.relevance,
      excerpt: hit.excerpt
    }))
  };

  try {
    const completion = await openai.chat.completions.create({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `
Ты модуль планирования действий с опорой на подтвержденные знания.
Верни ТОЛЬКО JSON вида:
{
  "summary": "краткое резюме",
  "steps": [
    {
      "id": "step_1",
      "action": "конкретное действие",
      "rationale": "почему это действие обосновано",
      "evidence_ids": [123, 456],
      "status": "todo|in_progress|done"
    }
  ]
}

Требования:
1) Каждый шаг должен быть применимым и конкретным.
2) В rationale привязывай шаг к контексту и знаниям.
3) В evidence_ids включай ТОЛЬКО chunk_id из knowledge_hits.
4) Если current_plan не пустой, это режим корректировки: улучши/обнови существующие шаги, сохраняя полезные пункты.
5) Не выдумывай источники, которых нет в knowledge_hits.
`
        },
        {
          role: 'user',
          content: JSON.stringify(promptPayload)
        }
      ]
    });

    const raw = completion.choices?.[0]?.message?.content || '{}';
    const parsed = tryParseJson(raw);
    if (!parsed || typeof parsed !== 'object') {
      const fb = fallbackPlan({
        objective: objectiveNorm,
        contextText: contextNorm,
        knowledgeHits,
        currentPlan: currentPlanNorm
      });
      return {
        ...fb,
        mode: currentPlanNorm.length > 0 ? 'corrected' : 'draft'
      };
    }

    const summary = ensureString(parsed.summary, 'Сформирован план действий.');
    const rawSteps = Array.isArray(parsed.steps) ? parsed.steps : [];
    const steps = rawSteps
      .map((step, index) => {
        const action = ensureString(step?.action || step?.title || step?.step);
        const rationale = ensureString(step?.rationale || step?.reason);
        if (!action) return null;
        const status = ensureString(step?.status || 'todo').toLowerCase();
        return {
          id: ensureString(step?.id || `step_${index + 1}`),
          action,
          rationale: rationale || 'Обоснование сформировано на основе контекста.',
          evidence_ids: coerceEvidenceIds(step?.evidence_ids, allowedEvidenceIds),
          status: ['todo', 'in_progress', 'done'].includes(status) ? status : 'todo'
        };
      })
      .filter(Boolean)
      .slice(0, 20);

    if (steps.length === 0) {
      const fb = fallbackPlan({
        objective: objectiveNorm,
        contextText: contextNorm,
        knowledgeHits,
        currentPlan: currentPlanNorm
      });
      return {
        ...fb,
        mode: currentPlanNorm.length > 0 ? 'corrected' : 'draft'
      };
    }

    return {
      summary,
      steps,
      mode: currentPlanNorm.length > 0 ? 'corrected' : 'draft'
    };
  } catch {
    const fb = fallbackPlan({
      objective: objectiveNorm,
      contextText: contextNorm,
      knowledgeHits,
      currentPlan: currentPlanNorm
    });
    return {
      ...fb,
      mode: currentPlanNorm.length > 0 ? 'corrected' : 'draft'
    };
  }
}

export { estimateTokens };
