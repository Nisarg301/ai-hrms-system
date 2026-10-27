import { Types } from 'mongoose';
import { listTasksQuerySchema } from '../../src/validators/task.validators';

// The GET /tasks filters added for the Tasks assistant (docs/AI_TASKS_ASSISTANT.md, section 8).

describe('listTasksQuerySchema', () => {
  it('reads one status or several, due days and a member', () => {
    const memberId = new Types.ObjectId().toString();
    expect(listTasksQuerySchema.parse({ status: 'todo,in-progress, blocked', dueFrom: '2026-10-19', dueTo: '2026-10-25', memberId })).toEqual({
      status: ['todo', 'in-progress', 'blocked'],
      dueFrom: '2026-10-19',
      dueTo: '2026-10-25',
      memberId,
    });
    expect(listTasksQuerySchema.parse({})).toEqual({});
  });

  it('refuses an unknown status, a malformed day and a bad member id', () => {
    expect(listTasksQuerySchema.safeParse({ status: 'todo,archived' }).success).toBe(false);
    expect(listTasksQuerySchema.safeParse({ dueTo: '19/10/2026' }).success).toBe(false);
    expect(listTasksQuerySchema.safeParse({ memberId: 'mike' }).success).toBe(false);
  });
});
