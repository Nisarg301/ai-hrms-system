# Tasks Assistant: manage tasks through chat

On the **Tasks** page (`http://localhost:5173/tasks`), users list, find, count, create, change and delete tasks by typing or speaking. For example: "Create a task to fix the login bug in Apollo for Priya, due Friday", "Mark the login bug as done" or "Show my open tasks".

This document covers the Tasks module only. The shared parts are described in [AI_ASSISTANT_PLAN.md](AI_ASSISTANT_PLAN.md): Ollama setup, running on a CPU, the agent loop, confirm cards, voice and plan gating. Tasks follows the same pattern as Projects ([AI_PROJECTS_ASSISTANT.md](AI_PROJECTS_ASSISTANT.md)), so this document focuses on what is different: a task belongs to a project and has members, so a request names other records too.

**Contents:** Status · Design choices · 1 Principle · 2 Task fields · 3 Who can do what · 4 Example conversations · 5 System prompt · 6 Tools · 7 Server checks · 8 Backend changes · 9 Shared changes · 10 Client changes · 11 Testing · 12 File flow

---

## Status

**Built (2026-10-19).** The Tasks assistant works on `/tasks`, on the same shared code as the other modules.

| Where | What |
|---|---|
| `server/src/ai/modules/task.module.ts`, `task.helpers.ts` | The five tools; status, member and move words; finding a task by its words; reading what the model left out from the message; the no-model step for status statements |
| `server/src/controllers/task.controller.ts`, `validators/task.validators.ts` | `GET /tasks` filters `status`, `dueFrom`, `dueTo` and `memberId` |
| `server/src/ai/types.ts`, `agent.service.ts`, `dates.ts`, `registry.ts` | Card form kind `'task'`; `prepare()` may hand a request to another tool; values read from a follow-up reply count as the server's own; broken JSON keys repaired; `dueRange()` shared |
| `client/src/components/AiAssistant/AiTaskForm.tsx` | The task form on the confirm card; `AiConfirmCard` picks it by its kind |
| `client/src/components/AiAssistant/AiAssistant.tsx` | `/tasks` → `tasks`; the tasks table reloads after a confirmed change |

**To try it:** with `AI_ENABLED=true` in `server/.env`, open **Tasks** as a Professional-plan user whose role can read tasks.

**Tests:**
- `cd server && npm test` runs 272 tests, 82 of them for Tasks.
- Client: `npx vitest run src/components/AiAssistant` (10 tests, 1 of them for Tasks).
- Eval against the real model: `RUN_OLLAMA=1 OLLAMA_MODEL=llama3.2 npx jest tests/ai/task.eval`.

**Eval on `llama3.2`:** 5/17 on the first run, 14/17 after the first fixes, and **17/17** twice after the rest. 3 of the 17 phrases are read by the server alone, in under 0.1 s. In every run, nothing was written without a Confirm. Since the shared changes, the other modules' evals stand at Projects 15/15, Departments 16/16, Exports 15/15 and Employees 13/15 (the same two misses as before).

**What the eval runs changed.** With five tools and seven fields on `update_task`, the 3B model was often wrong about the details while being right about the intent. As in the other modules, the server now reads the message itself and trusts the model's fields less:

- **The wrong tool.** "Mark the login bug as done" came back as `delete_task`, so the user saw a red Delete card. "Login bug wala task done kar do" came back as `create_task`, with the whole sentence as the title.
  - A delete now needs a word for deleting in the message, and a create a word for creating.
  - Otherwise the request goes to `update_task`. For this, `prepare()` may now return a reroute (section 9), so the card belongs to the tool that really runs.
- **Fields left out or mixed up.**
  - The task left out of an update, or the due date left inside it ("Push the login bug to next Monday", all in `task`).
  - A project given as a member ("Show the tasks in Hermes").
  - "open" given as a due date, "status" as a status, "overdue" as a status.
  - Members dropped ("What is Mike Johnson working on?").
  - In every case, the server now reads what is missing from the message: the task, the members ("Add Mike Johnson to …", "Remove Rahul from …"), a move target, a status, a due date, and whose tasks a question is about. A list filter that reads as nothing is dropped instead of answered with an error.
- **Hints copied as values.** The model filled a description with "What the task is about", the hint for that field, and a broken call used a hint as a key. The fixes:
  - field descriptions are now short labels;
  - free text must share a real word with the message (`heardText`). `grounded()` had let "What the task is about" through on "the" and "task".
- **Keys missing their opening quote** (`"",members":"Mike Johnson"`) are repaired in the shared agent.
- **Messy values on a create.**
  - The title came back as "create task to fix the signup page in Apollo". The request around the title is now removed ("Fix the signup page").
  - The project was left empty although the message says "in Apollo". A project the message names is now used.
  - A description that only repeats the title is dropped, and text after a colon ("…, due 30 Oct: cover login and signup") is used as the description.
- **A list instead of a change.** For "I've started the review of the API spec", the model listed tasks. Plain statements of one task's progress now go straight to `update_task`, with no model call (`AiModule.direct`, as on Exports).
- **Stray members.** A "member" called "done", one made of the task's own words ("login bug"), or one that is a project's name, is dropped instead of producing a "No employee is called …" warning. The project case came from a later run of every module's eval, where "Move the login bug task to Hermes" came back with members "Hermes".

**Later runs of every module's eval (2026-10-19)** found two more glitches, both now absorbed by the server:

- **"Which tasks are blocked?"** came back as broken JSON with a trailing comma and an outer object that never closes (`{"name":"list_tasks","parameters{"due":"",} assistant …`). The shared parser now drops trailing commas, and reads the name and the parameters object on their own. The recovered call had no status, so a list now takes the one status its message names when the model gives none and no search words.
- **"Move the login bug task to Hermes"** came back with the task's words as the project and Hermes as a member. When the model's project matches none, the one project the message names wins (and "Hermes" is dropped as a member, being a project).

**Changes from the plan, found while building it:**

- **A follow-up reply the server reads counts as the server's own value.** "Friday" became `2026-10-23`, which was then dropped for not being the reply's own words. Projects had the same bug for a deadline given as a word; both are fixed in the shared agent.
- **"Me" is looked up in the people directory,** so the card shows the name the task will show.
- **Only an exact title wins outright.** Unlike people's names, a title that only starts with the words ("Login bug follow-up") is no better than one that contains them ("Fix login bug"), so the assistant asks which one.
- **A title may miss one word of the message.** "The login bug is fixed finally" still finds "Fix the login bug".
- **A status word inside a title isn't a status.** The found task's title words are set aside once each, so "Mark the done button task as done" still reads one "done".
- **An organization with no projects** gets an explanation, since every task needs a project.

---

## Design choices

| Question | Choice | Why |
|---|---|---|
| Who can be a member? | **Employees only**, as on the Tasks page | The API would also accept an admin, but the page's member list has only employees, and its edit form can't show anyone else. The assistant offers the same people as the page. |
| How are members found? | `GET /people/search` (the colleague directory) | It works for every role. The Employees list the page uses needs `employees: read`, so with it an ORG_USER with `tasks: create` couldn't name a member. |
| A description is required, but people rarely give one | Ask for it, with a **"Same as the title"** button | The API and the page both require it. The server never writes one itself; one click copies the user's own title. |
| No member given | Ask, with an **"Assign to me"** button for an employee | The API requires at least one member. The server doesn't guess. |
| "Assign Mike", "Add Mike", "Remove Mike" | The message's own verb decides | *add* / *also* adds a member, *remove* / *unassign* takes one off, and anything else (*assign to*, *give to*) replaces the members. |

---

## 1. Principle

As with every module: **Ollama understands the request, and the Node.js backend does the work.** The model picks one of the module's tools and copies the user's words. The server turns them into real values: a task, a project, the members, a status and a date. It then shows a confirm card, and on **Confirm** it calls the existing `/api/v1/tasks` endpoints with the user's own token. The model has no database access.

---

## 2. Task fields

`POST /api/v1/tasks` is validated by `createTaskSchema`; `PUT /api/v1/tasks/:id` takes the same fields, all optional.

| User says | API field | Required on create | How the server fills it |
|---|---|---|---|
| a task to …, called … | `title` | yes | Trimmed. Must appear in what the user said. Titles are not unique, so the card warns when the project already has a task with that title. |
| description, details | `description` | yes | Free text from the user. If it's the only thing missing, the next reply is taken as it, with no model call. The question offers **Same as the title**. |
| due, by, deadline | `dueDate` | yes | The user's words ("Friday", "31 Oct", "end of the month") resolved by `ai/dates.ts` to a `YYYY-MM-DD` day. A due date is a plain calendar day, so no time zone is involved. A day in the past gets a warning. |
| in Apollo, for the Apollo project | `projectId` | yes | Matched by name against `GET /projects`. If the organization has only one project, that one is used. No match → ask, listing the projects. |
| for Mike, assign to Priya and Rahul, me | `userId` (members) | yes, at least one | Each name is matched with `GET /people/search`, keeping employees only. "Me", "my" or "myself" is the user. Several matches → ask which, with buttons. |
| status | `status` | no (default `todo`) | Free words mapped to the four statuses (below). |

**Status words** (labels as on the page):

| Status | The user may say |
|---|---|
| `todo`: To Do | to do, not started, pending, backlog, new, reopen |
| `in-progress`: In Progress | in progress, started, start, working on, doing, ongoing, WIP, picked up |
| `done`: Done | done, complete, completed, finished, closed, resolved, fixed, ho gaya |
| `blocked`: Blocked | blocked, stuck, on hold, waiting, held up, paused |

In a list or a count, **open** (also *pending*, *remaining*, *unfinished*, *not done*) means every status except Done. **Overdue** means the due date has passed and the task isn't done.

**Deleting is a soft delete**, the same as the page's Delete button. Nothing else depends on a task.

---

## 3. Who can do what

Like Projects, Tasks follows the **permission matrix**: the routes use `authorize('tasks', …)`.

| Tool | Needs | ORG_ADMIN | ORG_USER |
|---|---|---|---|
| `list_tasks`, `count_tasks` | `tasks: read` | yes | if their role allows it |
| `create_task` | `tasks: create` | yes | if their role allows it |
| `update_task` | `tasks: update` | yes | if their role allows it |
| `delete_task` | `tasks: delete` | yes | if their role allows it |

- The model is only given the tools the user's role allows. The API checks again on Confirm.
- Without `tasks: read`, the user gets no assistant on this page.
- Finding a project by name needs `projects: read`, as the page's project list does. Without it, the assistant says it can't look projects up.
- Finding people needs nothing extra: `/people/search` is open to every member.
- Tasks are on both plans; the assistant itself is Professional only.

---

## 4. Example conversations

Today is Mon 19 Oct 2026 in these examples.

### 4.1 Create, with details missing

> **You:** Create a task to fix the login bug in Apollo
>
> **Assistant:** I'll create **Fix the login bug** in Apollo. I still need a short **description**, the **due date** and **who works on it**. *[Same as the title] [Assign to me] [Fill in the form instead]*
>
> **You:** *(clicks Same as the title)*
>
> **Assistant:** I'll create **Fix the login bug** in Apollo. I still need the **due date** and **who works on it**.
>
> **You:** Priya, due Friday
>
> **Assistant:** *(confirm card)* New task · Title **Fix the login bug** · Description *Fix the login bug* · Project **Apollo** · Members **Priya Shah** · Due **Fri 23 Oct 2026** · Status **To Do** · **[Create task]** [Cancel]
>
> **Assistant:** ✅ **Task created:** Fix the login bug · Apollo · due Fri 23 Oct 2026 · Priya Shah.

"Assign to me" is offered only to an employee, because only employees can be members.

### 4.2 Create in one sentence

> **You:** Add a task "Write release notes" for Rahul and me in Hermes, due 31 Oct: notes for version 2.1
>
> **Assistant:** *(confirm card with every field filled in, all editable)*

### 4.3 Change a task

| Message | Card |
|---|---|
| Mark the login bug as done | Status: ~~To Do~~ → **Done** |
| I've started the release notes | Status: ~~To Do~~ → **In Progress** |
| Push the login bug task to next Monday | Due date: ~~Fri 23 Oct 2026~~ → **Mon 26 Oct 2026** |
| Add Rahul to the login bug task | Members: ~~Priya Shah~~ → **Priya Shah, Rahul Verma** |
| Remove Priya from the release notes | Members: ~~Priya Shah, Rahul Verma~~ → **Rahul Verma** |
| Assign the login bug to Mike | Members: ~~Priya Shah~~ → **Mike Johnson** |
| Move the login bug task to Hermes | Project: ~~Apollo~~ → **Hermes** |
| Rename the login bug task to Fix Safari login | Title: ~~Fix the login bug~~ → **Fix Safari login** |

- **A task is found by its words**, in any order: "the login bug" finds "Fix the login bug". When several tasks match, the assistant asks which, with buttons that show each task's project and due date.
- **A project named on an update is a move only when the message says so** (move, shift, transfer, put … in). "Mark the login bug in Apollo as done" only uses Apollo to tell tasks apart.
- **A task can't be left without members:** removing the last one gets an explanation instead of a card.

### 4.4 Lists and counts

| Message | Tool call | Backend |
|---|---|---|
| Show my open tasks | `list_tasks({ member: "me", status: "open" })` | `GET /tasks?memberId=<me>&status=todo,in-progress,blocked&sortBy=dueDate&sortDir=asc` |
| What's overdue? | `list_tasks({ due: "overdue" })` | `GET /tasks?dueTo=<yesterday>&status=todo,in-progress,blocked` |
| Tasks due this week | `list_tasks({ due: "this week" })` | `GET /tasks?dueFrom=<Mon>&dueTo=<Sun>` |
| Show Apollo's tasks | `list_tasks({ project: "Apollo" })` | `GET /tasks?projectId=<Apollo>` |
| What is Priya working on? | `list_tasks({ member: "Priya", status: "in progress" })` | `GET /tasks?memberId=<Priya>&status=in-progress` |
| Find the login bug | `list_tasks({ search: "login bug" })` | one match → a details line |
| Which tasks are blocked? | `list_tasks({ status: "blocked" })` | `GET /tasks?status=blocked` |
| How many tasks does Mike have? | `count_tasks({ member: "Mike" })` | one count per status → "**7 tasks** for Mike Johnson: 3 To Do, 2 In Progress, 1 Done and 1 Blocked." |
| Count by status | `count_tasks({})` | a table of the four statuses |

Lists are sorted by due date, 20 at a time, with **Show more**. The table shows Task, Project, Members, Due date and Status, and marks overdue tasks.

### 4.5 Delete

> **You:** Delete the release notes task
>
> **Assistant:** *(red card)* **Delete Write release notes?** · Project Hermes · Due Sat 31 Oct 2026 · Status To Do · Members Rahul Verma, Nisarg · **[Delete task]** [Cancel]

Deletes happen one task at a time.

---

## 5. System prompt

```ts
systemPrompt: (ctx) => `${basePrompt(ctx, 'tasks')}
You are the Tasks assistant. You help list, find and count tasks${writes ? ', and create, change or delete them' : ''}.
- Call a tool for every request, also when the user writes in Hindi or Hinglish.
- Fill in only details the user actually gave. Never make up a description, a due date, a project or a member.
- Copy task titles, project names, people's names, statuses and dates exactly as the user said them. The server finds the records and works out the dates.
- When the user means themselves ("my tasks", "assign it to me"), write "me" for the member.
- To change a status, a due date, the members or the project of a task, call update_task.
- Never say that a task was created, changed or deleted. The app shows that after the backend confirms it.`
```

The update line is only sent when the user has `update_task`. As the Exports eval showed, the model copies example values from its instructions into unrelated requests, so the prompt and the tool descriptions give no example titles, names or projects.

---

## 6. Tools

| Tool | Kind | Permission | Model fills in | Server does |
|---|---|---|---|---|
| `list_tasks` | read | read | `search?`, `status?`, `due?`, `project?`, `member?`, `page?` | resolves the project and member, maps status and due → `GET /tasks` with filters → table, details line or "Show more" |
| `count_tasks` | read | read | `status?`, `due?`, `project?`, `member?` | `GET /tasks?…&limit=1` → total; without a status, one count per status |
| `create_task` | write | create | `title?`, `description?`, `dueDate?`, `project?`, `members?`, `status?` | checks → asks for what is missing → card → `POST /tasks` |
| `update_task` | write | update | `task`, then any of `newTitle`, `description`, `dueDate`, `status`, `project`, `members` | find task → card with old → new → `PUT /tasks/:id` (changed fields only) |
| `delete_task` | write | delete | `task` | find task → red card → `DELETE /tasks/:id` |

`members` takes one or more names ("Mike and Priya", "me"), as words or as a list.

**No model call for status statements.** "Mark the login bug as done", "I've started the API spec review", "The release notes are stuck" and "Login bug wala task done kar do" go straight to `update_task` (`AiModule.direct`). The server reads the task and the status from the message. Such a message:
- names exactly one status;
- states it ("mark", "I've", "is", "kar do", …) instead of asking;
- has no word for creating or deleting, and doesn't say "tasks".

Everything else goes to the model.

---

## 7. Server checks

The same rules as Projects, section 7, plus the records a task points to:

1. **Empty means not given** (`""`, `null`, `"null"`, `"N/A"`).
2. **Title, description and member names must come from the user.** A title or description must share a real word with what the user said, not just "the" or "task". A member name must appear in it. "Me" needs the user to speak of themselves.
3. **Statuses are a closed list, and must be the user's.** A status is kept only when the user's latest message mentions one, so a status the model invented is dropped.
4. **Dates are worked out by the server.** A due date is kept only when its words appear in the message. One that can't be read is asked for again, and a day in the past gets a warning.
5. **Projects and members are matched against real records.** A project by name among `GET /projects`; members through `/people/search`, employees only. A name that matches nothing, or several people, gets a question; the server never guesses between them.
6. **On an update, the message's own words decide what changes:**
   - a member verb adds, removes or replaces (Design choices);
   - a project counts as a move only with a move word (4.3).

   When the model leaves something out, the message fills the gap: the task (what is left after the verbs, statuses, dates, people and projects), the members, a move target, a status, and a due date (with *push*, *postpone*, *extend*, …).
7. **The tool must fit the message.** A delete needs a word for deleting, and "remove" counts only without "from" ("Remove Rahul from …" is a member). A create needs a word for creating once a status is named. Otherwise the request goes to `update_task`.
8. **Drafts are merged** across turns. With one detail missing, the fast path fills it from a plain reply: a date, a project name, people's names, or the reply itself as the description or title. A reply that starts like a new request goes to the model.
9. **The card is the last check.** Every field is editable, and Confirm stays disabled until the values pass the page form's rules (`client/src/validation/task.schemas.ts`).

---

## 8. Backend changes

**Filters on `GET /tasks`**, next to the existing `search` and `projectId`, checked by `listTasksQuerySchema`. The Tasks page can use them too.

| Filter | Value |
|---|---|
| `status` | One status, or several separated by commas |
| `dueFrom`, `dueTo` | `YYYY-MM-DD` days. Due dates are stored as `YYYY-MM-DD` strings, so they compare as text. |
| `memberId` | Tasks that have this person among their members |

---

## 9. Shared changes

- **The confirm card's form gets a fourth kind,** `'task'`. Its `labels` give the names of the project and members on the card, so the form can show them even if the user's lists don't include them (a disabled employee, say).
- **`dueRange()` moves to `ai/dates.ts`**, shared by Projects and Tasks: overdue, this week, next month, before 31 Dec and so on. `project.helpers.ts` re-exports it, so nothing else changes.
- **A tool can hand a request over.** `prepare()` may return `{ kind: 'reroute', tool, args }`. The agent then runs that tool instead, once per turn and only if the user may use it, so the card and the Confirm belong to the tool that really runs.
- **Values from a follow-up reply count as the server's own.** The draft fast path runs its tool with `fromButton: true`, so "did the user say this?" checks don't drop what the server read from the reply. This also fixes Projects: a deadline given as a word ("Friday") in a follow-up used to be dropped.
- **Broken JSON keys are repaired:** a word right after `,` or `{` and before `":` is read as a key, for `llama3.2`'s `"",members":"…"`.
- **Registry:** the Tasks module is added after Exports.

---

## 10. Client changes

- **Route map:** `/tasks` → module `tasks`, with the example "Mark the login bug as done" in the input box.
- **Starter chips:**
  - "New task" (needs `create`);
  - "My open tasks";
  - "What's overdue?";
  - "Count by status".
- **Task form on the card** (`AiTaskForm.tsx`):
  - Title, Description, Due date, Status, Project and Members.
  - The projects come from `fetchAllProjects`, as on the page. The members are the employees among `fetchPeople`.
  - Validation is `taskSchema` from the page form.
- After a confirmed change, `fetchTasks` reloads the table behind the drawer.

---

## 11. Testing

- **Unit:**
  - status words → status, and "open" in reads;
  - splitting member names ("Mike and Priya", "me");
  - the add / remove / replace verb;
  - move words;
  - matching a task by its words;
  - the follow-up fast path.
- **Agent:** scripted model and fake API.
  - create with details missing, using the buttons and a plain reply, then Confirm;
  - create in one sentence;
  - an invented status or member dropped;
  - the only project used without asking;
  - a duplicate title warning;
  - status, due date, add, remove, replace and move changes;
  - removing the last member refused;
  - two matching tasks;
  - delete;
  - my open tasks, overdue, a project's tasks and counts per status;
  - a read-only ORG_USER;
  - every eval failure, from the model's verbatim calls: the wrong tool, junk fields, filters that read as nothing, a wrapped title, a description after a colon, a status statement with no model call, and a due date left inside the task words.
- **Filters:** `listTasksQuerySchema` reads and refuses the new `GET /tasks` filters.
- **Client:** complete an incomplete task card, confirm the edited values, and reload the table.
- **Eval on the real model:** `RUN_OLLAMA=1 OLLAMA_MODEL=llama3.2 npx jest tests/ai/task.eval`, 17 phrases judged by what the user sees. The report shows which phrases the server read without the model.

---

## 12. File flow: what happens when you type or speak

The shared path, file by file, is in [AI_ASSISTANT_PLAN.md, section 13](AI_ASSISTANT_PLAN.md#13-file-flow-what-happens-when-you-type-or-speak): the drawer, the AI route, the agent's order of decisions, and Confirm. This section shows only what is particular to the Tasks assistant. Typing and speaking are the same from the second step on: `useSpeechInput.ts` turns your voice into text, and that text is sent like typed text.

**The files**

| Part | File |
|---|---|
| Route in the drawer | `AiAssistant.tsx`, `MODULE_ROUTES`: `/tasks` → `tasks` |
| Instructions and tools | `server/src/ai/modules/task.module.ts`: `list_tasks`, `count_tasks`, `create_task`, `update_task`, `delete_task`, plus a `direct` reader |
| Word readers | `task.helpers.ts` (statuses, due ranges, members, "move it to …"); `../dates.ts` (due dates) |
| REST API it calls | `/tasks` (`routes/task.routes.ts` → `controllers/task.controller.ts`), `/projects`, `/people/search` |
| Card form | `AiTaskForm.tsx` |
| After Confirm | `fetchTasks` reloads the table |

**One request, step by step: "Mark the login bug as done"**

1. The message reaches `runTurn()`. The module's `direct` (`statusStatement()` in `task.helpers.ts`) sees a plain status change, so `update_task` runs **without the model**.
2. `task.module.ts` `update_task.prepare()`:
   - finds the task from your words with `GET /tasks` (a search on the title; an exact title wins);
   - reads "done" as the status;
   - if several tasks match, answers with a button for each.
3. The card shows "Status: ~~To do~~ → **Done**".

**On Confirm:** `PUT /tasks/:id` → `task.routes.ts` checks `authorize('tasks', 'update')` → `task.controller.ts` `updateTask()`. The table reloads.

**With the model:** "Add a task Write release notes in Hermes for Rahul, due Friday" goes to the model, which calls `create_task`. The server then finds Hermes (`GET /projects`) and Rahul (`GET /people/search`), and works out the date for Friday.
