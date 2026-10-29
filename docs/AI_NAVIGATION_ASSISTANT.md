# Navigation: open any page by typing or speaking

In any assistant drawer, a user can say where they want to go: "Jump to dashboard", "Go to the projects page", "Open the project module", "Take me to my leave", "Projects route", "Where are leave types?". The assistant opens that page, but only when the user may open it. The rules are the ones the app's own route guards use: an ORG_USER never reaches an ORG_ADMIN page, and neither of them reaches a SUPER_ADMIN page, whatever they say.

This document covers navigation only. The shared parts are described in [AI_ASSISTANT_PLAN.md](AI_ASSISTANT_PLAN.md): Ollama setup, running on a CPU, the agent loop, voice and plan gating.

**Contents:** Status · Design choices · 1 Principle · 2 Who can use it · 3 Every page, and who may open it · 4 When a message is a "go to" · 5 Same words, different pages · 6 The answers · 7 Examples · 8 The Navigation assistant · 9 Tools · 10 Server checks · 11 Backend changes · 12 Client changes · 13 Testing · 14 File flow

---

## Status

**Built (2026-10-28), not committed.**

- **Server:**
  - `server/src/ai/modules/navigation.helpers.ts`: the page list (38 entries: every route, its tabs, and the sign-in and sign-out answers), the readers and the access checks.
  - `navigation.module.ts`: `go_to_page`, `list_pages`, the shared step `pageTurn()` and the Navigation assistant.
  - In `runTurn()`, the navigation step is step 1b, and the page tools run from any assistant's buttons.
- **Client:**
  - `AiResult.goTo`, and the current page sent with each message.
  - The Navigation assistant on every page without an assistant of its own.
  - On `goTo`, the drawer closes and the browser opens the page, once the server has saved the turn.
- **Tests:**
  - 92 new server tests (49 for the readers, 43 for whole turns); all 574 server tests pass.
  - 4 new client tests.
- **Eval on llama3.2 (CPU):** 19/19 on the second run.
  - The 12 phrases the server reads alone answer in under 0.1 s. The 7 that need the model take about 2 s each, and one 19 s while the model loaded.
  - The first run had 2 misses, both fixed:
    - "I need to approve some claims": the model sent the title "Approvals". The user's own words now win when they name a page more closely.
    - "Open payroll": the model guessed Expenses. A page the user's words don't name is now only suggested, never opened (section 6).

---

## Design choices

| Question | Choice | Why |
|---|---|---|
| Which drawer understands "go to"? | **Every one.** Navigation is a shared step of `runTurn()`, before the module's own work, so "Go to projects" works the same on Employees, Expenses or Me → Leave. | The request is to jump from wherever the user is. A module's own tools and prompt stay as they are. |
| What about pages with no assistant of their own (Home, Approvals & leave, People ops, Profile)? | **They get a small Navigation assistant** that only opens pages. It does no other work on those pages. | Otherwise "Jump to dashboard" lands on Home, where no drawer exists to jump anywhere else. Turning this off is one line in `AiAssistant.tsx`. Me → Performance, Profile, Team and Holidays showed it too, until they got their own assistants on 2026-10-29 ([AI_ME_ASSISTANTS.md](AI_ME_ASSISTANTS.md)). |
| Who decides whether the user may open a page? | **The server**, with the same rules as the client's route guards: `RoleRoute`, `PermissionRoute` (the role's `read` right and the plan's modules), and the plan features the Me tabs and the nav use. | The server never sends a path the guards would refuse. If it ever did, the guard would still send the user to `/unauthorized`, and the API would still refuse the data. |
| Who reads the page from the words? | **The server, from a fixed list of pages and their names.** No model call for "Go to projects". | Page names are a closed list, read reliably and at once. The model is used only on the Navigation assistant, for wording the list can't read ("I need to approve some claims"). |
| Does the drawer stay open after the jump? | **It closes**, and the new page shows. | The request is "redirect me to that route". On the new page, its own assistant (if it has one) is one click away. |
| A request that also asks for work ("Go to projects and create Apollo") | **A button to open the page, and the rest to ask there.** It doesn't jump straight away. | The drawer closes on a jump, and the rest of the request would be lost without a word. |
| A word several pages share ("attendance" for an admin) | **A question with a button per page.** For an ORG_USER, only the pages they may open count, so they get no question. | The admin's Team attendance and their own Me → Attendance are both "attendance". Guessing would open the wrong one. |
| SUPER_ADMIN | **No assistant at all**, as now: the AI is a feature of an organization's plan, and a SUPER_ADMIN has no organization. Their pages (Admin Users, Plans) only ever appear in refusals. | `scopeToOrganization` already refuses a SUPER_ADMIN on `/ai/*`. |

---

## 1. Principle

- **The server reads the page from the user's words.** A navigation request is recognized by its verb ("go to", "jump to", "take me to", "open", "navigate to", "switch to", Hinglish "le chalo", "kholo"), or by a page word ("page", "route", "module", "screen", "tab", "section"), and the rest of the message must be a page name.
- **The same rules as the route guards.** A page the user may not open is never opened. The answer says why: admin only, super admin only, not in their role, or not in the plan.
- **Nothing is changed.** Navigation only moves the browser. It has no confirm card and calls no write endpoint.
- **A jump only for a live answer.** An answer loaded from history never navigates, as with downloads and `view`.

---

## 2. Who can use it

Everyone who has an assistant: ORG_ADMIN and ORG_USER members of an organization on the Professional plan, with `AI_ENABLED=true`. The drawer button now shows on every page inside the app's layout:

- a page with its own assistant shows that assistant, which also understands "go to";
- any other page shows the **Navigation assistant**.

The Billing and Change password pages sit outside the app's layout and show no drawer, as before. They can still be opened from any drawer.

---

## 3. Every page, and who may open it

The same list as `client/src/routes/AppRouter.tsx`, `navItems.tsx` and `MePage.tsx`. "Member" means ORG_ADMIN or ORG_USER. "read X" means the role's `read` right on X; ORG_ADMIN always has it.

| Page | Path | Who may open it | Some of the words that name it |
|---|---|---|---|
| Home (Dashboard) | `/home` | member | home, dashboard, home page, main page |
| Home → Welcome | `/home?tab=welcome` | member | welcome, welcome tab |
| Me → Leave | `/me/leave` | member | my leave, leave balance, me page; "leave" |
| Me → Attendance | `/me/attendance` | member | my attendance, my WFH requests; "attendance", "work from home" |
| Me → Expenses | `/me/expenses` | member, plan has Expenses | my expenses, my claims; "expenses", "claims" |
| Me → Performance | `/me/performance` | member, plan has Performance | performance, my goals, my reviews, appraisal |
| Me → Profile | `/me/profile` | member | profile tab, my job details, employment details |
| Me → Team | `/me/team` | member | my team, colleagues, teammates; "team" |
| Me → Holidays | `/me/holidays` | member | my holidays; "holidays", "holiday list" |
| Approvals (leave requests) | `/leave/approvals` | ORG_ADMIN | approvals, leave approvals, approvals and leave, leave requests, leave management |
| Approvals → Attendance fixes | `/leave/approvals?tab=fixes` | ORG_ADMIN | attendance fixes, fix requests, regularization requests |
| Approvals → Work from home | `/leave/approvals?tab=wfh` | ORG_ADMIN | WFH requests, work from home requests |
| Approvals → Expenses | `/leave/approvals?tab=expenses` | ORG_ADMIN, plan has Expenses | expense approvals, claims to approve |
| Team attendance | `/leave/team-attendance` | ORG_ADMIN | team attendance, everyone's attendance; "attendance" |
| Leave types | `/leave/types` | ORG_ADMIN | leave types, leave policies |
| Holidays | `/leave/holidays` | ORG_ADMIN | holidays, holiday list, holiday calendar |
| Attendance settings | `/leave/attendance-settings` | ORG_ADMIN | attendance settings, office hours, working hours |
| Expenses → Claims | `/expenses` | ORG_ADMIN, plan has Expenses | expenses, claims, all claims, reimbursements |
| Expenses → Summary | `/expenses?tab=summary` | ORG_ADMIN, plan has Expenses | expense summary, spending |
| Expenses → Categories | `/expenses?tab=categories` | ORG_ADMIN, plan has Expenses | expense categories, categories |
| People ops → Onboarding | `/people-ops/onboarding` | ORG_ADMIN, plan has Onboarding | onboarding, people ops, joining checklists |
| People ops → Offboarding | `/people-ops/offboarding` | ORG_ADMIN, plan has Onboarding | offboarding, exit checklists |
| People ops → Templates | `/people-ops/templates` | ORG_ADMIN, plan has Onboarding | templates, checklist templates |
| Roles | `/roles` | ORG_ADMIN | roles, roles and permissions, permissions |
| Employees | `/employees` | read Employees | employees, employee list, staff, people |
| Documents | `/documents` | read Documents | documents, docs, files |
| Projects | `/projects` | read Projects | projects, project |
| Tasks | `/tasks` | read Tasks | tasks, to-dos |
| Departments | `/departments` | read Departments | departments, depts |
| Exports | `/exports` | read Exports, plan has Exports | exports, downloads, data export |
| Audit Logs | `/audit-logs` | read Audit Logs, plan has Audit Logs | audit logs, audit trail, activity log, logs |
| Profile | `/profile` | anyone signed in | profile, my profile, my account, account settings |
| Change password | `/change-password` | anyone signed in | change password, password |
| Billing & plan | `/billing` | ORG_ADMIN | billing, subscription, my plan, invoices, upgrade |
| Admin Users | `/admin-users` | SUPER_ADMIN | admin users, organizations, super admin |
| Plans | `/plans` | SUPER_ADMIN | plans, pricing plans, manage plans |
| Sign in, Forgot password | `/login`, `/forgot-password` | only when signed out | login, sign in, forgot password |
| Sign out | — | — | log out, sign out |

Notes:

- `/dashboard` redirects to `/home`, `/leave` to `/leave/approvals`, `/people-ops` to `/people-ops/onboarding`, and `/me` to `/me/leave`, so the assistant uses the final path at once.
- `/unauthorized` and `/reset-password` are never destinations.
- The words in quotes ("leave", "attendance", "claims") are **plain words**: they name a Me tab only when no other page the user may open fits better (section 5).
- Words are read after the text is normalized: "Approvals & leave" and "approvals and leave" are the same, as are "To-dos" and "to dos". Plurals count: "project module" and "projects page".

---

## 4. When a message is a "go to"

A message is read as navigation in one of these ways. Leading politeness ("hey", "please", "can you") is skipped first.

| Kind | Example | What happens |
|---|---|---|
| **Go**: a navigation verb, then a page | "Jump to dashboard", "Go to projects", "Take me to my leave", "Navigate to the roles page", "Open audit logs", "Switch to the summary tab", "Projects page pe le chalo", "Leave types kholo" | Opens the page. |
| **Page word**: the page and "page", "route", "module", "screen", "tab" or "section" | "Projects page", "the project module", "Employees route", "categories tab" | Opens the page. |
| **Show**: "show", "show me", "display", "view", "bring up", then a page that isn't this one | "Show me the dashboard" (on Employees), "Show my leave balance" (on Me → Attendance) | Opens the page. On the page's own assistant it isn't navigation: "Show projects" on Projects still lists projects. A "show" never refuses either: if the page is closed to the user, the module answers as before. A module can also claim another page's "show" (`AiModule.shows`): "Show my profile" on Me → Profile lists the details there instead of opening the My profile page. |
| **Where**: "where is", "where can I find", "how do I get to" | "Where are leave types?", "Where do I approve leave?" | Says where the page is, with a button to open it. No jump. |
| **Which pages**: "where can I go", "what pages can I open", "show all pages" | "Which pages can I access?" | Lists the pages this user may open, with buttons. |
| **A page and more** | "Go to projects and create Apollo" | A button to open Projects, and "then ask there: “create Apollo”". No jump. |
| **Two pages** | "Go to projects and tasks" | "One page at a time. Which one?", with a button for each. |

Only the Navigation assistant also opens a page from its **bare name** ("Projects", "my leave"). On a page's own assistant, a bare name means that module's work, as before. A reply to a question in progress ("Which department?") is never taken for a page.

Everything else goes to the module as before. "Open the Apollo project" is not navigation: after "open", "Apollo project" is not a page name, so the Projects assistant gets it.

---

## 5. Same words, different pages

Each page's words are either **strong** or **plain**. They are compared like this:

1. The longest matching name wins: "team attendance" beats "team", "people ops" beats "people", "onboarding templates" beats "onboarding".
2. Among the pages this user may open with that longest name, a strong word beats a plain one. For an admin, "expenses" opens Expenses → Claims (strong), not Me → Expenses (plain).
3. If several are still left, the user gets a button for each ("attendance" for an admin: Team attendance or Me → Attendance).
4. If the longest name belongs only to pages the user may not open, the answer refuses (section 6). It offers buttons for pages they may open with a shorter name: an ORG_USER asking for "team attendance" is told it's for admins, with a button for Me → Attendance.

So the same sentence opens different pages for different people:

| Said | ORG_ADMIN | ORG_USER |
|---|---|---|
| "Go to holidays" | Holidays (`/leave/holidays`) | Me → Holidays |
| "Go to expenses" | Expenses → Claims | Me → Expenses |
| "Go to attendance" | Which one: Team attendance or Me → Attendance | Me → Attendance |
| "Go to leave" | Me → Leave | Me → Leave |
| "Go to leave approvals" | Approvals | refused: admins only |
| "Go to attendance fixes" | Approvals → Attendance fixes | Me → Attendance |
| "Go to roles" | Roles | refused: admins only |
| "Go to plans" | refused: super admin only, with a button for Billing & plan | refused: super admin only |
| "Go to projects" | Projects | Projects, if their role can read Projects; else refused |

---

## 6. The answers

| Situation | Answer | Page |
|---|---|---|
| Opened | "Opening **Projects**." | Drawer closes, browser goes to `/projects`. |
| Already there | "You're already on **Projects**." | Stays. |
| Admin only | "**Roles** is only for your organization's admin, so I can't open it." | Stays. |
| Super admin only | "**Admin Users** is only for the platform's super admin, so I can't open it." | Stays. |
| Not in the role | "Your role doesn't include **Projects**, so I can't open it. Your admin can give you access." | Stays. |
| Not in the plan | "Your organization's plan doesn't include **Exports**." For ORG_ADMIN, a button for Billing & plan. | Stays. |
| Sign-in pages | "You're already signed in. To use another account, sign out from the menu under your name first." | Stays. |
| Sign out | "To sign out, use **Sign out** in the menu under your name, top right." | Stays. |
| Where | "**Leave types** is under **Approvals & leave** in the sidebar.", with an Open button | Stays. |
| A page and more | "I can open **Projects** first. Then ask its assistant: “create Apollo”.", with an Open button | Stays. |
| Several pages fit | "Which page did you mean?", with a button for each | Stays. |
| Which pages | "You can open these pages:", a table (page, where), and a button for each main page | Stays. |
| Unknown page (Navigation assistant) | "I couldn't find a page called “payroll”. Say “Where can I go?” to see the pages you can open." | Stays. |
| The model's guess, which the user's words don't name ("Open payroll", picked as Expenses) | "I think you mean **Expenses → Claims**, in the sidebar.", with an Open button | Stays: a guess is never opened. |

Every button is the same `go_to_page` tool with the page's key. The server checks the user's access again when a button is clicked.

---

## 7. Examples

- On Employees, an admin says "Jump to dashboard". The server opens `/home` with no model call.
- On Me → Leave, an employee types "Go to the projects page". Their role can read Projects, so the server opens `/projects`.
- On Projects, an employee says "Open roles". Roles is for admins only, so the server refuses.
- On Home, an admin says "Where do I set office hours?". The server answers "**Attendance settings** is under **Approvals & leave** in the sidebar." with an Open button.
- On Home, an admin types "I need to approve some claims". There is no navigation verb, so the model runs. It calls `go_to_page` with "Approvals", but the user's own words name a page more closely ("approve some claims", Approvals → Expenses), so they win. With no navigation verb, the answer is a button for Approvals → Expenses, not a jump.
- On Tasks, someone says "Take me to my attendance and request WFH tomorrow". The server answers with an Open button for Me → Attendance, and says to ask there: "request WFH tomorrow".

---

## 8. The Navigation assistant

The drawer on pages without an assistant of their own.

- **Key:** `navigation`.
- **Title:** "Navigation assistant".
- **Intro:** "Say where you want to go, for example “Go to projects” or “Open my leave”."
- **Starters:**
  - "Where can I go?" (`list_pages`);
  - "My leave" and "My attendance" (`go_to_page`).
- **Model:** used only when the server can't read a page from the words. The prompt lists the page titles the user's role has, and says:

```
You are the Navigation assistant. You open pages of the app for the user.
- When the user wants to go to, open or see a page, call go_to_page with the page in the user's own words.
- When the user asks which pages there are or where they can go, call list_pages.
- Only go_to_page opens a page. Never say you opened one yourself.
- For anything else, say that each page's own assistant does the work there.
```

---

## 9. Tools

Both tools are shared: every assistant runs them from a button, and the Navigation assistant also gives them to the model.

| Tool | Kind | Input | What it does |
|---|---|---|---|
| `go_to_page` | read | `page`: a page key from a button, or the page in the user's words from the model | Checks access and answers as in section 6. From the model: <br>• the user's own words win when they name a page more closely than the model's copy; <br>• it jumps only when the message has a navigation verb or page word, otherwise it answers as a "where", with a button; <br>• a page the user's words don't name at all is only suggested ("I think you mean …"). |
| `list_pages` | read | none | The pages this user may open, with buttons. |

---

## 10. Server checks

- **Access** (`navigation.helpers.ts`, `pageDenied`), in this order:
  1. Sign-in pages: never while signed in.
  2. Role: the page's roles must include the user's (SUPER_ADMIN only, ORG_ADMIN only, member, anyone).
  3. Plan: the page's plan feature (Expenses, Onboarding, Performance) and permission module must be in the organization's plan.
  4. Permission: for a matrix page, the role's `read` right (`hasPermission`; ORG_ADMIN always passes). `accessFor()` in `navigation.module.ts` loads an ORG_USER's role once per turn.
- **Paths:** only paths from the fixed page list are ever sent. The client also checks that a path starts with a single `/` before it navigates.
- **The current page:** the drawer sends `page` (path and query) with each message, used for "You're already on" and for the "show" rule. It's checked to be a path of at most 300 characters. If it's missing, the page of the module's own assistant is used.
- **The model can't open a closed page.** Its words go through the same reading and the same access checks as typed words.

---

## 11. Backend changes

- `server/src/ai/modules/navigation.helpers.ts` (new): the page list, the readers (section 4, section 5) and the access checks.
- `server/src/ai/modules/navigation.module.ts` (new): `go_to_page`, `list_pages`, `pageTurn()` (the shared step) and the Navigation assistant.
- `server/src/ai/types.ts`:
  - `AiResult.goTo`: the path to open;
  - `ToolContext.page` and `ToolContext.subscription`.
- `server/src/ai/agent.service.ts`:
  - `TurnInput.page` and `TurnInput.subscription`;
  - the navigation step before small talk;
  - the shared tools for buttons in any module;
  - an answer with `goTo` always goes straight to the user.
- `server/src/ai/registry.ts`: the Navigation assistant in `MODULES`.
- `server/src/validators/ai.validators.ts`: `page` in the chat request.
- `server/src/controllers/ai.controller.ts`: passes `page` and `req.subscription` to `runTurn()`.
- `server/tests/ai/support.ts`: `turn()` takes `page` and `subscription`.

No REST endpoint changes: navigation calls none.

---

## 12. Client changes

- `client/src/types/ai.ts`: `AiResult.goTo`, `AiChatRequest.page`.
- `client/src/components/AiAssistant/useAiChat.ts`:
  - sends the current page with each message;
  - `onGoTo` for a live answer with `goTo`, called once the stream has ended. Leaving the page closes the drawer, which would stop the request before the server saves the turn.
- `client/src/components/AiAssistant/AiAssistant.tsx`:
  - the Navigation assistant on pages without an assistant of their own;
  - on `goTo`, closes the drawer and navigates.

---

## 13. Testing

- **Server, `tests/ai/navigation.helpers.test.ts`:**
  - the readers: verbs, page words, "show", "where", "which pages", a page and more, two pages;
  - not navigation: "Open the Apollo project", "Show projects" on Projects, a bare name on a module's assistant;
  - the word rules (section 5), for ORG_ADMIN and ORG_USER.
- **Server, `tests/ai/navigation.agent.test.ts`:**
  - "Jump to dashboard" on every assistant, with no model call;
  - every refusal: admin only, super admin only, role, plan, sign-in;
  - "You're already on";
  - buttons re-checked on click;
  - the Navigation assistant's bare names and its model path.
- **Server eval, `tests/ai/navigation.eval.test.ts`:** 19 phrases on the Navigation assistant with llama3.2, 7 of which only the model can read:

```
RUN_OLLAMA=1 OLLAMA_MODEL=llama3.2 npx jest tests/ai/navigation.eval --runInBand
```
- **Client, `AiAssistant.navigation.test.tsx`:**
  - the Navigation assistant shows on Home;
  - a live `goTo` closes the drawer and moves the page;
  - one from history doesn't;
  - the current page is sent with each message.

---

## 14. File flow

The shared flow is in [AI_ASSISTANT_PLAN.md, section 13](AI_ASSISTANT_PLAN.md#13-file-flow-what-happens-when-you-type-or-speak). Navigation adds one step to it.

**Example: on Employees, an admin says "Jump to dashboard".**

1. `client/src/components/AiAssistant/useSpeechInput.ts`: the browser turns the speech into text.
2. `client/src/components/AiAssistant/useAiChat.ts`: `send()` → `stream()` posts `{ module: 'employees', message: 'Jump to dashboard', page: '/employees' }` to `/api/v1/ai/chat`.
3. `server/src/routes/ai.routes.ts`: sign-in, organization, plan and `ai` feature checks; `chatSchema` checks `page`.
4. `server/src/controllers/ai.controller.ts` `chat()`: checks the Employees assistant, opens the stream, calls `runTurn()` with `page` and the subscription.
5. `server/src/ai/agent.service.ts` `runTurn()`: the navigation step comes first. It calls `pageTurn()` in `modules/navigation.module.ts`.
6. `server/src/ai/modules/navigation.helpers.ts`:
   - `readPageRequest()` sees "jump to" and the name "dashboard", so Home (`/home`);
   - `pageDenied()` lets the admin open it.
7. `pageTurn()` answers "Opening **Home**." with `goTo: '/home'`. `runTurn()` saves it and sends a `message` event, then `done`. Ollama is never called.
8. `useAiChat.ts`: the live message has `goTo`, so it calls `onGoTo('/home')`.
9. `AiAssistant.tsx`: closes the drawer, then `navigate('/home')`. `AppRouter.tsx` runs its guards and shows the Home page. Its drawer is now the Navigation assistant.

**Example: on Home, an employee says "I need to approve some claims".**

Steps 1 to 5 are the same, with `module: 'navigation'`. Then:

- `pageTurn()` finds no navigation verb or page word, and the message isn't a page name on its own, so the model runs (`queue.ts` → `ollama.client.ts`).
- It calls `go_to_page` with `page: 'Approvals'`.
- `go_to_page` compares that with the user's own words. "approve some claims" names Approvals → Expenses, a closer match, so the user's words win.
- The employee isn't an admin, so it refuses: "**Approvals → Expenses** is only for your organization's admin, so I can't open it."
- The employee's own claims are a shorter match, so the answer also offers a button: "Open Me → Expenses".

**Files, in one table:**

| File | Role |
|---|---|
| `server/src/ai/modules/navigation.helpers.ts` | The page list, the readers, the access checks. Pure, apart from loading the role. |
| `server/src/ai/modules/navigation.module.ts` | The tools, the shared step `pageTurn()`, the Navigation assistant. |
| `server/src/ai/agent.service.ts` | Runs the navigation step first, and runs the shared tools from any module's buttons. |
| `client/src/components/AiAssistant/useAiChat.ts` | Sends `page`; hands a live `goTo` to the drawer. |
| `client/src/components/AiAssistant/AiAssistant.tsx` | Picks the drawer for the page (its own, or Navigation); closes and navigates on `goTo`. |
| `client/src/routes/AppRouter.tsx` | Unchanged: its guards still check every page the assistant opens. |
