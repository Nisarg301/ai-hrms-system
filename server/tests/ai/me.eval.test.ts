import { AiEvent, ChatMessageView, toolCallFromText } from '../../src/ai/agent.service';
import { attendanceModule } from '../../src/ai/modules/attendance.module';
import { leaveModule } from '../../src/ai/modules/leave.module';
import { myExpenseModule } from '../../src/ai/modules/myExpense.module';
import { ModelClient, ModelToolCall, ollamaClient } from '../../src/ai/ollama.client';
import { env } from '../../src/config/env';
import { AiModule, ApiClient } from '../../src/ai/types';
import * as dates from '../../src/utils/dates';
import { category, employeeUser, FakeMeApi, FakeMyExpenseApi, id, leaveTypes, PAID, stubPersistence, turn } from './support';

// The Me page eval set (docs/AI_ME_ASSISTANTS.md, section 10) against the real local model.
// Off by default; run it before a release or after changing OLLAMA_MODEL:
//   RUN_OLLAMA=1 OLLAMA_MODEL=llama3.2 npx jest tests/ai/me.eval --runInBand
// The APIs are in-memory fakes, so no real data is touched. Today is Thu 22 Oct 2026.

const run = process.env.RUN_OLLAMA === '1' ? describe : describe.skip;
stubPersistence();
const TODAY = '2026-10-22';
beforeEach(() => {
  jest.spyOn(dates, 'todayIso').mockReturnValue(TODAY);
  jest.spyOn(dates, 'now').mockReturnValue(new Date('2026-10-22T08:00:00Z'));
});

type Outcome = (last: ChatMessageView) => boolean;
const says = (last: ChatMessageView, pattern: RegExp) => pattern.test(last.result?.text ?? '');
/** The card shows these rows, label → value (only the ones named). */
const shows = (last: ChatMessageView, expected: Record<string, string>) => {
  const rows = Object.fromEntries((last.action?.card.rows ?? []).map((r) => [r.label, r.value]));
  return Object.entries(expected).every(([k, v]) => rows[k] === v);
};

interface Case {
  message: string;
  tool: string;
  outcome: Outcome;
}

// ---------------------------------------------------------------- leave

const LEAVE: Case[] = [
  { message: 'Apply for leave from 3 Nov to 5 Nov', tool: 'apply_leave', outcome: (l) => shows(l, { Type: 'Paid Leave', Dates: 'Tue 3 Nov → Thu 5 Nov 2026', Days: '3', Reason: '—' }) },
  { message: 'Apply for leave tomorrow', tool: 'apply_leave', outcome: (l) => shows(l, { Type: 'Paid Leave', Dates: 'Fri 23 Oct 2026', Days: '1', Reason: '—' }) },
  { message: 'I need a half day tomorrow', tool: 'apply_leave', outcome: (l) => shows(l, { Dates: 'Fri 23 Oct 2026 (first half)', Days: '0.5' }) },
  // The server sends a misrouted cancel to apply_leave (Prepared 'reroute').
  { message: "Second half leave on 28 Oct, doctor's appointment", tool: 'apply_leave|cancel_leave', outcome: (l) => shows(l, { Dates: 'Wed 28 Oct 2026 (second half)' }) && /doctor/i.test(l.action!.card.rows.find((r) => r.label === 'Reason')!.value) },
  { message: 'Leave next Monday to Friday for a family function', tool: 'apply_leave', outcome: (l) => shows(l, { Type: 'Unpaid Leave', Dates: 'Mon 26 Oct → Fri 30 Oct 2026', Days: '5' }) && Boolean(l.action!.card.notes?.[0]?.startsWith('Paid Leave has 4 days left')) },
  { message: 'Apply unpaid leave on 6 Nov', tool: 'apply_leave', outcome: (l) => shows(l, { Type: 'Unpaid Leave', Dates: 'Fri 6 Nov 2026' }) },
  { message: 'Take 3 days of leave from Monday', tool: 'apply_leave', outcome: (l) => shows(l, { Dates: 'Mon 26 Oct → Wed 28 Oct 2026', Days: '3' }) },
  { message: 'Mujhe kal chutti chahiye', tool: 'apply_leave', outcome: (l) => shows(l, { Dates: 'Fri 23 Oct 2026', Days: '1' }) },
  { message: 'Leave on Saturday', tool: 'apply_leave', outcome: (l) => says(l, /weekends or holidays/) },
  { message: 'What is my leave balance?', tool: 'leave_balance', outcome: (l) => Boolean(l.result?.table?.rows.length) || says(l, /Paid Leave/) },
  { message: 'How many paid leaves do I have left?', tool: 'leave_balance', outcome: (l) => says(l, /Paid Leave.*4/) || Boolean(l.result?.table?.rows.some((r) => r.available === '4')) },
  { message: 'Show my leave requests', tool: 'list_my_leave', outcome: (l) => says(l, /1 leave request/) },
  { message: 'Cancel my leave on 13 Nov', tool: 'cancel_leave', outcome: (l) => l.action?.card.tone === 'danger' && l.action.card.title === 'Cancel Paid Leave?' },
  { message: 'Work from home tomorrow', tool: 'none', outcome: (l) => says(l, /Attendance/) },
];

function leaveApi(): ApiClient & { writes(): unknown[] } {
  const api = new FakeMeApi(leaveTypes(4), TODAY);
  api.leave = [{ id: id(), leaveTypeId: PAID, leaveTypeName: 'Paid Leave', startDate: '2026-11-13', endDate: '2026-11-13', halfDay: null, days: 1, reason: '', status: 'pending', canCancel: true }];
  return api;
}

// ---------------------------------------------------------------- attendance

const ATTENDANCE: Case[] = [
  { message: 'Work from home tomorrow', tool: 'request_wfh', outcome: (l) => shows(l, { Dates: 'Fri 23 Oct 2026', Reason: '—' }) },
  { message: 'Request WFH from Monday to Wednesday', tool: 'request_wfh', outcome: (l) => shows(l, { Dates: 'Mon 26 Oct → Wed 28 Oct 2026', 'Working days': '3' }) },
  { message: 'I want to work from home next week because of a plumber visit', tool: 'request_wfh', outcome: (l) => shows(l, { Dates: 'Mon 26 Oct → Fri 30 Oct 2026' }) && /plumber/i.test(l.action!.card.rows.find((r) => r.label === 'Reason')!.value) },
  { message: 'WFH on 2 Nov', tool: 'request_wfh', outcome: (l) => says(l, /already have approved work from home/) },
  { message: 'Kal work from home', tool: 'request_wfh', outcome: (l) => shows(l, { Dates: 'Fri 23 Oct 2026' }) },
  { message: 'Fix yesterday, clock in 9:30 and clock out 6:30', tool: 'request_fix', outcome: (l) => shows(l, { Date: 'Wed 21 Oct 2026', 'Clock in': '09:30 (9:30 am)', 'Clock out': '18:30 (6:30 pm)' }) },
  { message: 'I forgot to clock out on 20 Oct, I came at 9:15 and left at 7 pm', tool: 'request_fix', outcome: (l) => shows(l, { Date: 'Tue 20 Oct 2026', 'Clock in': '09:15 (9:15 am)', 'Clock out': '19:00 (7:00 pm)' }) },
  { message: 'Regularize 15 Oct from 10 to 7', tool: 'request_fix', outcome: (l) => shows(l, { Date: 'Thu 15 Oct 2026', 'Clock in': '10:00 (10:00 am)', 'Clock out': '19:00 (7:00 pm)' }) },
  { message: 'Fix 15 Oct, I came at 10', tool: 'request_fix', outcome: (l) => says(l, /What time did you clock out on Thu 15 Oct 2026/) },
  { message: 'How many days was I late this month?', tool: 'my_attendance', outcome: (l) => says(l, /2 late/) },
  { message: 'Show my attendance requests', tool: 'list_attendance_requests', outcome: (l) => says(l, /1 request/) },
  { message: 'Cancel my WFH request for 2 Nov', tool: 'cancel_attendance_request|request_wfh', outcome: (l) => l.action?.card.tone === 'danger' },
  { message: 'Apply leave tomorrow', tool: 'none', outcome: (l) => says(l, /Leave/) },
];

function attendanceApi(): ApiClient & { writes(): unknown[] } {
  const api = new FakeMeApi(leaveTypes(4), TODAY);
  api.requests = [{ id: id(), kind: 'wfh', startDate: '2026-11-02', endDate: '2026-11-02', clockIn: null, clockOut: null, reason: '', status: 'approved', canCancel: true }];
  return api;
}

// ---------------------------------------------------------------- my expenses

const travel = category('Travel', 500000, 50000);
const food = category('Food & meals', 200000, 50000);
const internet = category('Internet & phone', null, 50000);

const EXPENSES: Case[] = [
  { message: 'Add a new claim, client visit to Pune', tool: 'create_claim', outcome: (l) => says(l, /what did you spend/) },
  {
    message: 'New claim for the September internet bill, ₹1,299 at Airtel on 5 Oct',
    tool: 'create_claim',
    outcome: (l) => shows(l, { Claim: 'September internet bill', Date: 'Mon 5 Oct 2026', Category: 'Internet & phone', Amount: '₹1,299.00', Merchant: 'Airtel' }),
  },
  { message: 'Claim for client lunch: ₹850 at Barbeque Nation on 20 Oct, food', tool: 'create_claim', outcome: (l) => shows(l, { Date: 'Tue 20 Oct 2026', Category: 'Food & meals', Amount: '₹850.00', Merchant: 'Barbeque Nation' }) },
  {
    message: 'New claim for a cab to the airport, 650 rupees, Uber, yesterday, travel',
    tool: 'create_claim',
    outcome: (l) => shows(l, { Date: 'Wed 21 Oct 2026', Category: 'Travel', Amount: '₹650.00', Merchant: 'Uber' }) && l.action!.card.file?.required === true,
  },
  {
    message: 'Create a claim for the Pune hotel, ₹6,000 at Taj on 14 Oct, travel, save it as a draft',
    tool: 'create_claim',
    outcome: (l) => l.action?.card.confirmLabel === 'Save as draft' && Boolean(l.action.card.warnings?.[0]?.startsWith('Over the ₹5,000.00 limit')),
  },
  { message: 'New claim', tool: 'create_claim', outcome: (l) => says(l, /What is the claim for/) },
  { message: 'Show my claims', tool: 'list_my_claims', outcome: (l) => says(l, /1 claim/) },
  {
    message: "Add another expense to the Pune claim: lunch ₹420 at Haldiram's on 16 Oct, food",
    tool: 'add_expense|create_claim',
    outcome: (l) => l.action?.card.title === 'Add to Client visit to Pune' && shows(l, { Amount: '₹420.00', Category: 'Food & meals' }),
  },
  { message: 'Submit my Pune claim', tool: 'submit_claim', outcome: (l) => says(l, /Uber \(Thu 15 Oct 2026\) needs a receipt/) },
  { message: 'Add a receipt for the Uber expense in my Pune claim', tool: 'add_receipt', outcome: (l) => l.action?.card.title === 'Add a receipt' && l.action.card.file?.required === true },
  { message: 'Apply leave tomorrow', tool: 'none', outcome: (l) => says(l, /Leave/) },
];

function expenseApi(): ApiClient & { writes(): unknown[] } {
  const api = new FakeMyExpenseApi([{ ...travel }, { ...food }, { ...internet }, category('Other')]);
  api.claim('Client visit to Pune', [{ date: '2026-10-15', categoryId: travel.id, amountPaise: 85000, merchant: 'Uber', note: '' }]);
  return api;
}

// ---------------------------------------------------------------- the runner

function recording(): ModelClient & { calls: ModelToolCall[]; texts: string[] } {
  const calls: ModelToolCall[] = [];
  const texts: string[] = [];
  return {
    calls,
    texts,
    async chat(request) {
      const reply = await ollamaClient.chat(request);
      calls.push(...reply.toolCalls);
      if (reply.content.trim()) texts.push(reply.content.trim());
      return reply;
    },
  };
}

async function evaluate(module: AiModule, cases: Case[], fakeApi: () => ApiClient & { writes(): unknown[] }) {
  const report: { message: string; ok: boolean; got: string; shown: string; seconds: string }[] = [];
  for (const c of cases) {
    const api = fakeApi();
    const model = recording();
    const started = Date.now();
    const { last, events } = await turn({ module, user: employeeUser, api, message: c.message, model });
    // A tool call the model wrote as text counts too: the agent recovers it (toolCallFromText).
    const written = model.texts.map(toolCallFromText).find((x): x is ModelToolCall => Boolean(x) && x !== 'malformed');
    const call = model.calls[model.calls.length - 1] ?? written;
    const direct = !model.calls.length && !model.texts.length ? (events.find((e) => e.type === 'tool') as Extract<AiEvent, { type: 'tool' }> | undefined) : undefined;
    // 'none': another tab's work, answered before any tool (AiModule.elsewhere).
    const name = call?.name ?? direct?.name ?? 'none';
    const ok = c.tool.split('|').includes(name) && c.outcome(last);
    report.push({
      message: c.message,
      ok,
      got: call ? `${call.name} ${JSON.stringify(call.args)}` : direct ? `${direct.name} (server, no model)` : `no tool call: "${model.texts.join(' ').slice(0, 100)}"`,
      shown: last.action ? last.action.card.rows.map((r) => `${r.label}: ${r.value}`).join(' | ') : (last.result?.text ?? '').slice(0, 110),
      seconds: ((Date.now() - started) / 1000).toFixed(1),
    });
    // Whatever the model did, nothing may be written without a Confirm.
    expect(api.writes()).toEqual([]);
  }
  console.table(report);
  const passed = report.filter((r) => r.ok).length;
  console.log(`${module.key}: ${passed}/${report.length} correct on ${env.OLLAMA_MODEL}`);
  return passed / report.length;
}

run(`Me page eval on ${env.OLLAMA_MODEL}`, () => {
  it('Leave', async () => expect(await evaluate(leaveModule, LEAVE, leaveApi)).toBeGreaterThanOrEqual(0.8), 20 * 60 * 1000);
  it('Attendance', async () => expect(await evaluate(attendanceModule, ATTENDANCE, attendanceApi)).toBeGreaterThanOrEqual(0.8), 20 * 60 * 1000);
  it('My expenses', async () => expect(await evaluate(myExpenseModule, EXPENSES, expenseApi)).toBeGreaterThanOrEqual(0.8), 20 * 60 * 1000);
});
