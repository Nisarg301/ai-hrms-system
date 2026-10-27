# Roles Assistant: manage roles and their permissions through chat

On the **Roles** page (`http://localhost:5173/roles`), an admin creates, changes, lists and deletes roles by typing or speaking, permissions included. For example: "Create a role HR Manager with read, create and update on employees, select all on documents and read on projects", or "Create a role Auditor with all permissions".

This document covers the Roles module only. The shared parts are described in [AI_ASSISTANT_PLAN.md](AI_ASSISTANT_PLAN.md): Ollama setup, running on a CPU, the agent loop, confirm cards, voice and plan gating. Roles follows the same pattern as the other modules; what is new is the permission matrix, which a request describes in words.

**Contents:** Status · Design choices · 1 Principle · 2 How permissions are read · 3 Who can do what · 4 Example conversations · 5 System prompt · 6 Tools · 7 Server checks · 8 Backend changes · 9 Shared changes · 10 Client changes · 11 Testing · 12 File flow

---

## Status

**Built (2026-10-21), not committed.**

- **Server:** `server/src/ai/modules/role.helpers.ts` (the permission reader), `role.module.ts` (the four tools), the `roleId` filter on `GET /employees`, and `AiModule.adminOnly`.
- **Client:** `AiRoleForm.tsx`, which is the page's `PermissionMatrix` on the card, and the `/roles` route in the drawer.
- **Tests:** 42 Roles tests on the server (19 unit, 23 agent). All 378 server tests pass, and the client's assistant tests pass (42, the new Roles card test included).
- **Eval on llama3.2 (CPU):** 17/17 on the last run, 1.6–13 s per message. Messages the server reads itself ("Select all permissions for the Auditor role") take no model time.
  - The first run scored 14/17. The fixes for its misses are in section 7: the read-alone path (5), the list fallback (6) and a reroute (4).
  - The second run scored 16/17. That miss was the model putting the role's name in `newName`, which the server now reads as the role when no rename was asked for.

---

## Design choices

| Question | Choice | Why |
|---|---|---|
| Who reads the permissions? | **The server, from the user's own message.** The model picks the tool and gives the role's name. | A permission phrase is a small grammar ("read and update on tasks, select all on documents"). A 3B model would have to turn it into a nested list of flags, and the other evals showed how often it mixes up fields. The server reads it the same way every time. |
| Read without being asked | **Added, with a note on the card** | Read is a gate: without it, Create, Update and Delete grant nothing, and the page's matrix doesn't let them be set alone. "Create and update on tasks" therefore becomes Read, Create and Update. |
| "Select all permissions" | **Every module of the plan, all four actions** | The same as the matrix's "Select all permissions". "Select all on documents" is that module's row. |
| What does an update change? | **Only the modules the message names.** "With …" sets them to exactly what is said; *give* / *add* adds, *remove* / *revoke* takes away. | A role has many modules; naming one shouldn't wipe the others. The card shows old → new for each changed module. |
| Who can use it? | **ORG_ADMIN only**, like the Roles page | The `/roles` routes use `requireOrgAdmin`. The assistant isn't offered to anyone else at all. |
| Deleting a role in use | **Refused before the card**, saying how many employees have it | The API refuses it ("Role is assigned to some users"), so a card would only fail. |

---

## 1. Principle

As in every module: **Ollama understands the request, and the Node.js backend does the work.** The model picks one of the module's tools and copies the role's name. The server reads the permissions from the message and finds the role. It then shows a confirm card with the full permission matrix, editable, and on **Confirm** it calls the existing `/api/v1/roles` endpoints with the admin's own token.

---

## 2. How permissions are read

A role is a name plus, for each module of the organization's plan, four flags: Read, Create, Update and Delete. `POST /roles` and `PUT /roles/:id` take `{ name, permissions: [{ module, read, create, update, delete }] }`, and modules without Read are left out, as the page does.

**Words for the modules:**

| Module | The user may say |
|---|---|
| Dashboard | dashboard |
| Employees | employees, staff, people |
| Documents | documents, docs |
| Projects | projects |
| Tasks | tasks, to-dos |
| Departments | departments |
| Exports | exports |
| Audit Logs | audit logs, audit |
| every module | all modules, every module, everything |

**Words for the actions:**

| Action | The user may say |
|---|---|
| Read | read, view, see, access, read only |
| Create | create, add, new |
| Update | update, edit, change, modify |
| Delete | delete, remove |
| all four | select all, all permissions, full access, full control, CRUD |

**A phrase is a list of clauses.** Each clause pairs actions with modules, in either order:

- "read, create and update on employees" (actions, then modules);
- "employees: read and create", or "tasks with read and update" (modules, then actions);
- "select all on documents and read on projects" (two clauses);
- "all permissions" (all four actions with no module: every module).

**On an update, a clause can add or take away:**

| Words before it | Effect on the named modules |
|---|---|
| *(none)*, "with …" | Set to exactly these actions |
| give, grant, add, allow | These actions are added |
| remove, revoke, take away, no, without, except | These actions are taken away; with no actions ("remove documents"), the module gets none |

"Remove" and "add" also name actions (Delete, Create). They count as taking away or adding only when an action or a module follows them: "remove create from documents" takes Create away, while "can add and remove tasks" grants Create and Delete. After "can", or after another action ("view, add and remove on projects"), they are always actions. "Delete" takes away only when an action follows it ("delete the update permission on employees"). In "create a new role", "new" names the role, not the Create action; "None" or "no permissions" is a role with none, on purpose.

**Then the rules of the page's matrix apply:**

- **Read is added** where Create, Update or Delete is given without it, and the card notes it.
- **Taking Read away** clears the whole row.
- **Modules outside the plan** are left out with a note, because the API refuses them.
- **Actions with no module**, other than "all permissions", get a question: "Which modules should get Read?"

---

## 3. Who can do what

| Who | Gets |
|---|---|
| ORG_ADMIN | Every tool |
| ORG_USER | No assistant on this page. The Roles page is for admins only, and so is the API. |

---

## 4. Example conversations

### 4.1 Create, in one sentence

> **You:** Create a role HR Manager with read, create and update on employees, select all on documents and read on projects
>
> **Assistant:** *(confirm card)* New role · Name **HR Manager** · Employees **Read, Create, Update** · Documents **all** · Projects **Read** · *(the full matrix, editable)* · **[Create role]** [Cancel]

### 4.2 Create with every permission, or with details missing

> **You:** Create a role Auditor with all permissions
>
> **Assistant:** *(card)* Auditor · every module of the plan: **all**

> **You:** Create a new role
>
> **Assistant:** What should the role be called, and which permissions should it have? *[Fill in the form instead]*

When only the name is missing, the next reply is taken as the name. When only the permissions are missing, the next reply is read as permissions ("read on employees and projects"). When both are missing, a reply such as "Support Agent with read and update on tasks" fills both. None of these needs a model call.

> **You:** Create a role Viewer with read only
>
> **Assistant:** For **Viewer**: Which modules should get Read? Name them, or say "all modules".
>
> **You:** Employees and documents
>
> **Assistant:** *(card)* Viewer · Employees **Read** · Documents **Read**

A reply that names only modules completes the actions said before the question.

### 4.3 Update

| Message | Card |
|---|---|
| Update the HR Manager role with read and update on tasks | Tasks: ~~—~~ → **Read, Update** |
| Give delete on employees to HR Manager | Employees: ~~Read, Create, Update~~ → **all** |
| Remove create from documents for HR Manager | Documents: ~~all~~ → **Read, Update, Delete** |
| Take away projects from HR Manager | Projects: ~~Read~~ → **—** |
| Select all permissions for the Auditor role | every module → **all** |
| Rename HR Manager to People Manager | Name: ~~HR Manager~~ → **People Manager** |

Modules the message doesn't name keep their permissions.

### 4.4 Delete

> **You:** Delete the Auditor role
>
> **Assistant:** *(red card)* **Delete Auditor?** · permissions summary · **[Delete role]** [Cancel]

> **You:** Delete the HR Manager role
>
> **Assistant:** **HR Manager** is given to 4 employees, so it can't be deleted. Give them another role first, on the Employees page.

### 4.5 Lists

| Message | Answer |
|---|---|
| Show all roles | A table: role, and its permissions in short ("Employees: all · Projects: Read") |
| What can HR Manager do? | A details line, one module per part |

---

## 5. System prompt

```ts
systemPrompt: (ctx) => `${basePrompt(ctx, 'roles')}
You are the Roles assistant. You help list roles, and create, change or delete them with their permissions.
- Call a tool for every request, also when the user writes in Hindi or Hinglish.
- Copy the role's name exactly as the user said it. The server reads the permissions from the user's message.
- To change a role's permissions or name, call update_role.
- Never say that a role was created, changed or deleted. The app shows that after the backend confirms it.`
```

As the other evals showed, the model copies example values from its instructions, so the tool descriptions give no example names.

---

## 6. Tools

| Tool | Kind | Who | Model fills in | Server does |
|---|---|---|---|---|
| `list_roles` | read | ORG_ADMIN | `search?` | `GET /roles` → table, or a details line |
| `create_role` | write | ORG_ADMIN | `name?`, `permissions?` (the user's words) | reads the permissions from the message → asks for what is missing → card with the matrix → `POST /roles` |
| `update_role` | write | ORG_ADMIN | `role`, `newName?`, `permissions?` | find role → apply the clauses to its matrix → card with old → new → `PUT /roles/:id` |
| `delete_role` | write | ORG_ADMIN | `role` | find role → refuse if employees have it → red card → `DELETE /roles/:id` |

---

## 7. Server checks

1. **The permissions come from the user's message**, read as section 2 says; the model's `permissions` text is only used when the message has none (for example after a correction).
2. **The name must come from the user**, without the request around it ("role called HR Manager with …" → "HR Manager"). The name the message gives wins over the model's, and a "name" made only of permission words ("Read access") is dropped. Names are not unique, so the card warns about an existing one. On an update, a new name counts only when the message asks to rename ("rename … to …", "call it …").
3. **Roles are matched by name** among `GET /roles`: exact, initials or a unique prefix. Several matches get a question.
4. **The tool must fit the message** (Prepared `reroute`, once per turn):
   - A delete needs a word for deleting and no permission clauses. "Remove delete on tasks from HR Manager" and "Take away projects from HR Manager" are updates, so they go to `update_role`, as on Tasks.
   - A create named after a role that exists, in a message that doesn't start with a creating verb ("Give delete on employees to HR Manager"), goes to `update_role`.
   - An update of a role that doesn't exist, in a message that asks for a new one ("Create a role Auditor with …"), goes to `create_role`.
5. **Some messages need no model at all** (`roleModule.direct`). A change said outright about a role named before the word "role" ("Select all permissions for the Auditor role", "HR Manager role ko tasks ka read access do") goes straight to `update_role`. Questions, new roles and lowercase names are left to the model. In the eval the model answered the first one with `list_roles`.
6. **A list names the role the message names.** "What can HR Manager do?" once came back with no search; when the message names exactly one role, and doesn't ask for all roles, its details line is the answer.
7. **The matrix follows the page's rules:** Read is a gate, only the plan's modules, and modules without Read left out.
8. **The card is the last check.** The name and the whole matrix can be edited, and Confirm needs a name.

---

## 8. Backend changes

**A `roleId` filter on `GET /employees`**, for counting the employees who have a role before a delete. The Employees page can use it too.

---

## 9. Shared changes

- **A module can be for admins only** (`AiModule.adminOnly`). It is then left out of `GET /ai/modules` and refused by `/ai/chat` for anyone else.
- **The confirm card's form gets a sixth kind,** `'role'`: a name and the permission entries.

---

## 10. Client changes

- **Route map:** `/roles` → module `roles`, with the example "Create a role Auditor with all permissions".
- **Starter chips:** "New role" and "Show all roles".
- **Role form on the card** (`AiRoleForm.tsx`): the role name and the existing `PermissionMatrix`, with its Select All per row and "Select all permissions", for the plan's modules.
- After a confirmed change, `fetchRoles` reloads the table behind the drawer.

---

## 11. Testing

- **Unit:** the permission reader:
  - actions then modules, and modules then actions;
  - several clauses;
  - "select all" for one module, and "all permissions";
  - Read added where needed;
  - add, take away and set on an update, including "remove" and "add" as actions;
  - modules outside the plan;
  - actions with no module.
- **Agent:** scripted model and fake API.
  - create in one sentence, then Confirm;
  - all permissions;
  - the name missing, then a plain reply;
  - the permissions missing, then a plain reply;
  - set, grant, revoke and rename on an update;
  - delete, and delete refused while employees have the role;
  - a misrouted delete;
  - not offered to an ORG_USER.
- **Client:** completing a role card's matrix and confirming it.
- **Eval on the real model:** `RUN_OLLAMA=1 OLLAMA_MODEL=llama3.2 npx jest tests/ai/role.eval`, about 15 phrases.

---

## 12. File flow: what happens when you type or speak

The shared path, file by file, is in [AI_ASSISTANT_PLAN.md, section 13](AI_ASSISTANT_PLAN.md#13-file-flow-what-happens-when-you-type-or-speak): the drawer, the AI route, the agent's order of decisions, and Confirm. This section shows only what is particular to the Roles assistant. Typing and speaking are the same from the second step on: `useSpeechInput.ts` turns your voice into text, and that text is sent like typed text.

**The files**

| Part | File |
|---|---|
| Route in the drawer | `AiAssistant.tsx`, `MODULE_ROUTES`: `/roles` → `roles` |
| Instructions and tools | `server/src/ai/modules/role.module.ts`: `list_roles`, `create_role`, `update_role`, `delete_role`, plus a `direct` reader (ORG_ADMIN only: `adminOnly`) |
| Word readers | `role.helpers.ts`: the permission reader (`readClauses()`, `applyClauses()`), role names, "select all" |
| REST API it calls | `/roles` (`routes/role.routes.ts` → `controllers/role.controller.ts`), `/auth/me` (the plan's modules), `/employees?roleId=` (who has a role) |
| Card form | `AiRoleForm.tsx`, which shows the page's own `PermissionMatrix` |
| After Confirm | `fetchRoles` reloads the table |

**One request, step by step: "Create a role HR Manager with read, create and update on employees and select all on documents"**

1. **The model is asked**, and calls `create_role { name: "HR Manager" }`. The permissions are not left to the model.
2. `role.module.ts` `create_role.prepare()`:
   - `roleName()` takes the name from your message;
   - `permissionText()` and `readClauses()` in `role.helpers.ts` read your words as two clauses: *read, create, update* on *employees*, and *all* on *documents*;
   - `GET /auth/me` gives your plan's modules, and `applyClauses()` adds Read where needed and leaves out modules outside the plan;
   - `GET /roles` warns about a role with the same name.
3. The card lists Employees **Read, Create, Update** and Documents **all**, with the whole matrix editable.

**On Confirm:** `POST /roles` → `role.routes.ts` (ORG_ADMIN only) → `role.controller.ts` `createRole()`, which also checks the plan's modules.

**Without the model:** "Select all permissions for the Auditor role" is read by the module's `direct` (`permissionStatement()`), and goes straight to `update_role`.
