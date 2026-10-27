# Expenses Assistant: claims, the summary and categories through chat

On the **Expenses** page (`http://localhost:5173/expenses`), an admin works with all three tabs by typing or speaking:

- **Claims:** "Show submitted claims from Rahul in Travel for this month", "Export the CSV".
- **Summary:** "Summary for last month", "Show spending from 1 Sep to 15 Oct".
- **Categories:** "Add a category Client meals with a limit of ₹2,000 and receipt needed above ₹500", "Deactivate Travel", "Delete Snacks".

This document covers the Expenses module only. The shared parts are described in [AI_ASSISTANT_PLAN.md](AI_ASSISTANT_PLAN.md): Ollama setup, running on a CPU, the agent loop, confirm cards, voice and plan gating.

**Contents:** Status · Design choices · 1 Principle · 2 Who can do what · 3 Claims tab · 4 Summary tab · 5 Categories tab · 6 Example conversations · 7 System prompt · 8 Tools · 9 Server checks · 10 Backend changes · 11 Shared changes · 12 Client changes · 13 Testing · 14 File flow

---

## Status

**Built (2026-10-21), not committed.**

- **Server:**
  - `server/src/ai/modules/expense.helpers.ts`: the readers for statuses, date ranges and amounts.
  - `expense.module.ts`: the seven tools.
  - `AiResult.view`, and a seventh card kind, `'category'`.
- **Client:**
  - The Claims and Summary tabs read their filters from the URL.
  - The drawer moves the page for a live answer.
  - `AiCategoryForm.tsx` on the card.
  - The `/exports/expenses?from&to` download.
- **Tests:**
  - 40 Expenses tests on the server (15 unit, 25 agent); all 418 server tests pass.
  - On the client: 4 new assistant UI tests and 2 new page tests for the URL filters; all 31 assistant and Expenses page tests pass.
- **Eval on llama3.2 (CPU):** 20/20 on the second run.
  - The first run scored 18/20. "Show paid claims from 1 Sep to 30 Sep" went to `expense_summary`, and the server now answers it with the list (section 9, rule 4). The other miss was the eval's own check, which hadn't accepted a create rerouted to update.
  - The server's checks held. The model added the admin's own name as an employee filter for "Load the claims", and "Rahul" as dates; both were dropped.
  - "Export the CSV" takes no model time. Other messages took 2–31 s, the slow ones while the test suite shared the CPU.

---

## Design choices

| Question | Choice | Why |
|---|---|---|
| Where does a list show? | **In the chat, and the page behind the drawer follows.** "Show approved claims for October" answers with a table in the chat. The page also switches to the Claims tab with the same filters. A summary request does the same on the Summary tab. | The request is to "load the list". The page's own table, with its review drawer and Mark as paid, then shows exactly what was asked, and the chat keeps a record. |
| How are the page's filters set? | **In the URL** (`?status=approved&from=2026-10-01&to=2026-10-31`). The Claims and Summary tabs read their filters from it. | The assistant only has to change the address, and a filtered view can be bookmarked or shared. Filters picked by hand work as before. |
| Who reads dates, amounts and statuses? | **The server, from the user's own words.** The model picks the tool and copies the words. | The other evals showed the model mixing up fields and getting calendar maths wrong. A server-side reader does it the same way every time. |
| "Export the CSV" | **Downloads at once**, like the Exports assistant. It uses the dates the message gives, or else the dates of the latest list or summary in this chat, or else this month. | This is the same file as the page's **Export CSV** button: one row per expense in a date range. Like the button, it ignores the status, employee and category filters, and the answer says so. |
| Amounts | **Rupees in chat and on the card**, paise for the API, as on the page's form | People say "₹2,000" or "2k", and the API stores paise. |
| Deleting a category in use | **Refused before the card** when submitted claims use it, with a **Deactivate instead** button | The API refuses it ("This category is used by expenses. Deactivate it instead."). |
| Reviewing, approving and paying claims | **Not in this module.** They stay on the page (the review drawer and **Mark as paid**). | Not asked for. The chat's list makes the right claims easy to find. |

---

## 1. Principle

As in every module: **Ollama understands the request, and the Node.js backend does the work.** The model picks one of the module's tools and copies the user's words. The server reads statuses, people, categories, dates and amounts from them, and calls the existing `/api/v1/expenses`, `/expense-categories` and `/exports/expenses` endpoints with the admin's own token. Category changes show a confirm card and run only on **Confirm**.

---

## 2. Who can do what

| Who | Gets |
|---|---|
| ORG_ADMIN | Every tool. The Expenses page and its admin endpoints use `requireOrgAdmin`. |
| ORG_USER | No assistant on this page. An employee's own claims live elsewhere (a later phase). |

The module needs the plan's `expenses` feature, on top of `ai`. **Export the CSV** also needs the plan's `exports` module, like the page's button.

---

## 3. Claims tab

`GET /expenses` lists everyone's claims except drafts. It takes `status`, `employeeId`, `categoryId`, `from` and `to` (expense dates), 20 to a page.

**Words for the statuses:**

| Status | The user may say |
|---|---|
| Submitted | submitted, pending, waiting, awaiting approval, to approve, to review |
| Approved | approved, to be paid, awaiting payment, unpaid |
| Rejected | rejected, declined, refused |
| Paid | paid, reimbursed, settled |
| *(any)* | all claims, every status |

**Employee and category:** matched by name, as elsewhere: exact, initials, a unique prefix or a whole word. People come from `GET /people`, and categories from `GET /expense-categories?all=true` (inactive ones too, since old claims use them). Several matches get a question with buttons.

**Dates** are expense dates, as on the page's date filter:

| Words | Range |
|---|---|
| today, yesterday | that day |
| this week, last week | Monday to Sunday |
| this month, last month, this year, last year | the whole period (until today for "this") |
| October, Oct 2025 | that month |
| last 30 days | today and the 29 days before |
| from 1 Oct to 15 Oct, between 1 and 15 October | those days |
| since 1 Oct, after 1 Oct | from that day to today |
| until 15 Oct, before 15 Oct | up to that day (the summary and the export start on the 1st of that month, as the API does) |

**The answer:** "**12 claims** · Approved · Rahul Sharma · Travel · 1 Oct – 21 Oct 2026", with a table (Employee, Claim, Submitted, Expenses, Total, Status), a **Show more** button past 20, and the Claims tab showing the same filters.

**Export the CSV:** the browser downloads `GET /exports/expenses?from=…&to=…` at once, with the admin's token, under the name the server gives. The answer says which dates the file covers, and that it covers every status and employee, as the page's export does.

---

## 4. Summary tab

`GET /expenses/summary?from=…&to=…` gives approved and paid spending by expense date, by category and by department, plus what is waiting right now. Its range defaults to this month and is at most a year.

The answer shows:

- one line: "**1 Oct – 21 Oct 2026**: ₹84,500 approved, ₹60,000 of it paid. Waiting now: 3 claims (₹12,400) to approve, 2 (₹9,800) to pay."
- a table by category (Category, Total, Expenses), with a **By department** button for the same table by department.

The page switches to the Summary tab with the same dates. Dates are read as in section 3. A range over a year, or ending before it starts, gets the API's own message.

---

## 5. Categories tab

A category has a **name** (required, at most 60 characters, unique), a **limit per expense** (optional; none = no limit), **receipt needed above** (default ₹500; 0 = always) and **active** (default yes). These are the page's form fields and defaults.

**Words for the fields:**

| Field | The user may say |
|---|---|
| Limit per expense | "limit ₹2,000", "limit of 2k", "up to 5000 per expense", "max 1.5 lakh", "no limit" |
| Receipt needed above | "receipt above ₹500", "receipt needed over 1000", "receipt required above 0", "always needs a receipt" (= 0) |
| Active | active (the default); inactive, switched off, disabled; on an update also "deactivate", "switch off", "turn on", "reactivate" |

**Amounts:** "₹2,000", "2000", "Rs 2,000", "2000 rupees", "2k", "1.5 lakh", with paise allowed ("₹499.50"). The page's limits apply: more than 0 for a limit, at most ₹10,00,000.

**Tools:**

- **Create** asks only for the name when it's missing. Everything else takes the page's defaults, so "Add a new category called Internet" is enough.
- **Update** changes only the fields the message asks about. "Set Travel's limit to ₹10,000" doesn't touch its receipt rule. The card shows old → new.
- **Delete** checks first whether submitted claims use the category (`GET /expenses?categoryId=…&limit=1`). If so, it refuses and offers **Deactivate instead**. Drafts can still hold it, and then the API's refusal shows on Confirm.

---

## 6. Example conversations

### 6.1 Claims with filters, then the CSV

> **You:** Show approved claims from Rahul in Travel for October
>
> **Assistant:** **4 claims** · Approved · Rahul Sharma · Travel · 1 Oct – 31 Oct 2026 *(table)* · and the Claims tab shows the same filters
>
> **You:** Export the CSV
>
> **Assistant:** Downloading **Expenses CSV** for 1 Oct – 31 Oct 2026. It has one row per expense in those dates, for every employee and status, as the page's export does. *(the file downloads)*

### 6.2 Summary

> **You:** Summary from 1 September to 15 October
>
> **Assistant:** **1 Sep – 15 Oct 2026**: ₹1,24,000 approved, ₹98,000 of it paid. Waiting now: 3 claims (₹12,400) to approve, 2 (₹9,800) to pay. *(table by category)* **[By department]** · and the Summary tab shows those dates

### 6.3 Categories

> **You:** Add a new category Client meals with a limit of ₹2,000 per expense and receipt needed above ₹500
>
> **Assistant:** *(card)* New category · Name **Client meals** · Limit per expense **₹2,000.00** · Receipt needed **Above ₹500.00** · Active **Yes** · **[Create category]** [Cancel]

| Message | Card |
|---|---|
| Set the Travel limit to 10k | Limit per expense: ~~₹5,000.00~~ → **₹10,000.00** |
| Remove the limit on Snacks | Limit per expense: ~~₹300.00~~ → **No limit** |
| Travel always needs a receipt | Receipt needed: ~~Above ₹500.00~~ → **Always** |
| Deactivate Travel | Active: ~~Yes~~ → **No** |
| Rename Food to Meals | Name: ~~Food~~ → **Meals** |
| Delete Snacks | *(red card)* **Delete Snacks?** · **[Delete category]** |
| Delete Travel *(used by claims)* | "**Travel** is used by submitted claims, so it can't be deleted. **[Deactivate Travel instead]**" |

---

## 7. System prompt

```ts
systemPrompt: (ctx) => `${basePrompt(ctx, 'expenses')}
You are the Expenses assistant. You help list expense claims, export them as CSV, show the spending summary, and list, create, change or delete expense categories.
- Call a tool for every request, also when the user writes in Hindi or Hinglish.
- Copy names, statuses, dates and amounts exactly as the user said them. The server works them out.
- To change a category (its name, limit, receipt rule, or switching it on or off), call update_category.
- Never say that a category was created, changed or deleted. The app shows that after the backend confirms it.`
```

As before, the tool descriptions give no example values, because the model copies them.

---

## 8. Tools

| Tool | Kind | Model fills in | Server does |
|---|---|---|---|
| `list_claims` | read | `status?`, `employee?`, `category?`, `dates?`, `page?` | reads the filters → `GET /expenses` → table; the Claims tab follows |
| `export_claims` | read | `dates?` | picks the range (section 3) → download of `/exports/expenses?from&to` |
| `expense_summary` | read | `dates?`, `by?` (category or department) | `GET /expenses/summary` → line and table; the Summary tab follows |
| `list_categories` | read | `search?` | `GET /expense-categories?all=true` → table, or one category's line |
| `create_category` | write | `name?`, `limit?`, `receiptAbove?`, `active?` | asks for a missing name → card → `POST /expense-categories` |
| `update_category` | write | `category`, `newName?`, `limit?`, `receiptAbove?`, `active?` | find it → only the fields asked about → card with old → new → `PUT /expense-categories/:id` |
| `delete_category` | write | `category` | find it → refuse if submitted claims use it → red card → `DELETE /expense-categories/:id` |

Every tool is ORG_ADMIN only, and so is the module.

---

## 9. Server checks

1. **Filters come from the user's words.** A status, employee, category or date range counts only when the message names it. "Show all claims" clears the filters.
2. **The user's words win.** When the message names a status or a date range, it beats the model's copy. Dates are worked out on the server (`dates.ts`), never by the model.
3. **Amounts come from the message.** Each amount belongs to the word before it ("limit ₹2,000", "receipt above 500"). A number the model gives that the user never said is dropped.
4. **The tool must fit the message**, as on Tasks and Roles. A write goes to the right tool once per turn (Prepared `reroute`):
   - A delete with no word for deleting goes to update ("Remove the limit on Snacks" is an update).
   - A create named after a category that exists, in a message that doesn't ask for a new one, goes to update ("Set the Travel limit to 10k", "Food & meals always needs a receipt").
   - A summary for a message about claims, not spending ("Show paid claims from 1 Sep to 30 Sep"), is answered with the claims list. In the eval the model sent that one to `expense_summary`.
5. **Export only on a request to export.** "Thanks", or a question about exports, never downloads anything (the Exports fix of 2026-10-19). A plain request ("Export the CSV", "Download the expenses CSV for September") needs no model at all (`expenseModule.direct`).
6. **Names before dates and statuses.** The employee and category names the message holds are taken out before dates and statuses are read, so "June Smith" isn't a month.
7. **The card is the last check.** The category's four fields can be edited, with the page's rules, and Confirm needs a name. A name already in use is refused before the card, with an **Edit** button, because the API refuses duplicates.

---

## 10. Backend changes

None needed. `GET /expenses` already takes every filter, and `GET /expenses/summary`, `/exports/expenses` and the category endpoints exist.

---

## 11. Shared changes

- **The page can follow an answer** (`AiResult.view`): a path on the drawer's own page, such as `/expenses?tab=summary&from=2026-09-01&to=2026-10-15`. The client goes there for a live answer only, never for one loaded from history.
- **Downloads may carry a date range:** the client's allowed paths add `/exports/expenses?from=YYYY-MM-DD&to=YYYY-MM-DD`.
- **The confirm card's form gets a seventh kind,** `'category'`: name, limit and receipt rule in rupees, and active.

---

## 12. Client changes

- **Route map:** `/expenses` → module `expenses`, with the example "Show submitted claims for this month".
- **Starter chips:** "Submitted claims", "This month's summary", "Show categories", "New category".
- **Filters in the URL:**
  - The Claims tab reads `status`, `employee`, `category`, `from` and `to` from the address and writes them back when changed by hand.
  - The Summary tab reads `from` and `to`, and defaults to this month.
- **Category form on the card** (`AiCategoryForm.tsx`): the page's four fields with its labels, and the same rules (`expenseCategorySchema`).
- After a confirmed category change, `fetchAllCategories` reloads the table behind the drawer.

---

## 13. Testing

- **Unit:** the readers:
  - statuses, including "pending" and "to be paid";
  - date ranges: this month, last month, a month's name, from–to, since and until;
  - amounts: ₹, commas, k, lakh, paise and "no limit";
  - which amount belongs to the limit and which to the receipt rule;
  - "always needs a receipt".
- **Agent:** scripted model and fake API:
  - claims with each filter, and with all of them;
  - "show all claims";
  - several people match;
  - export with the message's dates, with the dates of the last list, and with none;
  - "thanks" after an export downloads nothing;
  - a summary for a range, by department, and a range over a year;
  - create with only a name, and with every field;
  - update of one field leaves the others alone;
  - delete, and delete refused while claims use the category;
  - a misrouted delete;
  - not offered to an ORG_USER.
- **Client:**
  - the Claims and Summary tabs read their filters from the URL;
  - a live answer moves the page and one from history doesn't;
  - completing a category card and confirming it.
- **Eval on the real model:** `RUN_OLLAMA=1 OLLAMA_MODEL=llama3.2 npx jest tests/ai/expense.eval`, about 18 phrases across the three tabs.

---

## 14. File flow: what happens when you type or speak

The shared path, file by file, is in [AI_ASSISTANT_PLAN.md, section 13](AI_ASSISTANT_PLAN.md#13-file-flow-what-happens-when-you-type-or-speak): the drawer, the AI route, the agent's order of decisions, and Confirm. This section shows only what is particular to the Expenses (admin) assistant. Typing and speaking are the same from the second step on: `useSpeechInput.ts` turns your voice into text, and that text is sent like typed text.

**The files**

| Part | File |
|---|---|
| Route in the drawer | `AiAssistant.tsx`, `MODULE_ROUTES`: `/expenses` → `expenses` |
| Instructions and tools | `server/src/ai/modules/expense.module.ts`: `list_claims`, `export_claims`, `expense_summary`, `list_categories`, `create_category`, `update_category`, `delete_category`, plus a `direct` reader for exports |
| Word readers | `expense.helpers.ts`: statuses, date ranges (`dateRange()`), amounts (`categoryAmounts()`) |
| REST API it calls | `/expenses` and `/expenses/summary` (`routes/expense.routes.ts` → `controllers/expense.controller.ts`), `/expense-categories` (`routes/expenseCategory.routes.ts`), `/people`, `/auth/me`; the browser downloads `/exports/expenses` |
| Card form | `AiCategoryForm.tsx` |
| The page following | `AiAssistant.tsx` `onView` → the URL → `ClaimsTab.tsx` and `SummaryTab.tsx` read their filters from it |

**One request, step by step: "Show approved claims from Rahul Sharma in Travel for October"**

1. **The model is asked**, and calls `list_claims`.
2. `list_claims.run()` reads the filters from your words:
   - `GET /people` matches Rahul Sharma;
   - `GET /expense-categories?all=true` matches Travel;
   - `statusesIn()` reads "approved";
   - `dateRange()` reads October;
   - then it calls `GET /expenses` with all four.
3. The answer is a table, plus a **view**: `/expenses?status=approved&employee=…&category=…&from=…&to=…`.
4. In the browser, `useAiChat.ts` passes the view to `onView`, and `AiAssistant.tsx` changes the address. `ClaimsTab.tsx` reads the filters from the address, so the page's own table shows the same claims.

**"Export the CSV":** the module's `direct` reads it without the model. `export_claims` answers with the file `/exports/expenses?from=…&to=…`, and `useAiDownloads.ts` downloads it at once.

**A category change:** "Set the Travel limit to 10k" → `update_category` → a card → on Confirm, `PUT /expense-categories/:id` → `expenseCategory.controller.ts` → `fetchAllCategories` reloads the tab.
