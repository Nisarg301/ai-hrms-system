import { describe, expect, it } from 'vitest';
import { parseSse } from './ai.endpoints';

describe('parseSse', () => {
  it('splits complete events and keeps a partial one for later', () => {
    const { events, rest } = parseSse('event: status\ndata: {"state":"thinking"}\n\n: ping\n\nevent: token\ndata: {"text":"Hel');
    expect(events).toEqual([{ type: 'status', state: 'thinking' }]);
    expect(rest).toBe('event: token\ndata: {"text":"Hel');
  });

  it('reads the event once the rest arrives', () => {
    const { events, rest } = parseSse('event: token\ndata: {"text":"Hello"}\n\nevent: done\ndata: {"conversationId":"c1"}\n\n');
    expect(events).toEqual([
      { type: 'token', text: 'Hello' },
      { type: 'done', conversationId: 'c1' },
    ]);
    expect(rest).toBe('');
  });

  it('skips a malformed event instead of failing the answer', () => {
    expect(parseSse('event: token\ndata: {broken\n\n').events).toEqual([]);
  });
});
