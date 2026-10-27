# Me Page Assistants: leave, attendance and my expenses through chat

The **Me** page has seven tabs. Three of them get an assistant, used by typing or speaking:

| Tab | Page | Example |
|---|---|---|
| Leave | `http://localhost:5173/me/leave` | "Apply for leave from 3 Nov to 5 Nov", "Half day tomorrow, second half" |
| Attendance | `http://localhost:5173/me/attendance` | "Work from home tomorrow", "Fix yesterday: clock in 9:30, clock out 6:30" |
| Expenses | `http://localhost:5173/me/expenses` | "New claim for client visit to Pune", "Add a claim for the September internet bill" |

Performance, Profile, Team and Holidays get **no assistant**: the chat button doesn't show on those tabs.

This document covers these three assistants. The shared parts are described in [AI_ASSISTANT_PLAN.md](AI_ASSISTANT_PLAN.md): Ollama setup, running on a CPU, the agent loop, confirm cards, voice and plan gating. Section 7.3 of the plan sketched a Leave module before any module was built; this document replaces that sketch.

**Contents:** Status · Design choices · 1 Principle · 2 Who can use them · 3 Leave · 4 Attendance · 5 My expenses · 6 Server checks · 7 Backend changes · 8 Shared changes · 9 Client changes · 10 Testing · 11 File flow

---

## Status

**Built (2026-10-22), not committed.**

- **Server:**
  - `leave.module.ts`, `attendance.module.ts` and `myExpense.module.ts`, with `me.helpers.ts`.
  - The day, range, time and Hinglish readers in `dates.ts`.
  - The shared changes in section 8.
  - The optional reason for work from home and fixes (section 7).
- **Client:**
  - The four card forms, and the receipt kind on the file field.
  - The three routes, and reloading each tab after a change.
  - The Request WFH and Request a fix drawer, with its reason now optional.
- **Tests:**
  - 49 new server tests (15 unit, 10 Leave, 12 Attendance, 12 Expenses); all 467 server tests pass.
  - 8 new client tests: the drawer shows on the three tabs and not the other four, and a claim's receipt turns required as its amount changes. The attendance drawer's tests pass with the optional reason.
- **Eval on llama3.2 (CPU):** 38/38 on the third run (Leave 14/14, Attendance 13/13, Expenses 11/11), 0–7 s per message.
  - The first run scored 32/38. The fixes are in section 6, rules 5–8:
    - "3 days of leave from Monday";
    - a cancel the model sent as a new request;
    - reasons made of command and time words;
    - broken JSON for a whole new claim;
    - "New claim" taken as a title;
    - leave asked about on the Expenses tab.
  - The second run scored 35/38: the three misses were correct answers to other tabs' work, given with no tool, which the eval didn't count yet.

---

## Design choices

| Question | Choice | Why |
|---|---|---|
| Which leave type when none is named? | **Paid leave if the balance covers the whole request, otherwise unpaid leave.** The card says why ("Paid Leave has 2 days left and this needs 3"), and the type can be changed on the card. | As asked. A request isn't split across two types: that would be two requests to approve. |
| Full day or half day? | **Full day**, unless the message says half day. A half day is the **first half** unless the message says second half, afternoon or after lunch. | As asked. The first half is also the page's default. |
| Is a reason needed? | **No**, for leave, work from home and fixes alike. | As asked. Leave already allows an empty reason; work from home and fixes don't yet (section 7). |
| A date without a year | Leave: the **next** such date (leave can't start before today). Work from home: the next one, unless it was in the **last 7 days** (it can be asked for up to 7 days back). Fixes and expenses: the **last** such date (they're about the past). | So "15 Oct", said on 22 Oct, is this year's for a fix and next year's for leave. |
| How does a claim end? | **One card makes the claim, adds the expense, attaches the receipt and submits it**, all on one Confirm. A **Submit now** switch on the card (on by default) keeps it as a draft instead. | As asked: title, then the expense's details, then the receipt, then submitted. |
| Receipts | **Chosen on the card.** It is required when the amount is above the category's receipt limit, as on the page, and optional otherwise. | The API refuses to submit a claim with a required receipt missing, so the card asks for it first. |
| More expenses in one claim | "Add another expense to my Pune claim" adds one to a **draft** claim. Saying "save as draft", "don't submit yet" or "I have more to add" turns **Submit now** off. | A trip often has several expenses. |
| What happens to the page | After every confirmed change, the tab reloads its balances, calendar or claims behind the drawer. | As on the other pages. |

---

## 1. Principle

As in every module: **Ollama understands the request, and the Node.js backend does the work.** The model picks one of the tab's tools and copies the user's words. The server works out dates, half days, times, leave types, categories and amounts from those words. It previews what it can (leave days and balances) and shows a confirm card. On **Confirm**, it calls the existing endpoints with the user's own token, the same ones the tab's buttons use.

---

## 2. Who can use them

| Assistant | Who | Plan |
|---|---|---|
| Leave | Everyone in the organization: employees, and admins for their own leave | The `ai` feature (Professional) |
| Attendance | Everyone | The `ai` feature |
| My expenses | Everyone | The `ai` and `expenses` features |

They only ever act for the signed-in person. Approving, and recording leave or fixes for someone else, stay on the admin pages.

---

## 3. Leave (`/me/leave`)

### 3.1 What it reads from a request

| Detail | The user may say | Rule |
|---|---|---|
| Dates | "3 Nov", "from 3 Nov to 5 Nov", "3rd to 5th November", "tomorrow", "next Monday", "Monday to Wednesday", "Monday and Tuesday", "for 3 days from Monday", and in Hinglish "kal", "aaj", "parso" | Required. One date means one day. Leave can't start before today, and has to stay within one calendar year. One request is one run of days: "Monday and Wednesday" is read as Monday only. |
| Days counted | *(not said)* | Working days only: the server leaves out weekends and the organization's holidays (`GET /leave/preview`). |
| Type | "paid", "PL", "unpaid", "leave without pay", "LWP", or any type's name or code ("sick", "CL") | Optional. Otherwise, section 3.2 applies. |
| Half day | "half day", "half-day"; "first half", "morning"; "second half", "afternoon", "after lunch" | Optional; full day by default. A half day must be one date, on a type that allows half days. |
| Reason | "because …", "for …", "reason: …", "I have fever" | Optional. Up to 500 characters. |

### 3.2 Choosing the type when none is named

1. Count the working days (`GET /leave/preview` on the paid type).
2. If **Paid Leave** has enough balance (`available` covers the days), use it. Paid Leave is the paid type whose code is `PL`, or else the only paid type with a yearly quota.
3. Otherwise use **Unpaid Leave**, the unpaid type, and note it on the card: "Paid Leave has 2 days left and this needs 3, so this is Unpaid Leave. You can change the type."
4. If the organization has no unpaid type, show the paid type's error ("Only 2 day(s) of Paid Leave left this year").
5. For a half day, only types that allow half days count.

### 3.3 Tools

| Tool | Kind | Model fills in | Server does |
|---|---|---|---|
| `leave_balance` | read | `type?` | `GET /leave/balances` → a table (type, quota, taken, pending, available) |
| `list_my_leave` | read | `status?` | `GET /leave/requests/mine` → a table, newest first, with a **Cancel** button on requests that can be cancelled |
| `apply_leave` | write | `dates`, `type?`, `halfDay?`, `reason?` | reads the details → picks the type → `GET /leave/preview` → card → `POST /leave/requests` |
| `cancel_leave` | write | `which` ("my leave on 5 Nov") | `GET /leave/requests/mine` → the matching request that can be cancelled → red card → `POST /leave/requests/:id/cancel` |

### 3.4 System prompt

```ts
systemPrompt: (ctx) => `${basePrompt(ctx, 'leave')}
You are the Leave assistant on the user's own Leave tab. You help them apply for leave, see their balance and their requests, and cancel a request.
- Call a tool for every request, also when the user writes in Hindi or Hinglish.
- To apply for leave, call apply_leave. Copy the dates, the leave type, "half day" and the reason exactly as the user said them.
- Leave the type empty unless the user named one. The server picks paid or unpaid leave.
- Leave halfDay empty unless the user said half day, first half, second half, morning or afternoon.
- A reason is optional. Never ask for one, and never make one up.
- If the user didn't say any date, ask which dates. Never guess dates.
- To cancel a request, call cancel_leave with the user's words for which one.
- Never say that leave was applied or cancelled. The app shows that after the backend confirms it.`
```

### 3.5 Examples

> **You:** Apply for leave from 3 Nov to 5 Nov
>
> **Assistant:** *(card)* Apply for leave · Type **Paid Leave** · Dates **Tue 3 Nov → Thu 5 Nov** · Days **3** · Left after this **7** · Reason **—** · **[Apply]** [Cancel]

> **You:** Leave next Monday to Friday, family function
>
> **Assistant:** *(card)* Type **Unpaid Leave** · Mon 26 Oct → Fri 30 Oct · 5 days · Reason **family function** · *Note: Paid Leave has 3 days left and this needs 5, so this is Unpaid Leave. You can change the type.*

| Message | Card |
|---|---|
| Half day tomorrow | Paid Leave · Fri 23 Oct (first half) · 0.5 days |
| Second half on 28 Oct, doctor's appointment | Paid Leave · Wed 28 Oct (second half) · 0.5 days · Reason: doctor's appointment |
| Unpaid leave on 6 Nov | Unpaid Leave · Fri 6 Nov · 1 day |
| Apply sick leave for tomorrow *(no Sick type)* | "There's no leave type called "sick". Types: Paid Leave, Unpaid Leave." |
| Leave on Saturday | "The selected dates are all weekends or holidays." *(the API's own message)* |
| What's my leave balance? | A table: Paid Leave · 12 · 2 taken · 1 pending · 9 available; Unpaid Leave · unlimited |
| Cancel my leave on 5 Nov | *(red card)* Cancel Paid Leave, Tue 3 Nov → Thu 5 Nov (pending)? |

---

## 4. Attendance (`/me/attendance`)

The tab has two buttons, **Request WFH** and **Request a fix**. The assistant does the same two things, plus a look at the month.

### 4.1 Work from home

| Detail | The user may say | Rule |
|---|---|---|
| Dates | "tomorrow", "on Friday", "from Monday to Wednesday", "26 to 28 Oct", "next week" | Required. It can be asked for up to 7 days back, within one calendar year, with at least one working day. |
| Reason | "for a plumber visit", "reason: …" | Optional (section 7). |

The API refuses dates that overlap the user's own pending or approved work from home, or full-day leave. The server checks `GET /attendance/requests/mine` and `GET /leave/requests/mine` first, so the answer explains instead of showing a card that would fail.

### 4.2 Attendance fix (regularization)

| Detail | The user may say | Rule |
|---|---|---|
| Date | "yesterday", "on 15 Oct", "last Friday", "today" | Required. Not in the future, and at most 30 days back. |
| Clock in and clock out | "clock in 9:30, clock out 6:30", "9:30 am to 6:30 pm", "from 10 to 7", "09:30–18:30" | Both required. Clock-out after clock-in; for today, not later than now. |
| Reason | "forgot to clock out", "reason: …" | Optional (section 7). |

**Times:** "am" and "pm" are read as said. Without them, a clock-out earlier than the clock-in is taken as afternoon: "from 9:30 to 6:30" is 09:30–18:30. A clock-in before 7 without "am" is read as afternoon too, which the card shows to be checked. If only one time is given, the assistant asks for the other.

The API refuses a fix on a day of full leave, and a second pending fix for the same date. The server checks for both first.

### 4.3 Tools

| Tool | Kind | Model fills in | Server does |
|---|---|---|---|
| `my_attendance` | read | `month?` | `GET /attendance/me?month=` → the month's totals (present, half days, absent, late, leave days, average day), and days with a missing clock-out |
| `list_attendance_requests` | read | `kind?`, `status?` | `GET /attendance/requests/mine` → a table with **Cancel** buttons where allowed |
| `request_wfh` | write | `dates`, `reason?` | dates → overlap checks → card → `POST /attendance/requests` `{ kind: 'wfh', startDate, endDate, reason }` |
| `request_fix` | write | `date`, `clockIn`, `clockOut`, `reason?` | date and times → checks → card → `POST /attendance/requests` `{ kind: 'regularization', date, clockIn, clockOut, reason }` |
| `cancel_attendance_request` | write | `which` ("my WFH on Friday") | `GET /attendance/requests/mine` → the matching one that can be cancelled → red card → `POST /attendance/requests/:id/cancel` |

### 4.4 System prompt

```ts
systemPrompt: (ctx) => `${basePrompt(ctx, 'attendance')}
You are the Attendance assistant on the user's own Attendance tab. You help them ask to work from home, ask for a fix to a day's clock-in and clock-out times, see their month, and cancel a request.
- Call a tool for every request, also when the user writes in Hindi or Hinglish.
- Work from home: call request_wfh with the dates exactly as the user said them.
- A fix (wrong or missing clock-in or clock-out on a day): call request_fix with the date, the clock-in time and the clock-out time exactly as the user said them.
- A reason is optional. Never ask for one, and never make one up.
- If the user didn't say the date or a time, ask for it. Never guess.
- Clocking in or out for today is done with the buttons on the Home page, not here.
- Never say that a request was sent or cancelled. The app shows that after the backend confirms it.`
```

### 4.5 Examples

> **You:** Work from home tomorrow
>
> **Assistant:** *(card)* Request work from home · Dates **Fri 23 Oct** · 1 working day · Reason **—** · **[Send request]** [Cancel]

> **You:** Fix yesterday, clock in 9:30 and clock out 6:30, forgot to clock out
>
> **Assistant:** *(card)* Request a fix · Date **Wed 21 Oct** · Clock in **09:30** · Clock out **18:30** · Reason **forgot to clock out** · **[Send request]**

| Message | Answer |
|---|---|
| WFH from Monday to Wednesday | Card: Mon 26 Oct → Wed 28 Oct · 3 working days |
| Work from home next week for a plumber visit | Card: Mon 26 Oct → Sun 1 Nov · 5 working days · Reason: plumber visit |
| WFH on 26 Oct *(already approved)* | "You already have approved work from home on Mon 26 Oct." |
| Fix 15 Oct, I came at 10 | "What time did you clock out on Thu 15 Oct?" |
| Fix tomorrow, 9 to 6 | "You can't fix a day that hasn't happened yet." |
| How many days was I late this month? | "**October 2026:** 14 present, 1 half day, 0 absent, **2 late**, 1 leave day. Average day 8h 40m." |
| Cancel my WFH request for Friday | *(red card)* Cancel work from home on Fri 23 Oct (pending)? |

---

## 5. My expenses (`/me/expenses`)

### 5.1 The conversation

A **claim** has a title ("Client visit to Pune") and holds up to 20 **expenses**. Each expense has a date, category, amount and merchant, plus an optional note, and up to 5 receipts.

1. **The request names the claim.** "Add a new claim for client visit to Pune" or "New claim: September internet bill" gives the title. If there's no title, the assistant asks what the claim is for.
2. **The assistant asks for the first expense:** "For **Client visit to Pune**, what did you spend? I need the **date**, **category**, **amount** and **merchant**. A note is optional."
3. **The reply can give some or all of them:** "Uber to the airport on 15 Oct, ₹850, travel". The assistant asks again only for what's still missing. A reply that gives everything still missing is read with no model call. Otherwise the model reads it, and the server checks each value: in testing, "Uber" said without "at" was only found that way.
4. **The card** shows the claim and its expense, every field editable, plus a **receipt** field:
   - **Required** when the amount is above the category's receipt limit: "Travel needs a receipt above ₹500.00." The file picker opens by itself.
   - **Optional** otherwise.
   - Over the category's **limit** is allowed, with a warning: "Over the ₹5,000.00 limit for Travel: your admin sees it flagged."
5. **Confirm** creates the claim, adds the expense, attaches the receipt and submits it. With **Submit now** off, the claim stays a draft.

### 5.2 What it reads

| Detail | The user may say | Rule |
|---|---|---|
| Claim title | "client visit to Pune", "September internet bill" | Required, at most 120 characters. |
| Date | "15 Oct", "yesterday", "last Friday", "on the 3rd" | Required. Not in the future, and at most 90 days back. |
| Category | "travel", "food", "internet", "office supplies" | Required, one of the active categories (`GET /expense-categories`), matched by name. |
| Amount | "₹850", "850 rupees", "1.2k", "₹1,299.50" | Required, more than 0 and at most ₹10,00,000. |
| Merchant | "at Uber", "from Amazon", "paid to Airtel", "merchant: Ola" | Required, at most 120 characters. |
| Note | "note: …", "for the client meeting" | Optional, at most 500 characters. |

A category can be read from the claim's title when it's clear ("September **internet** bill" → Internet & phone), and the card shows it to be checked.

### 5.3 Tools

| Tool | Kind | Model fills in | Server does |
|---|---|---|---|
| `list_my_claims` | read | `status?` | `GET /expenses/mine` → a table (claim, number, expenses, total, status) |
| `create_claim` | write | `title?`, `date?`, `category?`, `amount?`, `merchant?`, `note?` | asks for what's missing → card with the receipt field → on Confirm: `POST /expenses`, `POST /expenses/:id/items`, the receipt, then `POST /expenses/:id/submit` |
| `add_expense` | write | `claim`, `date?`, `category?`, `amount?`, `merchant?`, `note?` | finds the **draft** claim → asks for what's missing → card → `POST /expenses/:id/items`, the receipt, and the submit if **Submit now** is on |
| `add_receipt` | write | `claim`, `expense?` (the merchant or date) | finds the expense → card with a required file → `POST /expenses/:id/items/:itemId/receipts` |
| `submit_claim` | write | `claim` | finds the draft → runs the API's own checks first (a missing receipt, an expense over 90 days old) → card with the total → `POST /expenses/:id/submit` |

Withdrawing, editing and deleting claims stay on the page.

### 5.4 System prompt

```ts
systemPrompt: (ctx) => `${basePrompt(ctx, 'expenses')}
You are the Expenses assistant on the user's own Expenses tab. You help them make an expense claim, add expenses and receipts to it, submit it, and see their claims.
- Call a tool for every request, also when the user writes in Hindi or Hinglish.
- A new claim: call create_claim. The title is what the claim is for, in the user's words.
- Copy the date, category, amount, merchant and note exactly as the user said them. Leave out anything the user didn't say. Never make up an amount, a date or a merchant.
- Adding to a claim that already exists: call add_expense. Adding a receipt: call add_receipt.
- A note is optional. Never ask for one.
- Never say that a claim was created or submitted. The app shows that after the backend confirms it.`
```

### 5.5 Examples

> **You:** Add a new claim, client visit to Pune
>
> **Assistant:** For **Client visit to Pune**, what did you spend? I need the **date**, **category**, **amount** and **merchant**. A note is optional. *[Fill in the form instead]*
>
> **You:** Uber to the airport on 15 Oct, 850 rupees, travel
>
> **Assistant:** *(card)* New claim · **Client visit to Pune** · Date **Thu 15 Oct** · Category **Travel** · Amount **₹850.00** · Merchant **Uber** · Note **to the airport** · Receipt *(required: Travel needs a receipt above ₹500.00)* **[Choose file]** · Submit now **on** · **[Submit claim]** [Cancel]

> **You:** New claim for the September internet bill, ₹1,299 at Airtel on 5 Oct
>
> **Assistant:** *(card)* **September internet bill** · 5 Oct · Internet & phone · ₹1,299.00 · Airtel · Receipt *(required above ₹500.00)*

| Message | Answer |
|---|---|
| Add another expense to the Pune claim: lunch ₹420 at Haldiram's on 16 Oct, food | Card for the draft claim: 16 Oct · Food & meals · ₹420.00 · Haldiram's · Receipt *(optional)* |
| …save it as a draft, I have more to add | The same card, **Submit now** off, Confirm reads **Save expense** |
| Submit my Pune claim | Card: Client visit to Pune · 2 expenses · ₹1,270.00 · **[Submit claim]** |
| Submit my Pune claim *(a receipt missing)* | "Uber (15 Oct) needs a receipt before the claim can be submitted. **[Add the receipt]**" |
| Show my claims | A table: Client visit to Pune · EXP-2026-0012 · 2 · ₹1,270.00 · Awaiting approval |

---

## 6. Server checks

1. **Details come from the user's words.** Dates, half days, times, types, categories, amounts and merchants count only when the message gives them. The model's copy is used only when it matches what the user said. A date or amount the user never said is dropped, as in the other modules.
2. **Dates are worked out on the server** (`dates.ts`), leaning toward the future or the past as the design choices say. The model never does calendar maths.
3. **The API's own checks run before the card where an endpoint allows it:**
   - Leave: `GET /leave/preview` (days, balance, overlaps, weekends and holidays).
   - Work from home and fixes: overlaps and duplicates, from the user's own requests.
   - Claims: the receipt and age rules of submit.

   The API's message is shown in place of a card that would fail.
4. **A reason or a note is never invented.** Empty is fine.
5. **The tool must fit the message** (Prepared `reroute`, once per turn), as on Tasks and Roles:
   - A cancel needs a word for cancelling ("cancel", "withdraw", "take back"). "Second half leave on 28 Oct" sent to `cancel_leave` goes to `apply_leave`.
   - A message with a word for cancelling goes to the cancel tool. In the eval, "Cancel my WFH request for 2 Nov" came back as `request_wfh`.
6. **Other tabs' work is pointed to, not done** (`AiModule.elsewhere`, before any tool or model call). "Apply leave tomorrow" on the Attendance or Expenses tab, or "work from home" on the Leave tab, gets a one-line answer naming the right tab. In the eval, the model once answered "Apply leave tomorrow" on the Expenses tab with the list of claims.
7. **A new claim the server can read by itself needs no model** (`direct`): its title alone ("Add a new claim, client visit to Pune"), or its title with all four details. In the eval, the model once answered the second kind with broken JSON. A title made only of command words ("New claim") isn't taken as one.
8. **Reasons are never command or time words.** "Regularize", "clock in 9:30 and clock out 6:30" and "I came at 9:15" aren't reasons. "I forgot to clock out" is, written as "Forgot to clock out".
9. **The card is the last check.** Every field is editable, with the page's rules, and Confirm needs every required field. For a claim, it also needs the receipt if the edited amount and category require one.

---

## 7. Backend changes

**The reason becomes optional for work from home and fixes.** Today `createAttendanceRequestSchema` requires a reason for both (`'Give a reason'`), and so does the tab's drawer. As asked, both become optional, like leave and like an admin's recorded fix:

- `server/src/validators/attendance.validators.ts`: `reason` for employee requests becomes `z.string().trim().max(500).default('')`.
- `client/src/components/AttendanceRequestDrawer/AttendanceRequestDrawer.tsx`: the field is labelled **Reason (optional)**, and an empty reason no longer disables **Send request**.

Admins see "—" for a request without a reason, as they already do for recorded fixes. Nothing else changes: every other endpoint the assistants use already exists.

---

## 8. Shared changes

- **A call can use what an earlier call returned.** A new claim's expense goes to `/expenses/{0.id}/items`, where `{0.id}` is the id of the claim the first call created. Its receipt goes to `/expenses/{0.id}/items/{1.items.newest.id}/receipts` (the newest expense in the second call's answer: a claim's expenses are sorted by date, so the one just added isn't always last). Placeholders are filled in only from earlier results of the same Confirm.
- **A Confirm that partly succeeds is never run again.** If the receipt or the submit fails after the claim was created, the card is closed with what was saved: "The claim **Client visit to Pune** was saved as a draft, but it couldn't be submitted: … Finish it on the Expenses tab." Pressing Confirm again would otherwise create a second claim.
- **`revise()` knows whether a file was chosen**, so a receipt that became required after the amount was edited on the card is still asked for.
- **The card's file field takes a kind:** documents (PDF, Word, JPG, PNG) or receipts (PDF, JPG, PNG), both up to 10 MB.
- **Four new card form kinds:** `'leave'`, `'wfh'`, `'fix'` and `'claim'`.
- **A module can point to another page** (`AiModule.elsewhere`): a line answered before the draft, `direct` and the model.
- **Day readers in `dates.ts`:** one date, leaning toward the future, the past or "next unless within the last N days"; a run of days; the Hinglish day words; and the time reader for fixes.
- **An optional file can be left out:** its call is marked `skipWithoutFile`, and Confirm skips it when no file was chosen (a receipt under the category's limit).

---

## 9. Client changes

- **Route map:**

  | Route | Module | Example |
  |---|---|---|
  | `/me/leave` | `leave` | "Apply for leave from 3 Nov to 5 Nov" |
  | `/me/attendance` | `attendance` | "Work from home tomorrow" |
  | `/me/expenses` | `my-expenses` | "New claim for client visit to Pune" |

  Performance, Profile, Team and Holidays have no route, so no chat button shows there.
- **Starter chips:**
  - Leave: "Apply for leave", "My balance", "My requests".
  - Attendance: "Request WFH", "Request a fix", "My month".
  - Expenses: "New claim", "My claims".
- **Card forms** use the tabs' own fields and rules:
  - `AiLeaveForm`: type (with the balances), dates, full or half day, reason.
  - `AiWfhForm`: from, to, reason.
  - `AiFixForm`: date, clock in, clock out, reason.
  - `AiClaimForm`: title, date, category, amount, merchant, note, **Submit now**, and the receipt field, which turns required as the amount and category change.
- **After a confirmed change**, the tab reloads behind the drawer:
  - Leave: `refreshAfterLeaveChange`.
  - Attendance: `refreshMyAttendance`.
  - Expenses: `fetchMyClaims`.

---

## 10. Testing

- **Unit:** the readers:
  - dates leaning to the future, to the past, and "within the last 7 days";
  - ranges, including "Monday to Wednesday" and "for 3 days from Monday";
  - half days: first, second, morning and afternoon;
  - times: am/pm, "from 9:30 to 6:30" and a single time;
  - merchants: at, from, paid to;
  - amounts, using the Expenses readers.
- **Agent:** scripted model and fake API:
  - **Leave:**
    - paid with enough balance;
    - unpaid when the balance is short, with the note;
    - a named type;
    - a half day, first and second;
    - a type that doesn't exist;
    - weekends only;
    - no reason, and no invented reason;
    - balance, list and cancel.
  - **Attendance:**
    - one day and a range of work from home;
    - an overlap refused before the card;
    - a fix with both times;
    - a fix with one time, asking for the other;
    - a fix in the future;
    - the month;
    - cancel.
  - **Expenses:**
    - the full conversation: title, then the details in two replies, then the card;
    - a receipt required and optional;
    - over the limit;
    - Submit now off;
    - adding to a draft;
    - a submit refused for a missing receipt;
    - a Confirm that partly fails and isn't run again.
  - **Every tab:**
    - the right tab named for another tab's work;
    - not offered on the plan without `expenses`.
- **Client:**
  - each card form, including the receipt field turning required as the amount and category change;
  - the drawer on the three tabs, and not on the other four.
- **Eval on the real model:** `RUN_OLLAMA=1 OLLAMA_MODEL=llama3.2 npx jest tests/ai/me.eval`, with about 15 phrases per tab.

---

## 11. File flow: what happens when you type or speak

The shared path, file by file, is in [AI_ASSISTANT_PLAN.md, section 13](AI_ASSISTANT_PLAN.md#13-file-flow-what-happens-when-you-type-or-speak): the drawer, the AI route, the agent's order of decisions, and Confirm. This section shows only what is particular to the three Me page assistants. Typing and speaking are the same from the second step on: `useSpeechInput.ts` turns your voice into text, and that text is sent like typed text.

**The files**

| Part | File |
|---|---|
| Routes in the drawer | `AiAssistant.tsx`, `MODULE_ROUTES`: `/me/leave` → `leave`, `/me/attendance` → `attendance`, `/me/expenses` → `my-expenses` |
| Instructions and tools | `server/src/ai/modules/leave.module.ts`, `attendance.module.ts`, `myExpense.module.ts`; shared helpers in `me.helpers.ts` |
| Word readers | `../dates.ts`: `dayOf()`, `dayRangeOf()`, `timesIn()`, Hinglish days; `expense.helpers.ts` for amounts |
| REST API they call | Leave: `/leave/*` (`routes/leave.routes.ts` → `controllers/leave.controller.ts`). Attendance: `/attendance/*` (`routes/attendance.routes.ts` → `controllers/attendanceRequest.controller.ts`). Expenses: `/expenses`, `/expense-categories` (`routes/expense.routes.ts` → `controllers/expense.controller.ts`) |
| Card forms | `AiLeaveForm.tsx`, `AiAttendanceForms.tsx` (WFH and fix), `AiClaimForm.tsx` with `AiFileField.tsx` for the receipt |
| After Confirm | `refreshAfterLeaveChange`, `refreshMyAttendance`, `fetchMyClaims` |

**Before any tool:** each Me module has an `elsewhere` check (`otherTab()` in `me.helpers.ts`). "Apply leave" said on the Attendance tab is answered at step 2b with "Leave is on the Leave tab", with no tool and no model.

**Leave: "Apply for leave from 3 Nov to 5 Nov"**

1. **The model is asked**, and calls `apply_leave`.
2. `leave.module.ts` reads the dates itself: `dayRangeOf()` gives 3–5 Nov.
3. `GET /leave/balances` gives your types, and `GET /leave/preview` counts 3 working days on Paid Leave. If the balance is short, the preview says so, and it tries Unpaid Leave instead.
4. The result is a card. On Confirm: `POST /leave/requests` → `leave.controller.ts` `applyLeave()`.

**Attendance: "Fix yesterday, clock in 9:30 and clock out 6:30"**

1. **The model is asked**, and calls `request_fix`.
2. `attendance.module.ts` reads the date (`dayRangeOf()`, leaning to the past) and the times (`timesIn()`: 09:30 and 18:30).
3. It checks your own requests and leave first: `GET /attendance/requests/mine`, `GET /leave/requests/mine`.
4. The result is a card. On Confirm: `POST /attendance/requests` → `attendanceRequest.controller.ts`.

**Expenses: "New claim for the September internet bill, ₹1,299 at Airtel on 5 Oct"**

1. The module's `direct` (`newClaimStatement()`) reads the whole claim **without the model**: the title, amount, merchant and date, and the category from the title.
2. The card has a receipt field: `AiFileField.tsx`, required above the category's limit.
3. **On Confirm, four chained calls:**
   1. `POST /expenses` makes the claim;
   2. `POST /expenses/{0.id}/items` adds the expense. `fillPath()` in `agent.service.ts` puts in the new claim's id;
   3. `POST …/items/{1.items.newest.id}/receipts` sends the file. It is skipped when the receipt is optional and none was chosen;
   4. `POST …/submit`.
4. If a later call fails, `partial()` closes the card with what was saved, so Confirm can't make the claim twice.
