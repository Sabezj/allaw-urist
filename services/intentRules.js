// intentRules.js – rule‑based fast intent detection (≈40+ шаблонов)

// Возвращаем структуру { intent: '...', ...extraArgs, confidence: 0.9 }

const RULES = [
  // ---------- поиск товаров (по ключу) ----------
  { re: /плоск.*лист/i,                                             intent: 'search_products', args: q => ({ query_text: q }) },
  { re: /оцинк[\w\s]*лист/i,                                      intent: 'search_products', args: q => ({ query_text: q, attrs: { тип: 'оцинкованный' } }) },
  { re: /алюмоцинк[\w\s]*лист/i,                                  intent: 'search_products', args: q => ({ query_text: q, attrs: { тип: 'алюмоцинк' } }) },
  { re: /цветн[\w\s]*лист/i,                                      intent: 'search_products', args: q => ({ query_text: q, attrs: { покрытие: 'цветной' } }) },
  { re: /\bС-8\b/i,                                                intent: 'search_products', args: q => ({ query_text: q, attrs: { профиль: 'С-8' } }) },
  { re: /\bС-21\b/i,                                               intent: 'search_products', args: q => ({ query_text: q, attrs: { профиль: 'С-21' } }) },
  { re: /\bС-44\b/i,                                               intent: 'search_products', args: q => ({ query_text: q, attrs: { профиль: 'С-44' } }) },
  { re: /\bНС-35\b/i,                                              intent: 'search_products', args: q => ({ query_text: q, attrs: { профиль: 'НС-35' } }) },
  { re: /\bН-60\b/i,                                               intent: 'search_products', args: q => ({ query_text: q, attrs: { профиль: 'Н-60' } }) },
  { re: /\bН-75\b/i,                                               intent: 'search_products', args: q => ({ query_text: q, attrs: { профиль: 'Н-75' } }) },
  { re: /\bН-114\b/i,                                              intent: 'search_products', args: q => ({ query_text: q, attrs: { профиль: 'Н-114' } }) },
  { re: /\bМП-10\b/i,                                              intent: 'search_products', args: q => ({ query_text: q, attrs: { профиль: 'МП-10' } }) },
  { re: /\bМП-18\b/i,                                              intent: 'search_products', args: q => ({ query_text: q, attrs: { профиль: 'МП-18' } }) },
  { re: /\bМП-20\b/i,                                              intent: 'search_products', args: q => ({ query_text: q, attrs: { профиль: 'МП-20' } }) },
  { re: /\bМП-35\b/i,                                              intent: 'search_products', args: q => ({ query_text: q, attrs: { профиль: 'МП-35' } }) },
  { re: /\bPL\d{2,}\b/i,                                          intent: 'search_products', args: q => ({ query_text: q }) }, // generic pattern for SKU-like

  // ---------- толщина листа ----------
  { re: /0[.,]?4\s*мм/i,                                           intent: 'search_products', args: q => ({ query_text: q, attrs: { толщина: '0.4' } }) },
  { re: /0[.,]?45\s*мм/i,                                          intent: 'search_products', args: q => ({ query_text: q, attrs: { толщина: '0.45' } }) },
  { re: /0[.,]?5\s*мм/i,                                           intent: 'search_products', args: q => ({ query_text: q, attrs: { толщина: '0.5' } }) },
  { re: /0[.,]?55\s*мм/i,                                          intent: 'search_products', args: q => ({ query_text: q, attrs: { толщина: '0.55' } }) },
  { re: /0[.,]?6\s*мм/i,                                           intent: 'search_products', args: q => ({ query_text: q, attrs: { толщина: '0.6' } }) },
  { re: /0[.,]?65\s*мм/i,                                          intent: 'search_products', args: q => ({ query_text: q, attrs: { толщина: '0.65' } }) },
  { re: /0[.,]?7\s*мм/i,                                           intent: 'search_products', args: q => ({ query_text: q, attrs: { толщина: '0.7' } }) },
  { re: /0[.,]?75\s*мм/i,                                          intent: 'search_products', args: q => ({ query_text: q, attrs: { толщина: '0.75' } }) },
  { re: /0[.,]?8\s*мм/i,                                           intent: 'search_products', args: q => ({ query_text: q, attrs: { толщина: '0.8' } }) },
  { re: /0[.,]?9\s*мм/i,                                           intent: 'search_products', args: q => ({ query_text: q, attrs: { толщина: '0.9' } }) },
  { re: /1[.,]?0\s*мм/i,                                           intent: 'search_products', args: q => ({ query_text: q, attrs: { толщина: '1.0' } }) },
  { re: /1[.,]?2\s*мм/i,                                           intent: 'search_products', args: q => ({ query_text: q, attrs: { толщина: '1.2' } }) },
  { re: /1[.,]?5\s*мм/i,                                           intent: 'search_products', args: q => ({ query_text: q, attrs: { толщина: '1.5' } }) },
  { re: /2[.,]?0\s*мм/i,                                           intent: 'search_products', args: q => ({ query_text: q, attrs: { толщина: '2.0' } }) },

  // ---------- категорийные запросы ----------
  { re: /категор.*(какие|есть)/i,                                   intent: 'list_categories', args: () => ({}) },
  { re: /список.*категор/i,                                         intent: 'list_categories', args: () => ({}) },

  // ---------- запрос ассортимента / перечень товаров ----------
  // Пример: "ассортимент", "перечисли ассортимент", "какие товары есть"
  { re: /ассортим|перечисл\w*|какие\s+товары\s+есть/i,            intent: 'list_products', args: () => ({ limit: 10 }) },

  // ---------- детали товара ----------
  { re: /детал[ьи].*товар.*?(\d+)/i,                               intent: 'get_product_details', args: q => { const id = q.match(/(\d+)/)[1]; return { product_id: Number(id) }; } },
  { re: /sku.*?(\w+)/i,                                            intent: 'get_product_details', args: q => ({ product_id: q.match(/sku.*?(\w+)/i)[1] }) },

  // ---------- доставка ----------
  { re: /(сколько|когда).*(доставк|привез)/i,                       intent: 'estimate_delivery', args: () => ({}) },
  { re: /срок.*достав/i,                                            intent: 'estimate_delivery', args: () => ({}) },
  { re: /расчита.*достав/i,                                         intent: 'estimate_delivery', args: () => ({}) },

  // ---------- отмена заказа ----------
  { re: /отмен[итьы].*заказ.*?(\d+)/i,                             intent: 'cancel_order', args: q => ({ order_id: q.match(/(\d+)/)[1] }) },
  { re: /отмен.*order.*?(\w+)/i,                                   intent: 'cancel_order', args: q => ({ order_id: q.match(/(\w+)/)[1] }) },

  // ---------- общие приветствия/помощь (не требуют tool) ----------
  { re: /(приве|здравств)/i,                                       intent: 'smalltalk',       args: () => ({}) },
  { re: /(спасибо|благодар)/i,                                     intent: 'smalltalk',       args: () => ({}) },
];

export function regexIntent(text = '') {
  for (const { re, intent, args } of RULES) {
    if (re.test(text)) {
      return {
        intent,
        ...(typeof args === 'function' ? args(text) : args),
        confidence: 0.9,
      };
    }
  }
  return null;
}
