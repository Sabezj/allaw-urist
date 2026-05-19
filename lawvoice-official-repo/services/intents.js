import { OpenAI } from 'openai';
import config from '../config.js';
import * as intentRules from './intentRules.js';
const { regexIntent } = intentRules;

const TOOL_ALIASES = {
  'smalltalk': '__smalltalk__',
  '__smalltalk__': '__smalltalk__',
  'products.search': 'search_products',
  'search.products': 'search_products',
  'pure': 'search_products',
  'products.details': 'get_product_details',
  'products.list': 'list_products',
  'products.categories': 'list_categories',
  'order.cancel': 'cancel_order',
  'delivery.estimate': 'estimate_delivery',
  'order.submit': 'checkout',
  'submit_order': 'checkout',
  'legal.help': 'legal_support_request',
  'help.legal': 'legal_support_request',
  'detention': 'detention_help',
  'detention.assist': 'detention_help',
  'cyberbullying': 'cyberbullying_help',
  'school.rights': 'school_rights_help',
  'online.purchase.rights': 'online_purchase_rights_help',
  'emergency': 'emergency_help',
  'farewell': 'goodbye',
  'clarify': 'clarify_intent',
  'no_data': 'clarify_intent',
  'unknown': 'clarify_intent'
};

const SUPPORTED_TOOLS = new Set([
  'search_products',
  'get_product_details',
  'list_products',
  'list_categories',
  'estimate_delivery',
  'cancel_order',
  'add_to_cart',
  'checkout',
  'view_cart',
  'legal_support_request',
  'detention_help',
  'cyberbullying_help',
  'school_rights_help',
  'online_purchase_rights_help',
  'emergency_help',
  'goodbye',
  'clarify_intent',
  '__smalltalk__'
]);

const DEFAULT_CLARIFY_REPLY = 'Я рядом. Уточните, пожалуйста: это про задержание, кибербуллинг, школу или покупку в интернете?';
const DEFAULT_SMALLTALK_REPLY = 'Да, на связи. Чем помочь?';
const DEFAULT_GOODBYE_REPLY = 'Я на связи, если снова понадобится помощь. Берегите себя.';

const LAWVOICE_SCENARIO_HINTS = {
  detention_help: 'detention',
  cyberbullying_help: 'cyberbullying',
  school_rights_help: 'school',
  online_purchase_rights_help: 'online_purchase',
  emergency_help: 'safety_emergency',
  legal_support_request: 'general_legal'
};

function extractLawVoiceSlots(text = '') {
  const src = String(text || '');
  const lowered = src.toLowerCase();
  const urgencyHigh = /(срочн|прямо\s*сейчас|немедлен|опасно|угрож|боюсь|страшно|помогите)/i.test(lowered);
  const policeMentioned = /(полици|задерж|отдел|мусор|протокол|адвокат)/i.test(lowered);
  const violenceMentioned = /(бьют|избил|насили|напал|угрожают\s+убить|вымог|шантаж)/i.test(lowered);
  const intimateLeakMentioned = /(интим|фото|видео|слив|распростран)/i.test(lowered);
  const schoolMentioned = /(школ|учител|директор|класс|однокласс)/i.test(lowered);
  const onlineMentioned = /(интернет|маркетплейс|заказ|покупк|товар|чек|доставк|возврат)/i.test(lowered);
  const cyberMentioned = /(кибербуллинг|травл|буллинг|чат|соцсет|аккаунт|взлом|переписк)/i.test(lowered);
  return {
    query_text: src,
    urgency: urgencyHigh ? 'high' : 'normal',
    police_mentioned: policeMentioned,
    violence_mentioned: violenceMentioned,
    intimate_leak_mentioned: intimateLeakMentioned,
    school_mentioned: schoolMentioned,
    online_mentioned: onlineMentioned,
    cyber_mentioned: cyberMentioned
  };
}

function looksLikeNoisyTranscript(text = '') {
  const cleaned = String(text || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  if (!cleaned) return true;
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 1 && cleaned.length <= 2) return true;
  const hasCyr = /[а-яё]/i.test(cleaned);
  const hasLat = /[a-z]/i.test(cleaned);
  if (!hasCyr && !hasLat && cleaned.length < 8) return true;
  return false;
}

function buildLawVoiceRuleResult(intent, transcript, confidence = 0.92, extra = {}) {
  const slots = extractLawVoiceSlots(transcript);
  return {
    intent,
    confidence,
    ...slots,
    scenario: LAWVOICE_SCENARIO_HINTS[intent] || 'general_legal',
    ...extra
  };
}

function detectLawVoiceRule(transcript = '') {
  const lowered = String(transcript || '').toLowerCase();
  if (!lowered.trim()) return null;

  if (/(пока|до\s*свид|бай|bye|goodbye|tchau|чао|увидимся)/i.test(lowered)) {
    return buildLawVoiceRuleResult('goodbye', transcript, 0.98);
  }

  if (/(угрож|опасно|меня\s*бьют|насили|шантаж|вымог|слив.*интим|преследуют|убить)/i.test(lowered)) {
    return buildLawVoiceRuleResult('emergency_help', transcript, 0.99, { risk_level: 'high' });
  }

  if (/(задерж\w*|полици|отдел|доставили|протокол|адвокат|мусора)/i.test(lowered)) {
    return buildLawVoiceRuleResult('detention_help', transcript, 0.98, { risk_level: 'high' });
  }

  if (/(кибербуллинг|буллинг|травл|унижают|оскорбля|чат|соцсет|аккаунт|взлом|слив)/i.test(lowered)) {
    return buildLawVoiceRuleResult('cyberbullying_help', transcript, 0.97, { risk_level: 'medium' });
  }

  if (/(школ|учител|директор|класс|однокласс|дневник|отчисл|на уроке|в школе)/i.test(lowered)) {
    return buildLawVoiceRuleResult('school_rights_help', transcript, 0.95, { risk_level: 'medium' });
  }

  if (/(покупк|интернет.?магазин|маркетплейс|заказ|доставк|возврат|чек|продавец|брак)/i.test(lowered)) {
    return buildLawVoiceRuleResult('online_purchase_rights_help', transcript, 0.93, { risk_level: 'low' });
  }

  if (/(мне\s*нужна\s*помощь|помоги|нужен\s*совет|юридическ|консультац|что\s*делать|как\s*быть)/i.test(lowered)) {
    return buildLawVoiceRuleResult('legal_support_request', transcript, 0.92, { risk_level: 'medium' });
  }

  if (/(привет|здравств|добрый|hello|hi|ты\s*здесь|на\s*связи)/i.test(lowered)) {
    return { intent: 'smalltalk', confidence: 0.95, reply: DEFAULT_SMALLTALK_REPLY };
  }

  return null;
}

const openai = new OpenAI({ apiKey: config.get('openai.apiKey') });

function normalizeToolName(name) {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const lowered = trimmed.toLowerCase();
  return TOOL_ALIASES[trimmed] || TOOL_ALIASES[lowered] || lowered;
}

function clampConfidence(raw, fallback = 0.5) {
  if (!Number.isFinite(raw)) return fallback;
  if (raw < 0) return 0;
  if (raw > 1) return 1;
  return raw;
}

function safeParseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    const fromFence = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fromFence?.[1]) {
      try {
        return JSON.parse(fromFence[1].trim());
      } catch {
        return null;
      }
    }
    return null;
  }
}

function serializeArgs(args) {
  if (typeof args === 'string') {
    const parsed = safeParseJson(args);
    if (parsed && typeof parsed === 'object') return JSON.stringify(parsed);
    return JSON.stringify({});
  }
  if (args && typeof args === 'object') return JSON.stringify(args);
  return JSON.stringify({});
}

function buildToolCall(name, args = {}, id = 'intent_router') {
  return {
    id,
    type: 'function',
    function: {
      name,
      arguments: serializeArgs(args)
    }
  };
}

function buildClarification({
  transcript = '',
  reason = 'unknown',
  question = '',
  guessedIntent = null,
  confidence = 0.25
} = {}) {
  const reply = question || DEFAULT_CLARIFY_REPLY;
  return {
    toolCall: buildToolCall('clarify_intent', {
      question: reply,
      original_text: transcript || '',
      guessed_intent: guessedIntent
    }, 'clarify_fallback'),
    confidence: clampConfidence(confidence, 0.25),
    meta: {
      clarify: true,
      reason,
      reply,
      guessedIntent
    }
  };
}

function buildSmalltalk(confidence = 0.95, reply = DEFAULT_SMALLTALK_REPLY) {
  return {
    toolCall: null,
    confidence: clampConfidence(confidence, 0.95),
    meta: {
      smalltalk: true,
      reply: reply || DEFAULT_SMALLTALK_REPLY
    }
  };
}

function parseArgs(rawArgs) {
  if (rawArgs && typeof rawArgs === 'object') return rawArgs;
  const parsed = safeParseJson(rawArgs);
  if (parsed && typeof parsed === 'object') return parsed;
  return {};
}

function buildToolFromContent(contentJson) {
  if (!contentJson || typeof contentJson !== 'object') return null;
  const intentName = normalizeToolName(contentJson.intent || contentJson.tool || contentJson.name);
  if (!intentName) return null;
  const args = contentJson.arguments || contentJson.args || contentJson.params || {};
  return buildToolCall(intentName, args, 'llm_content_intent');
}

export function parseIntent(message, transcript = '') {
  const contentJson = safeParseJson(message?.content);
  const confidence = clampConfidence(contentJson?.confidence, 0.5);
  const explicitClarifyQuestion = contentJson?.clarification_question || contentJson?.question || contentJson?.reply;
  let toolCall = message?.tool_calls?.[0] || null;

  if (!toolCall) {
    toolCall = buildToolFromContent(contentJson);
  }

  const contentIntent = normalizeToolName(contentJson?.intent);
  if (contentIntent === '__smalltalk__') {
    return buildSmalltalk(confidence, contentJson?.reply);
  }

  if (!toolCall) {
    return buildClarification({
      transcript,
      reason: 'llm_no_tool',
      question: explicitClarifyQuestion,
      guessedIntent: contentJson?.guessed_intent || contentJson?.candidate_intent,
      confidence
    });
  }

  if (!toolCall.function) {
    return buildClarification({
      transcript,
      reason: 'invalid_tool_schema',
      question: explicitClarifyQuestion,
      confidence
    });
  }

  const normalizedName = normalizeToolName(toolCall.function.name);
  if (!normalizedName) {
    return buildClarification({
      transcript,
      reason: 'missing_tool_name',
      question: explicitClarifyQuestion,
      confidence
    });
  }

  if (normalizedName === '__smalltalk__') {
    return buildSmalltalk(confidence, contentJson?.reply);
  }

  if (!SUPPORTED_TOOLS.has(normalizedName)) {
    return buildClarification({
      transcript,
      reason: 'unsupported_tool',
      guessedIntent: normalizedName,
      question: explicitClarifyQuestion,
      confidence
    });
  }

  const parsedArgs = parseArgs(toolCall.function.arguments);
  if (normalizedName === 'clarify_intent') {
    return buildClarification({
      transcript,
      reason: 'model_clarify',
      question: parsedArgs.question || explicitClarifyQuestion,
      guessedIntent: parsedArgs.guessed_intent || parsedArgs.guessedIntent,
      confidence
    });
  }

  if (normalizedName === 'search_products' && !parsedArgs.query_text) {
    parsedArgs.query_text = transcript || '';
  }

  return {
    toolCall: buildToolCall(normalizedName, parsedArgs, toolCall.id || 'llm_tool_call'),
    confidence,
    meta: {
      source: 'llm'
    }
  };
}

export async function classifyIntent(transcript, options = {}) {
  const normalizedTranscript = typeof transcript === 'string' ? transcript.trim() : '';
  const rawMode = typeof options?.mode === 'string' ? options.mode.toLowerCase().trim() : 'auto';
  const mode = rawMode === 'lawvoice' || rawMode === 'commerce' ? rawMode : 'auto';
  console.debug('🎯 classifyIntent called', { transcript: normalizedTranscript, mode });

  if (!normalizedTranscript) {
    return buildClarification({
      transcript: '',
      reason: 'empty_input',
      question: 'Я не расслышал запрос. Повторите, пожалуйста, что нужно сделать.',
      confidence: 0
    });
  }

  if (looksLikeNoisyTranscript(normalizedTranscript)) {
    return buildClarification({
      transcript: normalizedTranscript,
      reason: 'noisy_transcript',
      question: 'Похоже, фраза распознана нечетко. Повторите, пожалуйста, простыми словами, что случилось.',
      confidence: 0.1
    });
  }

  const allowLaw = mode !== 'commerce';
  const allowCommerce = mode !== 'lawvoice';

  /* 1) LawVoice rules */
  if (allowLaw) {
    const lawRule = detectLawVoiceRule(normalizedTranscript);
    if (lawRule) {
      if (lawRule.intent === 'smalltalk') {
        return buildSmalltalk(lawRule.confidence || 0.95, lawRule.reply);
      }
      const lawIntent = normalizeToolName(lawRule.intent);
      if (!lawIntent || !SUPPORTED_TOOLS.has(lawIntent)) {
        return buildClarification({
          transcript: normalizedTranscript,
          reason: 'law_rule_unknown_intent',
          guessedIntent: lawIntent,
          confidence: clampConfidence(lawRule.confidence, 0.4)
        });
      }
      const { intent, confidence, ...rest } = lawRule;
      return {
        toolCall: buildToolCall(lawIntent, rest, 'law_rule_based'),
        confidence: clampConfidence(confidence, 0.92),
        meta: {
          source: 'law_rules',
          scenario: LAWVOICE_SCENARIO_HINTS[lawIntent] || 'general_legal'
        }
      };
    }
  }

  /* 2) Commerce rules */
  if (allowCommerce) {
    const ruleHit = typeof regexIntent === 'function' ? regexIntent(normalizedTranscript) : null;
    if (ruleHit) {
      const ruleName = normalizeToolName(ruleHit.intent || ruleHit.name || ruleHit);
      if (ruleName === '__smalltalk__') {
        return buildSmalltalk(0.99);
      }
      if (!ruleName || !SUPPORTED_TOOLS.has(ruleName)) {
        return buildClarification({
          transcript: normalizedTranscript,
          reason: 'rule_unknown_intent',
          guessedIntent: ruleName,
          confidence: clampConfidence(ruleHit.confidence, 0.4)
        });
      }
      const { intent, name, confidence, ...rest } = ruleHit;
      return {
        toolCall: buildToolCall(ruleName, rest, 'rule_based'),
        confidence: clampConfidence(confidence, 0.9),
        meta: {
          source: 'commerce_rules'
        }
      };
    }
  }

  console.debug('🔁 No rule hit, calling LLM');
  try {
    const commerceTools = [
      {
        type: 'function',
        function: {
          name: 'search_products',
          parameters: {
            type: 'object',
            properties: {
              query_text: { type: 'string', description: 'Оригинальный текст запроса' },
              limit: { type: 'number', description: 'Сколько результатов вернуть', default: 20 },
              attrs: {
                type: 'object',
                description: 'Фильтры (толщина, покрытие, профиль и т.д.)',
                additionalProperties: { type: 'string' }
              }
            },
            required: ['query_text']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'get_product_details',
          parameters: {
            type: 'object',
            properties: { product_id: { type: 'number' } },
            required: ['product_id']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'list_products',
          parameters: {
            type: 'object',
            properties: {
              limit: { type: 'number', description: 'Сколько товаров перечислить', default: 10 }
            }
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'list_categories',
          parameters: {
            type: 'object',
            properties: {}
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'estimate_delivery',
          parameters: {
            type: 'object',
            properties: { order_id: { type: 'string' } },
            required: ['order_id']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'cancel_order',
          parameters: {
            type: 'object',
            properties: { order_id: { type: 'string' } },
            required: ['order_id']
          }
        }
      }
    ];

    const lawVoiceTools = [
      {
        type: 'function',
        function: {
          name: 'legal_support_request',
          parameters: {
            type: 'object',
            properties: {
              query_text: { type: 'string' },
              scenario: { type: 'string' },
              urgency: { type: 'string', enum: ['low', 'normal', 'high'] }
            },
            required: ['query_text']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'detention_help',
          parameters: {
            type: 'object',
            properties: {
              query_text: { type: 'string' },
              urgency: { type: 'string', enum: ['normal', 'high'] },
              risk_level: { type: 'string', enum: ['medium', 'high'] }
            },
            required: ['query_text']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'cyberbullying_help',
          parameters: {
            type: 'object',
            properties: {
              query_text: { type: 'string' },
              platform: { type: 'string' },
              evidence_available: { type: 'boolean' }
            },
            required: ['query_text']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'school_rights_help',
          parameters: {
            type: 'object',
            properties: {
              query_text: { type: 'string' },
              role: { type: 'string' }
            },
            required: ['query_text']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'online_purchase_rights_help',
          parameters: {
            type: 'object',
            properties: {
              query_text: { type: 'string' },
              order_stage: { type: 'string' }
            },
            required: ['query_text']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'emergency_help',
          parameters: {
            type: 'object',
            properties: {
              query_text: { type: 'string' },
              risk_level: { type: 'string', enum: ['high'] }
            },
            required: ['query_text']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'goodbye',
          parameters: {
            type: 'object',
            properties: {
              query_text: { type: 'string' }
            },
            required: []
          }
        }
      }
    ];

    const commonTools = [
      {
        type: 'function',
        function: {
          name: 'clarify_intent',
          parameters: {
            type: 'object',
            properties: {
              question: { type: 'string', description: 'Короткий уточняющий вопрос пользователю' },
              guessed_intent: { type: 'string', description: 'Наиболее вероятный интент, если есть' }
            },
            required: ['question']
          }
        }
      }
    ];

    const tools =
      mode === 'lawvoice'
        ? [...lawVoiceTools, ...commonTools]
        : mode === 'commerce'
          ? [...commerceTools, ...commonTools]
          : [...lawVoiceTools, ...commerceTools, ...commonTools];

    const routingHint =
      mode === 'lawvoice'
        ? 'Режим lawvoice: приоритет правовым и кризисным интентам подростка.'
        : mode === 'commerce'
          ? 'Режим commerce: приоритет товарным/каталожным интентам.'
          : 'Режим auto: выбирай правовые интенты для социально-правовых запросов и commerce-интенты для товарных.';

    const response = await openai.chat.completions.create({
      model: config.get('openai.intentModel'),
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: `
Ты production intent-router для голосового ассистента.
Цель: выдать одно действие и не оставлять пользователя без ответа.

${routingHint}

Правила:
1) Если запрос однозначный, вызови ровно один tool.
2) Для приветствия/контактной проверки верни JSON: {"intent":"smalltalk","confidence":0..1,"reply":"..."}.
3) Если интент неясен, верни clarify_intent с коротким вопросом.
4) Для правовых ситуаций (задержание, кибербуллинг, школа, помощь) выбирай lawvoice tools.
5) Для запросов о товарах/каталоге выбирай commerce tools.
6) В content всегда верни валидный JSON с confidence.
`
        },
        { role: 'user', content: normalizedTranscript }
      ],
      tools,
      tool_choice: 'auto'
    });

    const message = response.choices[0]?.message || {};
    console.debug('📨 LLM intent response', message);
    const parsed = parseIntent(message, normalizedTranscript);

    if (parsed.toolCall?.function?.name === 'goodbye' && !parsed.meta?.reply) {
      return {
        ...parsed,
        meta: {
          ...(parsed.meta || {}),
          reply: DEFAULT_GOODBYE_REPLY
        }
      };
    }

    return parsed;
  } catch (error) {
    console.error('Intent LLM call failed:', error);
    return buildClarification({
      transcript: normalizedTranscript,
      reason: 'llm_error',
      question: 'Сейчас не смог точно распознать запрос. Коротко уточните, что случилось и какая помощь нужна.',
      confidence: 0.1
    });
  }
}
