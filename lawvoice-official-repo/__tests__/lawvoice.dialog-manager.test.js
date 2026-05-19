import { describe, expect, test } from '@jest/globals';
import LawVoiceDialogManager from '../public/modules/lawvoiceDialogManager.js';

function createMemoryStorage() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, value);
    }
  };
}

describe('LawVoiceDialogManager', () => {
  test('detects detention and moves to safety stage', () => {
    const manager = new LawVoiceDialogManager({ storage: createMemoryStorage() });
    const result = manager.registerIntent({
      intentName: 'detention_help',
      transcript: 'Меня задержали, я в отделе полиции.',
      params: { risk_level: 'high' }
    });

    expect(result.scenario).toBe('detention');
    expect(result.risk_level).toBe('high');
    expect(result.stage).toBe('safety');
    expect(result.directive).toContain('Сценарий: detention');
  });

  test('clarification prompt escalates after repeated misses', () => {
    const manager = new LawVoiceDialogManager({ storage: createMemoryStorage() });
    const first = manager.buildClarificationPrompt({
      fallbackText: 'Не до конца понял запрос.',
      transcript: 'Помоги'
    });
    const second = manager.buildClarificationPrompt({
      fallbackText: 'Все еще не понял.',
      transcript: 'Помоги, пожалуйста'
    });

    expect(first.prompt).toContain('Не до конца понял запрос.');
    expect(second.prompt).toContain('выберите тему');
  });

  test('state is restored from storage', () => {
    const storage = createMemoryStorage();
    const firstManager = new LawVoiceDialogManager({ storage, storageKey: 'lawvoice.test' });
    firstManager.registerIntent({
      intentName: 'cyberbullying_help',
      transcript: 'Меня травят в чате класса'
    });

    const secondManager = new LawVoiceDialogManager({ storage, storageKey: 'lawvoice.test' });
    const restored = secondManager.getStateSnapshot();

    expect(restored.scenario).toBe('cyberbullying');
    expect(restored.last_intent).toBe('cyberbullying_help');
  });
});
