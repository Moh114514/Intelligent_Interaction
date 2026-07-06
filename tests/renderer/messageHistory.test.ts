import { describe, expect, it } from 'vitest';
import { createMessageHistory, removeMessage, upsertModelMessage } from '../../features/conversation/messageHistory';
import { CatType } from '../../types';

describe('streaming shared message history', () => {
  it('updates one assistant message and preserves its speaking character', () => {
    const initial = createMessageHistory();
    const partial = upsertModelMessage(initial, CatType.BLACK, 'request-1', 'Hel');
    const complete = upsertModelMessage(partial, CatType.BLACK, 'request-1', 'Hello');
    expect(complete).toEqual([{ id: 'request-1', role: 'model', text: 'Hello', characterId: CatType.BLACK }]);
    expect(removeMessage(complete, CatType.BLACK, 'request-1')).toEqual([]);
  });
});
