# Me Page Assistants: every Me tab through chat

The **Me** page has seven tabs, and each one has its own assistant, used by typing or speaking:

| Tab | Page | Example |
|---|---|---|
| Leave | `http://localhost:5173/me/leave` | "Apply for leave from 3 Nov to 5 Nov", "Half day tomorrow, second half" |
| Attendance | `http://localhost:5173/me/attendance` | "Work from home tomorrow", "Fix yesterday: clock in 9:30, clock out 6:30" |
| Expenses | `http://localhost:5173/me/expenses` | "New claim for client visit to Pune", "Add a claim for the September internet bill" |
| Performance | `http://localhost:5173/me/performance`, `…/me/performance?section=reviews` | "I'm at 60% on the onboarding goal", "Write my self review" |
| Profile | `http://localhost:5173/me/profile` | "Set my hobbies to cycling and chess", "My date of birth is 24 Oct 1995" |
| Team | `http://localhost:5173/me/team` | "Who is on leave this week?", "Who is my manager?" |
| Holidays | `http://localhost:5173/me/holidays` | "When is the next holiday?", "Any long weekends this year?" |

Leave, Attendance and Expenses were built first (sections 3–5). Performance, Profile, Team and Holidays were added later (sections 6–9). Until then, those four tabs showed the Navigation assistant, which only opens pages ([AI_NAVIGATION_ASSISTANT.md](AI_NAVIGATION_ASSISTANT.md)). Now no Me tab shows it, and every assistant can still open pages ("Go to projects").

The shared parts are described in [AI_ASSISTANT_PLAN.md](AI_ASSISTANT_PLAN.md): Ollama setup, running on a CPU, the agent loop, confirm cards, voice and plan gating. Section 7.3 of the plan sketched a Leave module before any module was built; this document replaces that sketch.

**Contents:** Status · Design choices · 1 Principle · 2 Who can use them · 3 Leave · 4 Attendance · 5 My expenses · 6 Performance · 7 Profile · 8 Team · 9 Holidays · 10 Server checks · 11 Backend changes · 12 Shared changes · 13 Client changes · 14 Testing · 15 File flow

---

## Status

**Leave, Attendance and Expenses: built (2026-10-22), not committed.**

- **Server:**
  - `leave.module.ts`, `attendance.module.ts` and `myExpense.module.ts`, with `me.helpers.ts`.
  - The day, range, time and Hinglish readers in `dates.ts`.
  - The shared changes in section 12.
  - The optional reason for work from home and fixes (section 11).
- **Client:**
  - The four card forms, and the receipt kind on the file field.
  - The three routes, and reloading each tab after a change.
  - The Request WFH and Request a fix drawer, with its reason now optional.
- **Tests:**
  - 49 new server tests (15 unit, 10 Leave, 12 Attendance, 12 Expenses); all 467 server tests pass.
  - 8 new client tests: the drawer shows on the three tabs and not the other four, and a claim's receipt turns required as its amount changes. The attendance drawer's tests pass with the optional reason.
- **Eval on llama3.2 (CPU):** 38/38 on the third run (Leave 14/14, Attendance 13/13, Expenses 11/11), 0–7 s per message.
  - The first run scored 32/38. The fixes are in section 10, rules 5–8:
    - "3 days of leave from Monday";
    - a cancel the model sent as a new request;
    - reasons made of command and time words;
    - broken JSON for a whole new claim;
    - "New claim" taken as a title;
    - leave asked about on the Expenses tab.
  - The second run scored 35/38: the three misses were correct answers to other tabs' work, given with no tool, which the eval didn't count yet.

**Performance, Profile, Team and Holidays: built (2026-10-29), not committed.**

- **Server:**
  - `performance.module.ts` with `performance.helpers.ts`; `myProfile.module.ts`, `myTeam.module.ts` and `myHolidays.module.ts`, with their readers in `me.helpers.ts`.
  - `otherTab()` for all seven tabs (section 10, rule 6).
  - `ToolDraft.freeText`, `AiModule.shows` and five new card form kinds (section 12).
- **Client:**
  - `AiPerformanceForms.tsx` (goal, check-in, review) and `AiProfileForms.tsx` (date of birth, introduction).
  - The four routes, and the reloads after a change.
  - The date of birth in the people store; the Holidays tab's year in the URL.
- **Tests:**
  - 123 new server tests (76 unit, 46 agent, 1 for the tool-call repair); all 697 server tests pass.
  - 3 new client tests: the review card's Confirm label and its required answers, the introduction card and its reloads, and the Holidays year from the URL. The drawer test now expects each tab's own assistant on all seven tabs (8 paths, with `?section=reviews`), and no Navigation assistant.
- **Eval on llama3.2 (CPU):** 90/90 on the second run, all seven tabs (Performance 16/16, Profile 13/13, Team 11/11, Holidays 12/12; Leave, Attendance and Expenses unchanged at 38/38).
  - On the four new tabs, 28 of the 52 messages were answered by the server with no model call, and none took more than 6 s.
  - The first run scored 51/52. llama3.2 wrote "I'd like to write Neha's review now" as text, with a key missing both quotes (`review:""`). There are two fixes (section 10, rule 12): any "write … review" is now read by the server, and the agent's repair of a written tool call also quotes bare keys.

---

## Design choices

| Question | Choice | Why |
|---|---|---|
| Which leave type when none is named? | **Paid leave if the balance covers the whole request, otherwise unpaid leave.** The card says why ("Paid Leave has 2 days left and this needs 3"), and the type can be changed on the card. | As asked. A request isn't split across two types: that would be two requests to approve. |
| Full day or half day? | **Full day**, unless the message says half day. A half day is the **first half** unless the message says second half, afternoon or after lunch. | As asked. The first half is also the page's default. |
| Is a reason needed? | **No**, for leave, work from home and fixes alike. | As asked. Leave already allows an empty reason; work from home and fixes didn't (section 11). |
| A date without a year | Leave: the **next** such date (leave can't start before today). Work from home: the next one, unless it was in the **last 7 days** (it can be asked for up to 7 days back). Fixes and expenses: the **last** such date (they're about the past). A goal's due date: the next one. A date of birth: the year must be said. | So "15 Oct", said on 22 Oct, is this year's for a fix and next year's for leave. |
| How does a claim end? | **One card makes the claim, adds the expense, attaches the receipt and submits it**, all on one Confirm. A **Submit now** switch on the card (on by default) keeps it as a draft instead. | As asked: title, then the expense's details, then the receipt, then submitted. |
| Receipts | **Chosen on the card.** It is required when the amount is above the category's receipt limit, as on the page, and optional otherwise. | The API refuses to submit a claim with a required receipt missing, so the card asks for it first. |
| More expenses in one claim | "Add another expense to my Pune claim" adds one to a **draft** claim. Saying "save as draft", "don't submit yet" or "I have more to add" turns **Submit now** off. | A trip often has several expenses. |
| One assistant per tab? | **Yes, all seven.** Performance has one assistant for its four sections (My goals, My reviews, My team, Reviews to write). | Each tab's work is different. The section behind the drawer follows the answer. |
| How are review answers given? | **One question at a time.** Every reply is the answer, word for word, except "skip", "done" and "stop". Then the rating, then the card with everything editable. | Answers are long and spoken freely. A small model can't reliably split one long message across several questions, and a wrong split would put words in the user's mouth. |
| Submit a review, or save a draft? | **A draft**, unless the user said "submit". The card has a **Submit now** switch. | Submitting can't be undone except by an admin (the page says so too). A draft can be changed any time. |
| A check-in that says "completed" | **Progress becomes 100%** unless a number was said. Progress and status not said stay as they are. | "Mark the hiring goal as done" means finished. The card shows both, and both can be changed. |
| A new goal's dates | **The due date is required** and asked for if missing. The start is **today** unless said, as on the page. | The page's form needs both; today is its default start. |
| Goals for someone else | **For the people who report to you**; an admin, for anyone. As on the page and the API. | "Set a goal for Neha" is a manager's everyday request. |
| Profile details | The job title, department, manager, joining date and email are **read-only**: the assistant answers questions about them and says the admin changes them. The date of birth and the introduction can be changed. | As on the tab: "Your organization admin keeps these details up to date, except your date of birth". |
| Team and Holidays | **Answers only**, as the tabs are read-only. Most questions are read by the server with **no model call**. | Nothing there can be changed. The questions are few and plain ("Who is on leave today?"), so the server answers in well under a second. |
| What happens to the page | After every confirmed change, the tab reloads behind the drawer. A list answer also moves the page: the Performance section, or the Holidays year. | As on the other pages. |

---

## 1. Principle

As in every module: **Ollama understands the request, and the Node.js backend does the work.** The model picks one of the tab's tools and copies the user's words. The server works out dates, half days, times, leave types, categories, amounts, goals, progress and ratings from those words. It previews what it can (leave days and balances) and shows a confirm card. On **Confirm**, it calls the existing endpoints with the user's own token, the same ones the tab's buttons use.

---

## 2. Who can use them

| Assistant | Who | Plan |
|---|---|---|
| Leave | Everyone in the organization: employees, and admins for their own leave | The `ai` feature (Professional) |
| Attendance | Everyone | The `ai` feature |
| My expenses | Everyone | The `ai` and `expenses` features |
| Performance | Everyone. Team goals and manager reviews only for the people the API allows (section 6.4) | The `ai` and `performance` features |
| Profile | Everyone | The `ai` feature |
| Team | Everyone | The `ai` feature |
| Holidays | Everyone | The `ai` feature |

They act for the signed-in person only. The exceptions are a manager's goals and reviews for their direct reports, which the Performance tab itself allows. Approving, recording leave or fixes for someone else, launching review cycles and adding holidays stay on the admin pages.

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
| Reason | "for a plumber visit", "reason: …" | Optional (section 11). |

The API refuses dates that overlap the user's own pending or approved work from home, or full-day leave. The server checks `GET /attendance/requests/mine` and `GET /leave/requests/mine` first, so the answer explains instead of showing a card that would fail.

### 4.2 Attendance fix (regularization)

| Detail | The user may say | Rule |
|---|---|---|
| Date | "yesterday", "on 15 Oct", "last Friday", "today" | Required. Not in the future, and at most 30 days back. |
| Clock in and clock out | "clock in 9:30, clock out 6:30", "9:30 am to 6:30 pm", "from 10 to 7", "09:30–18:30" | Both required. Clock-out after clock-in; for today, not later than now. |
| Reason | "forgot to clock out", "reason: …" | Optional (section 11). |

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

## 6. Performance (`/me/performance`)

The tab has four sections:

| Section | URL | Shown |
|---|---|---|
| My goals | `/me/performance` | Always |
| My reviews | `/me/performance?section=reviews` | Always |
| My team | `/me/performance?section=team` | When someone reports to the user |
| Reviews to write | `/me/performance?section=to-write` | When the user writes someone's manager review |

One assistant covers all four. A list answer moves the page to its section behind the drawer (`AiResult.view`).

The examples below assume today is **Thu 22 Oct 2026** and these two goals:
- **Launch the new onboarding flow**: 40%, On track, due Thu 31 Dec 2026, weight 40%.
- **Hire two backend engineers**: 20%, At risk, due Mon 30 Nov 2026, weight 30%.

They also assume an open review cycle, **H2 2026**. Its self review is due Fri 13 Nov 2026, and it has three questions: "What went well this period?", "What could have gone better?" and "What do you want to focus on next?".

### 6.1 A new goal

| Detail | The user may say | Rule |
|---|---|---|
| Title | "Set a goal to launch the onboarding flow", "New goal: hire a designer", "Add a goal called Ship v2" | Required, at most 120 characters. Asked for if missing. |
| Due date | "by 31 Jan", "due 15 Jan", "before 1 Dec", "by the end of the year", "by the end of next month" | Required, and not before the start. Asked for if missing. A date without a year is the next one. |
| Start date | "starting 1 Nov", "from 1 Oct" | Optional: **today** otherwise, as on the page. |
| Weight | "weight 20%", "20% weight", "weightage 20" | Optional, a whole number from 1 to 100. |
| Description | "description: the three new screens", "details: …" | Optional, at most 2,000 characters. |
| For | "for Neha", "for Neha Gupta" | Optional. Someone who reports to the user (an admin: anyone in the organization). Otherwise the goal is the user's own. |

The card warns when the weights of the user's running and completed goals would go over 100%: "Your goals' weights would add up to 110% (100% is usual)." As on the page, that's allowed.

### 6.2 A check-in, and changing a goal

A **check-in** records where a goal stands. It is how progress and status change, as in the goal's drawer.

| Detail | The user may say | Rule |
|---|---|---|
| Goal | "the onboarding goal", "hiring", "Launch the new onboarding flow" | Matched by the words of its title. If several match, buttons ask which. If the user has only one running goal, it needs no name. |
| Progress | "60%", "60 percent", "halfway" | 0 to 100. Unchanged when not said. "Completed" with no number is 100%. |
| Status | "on track", "at risk", "behind", "completed" / "done" / "finished", "cancel" / "drop", "reopen" | Unchanged when not said; a cancelled goal reopens as On track, as on the drawer. "60% done" is progress, not Completed. |
| Comment | "because design is late", "since two candidates dropped out", "comment: …" | Optional, at most 1,000 characters. Never invented. |

If the message says none of these ("Check in on the hiring goal"), the assistant asks: "Where does **Hire two backend engineers** stand? Say the progress (it's at 20%), a status (On track, At risk, Behind, Completed), or both."

**Cancelling** a goal is a check-in with the status Cancelled, on a red card: "Cancelling keeps the goal and its history; a later check-in reopens it."

**Changing** a goal (`update_goal`) changes its title ("rename … to …"), due date ("move the due date to 15 Jan", "push it to 15 Jan", "extend it to 15 Jan"), start date, weight or description. Progress and status change only with a check-in, as on the page. The card shows each change as old → new.

### 6.3 Reviews: a short conversation

Writing a review takes one question at a time:

1. **"Write my self review"** finds the user's review in an open cycle (launched or released) whose self review isn't submitted. If several are open, buttons ask which cycle. If none is open: "You have no self review to write right now. Reviews appear here when your admin starts a review cycle."
2. **The assistant asks each question that has no answer yet**, saved drafts included: "**Question 1 of 3** · H2 2026 · due Fri 13 Nov 2026: *What went well this period?* Answer in your own words. Say “skip” to leave it for later, “done” to finish now, or “stop”."
3. **Every reply is the answer, word for word.** The exceptions are "skip", "done" (or "that's all") and "stop" (or "cancel", "never mind"), and a request to go to a page ("Go to projects").
4. **Then the rating:** "How would you rate yourself, from 1 to 5? 1 Needs improvement · 2 Below expectations · 3 Meets expectations · 4 Exceeds expectations · 5 Outstanding." The reply may be "4", "four", "4 out of 5", "4/5" or "exceeds expectations". A rating said earlier ("Write my self review, I'd rate myself 4") isn't asked for again.
5. **The card** shows every question with its answer, and the rating. All of them are editable, and there is a **Submit now** switch:
   - **Off** by default: Confirm reads **Save draft** and saves it (`PUT /reviews/:id/self`), as the drawer's Save draft does.
   - **On** when the user said "submit". Confirm reads **Submit review** and submits it (`POST /reviews/:id/self/submit`). Every question and the rating are needed first, as on the page. The card says why if they're missing ("Answer every question (1 left) and choose a rating to submit"), and notes that a submitted review can't be changed unless an admin reopens it.
6. "Stop" ends it: "OK, I stopped. Nothing was saved." "Done" goes to the card with the answers so far.

"**Submit my self review**", when the saved draft already has every answer and a rating, goes straight to the card with Submit now on.

**A manager review** works the same way: "Write Neha's review" finds Neha's review in **Reviews to write**, and the questions say "for **Neha Gupta**'s review". It is open to her reviewer, and to admins for people without one, as the API allows. The rating question reads "How would you rate Neha, from 1 to 5?". Confirm calls `PUT /reviews/:id/manager` or `POST /reviews/:id/manager/submit`.

### 6.4 Who may do what

These follow the API, which checks again on Confirm:

| Action | Who |
|---|---|
| A goal of one's own: create, change, check in | The user |
| A goal for someone else | Their manager (someone who reports to the user), or an admin |
| A team member's goals: see, change, check in | Their manager, or an admin |
| The self review | Only the person reviewed |
| The manager review | The reviewer, or an admin when the person has no reviewer. Never the person reviewed |

"Set a goal for Asha" when Asha doesn't report to the user: "**Asha Rao** doesn't report to you. You can set goals for yourself and the people who report to you."

### 6.5 Tools

| Tool | Kind | Model fills in | Server does |
|---|---|---|---|
| `list_goals` | read | `whose?`, `status?` | `GET /goals/mine`, or `GET /goals/team` for the user's direct reports (`?ownerId=` for one of them) → a table (goal, owner, progress, status, due), with **Check in** buttons. "Need attention" means at risk, behind or overdue. The page moves to **My goals** or **My team** |
| `create_goal` | write | `title?`, `due?`, `start?`, `weight?`, `description?`, `for?` | reads the details → `GET /people` for a person named → asks for the title or due date if missing → card → `POST /goals` |
| `update_goal` | write | `goal`, `title?`, `due?`, `start?`, `weight?`, `description?` | finds the goal → card with old → new → `PUT /goals/:id` |
| `check_in_goal` | write | `goal?`, `progress?`, `status?`, `comment?` | finds the goal → card with old → new (red to cancel) → `POST /goals/:id/check-ins` |
| `list_reviews` | read | `which?` ("mine" or "to write") | `GET /reviews/mine` or `GET /reviews/to-write` → a table with **Write** buttons. The page moves to **My reviews** or **Reviews to write** |
| `write_review` | write | `person?`, `cycle?` | finds the review → `GET /reviews/:id` (questions and saved draft) → asks the questions and the rating → card → `PUT /reviews/:id/{self or manager}`, or `POST …/submit` |

Deleting a goal, and reopening or reassigning a review, stay on the page.

### 6.6 System prompt

```ts
systemPrompt: (ctx) => `${basePrompt(ctx, 'performance')}
You are the Performance assistant on the user's own Performance tab. You help them set goals, check in on them, change them, see their reviews, and write a review.
- Call a tool for every request, also when the user writes in Hindi or Hinglish.
- A new goal: call create_goal. Copy the title, the dates, the weight and the person it is for exactly as the user said them.
- Progress, a status or a comment on a goal ("60%", "at risk", "done", "cancel it"): call check_in_goal with the goal's name in the user's words.
- Changing a goal's title, dates or weight: call update_goal.
- Writing a self review, or a review of someone who reports to the user: call write_review. Fill in person only for someone else's review.
- Never write review answers yourself. The app asks the user each question.
- Never say that a goal or a review was saved. The app shows that after the backend confirms it.`
```

### 6.7 Examples

> **You:** I'm at 60% on the onboarding goal
>
> **Assistant:** *(card)* Check in · Goal **Launch the new onboarding flow** · Progress 40% → **60%** · Status **On track** · Comment **—** · **[Check in]** [Edit] [Cancel]

> **You:** Write my self review
>
> **Assistant:** **Question 1 of 3** · H2 2026 · due Fri 13 Nov 2026: *What went well this period?* Answer in your own words. Say “skip” to leave it for later, “done” to finish now, or “stop”. *[Fill in the form instead]*
>
> **You:** We shipped the new onboarding flow two weeks early and I mentored two juniors
>
> **Assistant:** **Question 2 of 3**: *What could have gone better?*
>
> **You:** skip
>
> **Assistant:** **Question 3 of 3**: *What do you want to focus on next?*
>
> **You:** Hiring, and getting the payments service to 99.9% uptime
>
> **Assistant:** How would you rate yourself, from 1 to 5? 1 Needs improvement · 2 Below expectations · 3 Meets expectations · 4 Exceeds expectations · 5 Outstanding
>
> **You:** 4
>
> **Assistant:** *(card)* Your H2 2026 self review · What went well this period? **We shipped the new onboarding flow…** · What could have gone better? **—** · What do you want to focus on next? **Hiring, and getting…** · Rating **4 · Exceeds expectations** · **[Save draft]** [Edit] [Cancel]

| Message | Answer |
|---|---|
| Set a goal to hire a designer by 31 Jan, weight 20% | Card: New goal · **Hire a designer** · Start Thu 22 Oct 2026 · Due Sun 31 Jan 2027 · Weight 20% · *Your goals' weights would add up to 90% (100% is usual).* |
| Set a goal to write the API docs | "When is **Write the API docs** due?" |
| Mark the hiring goal as completed | Card: Progress 20% → **100%** · Status At risk → **Completed** |
| Hiring is behind because two candidates dropped out | Card: Status At risk → **Behind** · Comment **two candidates dropped out** |
| Cancel the hiring goal | *(red card)* Cancel this goal? · Status At risk → **Cancelled** |
| Move the onboarding goal's due date to 15 Jan | Card: Due Thu 31 Dec 2026 → **Fri 15 Jan 2027** |
| Show my goals | A table of the two goals, with **Check in** buttons |
| Which of my team's goals need attention? | The team goals that are at risk, behind or overdue; the page moves to **My team** |
| Set a goal for Neha to close 10 deals by 31 Dec | Card: **New goal for Neha Gupta** · Close 10 deals · Due Thu 31 Dec 2026 |
| Show my reviews | A table: H2 2026 · 1 Jul → 31 Dec 2026 · Self review **Not started**, due Fri 13 Nov · Manager's rating **not released yet**; H1 2026 · Submitted · **4 · Exceeds expectations**. The page moves to **My reviews** |
| Submit my self review *(draft complete)* | Card with Submit now on: **[Submit review]** |
| Write Neha's review | **Question 1 of 3** · for **Neha Gupta**'s review · H2 2026 … |
| Apply leave tomorrow | "Leave is on the **Leave** tab: open it and ask there." |

---

## 7. Profile (`/me/profile`)

The tab shows the user's job details, which the admin keeps up to date, their date of birth, which they set themselves, and their introduction.

### 7.1 What it can change

| Detail | The user may say | Rule |
|---|---|---|
| Date of birth | "My date of birth is 24 Oct 1995", "I was born on 24/10/1995", "Set my birthday to 1995-10-24", "Remove my date of birth" | A full date with the year: without one, the assistant asks "Which year were you born?". Not in the future, and from 1900 on. Removing it is allowed, as on the page. |
| Introduction | "Set my hobbies to cycling and chess", "About me: a backend engineer from Pune", "What I love about my job is the people", "Clear my hobbies" | Three answers: **About me**, **My hobbies**, **What I love about my job**, each at most 1,000 characters. Only the ones named change. |

"**Write my introduction**" (or "Introduce myself") asks the three questions one at a time, as for a review (section 6.3), and shows each current answer: "**About me** (1 of 3). Tell your colleagues a little about yourself: where you are from, what you do, a fun fact. Now: *Backend engineer from Pune*. Say your answer, or “skip” to keep it." Every reply is the answer, as for a review, and the card shows each change as old → new.

The card for a date of birth notes: "Colleagues see only the day and month, to wish you on your birthday."

### 7.2 What it answers

| Message | Answer |
|---|---|
| Who is my manager? | "You report to **Rahul Mehta** (Engineering Manager)." |
| What's my job title? | "Your job title is **Backend Engineer**." |
| Which department am I in? | "You're in **Engineering**." |
| When did I join? | "You joined on **Mon 3 Mar 2025**." |
| What's my email? | "Your email is **priya@acme.com**." |
| Show my profile | A table: Name, Email, Job title, Department, Reports to, Date of joining, Date of birth, Introduction (2 of 3 answered) |

### 7.3 What it doesn't change

| Message | Answer |
|---|---|
| Change my job title to Senior Engineer | "Your organization admin keeps your **job title** up to date. Ask them to change it." The same for the department, manager, joining date and email. |
| Change my photo, Change my name | "Your photo and name are changed on **My profile** (the menu under your name, top right). Say “Go to my profile” to open it." |
| Change my password | "Your password is changed on **Change password**. Say “Go to change password” to open it." |

### 7.4 Tools

| Tool | Kind | Model fills in | Server does |
|---|---|---|---|
| `my_profile` | read | `about?` ("manager", "job title", …) | `GET /auth/me`, `GET /people`, `GET /me/profile-details`, `GET /me/introduction` → the one detail asked for, or the whole profile as a table |
| `set_birthday` | write | `date?` | reads the date, or "remove" → card → `PUT /me/profile-details` `{ dateOfBirth }` (null removes it) |
| `update_introduction` | write | `about?`, `hobbies?`, `lovesAboutJob?` | reads which answers change and to what → `GET /me/introduction` → card (old → new) → `PUT /me/introduction` with only those |

### 7.5 System prompt

```ts
systemPrompt: (ctx) => `${basePrompt(ctx, 'your profile')}
You are the Profile assistant on the user's own Profile tab. You help them see their job details, set their date of birth, and write their introduction (about me, hobbies, what they love about their job).
- Call a tool for every request, also when the user writes in Hindi or Hinglish.
- Questions about their manager, job title, department, joining date or email: call my_profile.
- Date of birth: call set_birthday with the date exactly as the user said it.
- Introduction: call update_introduction with each answer exactly as the user said it. Leave out the ones they didn't mention.
- Never make up an answer or a date.
- The job title, department, manager, joining date and email are kept by the organization admin. Say so if asked to change them.
- Never say that something was saved. The app shows that after the backend confirms it.`
```

### 7.6 Examples

> **You:** Set my hobbies to cycling and chess
>
> **Assistant:** *(card)* Update your introduction · My hobbies ~~Reading~~ → **Cycling and chess** · **[Save]** [Edit] [Cancel]

> **You:** My date of birth is 24 Oct
>
> **Assistant:** Which year were you born?
>
> **You:** 1995
>
> **Assistant:** *(card)* Set your date of birth · **Tue 24 Oct 1995** · *Colleagues see only the day and month, to wish you on your birthday.* · **[Save]**

---

## 8. Team (`/me/team`)

The tab shows the user's manager, their teammates (the people who share that manager) and the people who report to them. For each, it shows who is on approved leave today or this week (Monday to Sunday). Nothing on the tab can be changed, so the assistant only answers.

The examples assume the user reports to **Rahul Mehta**. Their teammates are **Asha Rao** (on leave today, first half) and **Vikram Singh** (on leave Fri 23 Oct), and **Neha Gupta** reports to them.

### 8.1 What it answers

| Message | Answer |
|---|---|
| Who is my manager? | "Your manager is **Rahul Mehta** (Engineering Manager · Engineering). Available this week." |
| Who is on leave today? | "**Asha Rao** is on leave today (first half)." With no one away: "No one in your team is on leave today." |
| Who's on leave this week? | "On leave this week: **Asha Rao** (today, first half), **Vikram Singh** (Fri 23 Oct)." |
| Is Vikram available on Friday? | "**Vikram Singh** is on leave on Fri 23 Oct 2026." A day without leave: "**Vikram Singh** has no leave on Mon 19 Oct 2026." |
| Is Asha in next week? | "I can only see leave for this week (Mon 19 Oct → Sun 25 Oct 2026). Ask Asha, or Rahul Mehta." |
| Who reports to me? | "**1 person** reports to you: Neha Gupta (Frontend Engineer)." With no one: "No one reports to you." |
| Who are my teammates? | "Your teammates (they also report to Rahul Mehta): Asha Rao, Vikram Singh." |
| Is Mike in my team? | "**Mike** isn't in your team. Your team is your manager, the people who share your manager, and the people who report to you." |
| Show my team | A table: Name · In your team as (Manager, Teammate, Reports to you) · Job title · Department · This week (On leave today / On leave Fri 23 Oct / Available) |

With no team at all: "You're not in a team yet. Ask your admin to set your manager."

Only approved leave counts, as on the tab. Work from home isn't shown on this tab, so the assistant doesn't answer it: "The Team tab shows leave only, not work from home."

### 8.2 Tools

| Tool | Kind | Model fills in | Server does |
|---|---|---|---|
| `my_team` | read | `who?`, `person?`, `day?` | `GET /me/team` → the answer the words ask for (section 8.1), or the whole team as a table |

Almost every question is read by the server alone (`direct`), with no model call. The model is asked only for wording the reader doesn't know, and it can only call `my_team`.

### 8.3 System prompt

```ts
systemPrompt: (ctx) => `${basePrompt(ctx, 'your team')}
You are the Team assistant on the user's own Team tab. You answer questions about their manager, their teammates (people with the same manager), the people who report to them, and who is on leave today or this week.
- Call my_team for every question, also when the user writes in Hindi or Hinglish.
- Copy the person's name and the day exactly as the user said them.
- You can't change anything here. The organization admin sets who reports to whom.`
```

---

## 9. Holidays (`/me/holidays`)

The tab shows the organization's holidays for a year: last year, this year or next year. Only the admin adds them, on the **Holidays** page, so the assistant only answers. A list answer moves the tab to its year: the tab now reads the year from the URL (`/me/holidays?year=2027`).

The examples assume these holidays: Gandhi Jayanti (Fri 2 Oct), Dussehra (Tue 20 Oct), Diwali (Sun 8 Nov), Guru Nanak Jayanti (Tue 24 Nov) and Christmas (Fri 25 Dec 2026), and Republic Day (Tue 26 Jan 2027).

### 9.1 What it answers

| Message | Answer |
|---|---|
| When is the next holiday? | "The next holiday is **Diwali** on **Sun 8 Nov 2026**, in 17 days." The last one of the year is followed by next year's first. |
| Show holidays this year | A table: Date · Holiday · Note, with the ones already past marked; the tab shows 2026 |
| Holidays in December | "**1 holiday** in December 2026: Christmas, Fri 25 Dec." |
| Is 25 Dec a holiday? | "Yes: **Fri 25 Dec 2026** is **Christmas**." Otherwise: "No: Tue 3 Nov 2026 isn't a holiday." A weekend is named: "No: Sat 31 Oct 2026 isn't a holiday. It's a Saturday, though.", "Yes: **Sun 8 Nov 2026** is **Diwali**. It falls on a Sunday." |
| How many holidays are left this year? | "**3 holidays** are left in 2026:" and a table |
| Show next year's holidays | A table for 2027; the tab moves to 2027 |
| Any long weekends? | "Long weekends from today: **Christmas**, Fri 25 Dec → Sun 27 Dec 2026 (3 days). With a day of leave: **Guru Nanak Jayanti**: take Mon 23 Nov 2026 off for Sat 21 Nov → Tue 24 Nov 2026 (4 days)." |
| When is Diwali? | "**Diwali** is on **Sun 8 Nov 2026**, in 17 days." |

A long weekend is a holiday on a Friday or a Monday. A holiday on a Tuesday or a Thursday makes one with a day of leave, which the answer names. Holidays on a weekend make none.

| Message | Answer |
|---|---|
| Add a holiday on 31 Dec *(admin)* | "Holidays are added on the **Holidays** page. Say “Go to holidays” to open it." |
| Add a holiday on 31 Dec *(employee)* | "Only your organization's admin adds holidays." |
| Apply leave on 24 Dec | "Leave is on the **Leave** tab: open it and ask there." |

### 9.2 Tools

| Tool | Kind | Model fills in | Server does |
|---|---|---|---|
| `list_holidays` | read | `when?` (a year, month, date or holiday name) | `GET /holidays?year=` (two years when the question crosses into next year) → the answer the words ask for (section 9.1). The tab moves to the year shown |

As on the Team tab, almost every question is read by the server alone (`direct`).

### 9.3 System prompt

```ts
systemPrompt: (ctx) => `${basePrompt(ctx, 'holidays')}
You are the Holidays assistant on the user's own Holidays tab. You answer questions about the organization's holiday calendar.
- Call list_holidays for every question, also when the user writes in Hindi or Hinglish.
- Copy the year, the month, the date or the holiday's name exactly as the user said them.
- You can't change the calendar. The organization admin adds holidays.`
```

---

## 10. Server checks

1. **Details come from the user's words.** Dates, half days, times, types, categories, amounts, merchants, progress, statuses, weights and ratings count only when the message gives them. The model's copy is used only when it matches what the user said. A date or amount the user never said is dropped, as in the other modules.
2. **Dates are worked out on the server** (`dates.ts`), leaning toward the future or the past as the design choices say. The model never does calendar maths.
3. **The API's own checks run before the card where an endpoint allows it:**
   - Leave: `GET /leave/preview` (days, balance, overlaps, weekends and holidays).
   - Work from home and fixes: overlaps and duplicates, from the user's own requests.
   - Claims: the receipt and age rules of submit.
   - Goals: the dates in order, the weight from 1 to 100, and who the goal may be for.
   - Reviews: an open cycle and a part not yet submitted, and, to submit, every question and a rating.

   The API's message is shown in place of a card that would fail.
4. **A reason, a note, a comment or an answer is never invented.** Empty is fine.
5. **The tool must fit the message** (Prepared `reroute`, once per turn), as on Tasks and Roles:
   - A cancel needs a word for cancelling ("cancel", "withdraw", "take back"). "Second half leave on 28 Oct" sent to `cancel_leave` goes to `apply_leave`.
   - A message with a word for cancelling goes to the cancel tool. In the eval, "Cancel my WFH request for 2 Nov" came back as `request_wfh`.
6. **Other tabs' work is pointed to, not done** (`AiModule.elsewhere`, before any tool or model call). "Apply leave tomorrow" on the Attendance or Expenses tab, or "work from home" on the Leave tab, gets a one-line answer naming the right tab. In the eval, the model once answered "Apply leave tomorrow" on the Expenses tab with the list of claims. Every tab now points to all the others (`otherTab()` in `me.helpers.ts`):
   - "Set a goal" on the Leave tab → Performance.
   - "Apply leave" on the Team or Holidays tab → Leave.
   - "When is the next holiday?" on the Profile tab → Holidays.
   - "Who is on leave today?" on the Performance tab → Team.

   A message with the tab's own words stays on that tab: "Who is on leave today?" on the Team tab is the Team tab's question, not the Leave tab's.
7. **A new claim the server can read by itself needs no model** (`direct`): its title alone ("Add a new claim, client visit to Pune"), or its title with all four details. In the eval, the model once answered the second kind with broken JSON. A title made only of command words ("New claim") isn't taken as one.
8. **Reasons are never command or time words.** "Regularize", "clock in 9:30 and clock out 6:30" and "I came at 9:15" aren't reasons. "I forgot to clock out" is, written as "Forgot to clock out".
9. **The card is the last check.** Every field is editable, with the page's rules, and Confirm needs every required field. For a claim, it also needs the receipt if the edited amount and category require one. For a review with Submit now on, it needs every answer and a rating.
10. **A free-text answer is taken as it is.** While the assistant waits for a review answer or an introduction answer, the reply skips the small-talk and other-tab checks: "Great teamwork this quarter" is an answer, not a thank-you, and "I took less leave" is not sent to the Leave tab. A request to go to a page still opens it ("Go to projects").
11. **Who may do what follows the API** (section 6.4), and the API checks again on Confirm with the user's own token.
12. **Plain requests need no model** (`direct`): "Show my goals", "Write my self review", "Write Neha's review", nearly every Team and Holidays question, and "Who is my manager?" on the Profile tab. In the eval, the model once wrote "I'd like to write Neha's review now" as broken JSON. The agent's repair of a tool call written as text also quotes keys with no quotes at all, but only after a first parse fails, so well-formed JSON is never changed.

---

## 11. Backend changes

**The reason becomes optional for work from home and fixes.** Before, `createAttendanceRequestSchema` required a reason for both (`'Give a reason'`), and so did the tab's drawer. As asked, both became optional, like leave and like an admin's recorded fix:

- `server/src/validators/attendance.validators.ts`: `reason` for employee requests becomes `z.string().trim().max(500).default('')`.
- `client/src/components/AttendanceRequestDrawer/AttendanceRequestDrawer.tsx`: the field is labelled **Reason (optional)**, and an empty reason no longer disables **Send request**.

Admins see "—" for a request without a reason, as they already do for recorded fixes.

**No endpoint changes for Performance, Profile, Team and Holidays.** They use the endpoints their tabs already use: `/goals`, `/reviews`, `/me/team`, `/me/introduction`, `/me/profile-details`, `/people`, `/auth/me` and `/holidays`.

---

## 12. Shared changes

- **A call can use what an earlier call returned.** A new claim's expense goes to `/expenses/{0.id}/items`, where `{0.id}` is the id of the claim the first call created. Its receipt goes to `/expenses/{0.id}/items/{1.items.newest.id}/receipts` (the newest expense in the second call's answer: a claim's expenses are sorted by date, so the one just added isn't always last). Placeholders are filled in only from earlier results of the same Confirm.
- **A Confirm that partly succeeds is never run again.** If the receipt or the submit fails after the claim was created, the card is closed with what was saved: "The claim **Client visit to Pune** was saved as a draft, but it couldn't be submitted: … Finish it on the Expenses tab." Pressing Confirm again would otherwise create a second claim.
- **`revise()` knows whether a file was chosen**, so a receipt that became required after the amount was edited on the card is still asked for.
- **The card's file field takes a kind:** documents (PDF, Word, JPG, PNG) or receipts (PDF, JPG, PNG), both up to 10 MB.
- **Card form kinds:** `'leave'`, `'wfh'`, `'fix'` and `'claim'`; then `'goal'`, `'checkin'`, `'review'`, `'birthday'` and `'introduction'`.
- **A module can point to another page** (`AiModule.elsewhere`): a line answered before the draft, `direct` and the model.
- **Day readers in `dates.ts`:** one date, leaning toward the future, the past or "next unless within the last N days"; a run of days; the Hinglish day words; and the time reader for fixes.
- **An optional file can be left out:** its call is marked `skipWithoutFile`, and Confirm skips it when no file was chosen (a receipt under the category's limit).
- **A draft can wait for free text** (`ToolDraft.freeText`): the next reply skips small talk and `elsewhere` (section 10, rule 10) and goes to the tool's `fillFromReply` as it is.

---

## 13. Client changes

- **Route map:**

  | Route | Module | Example |
  |---|---|---|
  | `/me/leave` | `leave` | "Apply for leave from 3 Nov to 5 Nov" |
  | `/me/attendance` | `attendance` | "Work from home tomorrow" |
  | `/me/expenses` | `my-expenses` | "New claim for client visit to Pune" |
  | `/me/performance` | `performance` | "I'm at 60% on the onboarding goal" |
  | `/me/profile` | `my-profile` | "Set my hobbies to cycling and chess" |
  | `/me/team` | `my-team` | "Who is on leave this week?" |
  | `/me/holidays` | `my-holidays` | "When is the next holiday?" |

  Every Me tab now has its own assistant, so none shows the Navigation assistant. Every assistant still opens pages.
- **Starter chips:**
  - Leave: "Apply for leave", "My balance", "My requests".
  - Attendance: "Request WFH", "Request a fix", "My month".
  - Expenses: "New claim", "My claims".
  - Performance: "My goals", "New goal", "My reviews", "Write self review".
  - Profile: "My profile", "Edit introduction", "Set date of birth".
  - Team: "My team", "On leave today", "On leave this week".
  - Holidays: "Next holiday", "This year", "Long weekends".
- **Card forms** use the tabs' own fields and rules:
  - `AiLeaveForm`: type (with the balances), dates, full or half day, reason.
  - `AiWfhForm`: from, to, reason.
  - `AiFixForm`: date, clock in, clock out, reason.
  - `AiClaimForm`: title, date, category, amount, merchant, note, **Submit now**, and the receipt field, which turns required as the amount and category change.
  - `AiGoalForm`: who it's for (a new goal for a team member), title, description, start, due, weight, as in the New goal dialog.
  - `AiCheckInForm`: progress, status, comment, as in the goal drawer's Check in.
  - `AiReviewForm`: each question with its answer, the 1–5 rating, and **Submit now**. Confirm reads **Submit review** or **Save draft** as the switch changes.
  - `AiBirthdayForm`: the date of birth, or none.
  - `AiIntroductionForm`: About me, My hobbies, What I love about my job.
- **After a confirmed change**, the tab reloads behind the drawer:
  - Leave: `refreshAfterLeaveChange`.
  - Attendance: `refreshMyAttendance`.
  - Expenses: `fetchMyClaims`.
  - Performance: `fetchMyGoals`, `fetchTeamGoals`, `fetchMyReviews` and `fetchReviewsToWrite`.
  - Profile: `fetchMyIntroduction`, and `fetchMyDetails` for the date of birth. The date of birth moves from the `MyDateOfBirth` component's own state into the people store, so it can reload.
- **The page follows a list answer:** Performance moves to the answer's section (`?section=`); Holidays moves to its year (`?year=`, which the tab now reads from the URL instead of keeping it to itself).

---

## 14. Testing

- **Unit:** the readers:
  - dates leaning to the future, to the past, and "within the last 7 days";
  - ranges, including "Monday to Wednesday" and "for 3 days from Monday";
  - half days: first, second, morning and afternoon;
  - times: am/pm, "from 9:30 to 6:30" and a single time;
  - merchants: at, from, paid to;
  - amounts, using the Expenses readers;
  - goal titles, due and start dates, weights, progress, statuses and comments, and finding a goal by its words;
  - ratings: "4", "four", "4 out of 5", "exceeds expectations";
  - dates of birth with and without a year, and the introduction's three answers;
  - the Team and Holidays questions;
  - `otherTab()` on all seven tabs.
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
  - **Performance:**
    - a new goal with all its details, and with the due date asked for;
    - a goal for a direct report, and refused for someone else;
    - a check-in with progress, with "completed", and a cancel on a red card;
    - asking which goal when several match;
    - changing a due date;
    - the goals and reviews lists, and the section the page moves to;
    - the whole self review conversation: questions, "skip", the rating, the card, Save draft;
    - submitting a complete draft, and refusing an incomplete one;
    - "stop" and "done";
    - "Great teamwork" taken as an answer, not small talk;
    - a manager review.
  - **Profile:** each detail asked about; a date of birth with the year asked for; removing it; one introduction answer; the three-question introduction; job details refused.
  - **Team:** manager, on leave today and this week, a person on a day, reports, teammates, someone not in the team, no team.
  - **Holidays:** next, a month, a date, left this year, next year (and the tab's year), long weekends.
  - **Every tab:**
    - the right tab named for another tab's work;
    - not offered on the plan without `expenses` (Expenses) or `performance` (Performance).
- **Client:**
  - each card form, including the receipt field turning required as the amount and category change, and the review's Confirm label following Submit now;
  - the drawer on all seven tabs, with each tab's own assistant;
  - the Holidays tab's year read from the URL.
- **Eval on the real model:** `RUN_OLLAMA=1 OLLAMA_MODEL=llama3.2 npx jest tests/ai/me.eval`, with about 10–15 phrases per tab.

---

## 15. File flow: what happens when you type or speak

The shared path, file by file, is in [AI_ASSISTANT_PLAN.md, section 13](AI_ASSISTANT_PLAN.md#13-file-flow-what-happens-when-you-type-or-speak): the drawer, the AI route, the agent's order of decisions, and Confirm. This section shows only what is particular to the Me page assistants. Typing and speaking are the same from the second step on: `useSpeechInput.ts` turns your voice into text, and that text is sent like typed text.

**The files**

| Part | File |
|---|---|
| Routes in the drawer | `AiAssistant.tsx`, `MODULE_ROUTES`: `/me/leave` → `leave`, `/me/attendance` → `attendance`, `/me/expenses` → `my-expenses`, `/me/performance` → `performance`, `/me/profile` → `my-profile`, `/me/team` → `my-team`, `/me/holidays` → `my-holidays` |
| Instructions and tools | `server/src/ai/modules/leave.module.ts`, `attendance.module.ts`, `myExpense.module.ts`, `performance.module.ts`, `myProfile.module.ts`, `myTeam.module.ts`, `myHolidays.module.ts`; shared helpers in `me.helpers.ts` and `performance.helpers.ts` |
| Word readers | `../dates.ts`: `dayOf()`, `dayRangeOf()`, `timesIn()`, Hinglish days; `expense.helpers.ts` for amounts; `performance.helpers.ts` for goals, progress, statuses and ratings; `me.helpers.ts` for dates of birth, the introduction, and the Team and Holidays questions |
| REST API they call | Leave: `/leave/*` (`routes/leave.routes.ts` → `controllers/leave.controller.ts`). Attendance: `/attendance/*` (`routes/attendance.routes.ts` → `controllers/attendanceRequest.controller.ts`). Expenses: `/expenses`, `/expense-categories` (`routes/expense.routes.ts` → `controllers/expense.controller.ts`). Performance: `/goals/*` (`goal.routes.ts` → `goal.controller.ts`), `/reviews/*` (`review.routes.ts` → `review.controller.ts`). Profile and Team: `/me/*` (`me.routes.ts` → `me.controller.ts`), `/people`, `/auth/me`. Holidays: `/holidays` (`holiday.routes.ts` → `holiday.controller.ts`) |
| Card forms | `AiLeaveForm.tsx`, `AiAttendanceForms.tsx` (WFH and fix), `AiClaimForm.tsx` with `AiFileField.tsx` for the receipt, `AiPerformanceForms.tsx` (goal, check-in, review), `AiProfileForms.tsx` (date of birth, introduction) |
| After Confirm | `refreshAfterLeaveChange`, `refreshMyAttendance`, `fetchMyClaims`; `fetchMyGoals`, `fetchTeamGoals`, `fetchMyReviews`, `fetchReviewsToWrite`; `fetchMyIntroduction`, `fetchMyDetails` |

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

**Performance: "Write my self review"**

1. **The model is asked**, and calls `write_review` with no person.
2. `performance.module.ts` finds your open review (`GET /reviews/mine`), then loads its questions and saved draft (`GET /reviews/:id`).
3. It asks the first unanswered question and saves a draft marked `freeText`, waiting for question 1.
4. **Your reply** goes to `fillFromReply()` at step 3 of the turn, with no model call and no small-talk check: the reply is the answer. The next question is asked, and so on, then the rating (`ratingFrom()` in `performance.helpers.ts`).
5. The result is a card with `AiReviewForm.tsx`. On Confirm: `PUT /reviews/:id/self` (Save draft) or `POST /reviews/:id/self/submit` → `review.controller.ts` `writePart()`.
6. The tab reloads its reviews behind the drawer.

**Holidays: "When is the next holiday?"**

1. The module's `direct` reads the question itself (`holidayQuestion()` in `me.helpers.ts`): the next holiday. **No model call.**
2. `myHolidays.module.ts` calls `GET /holidays?year=2026`, and next year's too if none is left this year.
3. The answer names the holiday and the days until it.
