# Audit Logs Assistant: find activity by module, action and dates through chat

On the **Audit Logs** page (`http://localhost:5173/audit-logs`), anyone allowed to read audit logs can load them by typing or speaking. For example: "Load all the audit logs for Leave", "Show deleted records in Projects last week", "Who signed in today?", "Audit logs from 1 Oct to 15 Oct".

This document covers the Audit Logs module only. The shared parts are described in [AI_ASSISTANT_PLAN.md](AI_ASSISTANT_PLAN.md): Ollama setup, running on a CPU, the agent loop, voice and plan gating. The page is read-only, and so is the assistant: it has no write tools and no confirm cards.

**Contents:** Status · Design choices · 1 Principle · 2 Who can use it · 3 What it reads · 4 Every combination · 5 The answer · 6 Examples · 7 System prompt · 8 Tools · 9 Server checks · 10 Backend changes · 11 Client changes · 12 Testing · 13 File flow

---

## Status

**Built (2026-10-22), not committed.**

- **Server:**
  - `server/src/ai/modules/auditLog.helpers.ts`: the module, action and date readers.
  - `auditLog.module.ts`: `list_audit_logs`, with the no-model path.
  - Hinglish days ("kal", "aaj") in the shared date reader.
- **Client:**
  - The page's filters in the URL.
  - The `/audit-logs` route in the drawer.
- **Tests:**
  - 15 new server tests; all 482 server tests pass.
  - 2 new client tests: the page loads once with the URL's filters, and a live answer moves the page. All 40 assistant and page tests run with them pass.
- **Eval on llama3.2 (CPU):** 18/18 on the second run.
  - 17 of the 18 phrases are read by the server alone and answer at once. "Show me what happened recently" goes to the model, which invented no filters, and takes about 14 s.
  - The first run's one miss was the eval's own expectation for "Any changes to permissions?": "changes" means any action (section 3.2).

---

## Design choices

| Question | Choice | Why |
|---|---|---|
| Where does the list show? | **In the chat, and the page behind the drawer follows**, as on Expenses. "Show deleted records in Projects last week" answers with a table in the chat, and the page's Module, Action and date filters switch to the same values. | The request is to "load the data": the page's own table then shows exactly what was asked. |
| How are the page's filters set? | **In the URL** (`/audit-logs?module=leave&action=create&from=2026-10-01&to=2026-10-21`), which the page reads and writes. | The same mechanism as the Expenses page. Filters chosen by hand work as before, and a filtered view can be bookmarked. |
| Who reads the module, action and dates? | **The server, from the user's own words.** Most requests need no model call at all. | They are fixed lists and a date range, which the server reads reliably and at once. The model is left for unusual wording. |
| Several modules or actions in one request | **The first one**, with a note: "One module at a time: showing Leave." | The API takes one of each, as the page's dropdowns do. |
| Dates | **Days in the organization's time zone** (`Asia/Kolkata`). "15 Oct" covers 00:00 to 23:59 that day. | As the page's date picker does. |
| Filter by user ("what did Rahul change?") | **Not now.** | The API has it (`actorId`), but the page has no user filter to follow. It's an easy addition later. |

---

## 1. Principle

As in every module: **the server works out what is asked and calls the existing REST API with the user's own token.** Here that is `GET /api/v1/audit-logs` with `module`, `action`, `from` and `to`, 20 entries a page, newest first. Ollama is only asked when the server can't read the message itself.

---

## 2. Who can use it

| Who | Gets |
|---|---|
| ORG_ADMIN | The assistant |
| ORG_USER | The assistant only if their role grants **Audit Logs: Read**, as the page itself requires |

Audit logs are in the **Professional** plan only, like the page and the AI assistant itself.

---

## 3. What it reads

### 3.1 Modules (the page's Module dropdown)

| Module | The user may say |
|---|---|
| Employees | employees, employee, staff, people |
| Documents | documents, document, docs |
| Departments | departments, department, dept |
| Projects | projects, project |
| Tasks | tasks, task, to-dos |
| Roles | roles, role, permissions |
| Leave | leave, leaves, leave requests, time off, chutti |
| Holidays | holidays, holiday |
| Announcements | announcements, announcement |
| Posts | posts, post, the feed, the Home feed |
| Attendance | attendance, work from home, WFH, fixes, regularization |
| Expenses | expenses, expense claims, claims, reimbursements |
| Onboarding & offboarding | onboarding, offboarding, people ops, checklists |
| Performance | performance, goals, reviews |
| *(any)* | all modules, every module, all audit logs |

### 3.2 Actions (the page's Action dropdown)

| Action | The user may say |
|---|---|
| Created | created, create, added, new |
| Updated | updated, update, edited, changed, modified |
| Deleted | deleted, delete, removed |
| Signed in | signed in, sign in, logged in, login, logins |
| Signed out | signed out, sign out, logged out, logout |
| *(any)* | all actions, everything, changes ("any changes to permissions?" covers created, updated and deleted) |

### 3.3 Dates

The same reader as the Expenses page (`expense.helpers.ts`, `dateRange`):

| Words | Range |
|---|---|
| today, yesterday | that day |
| this week, last week | Monday to Sunday (up to today for "this") |
| this month, last month, this year, last year | the whole period (up to today for "this") |
| October, Sep 2025 | that month |
| last 30 days | today and the 29 days before |
| from 1 Oct to 15 Oct, between 1 and 15 October, 1 Oct – 15 Oct | those days |
| since 1 Oct, after 1 Oct | from that day to now |
| until 15 Oct, before 15 Oct | up to the end of that day |
| on 15 Oct | that day |

A date without a year is the last such date: audit logs are about the past.

---

## 4. Every combination

Each filter is optional, and they combine. Whatever the message names is used, and nothing else.

| The message names | Example | Loads |
|---|---|---|
| Module | "Load all the audit logs for Leave" | Leave, any action, any date |
| Action | "Show everything that was deleted" | Deleted, any module, any date |
| Dates | "Audit logs from 1 Oct to 15 Oct" | Any module and action, those days |
| Module + action | "Show created entries in Projects" | Projects, Created |
| Module + dates | "Leave activity last week" | Leave, last week |
| Action + dates | "Who signed in today?" | Signed in, today |
| Module + action + dates | "Deleted documents this month" | Documents, Deleted, this month |
| Nothing | "Load all the audit logs" | Everything, newest first (the filters are cleared) |

Special cases:

- **Sign-ins have no module.** "Logins in Projects" loads the sign-ins, with a note that sign-ins aren't recorded per module.
- **Several of one kind** ("Leave and attendance logs") loads the first, with a note: "One module at a time: showing Leave."
- **A range over a year is fine.** The API has no limit on audit-log dates.
- **Nothing found** gets a plain line, "No audit entries · Leave · Deleted · 1 Oct – 21 Oct 2026", and the page shows the same empty view.

---

## 5. The answer

- **A line:** "**42 entries** · Leave · Created · 1 Oct – 21 Oct 2026." Past 20 entries it adds "Showing 1–20" and a **Show more** button.
- **A table**, with the page's columns: When (in `Asia/Kolkata`), User, Action, Module, Record.
- **The page follows:** its Module, Action and date filters switch to the same values, so the page's table matches.
- **A count question** gets the same answer, and the line answers it: "How many records were deleted this week?" → "**3 entries** · Deleted · 19 Oct – 22 Oct 2026."

---

## 6. Examples

> **You:** Load all the audit logs for Leave created last month
>
> **Assistant:** **12 entries** · Leave · Created · 1 Sep – 30 Sep 2026. *(table)* · and the page's filters show Leave, Created, 1 Sep – 30 Sep 2026

| Message | Filters |
|---|---|
| Show all audit logs | none |
| Leave logs | Leave |
| What was deleted? | Deleted |
| Who signed in today? | Signed in · 22 Oct 2026 |
| Audit logs from 1 Oct to 15 Oct | 1 Oct – 15 Oct 2026 |
| Show updated roles this week | Roles · Updated · 19 Oct – 22 Oct 2026 |
| Deleted documents since 1 Oct | Documents · Deleted · 1 Oct – 22 Oct 2026 |
| Attendance activity yesterday | Attendance · 21 Oct 2026 |
| Show logins in Projects | Signed in, with the note about sign-ins |
| Leave and attendance logs | Leave, with the one-module note |

---

## 7. System prompt

```ts
systemPrompt: (ctx) => `${basePrompt(ctx, 'audit logs')}
You are the Audit Logs assistant. You help find entries in the organization's audit log by module, action and dates. The log is read-only.
- Call list_audit_logs for every request, also when the user writes in Hindi or Hinglish.
- Copy the module, the action and the dates exactly as the user said them. The server works them out.
- Leave out anything the user didn't say.`
```

---

## 8. Tools

| Tool | Kind | Model fills in | Server does |
|---|---|---|---|
| `list_audit_logs` | read | `module?`, `action?`, `dates?`, `page?` | reads the filters (section 3) → `GET /audit-logs` → line and table; the page follows |

`direct`: a message whose words name a module, an action or dates, or ask for all audit logs, runs `list_audit_logs` with no model call.

---

## 9. Server checks

1. **Filters come from the user's words.** A module, action or date range counts only when the message names it. The model's copy is used only when it is in the message.
2. **Names don't become filters by accident.** "Posts" is a module, but "the post-lunch logins" isn't a filter for Posts: a module word counts only as a word of its own, not inside another.
3. **Dates are worked out on the server**, as days in `Asia/Kolkata`. `from` is 00:00 of the first day and `to` is 23:59:59.999 of the last, as the page sends them.
4. **Buttons carry the filters they were made with** (ids, ISO dates), so **Show more** pages through the same list.

---

## 10. Backend changes

None. `GET /audit-logs` already takes every filter.

---

## 11. Client changes

- **Route map:** `/audit-logs` → module `auditLogs`, with the example "Show deleted records in Projects last week".
- **Starter chips:** "All audit logs", "Today's sign-ins", "Deleted this week".
- **The page's filters in the URL:** `module`, `action`, `from` and `to` (days). The page reads them into its store and writes them back when they're changed by hand. A live answer's `view` moves the page, as on Expenses.

---

## 12. Testing

- **Unit:** the readers:
  - every module word and action word, including "sign in" against "signed out";
  - a module word inside another word;
  - several modules or actions;
  - the date range as `Asia/Kolkata` instants.
- **Agent:** scripted model and fake API:
  - each row of the section 4 table;
  - sign-ins with a module;
  - "all audit logs" clearing the filters;
  - Show more;
  - the page's `view`;
  - not offered without Audit Logs: Read.
- **Client:**
  - the page reads its filters from the URL and writes them back;
  - a live answer moves the page.
- **Eval on the real model:** `RUN_OLLAMA=1 OLLAMA_MODEL=llama3.2 npx jest tests/ai/auditLog.eval`, with the section 6 phrases and a few in other words.

---

## 13. File flow: what happens when you type or speak

The shared path, file by file, is in [AI_ASSISTANT_PLAN.md, section 13](AI_ASSISTANT_PLAN.md#13-file-flow-what-happens-when-you-type-or-speak): the drawer, the AI route, the agent's order of decisions, and Confirm. This section shows only what is particular to the Audit Logs assistant. Typing and speaking are the same from the second step on: `useSpeechInput.ts` turns your voice into text, and that text is sent like typed text.

**The files**

| Part | File |
|---|---|
| Route in the drawer | `AiAssistant.tsx`, `MODULE_ROUTES`: `/audit-logs` → `auditLogs` |
| Instructions and tool | `server/src/ai/modules/auditLog.module.ts`: `list_audit_logs`, plus a `direct` reader |
| Word readers | `auditLog.helpers.ts`: `modulesIn()`, `actionsIn()`, `auditRange()` (days in Asia/Kolkata); dates from `expense.helpers.ts` `dateRange()` |
| REST API it calls | `/audit-logs` (`routes/auditLog.routes.ts` checks `authorize('auditLogs', 'read')` → `controllers/auditLog.controller.ts` `listAuditLogs()`) |
| The page following | `AiAssistant.tsx` `onView` → the URL → `pages/auditLogs/AuditLogsPage.tsx` `filtersFrom()` → the store (`filtersChanged`) → `fetchAuditLogs` |
| After | Nothing to confirm: the log is read-only |

**One request, step by step: "Show deleted records in Projects last week"**

1. The message reaches `runTurn()`. The module's `direct` (`listStatement()`) finds filter words, so `list_audit_logs` runs **without the model**.
2. `list_audit_logs.run()` reads three filters:
   - `modulesIn()` gives Projects;
   - `actionsIn()` gives Deleted;
   - `auditRange()` gives last week, as 00:00 to 23:59 in Asia/Kolkata.
3. It calls `GET /audit-logs?module=projects&action=delete&from=…&to=…`.
4. The answer is a table, plus a **view**: `/audit-logs?module=projects&action=delete&from=2026-10-12&to=2026-10-18`.
5. In the browser:
   1. `useAiChat.ts` → `onView` → `AiAssistant.tsx` changes the address;
   2. `AuditLogsPage.tsx` reads the filters from it and sets the page's dropdowns and dates;
   3. it loads the same entries with `fetchAuditLogs`.

**Unusual wording:** "Show me what happened recently" names no filter, so it goes to the model. The server still uses only the words you said, so no filter is invented.
