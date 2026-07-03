import { describe, expect, it } from 'vitest';

import { createMessageHistory, removeMessage, upsertModelMessage } from '../../features/conversation/messageHistory';
import { CatType } from '../../types';

describe('streaming message history', () => {
  it('updates one assistant message and can remove a cancelled partial response', () => {
    const initial = createMessageHistory();
    const partial = upsertModelMessage(initial, CatType.BLACK, 'request-1', 'Hel');
    const complete = upsertModelMessage(partial, CatType.BLACK, 'request-1', 'Hello');

    expect(complete[CatType.BLACK]).toEqual([{ id: 'request-1', role: 'model', text: 'Hello' }]);
    expect(removeMessage(complete, CatType.BLACK, 'request-1')[CatType.BLACK]).toEqual([]);
    expect(complete[CatType.WHITE]).toEqual([]);
  });
});