# Projects Assistant: manage projects through chat

On the **Projects** page (`http://localhost:5173/projects`), users list, find, count, create, change and delete projects by typing or speaking, instead of using the table and the form. For example: "Create a project called Apollo, mobile app rewrite, due 31 December".

This document covers the Projects module only. The shared parts are described in [AI_ASSISTANT_PLAN.md](AI_ASSISTANT_PLAN.md): Ollama setup, running on a CPU, the agent loop, confirm cards, voice and plan gating. Projects follows the same pattern as the Employees assistant ([AI_EMPLOYEE_ASSISTANT.md](AI_EMPLOYEE_ASSISTANT.md)), so this document focuses on what is different.

**Contents:** Status · 1 Principle · 2 Project fields · 3 Who can do what · 4 Example conversations · 5 System prompt · 6 Tools · 7 Server checks · 8 Backend changes · 9 Shared changes · 10 Client changes · 11 Testing · 12 File flow

---

## Status

**Built (2026-10-16).** The Projects assistant works on `/projects`, on the same shared code as Employees.

| Where | What |
|---|---|
| `server/src/ai/modules/project.module.ts`, `project.helpers.ts` | The five tools; status words, `due` ranges, deadline days, grounding checks |
| `server/src/ai/text.ts` | Text helpers now shared by both modules (moved out of `employee.helpers.ts`) |
| `server/src/ai/registry.ts` | `allowedTools()`: tools follow the role's permission matrix (`requires`) as well as `adminOnly` |
| `server/src/controllers/project.controller.ts`, `task.controller.ts` | `GET /projects` filters `status`, `dueFrom`, `dueTo`; `GET /tasks` filter `projectId` |
| `client/src/components/AiAssistant/AiProjectForm.tsx` | The project form on the confirm card; `AiConfirmCard` picks the form by its kind |
| `client/src/components/AiAssistant/AiAssistant.tsx` | `/projects` → `projects`; the projects table reloads after a confirmed change |

**Fixed 2026-10-19:** when the deadline was the only thing missing, a reply such as "Friday" was dropped. The server read it as `2026-10-23`, and that date then failed the check that the user said it. Values read from a follow-up reply now count as the server's own (see [AI_TASKS_ASSISTANT.md](AI_TASKS_ASSISTANT.md), section 9). A test covers it.

**To try it:** with `AI_ENABLED=true` in `server/.env`, open **Projects** as a Professional-plan user whose role can read projects.

**Tests:**
- `cd server && npm test` runs 96 tests, 39 of them for Projects.
- Client: `npx vitest run src/components/AiAssistant` (9 tests).
- Eval against the real model: `RUN_OLLAMA=1 OLLAMA_MODEL=llama3.2 npx jest tests/ai/project.eval`.

**Eval on `llama3.2`:** 9/15 on the first run, **15/15** after the fixes below. In every run, nothing was ever written without a Confirm. The Employees eval stayed at 13/15 after the shared changes.

**What the first eval run changed:**

- **Broken tool calls repaired.** For update requests, `llama3.2` writes `{"name":"update_project","parameters{"…}` followed by an invented reply. The agent now takes the leading JSON object and puts back the missing `":`. This fix lives in the shared agent, so Employees gets it too.
- **`name` vs the project.** "Put Apollo on hold" came back as `{ name: "Apollo" }`. The field for a new name is now `newName`, and a stray `name` is read as the project when `project` is missing.
- **Invented status and deadline dropped.** "Push the Apollo deadline to 15 January" also came back with `status: "done"`. A status is now accepted only when the user's message mentions that status, and a deadline only when its words are in the message. Arguments built by the server for buttons skip this check, because they were checked in an earlier turn. `update_employee` got the same rule for `status`.
- **Command words stripped from names.** "Mark Apollo as done" looked up a project called "Mark Apollo". Leading words like *mark*, *put*, *set* or *delete* are now removed before the search, for employees too.

---

## 1. Principle

As with Employees: **Ollama understands the request, and the Node.js backend does the work.** The model picks one of the module's tools and copies the user's words. The server turns them into real values (a project, a status, a date), shows a confirm card, and on **Confirm** calls the existing `/api/v1/projects` endpoints with the user's own token. The model has no database access.

---

## 2. Project fields

`POST /api/v1/projects` is validated by `createProjectSchema`; `PUT /api/v1/projects/:id` takes the same fields, all optional.

| User says | API field | Required on create | How the server fills it |
|---|---|---|---|
| name, title, called … | `name` | yes | Trimmed. Must appear in what the user said. Names are not unique, so the card warns when a project with that name already exists. |
| description, about, for … | `description` | yes | Free text. Must share words with what the user said. If it's the only thing missing, the user's next reply is taken as the description, with no model call. |
| deadline, due, by … | `deadline` | yes | The user's words ("31 Dec", "next Friday", "end of the month") resolved by `ai/dates.ts`. Stored as the start of that day in `APP_TIMEZONE`, the same way the page's date picker stores it. A date in the past gets a warning. |
| status | `status` | no (default `planning`) | Free words mapped to the four statuses (see below). Unclear words get a question listing the four. |

**Status words:**

| Status | The user may say |
|---|---|
| `planning` | planning, planned, not started, new, draft |
| `active` | active, in progress, ongoing, started, running, live, start it |
| `completed` | completed, complete, done, finished, closed, delivered |
| `on-hold` | on hold, hold, paused, pause, blocked, stopped, frozen |

**Deadlines are calendar days.** The page sends `date.toISOString()` from the browser, so a deadline of 31 Dec picked in India is stored as `2026-12-30T18:30:00Z`. The assistant reads every deadline back as a day in `APP_TIMEZONE`, so it shows 31 Dec and not 30 Dec.

**Deleting is a soft delete**, the same as the page's Delete button. Tasks linked to the project are not deleted. After the delete they show the project as "Unknown", so the delete card warns how many tasks are linked.

---

## 3. Who can do what

Unlike Employees, where every change needs ORG_ADMIN, Projects follows the **permission matrix**. The routes use `authorize('projects', …)`.

| Tool | Needs | ORG_ADMIN | ORG_USER |
|---|---|---|---|
| `list_projects`, `count_projects` | `projects: read` | yes | if their role allows it |
| `create_project` | `projects: create` | yes | if their role allows it |
| `update_project` | `projects: update` | yes | if their role allows it |
| `delete_project` | `projects: delete` | yes | if their role allows it |

- The model is only given the tools the user's role allows, so a read-only user never sees a write tool. The API checks again on Confirm.
- Without `projects: read`, the user gets no assistant on this page.
- The delete card's linked-task count needs `tasks: read`. Without it the card says nothing about tasks.
- Projects are on both plans; the assistant itself is Professional only.

---

## 4. Example conversations

### 4.1 Create, with details missing

> **You:** Create a project called Apollo due 31 December.
>
> **Assistant:** I'll create Apollo, due Thu 31 Dec 2026. I still need a short **description**. *[Fill in the form instead]*
>
> **You:** Rewrite of the customer mobile app
>
> **Assistant:** *(confirm card)* New project · Name **Apollo** · Description *Rewrite of the customer mobile app* · Deadline **Thu 31 Dec 2026** · Status **Planning** · **[Create project]** [Cancel]
>
> **Assistant:** ✅ **Project created:** Apollo · due Thu 31 Dec 2026 · Planning.

The second reply needs no model call: the description was the only thing missing.

### 4.2 Change status or deadline

> **You:** Put Apollo on hold
>
> **Assistant:** *(card)* **Update Apollo** · Status: ~~Active~~ → **On hold** · [Save] [Cancel]

> **You:** Push the Apollo deadline to 15 January
>
> **Assistant:** *(card)* Deadline: ~~Thu 31 Dec 2026~~ → **Fri 15 Jan 2027**

When several projects match ("Apollo" and "Apollo v2"), the assistant asks which one with buttons, as Employees does.

### 4.3 Lists and counts

| Message | Tool call | Backend |
|---|---|---|
| Show all projects | `list_projects({})` | `GET /projects?limit=20&sortBy=deadline&sortDir=asc` |
| Find Apollo | `list_projects({ search: "Apollo" })` | `GET /projects?search=Apollo`; one match shows a details line, with task counts when the user can read tasks |
| Which projects are on hold? | `list_projects({ status: "on hold" })` | `GET /projects?status=on-hold` |
| What's overdue? | `list_projects({ due: "overdue" })` | `GET /projects?dueTo=<yesterday>&status=planning,active,on-hold` |
| Projects due this month | `list_projects({ due: "this month" })` | `GET /projects?dueFrom=<1st>&dueTo=<last day>` |
| How many active projects? | `count_projects({ status: "active" })` | `GET /projects?status=active&limit=1` → `meta.total` |
| How many projects? | `count_projects({})` | one count per status → a table |

`due` takes the user's words: *overdue*, *this week*, *next week*, *this month*, *next month*, *next 30 days*, *before 31 Dec*, *after 1 Nov*, or a single date.

### 4.4 Delete

> **You:** Delete Apollo
>
> **Assistant:** *(red card)* **Delete Apollo?** · due Thu 31 Dec 2026 · Planning · ⚠️ 3 tasks are linked to this project. They are kept, but will show the project as "Unknown". **[Delete project]** [Cancel]

Deletes happen one project at a time.

---

## 5. System prompt

```ts
systemPrompt: (ctx) => `${basePrompt(ctx, 'projects')}
You are the Projects assistant. You help list, find and count projects${writes ? ', and create, change or delete them' : ''}.
- Call a tool for every request, also when the user writes in Hindi or Hinglish.
- Fill in only details the user actually gave. Never make up a description or a deadline.
- Copy project names, statuses and dates exactly as the user said them. The server finds the projects and works out the dates.
- To change a status or a deadline, call update_project.
- Never say that a project was created, changed or deleted. The app shows that after the backend confirms it.`
```

The rules that matter are enforced in code, as for Employees: values must be grounded in what the user said, names are matched to real projects, statuses and dates are resolved by the server, every change waits for Confirm, and text answers that claim a change are replaced.

---

## 6. Tools

| Tool | Kind | Permission | Model fills in | Server does |
|---|---|---|---|---|
| `list_projects` | read | read | `search?`, `status?`, `due?`, `page?` | maps status and due → `GET /projects` with filters; table, details line or "Show more" |
| `count_projects` | read | read | `status?`, `due?` | `GET /projects?…&limit=1` → total; with no filter, one count per status |
| `create_project` | write | create | `name?`, `description?`, `deadline?`, `status?` | checks → asks for what is missing → card → `POST /projects` |
| `update_project` | write | update | `project`, then any of `newName`, `description`, `deadline`, `status` | find project → card with old → new → `PUT /projects/:id` (changed fields only) |
| `delete_project` | write | delete | `project` | find project → count linked tasks → red card → `DELETE /projects/:id` |

---

## 7. Server checks

The same idea as Employees, section 8, adapted to projects:

1. **Empty means not given** (`""`, `null`, `"null"`, `"N/A"`).
2. **Name and description must come from the user.** At least one word of each must appear in what the user said, so the model can't invent a description.
3. **Statuses are a closed list, and must be the user's.** Words are mapped with the table in section 2. A status is kept only when the user's message mentions it, so a status the model invented is dropped. If the message names exactly one status, that status is used.
4. **Dates are worked out by the server.** A deadline is kept only when its words appear in the message. One that can't be read is asked for again, and a deadline in the past gets a warning.
5. **Duplicate names get a warning.** On create, a card notes that a project with the same name exists (names are not unique).
6. **Drafts are merged** across turns, and the fast path fills a missing deadline (a date), status (a status word), or the one missing free-text field (description or name) from a plain reply.
7. **The card is the last check.** Every field is editable; Confirm stays disabled until the values pass the page form's rules (`client/src/validation/project.schemas.ts`).

---

## 8. Backend changes

1. **Filters on `GET /projects`:**
   - `status`: one status, or several separated by commas.
   - `dueFrom` and `dueTo`: `YYYY-MM-DD` days in `APP_TIMEZONE`.

   The Projects page can use them too.
2. **`projectId` filter on `GET /tasks`**, used to count the tasks linked to a project.

---

## 9. Shared changes (used by every module from now on)

- **Tools can require a permission.** `AiTool.requires` names a permission-matrix action on the module (for example `'create'`). `allowedTools()` in the registry loads the user's role once and filters the tools. `adminOnly` still exists for Employees.
- **Starter chips follow the tools.** A chip appears only when the user may use its tool, so the `adminOnly` flag on chips is gone.
- **The confirm card's form has a kind:** `'employee'` or `'project'`, each with its own fields on the client.

---

## 10. Client changes

- **Route map:** `/projects` → module `projects`.
- **Starter chips:** "New project", "Show all projects", "What's overdue?" and "Count by status". Each one is only shown when the user has the permission its tool needs.
- **Project form on the card:** Name, Description, Deadline (date picker), Status. Validation is `projectSchema` from the page form.
- After a confirmed change, `fetchProjects` reloads the table behind the drawer.

---

## 11. Testing

- **Unit:**
  - status words → status;
  - `due` words → date range;
  - deadline instant ↔ day in `APP_TIMEZONE`;
  - grounding of the name and description.
- **Agent:** scripted model and fake API.
  - create with a missing description (fast path), then Confirm;
  - status change with old → new;
  - two projects with the same name;
  - delete with a linked-task warning;
  - overdue list;
  - an ORG_USER who may read but not create.
- **Eval on the real model:** `RUN_OLLAMA=1 OLLAMA_MODEL=llama3.2 npx jest tests/ai/project.eval`.

---

## 12. File flow: what happens when you type or speak

The shared path, file by file, is in [AI_ASSISTANT_PLAN.md, section 13](AI_ASSISTANT_PLAN.md#13-file-flow-what-happens-when-you-type-or-speak): the drawer, the AI route, the agent's order of decisions, and Confirm. This section shows only what is particular to the Projects assistant. Typing and speaking are the same from the second step on: `useSpeechInput.ts` turns your voice into text, and that text is sent like typed text.

**The files**

| Part | File |
|---|---|
| Route in the drawer | `client/src/components/AiAssistant/AiAssistant.tsx`, `MODULE_ROUTES`: `/projects` → `projects` |
| Instructions and tools | `server/src/ai/modules/project.module.ts`: `list_projects`, `count_projects`, `create_project`, `update_project`, `delete_project` |
| Word readers | `project.helpers.ts` (statuses, which details were really said, a reply that fills a question); `../dates.ts` (deadlines) |
| REST API it calls | `/projects` and `/tasks`: `routes/project.routes.ts` → `controllers/project.controller.ts` |
| Card form | `client/src/components/AiAssistant/AiProjectForm.tsx` |
| After Confirm | `fetchProjects` reloads the page's table |

**One request, step by step: "Create a project called Apollo due 31 December"**

1. `AiAssistant.tsx` → `useAiChat.ts` → `POST /api/v1/ai/chat` with `module: 'projects'`.
2. `agent.service.ts` `runTurn()`: no chip, no small talk, no question waiting, and Projects has no `direct`, so **the model is asked** (`queue.ts` → `ollama.client.ts`). It answers `create_project { name: "Apollo", deadline: "31 December" }`.
3. `project.module.ts` `create_project.prepare()`:
   - `cleanProjectArgs()` keeps only what you said;
   - `resolveDate()` turns "31 December" into 2026-12-31;
   - `GET /projects` warns about a project with the same name;
   - if a detail is missing, it asks ("What's the deadline?") and saves a draft. Your next reply goes to `fillProjectFromText()`, with no model call.
4. A card comes back: "New project · Apollo · Thu 31 Dec 2026 · Active". Nothing is saved yet.

**On Confirm:** `confirmAction()` runs `POST /projects` with your token. `project.routes.ts` checks `authorize('projects', 'create')`, then `project.controller.ts` `createProject()` saves it. The reply is "✅ Project created", and the page's table reloads.

**A question:** "Which projects are overdue?" → `list_projects.run()` → `GET /projects` with the overdue dates → a table. No card.
