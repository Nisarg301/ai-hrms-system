# Departments Assistant: manage departments through chat

On the **Departments** page (`http://localhost:5173/departments`), users list, find and count departments, and see how many employees each has, by typing or speaking. An admin can also create, rename, deactivate and delete departments. For example: "Create a department called Design for product and brand design".

This document covers the Departments module only. The shared parts are described in [AI_ASSISTANT_PLAN.md](AI_ASSISTANT_PLAN.md): Ollama setup, running on a CPU, the agent loop, confirm cards, voice and plan gating. Departments follows the same pattern as Projects ([AI_PROJECTS_ASSISTANT.md](AI_PROJECTS_ASSISTANT.md)), and its permissions work like Employees ([AI_EMPLOYEE_ASSISTANT.md](AI_EMPLOYEE_ASSISTANT.md)). This document focuses on what is different.

**Contents:** Status · 1 Principle · 2 Department fields · 3 Who can do what · 4 Example conversations · 5 System prompt · 6 Tools · 7 Server checks · 8 Backend changes · 9 Shared changes · 10 Client changes · 11 Testing · 12 File flow

---

## Status

**Built (2026-10-19).** The Departments assistant works on `/departments`, on the same shared code as Employees and Projects.

| Where | What |
|---|---|
| `server/src/ai/modules/department.module.ts`, `department.helpers.ts` | The five tools; status words, grounding checks, the follow-up fast path |
| `server/src/controllers/department.controller.ts`, `validators/department.validators.ts` | `GET /departments` filter `status` (`listDepartmentsQuerySchema`) |
| `server/src/ai/types.ts`, `text.ts`, `registry.ts` | Card form kind `'department'`; *activate*, *deactivate*, *reactivate* stripped from names; the module registered |
| `client/src/components/AiAssistant/AiDepartmentForm.tsx` | The department form on the confirm card; `AiConfirmCard` picks it by its kind |
| `client/src/components/AiAssistant/AiAssistant.tsx` | `/departments` → `departments`; the departments table reloads after a confirmed change |

**To try it:** with `AI_ENABLED=true` in `server/.env`, open **Departments** as a Professional-plan user whose role can read departments. Writes need ORG_ADMIN.

**Tests:**
- `cd server && npm test` runs 133 tests, 37 of them for Departments.
- Client: `npx vitest run src/components/AiAssistant` (7 tests, 1 of them for Departments).
- Eval against the real model: `RUN_OLLAMA=1 OLLAMA_MODEL=llama3.2 npx jest tests/ai/department.eval`.

**Eval on `llama3.2`:** 15/16 on the first run, **16/16** after the fix below. In every run, nothing was written without a Confirm. After the shared change, the Projects eval stayed at 15/15 and the Employees eval at 13/15.

**What the first eval run showed:**

- **Invented statuses were dropped, as designed.** The model added `status: "active"` to creates, `"inactive"` to a description change, and `"rename"` to a rename. None of those messages mentions a status, so the server dropped each one.
- **"Headcount by department" came back as `count_departments({})`.** That answers with the number of departments, not people. A count with no filter, from a message about employees, people, staff or headcount, is now answered with each department's employee count, as `list_departments` would. This is the one miss on the first run.
- **"How many people work in Engineering?"** went to `count_departments({ department: "Engineering" })`, so `count_departments` takes a `department` to count the employees in it (section 6). `list_departments({ search })` answers the same question.

**Changes from the plan, found while building it:**

- **"all" is not a filter.** "Show all departments" may come back as `{ status: "all" }` or `{ search: "all" }`. Both are read as no filter instead of "'all' isn't a department status".
- **The status can come from the message alone.** "Deactivate Sales" may arrive as just `{ name: "Sales" }`. When the model sends no status and no other change, and the message names exactly one status, that status is used. The department's own name doesn't count, so "Update Archive" does not deactivate the Archive department.
- **"Which one?" buttons carry only checked values.** The changes are checked before the department is looked up, and a button sends on only those, so a status the model invented can't come back through a button.
- **A reply that is a new request isn't taken as the missing detail.** While a draft waits for a description, "Show all departments" or "cancel" goes to the model instead of becoming the description.

---

## 1. Principle

As with Employees and Projects: **Ollama understands the request, and the Node.js backend does the work.** The model picks one of the module's tools and copies the user's words. The server turns them into real values (a department, a status), shows a confirm card, and on **Confirm** calls the existing `/api/v1/departments` endpoints with the user's own token. The model has no database access.

---

## 2. Department fields

`POST /api/v1/departments` is validated by `createDepartmentSchema`; `PUT /api/v1/departments/:id` takes the same fields, all optional.

| User says | API field | Required on create | How the server fills it |
|---|---|---|---|
| name, title, called … | `title` | yes | Trimmed. Must appear in what the user said. Titles are not unique, so the card warns when a department with that title already exists. |
| description, handles, responsible for … | `description` | yes | Free text. Must share words with what the user said. If it's the only thing missing, the user's next reply is taken as the description, with no model call. |
| status, active, inactive … | `status` | no (default `active`) | Free words mapped to the two statuses (see below). |

The tool's field for the title is called `name`, because that is the word people use and the word the model fills in. The server maps it to `title`.

**Status words:**

| Status | The user may say |
|---|---|
| `active` | active, activate, reactivate, enable, enabled, in use, resume |
| `inactive` | inactive, not active, deactivate, deactivated, disable, disabled, closed, archived, dormant, not in use, retired |

**Inactive is only a label.** Nothing else in the system reads it: employees stay in an inactive department, and it can still be picked on the employee form. When a department with employees is deactivated, the card says that they stay in it.

**Deleting is a soft delete**, the same as the page's Delete button. The API refuses while any employee is still in the department ("Department is assigned to some employees"), so the assistant checks first and does not show a delete card in that case (section 4.4).

---

## 3. Who can do what

Department writes work like Employees: the routes use `requireOrgAdmin`, whatever the permission matrix says, so the write tools are `adminOnly`.

| Tool | Needs | ORG_ADMIN | ORG_USER |
|---|---|---|---|
| `list_departments`, `count_departments` | `departments: read` | yes | if their role allows it |
| `create_department`, `update_department`, `delete_department` | ORG_ADMIN | yes | no: the tools are not offered, and the API requires `requireOrgAdmin` |

- Without `departments: read`, the user gets no assistant on this page (`requiredPermission`).
- Employee counts come from `GET /employees?department=<id>`, which needs `employees: read`. Without it, the counts are left out. ORG_ADMIN always has them.
- Departments are on both plans; the assistant itself is Professional only.

---

## 4. Example conversations

### 4.1 Create, with details missing

> **You:** Create a department called Design.
>
> **Assistant:** I'll create Design. I still need a short **description**. *[Fill in the form instead]*
>
> **You:** Product and brand design
>
> **Assistant:** *(confirm card)* New department · Title **Design** · Description *Product and brand design* · Status **Active** · **[Create department]** [Cancel]
>
> **Assistant:** ✅ **Department created:** Design · Active.

The second reply needs no model call: the description was the only thing missing.

### 4.2 Rename, deactivate

> **You:** Rename HR to People Operations
>
> **Assistant:** *(card)* **Update Human Resources** · Title: ~~Human Resources~~ → **People Operations** · [Save] [Cancel]

> **You:** Deactivate Sales
>
> **Assistant:** *(card)* **Update Sales** · Status: ~~Active~~ → **Inactive** · ⚠️ 4 employees are still in Sales. Deactivating doesn't move them. · [Save] [Cancel]

"HR" finds "Human Resources" by its initials, as on Employees. When several departments match, the assistant asks which one with buttons.

### 4.3 Lists and counts

| Message | Tool call | Backend |
|---|---|---|
| Show all departments | `list_departments({})` | `GET /departments?limit=20&sortBy=title&sortDir=asc`, plus `GET /employees?department=<id>&limit=1` per row for the Employees column |
| Find Engineering | `list_departments({ search: "Engineering" })` | matched by name → a details line: **Engineering** · Active · 12 employees · Builds the product |
| How many people work in Engineering? | `count_departments({ department: "Engineering" })` | `GET /employees?department=<id>&limit=1` → "**12 employees** work in Engineering." (`list_departments({ search })` gives the details line instead) |
| Headcount by department | `count_departments({})` or `list_departments({})` | the table with the Employees column |
| Which departments are inactive? | `list_departments({ status: "inactive" })` | `GET /departments?status=inactive` |
| How many departments? | `count_departments({})` | one count per status → "**8 departments**: 7 active and 1 inactive." |
| How many inactive departments? | `count_departments({ status: "inactive" })` | `GET /departments?status=inactive&limit=1` → `meta.total` |

A search first looks for a department by name (exact, initials, prefix or a whole word). If exactly one matches, the details line is shown. Otherwise the API's search runs, which also looks in descriptions, and the results are shown as a table.

### 4.4 Delete

> **You:** Delete Design
>
> **Assistant:** *(red card)* **Delete Design?** · Status Active · Description *Product and brand design* · **[Delete department]** [Cancel]

> **You:** Delete Engineering
>
> **Assistant:** **Engineering** still has 12 employees, so it can't be deleted. Move them to another department first, on the Employees page. *[Deactivate Engineering instead]*

- Deletes happen one department at a time.
- The "Deactivate instead" button is shown only for an active department. It opens the same update card as "Deactivate Engineering", with no model call.

---

## 5. System prompt

```ts
systemPrompt: (ctx) => `${basePrompt(ctx, 'departments')}
You are the Departments assistant. You help list, find and count departments, and say how many employees each has${writes ? ', and create, rename, deactivate or delete departments' : ''}.
- Call a tool for every request, also when the user writes in Hindi or Hinglish.
- Fill in only details the user actually gave. Never make up a description.
- Copy department names and statuses exactly as the user said them. The server finds the departments.
- To rename, deactivate or reactivate a department, call update_department.
- Never say that a department was created, changed or deleted. The app shows that after the backend confirms it.`
```

The line about `update_department` is only sent to ORG_ADMIN, who has that tool. As for the other modules, the rules that matter are enforced in code: values must be grounded in what the user said, names are matched to real departments, statuses are resolved by the server, every change waits for Confirm, and text answers that claim a change are replaced.

---

## 6. Tools

| Tool | Kind | Who | Model fills in | Server does |
|---|---|---|---|---|
| `list_departments` | read | `departments: read` | `search?`, `status?`, `page?` | name match → details line; otherwise `GET /departments` with filters → table with employee counts, or "Show more" |
| `count_departments` | read | `departments: read` | `status?`, `department?` | `GET /departments?status=…&limit=1` → total; with no filter, one count per status; with a department, the employees in it. With no filter and a message about people, the employees per department. |
| `create_department` | write | ORG_ADMIN | `name?`, `description?`, `status?` | checks → asks for what is missing → card → `POST /departments` |
| `update_department` | write | ORG_ADMIN | `department`, then any of `newName`, `description`, `status` | find department → card with old → new → `PUT /departments/:id` (changed fields only) |
| `delete_department` | write | ORG_ADMIN | `department` | find department → refuse if employees are in it → red card → `DELETE /departments/:id` |

`update_department` also accepts a stray `name`: it is read as the department when `department` is missing, and as the new name otherwise. In the Projects eval, the model sent `name` for the record itself.

---

## 7. Server checks

The same idea as Projects, section 7, adapted to departments:

1. **Empty means not given** (`""`, `null`, `"null"`, `"N/A"`).
2. **Name and description must come from the user.** At least one word of each must appear in what the user said, so the model can't invent a description.
3. **Statuses are a closed list, and must be the user's.** Words are mapped with the table in section 2. A status is kept only when the user's latest message mentions one, not counting the department's own name, so a status the model invented is dropped. If the model sends no status and no other change, a single status named in the message is used. Arguments built by the server for buttons skip this check.
4. **Departments are matched against the real list.** All departments are loaded (`limit=100`) and matched by name, initials, prefix or whole word. Several matches give a "which one?" question. The server never guesses between them.
5. **Duplicate titles get a warning,** on create and on rename.
6. **Drafts are merged** across turns, and the fast path fills the one missing free-text field (name or description) from a plain reply. A reply that starts like a new request ("show", "delete", "how many", "cancel") goes to the model instead.
7. **A delete is checked first.** A department that still has employees gets an explanation instead of a card, because the API would refuse it. The API checks again on Confirm.
8. **The card is the last check.** Every field is editable, and Confirm stays disabled until the values pass the page form's rules (`client/src/validation/department.schema.ts`).

---

## 8. Backend changes

1. **`status` filter on `GET /departments`:** `active` or `inactive`, checked by a new `listDepartmentsQuerySchema`. The Departments page can use it too.

Employee counts use the `department` filter on `GET /employees` that was added for the Employees assistant. Nothing else changes.

---

## 9. Shared changes

- **The confirm card's form gets a third kind,** `'department'`, next to `'employee'` and `'project'`, on the server and the client.
- **More command words stripped from names.** *Activate*, *deactivate* and *reactivate* join *mark*, *put*, *rename* and the rest, so "Deactivate Sales" looks up "Sales" in every module.
- **Registry:** the Departments module is added after Projects.

---

## 10. Client changes

- **Route map:** `/departments` → module `departments`.
- **Starter chips:** "New department", "Show all departments", "Inactive departments" and "Count departments". "New department" is only shown to ORG_ADMIN, because only ORG_ADMIN has its tool.
- **Department form on the card** (`AiDepartmentForm.tsx`): Title, Description, Status (Active / Inactive), with the same labels as the page's form. Validation is `departmentSchema` from the page form.
- After a confirmed change, `fetchDepartments` reloads the table behind the drawer.

---

## 11. Testing

- **Unit:**
  - status words → status, including "not active" → inactive;
  - grounding of the name and description;
  - the follow-up fast path.
- **Agent:** scripted model and fake API.
  - create with a missing description (fast path), then Confirm;
  - an invented status is dropped;
  - a duplicate title warning;
  - rename found by initials ("HR"), with old → new;
  - deactivate a department with employees;
  - two departments that match;
  - delete refused while employees remain, with the "Deactivate instead" button;
  - delete of an empty department, then Confirm;
  - list with employee counts, and without them when `/employees` is forbidden;
  - count by status, and the employees of one department;
  - "Headcount by department" sent to `count_departments`;
  - an ORG_USER who may read but not write.
- **Client:** complete an incomplete department card, confirm the edited values, and reload the table.
- **Eval on the real model:** `RUN_OLLAMA=1 OLLAMA_MODEL=llama3.2 npx jest tests/ai/department.eval`, 16 phrases (see Status for the results).

---

## 12. File flow: what happens when you type or speak

The shared path, file by file, is in [AI_ASSISTANT_PLAN.md, section 13](AI_ASSISTANT_PLAN.md#13-file-flow-what-happens-when-you-type-or-speak): the drawer, the AI route, the agent's order of decisions, and Confirm. This section shows only what is particular to the Departments assistant. Typing and speaking are the same from the second step on: `useSpeechInput.ts` turns your voice into text, and that text is sent like typed text.

**The files**

| Part | File |
|---|---|
| Route in the drawer | `AiAssistant.tsx`, `MODULE_ROUTES`: `/departments` → `departments` |
| Instructions and tools | `server/src/ai/modules/department.module.ts`: `list_departments`, `count_departments`, `create_department`, `update_department`, `delete_department` (writes for ORG_ADMIN only) |
| Word readers | `department.helpers.ts` (statuses: "deactivate", "inactive", "active again"); `../text.ts` (matching a department by name or initials) |
| REST API it calls | `/departments` (`routes/department.route.ts` → `controllers/department.controller.ts`); `/employees?department=` for counts |
| Card form | `AiDepartmentForm.tsx` |
| After Confirm | `fetchDepartments` reloads the table |

**One request, step by step: "Deactivate Sales"**

1. The message reaches `runTurn()`. **The model is asked**, and calls `update_department { department: "Sales" }`. It may leave out the status: the server reads it from your words anyway.
2. `department.module.ts` `update_department.prepare()`:
   - `GET /departments` finds "Sales" (`matchByName()`);
   - `statusesIn()` reads "deactivate" as Inactive;
   - `GET /employees?department=…` counts who is still in it, for a warning on the card.
3. The card shows "Status: ~~Active~~ → **Inactive**".

**On Confirm:** `PUT /departments/:id` with only the changed field → `department.route.ts` (ORG_ADMIN only) → `department.controller.ts` `updateDepartment()`. The table reloads.

**A delete:** "Delete Engineering" is refused before any card when employees are still in it. The answer offers a **Deactivate instead** button.
