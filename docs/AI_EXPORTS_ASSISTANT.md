# Exports Assistant: download CSV files through chat

On the **Exports** page (`http://localhost:5173/exports`), users download CSV files by typing or speaking, for one module or several at once. For example: "Download the CSV for employees, documents, projects and tasks".

This document covers the Exports module only. The shared parts are described in [AI_ASSISTANT_PLAN.md](AI_ASSISTANT_PLAN.md): Ollama setup, running on a CPU, the agent loop, voice and plan gating. Exports differs from the other modules in one way: its answer is a set of files for the browser, not a table or a confirm card.

**Contents:** Status · Design choices · 1 Principle · 2 What can be exported · 3 Who can do what · 4 Example conversations · 5 How a download reaches the browser · 6 Plain commands skip the model · 7 System prompt · 8 Tool · 9 Server checks · 10 Shared changes · 11 Backend changes · 12 Client changes · 13 Testing · 14 File flow

---

## Status

**Built (2026-10-19).** The Exports assistant works on `/exports`, for one module or several at once.

| Where | What |
|---|---|
| `server/src/ai/modules/exports.module.ts`, `exports.helpers.ts` | The `export_csv` tool; reading the modules, exclusions, notes and questions from a message; the check that backs the model's reading with the user's words; the no-model step |
| `server/src/ai/types.ts`, `agent.service.ts`, `registry.ts` | `AiResult.downloads` and `autoDownload`; the `AiModule.direct` step; answers with files always reach the user; "downloaded" as a claimed change; the module registered |
| `client/src/components/AiAssistant/useAiDownloads.ts` | Downloads a file with the page's own request and `saveBlob()`, and tracks its state |
| `client/src/components/AiAssistant/AiMessage.tsx`, `useAiChat.ts`, `AiAssistant.tsx` | Download buttons in answers; only live answers start downloads; `/exports` → `exports`; an example request per page in the input box |

**To try it:** with `AI_ENABLED=true` in `server/.env`, open **Exports** as a Professional-plan user with `exports: read`, and type or say "Download the CSV for employees, documents, projects and tasks".

**Tests:**
- `cd server && npm test` runs 189 tests, 56 of them for Exports.
- Client: `npx vitest run src/components/AiAssistant` (9 tests, 2 of them for Exports).
- Eval against the real model: `RUN_OLLAMA=1 OLLAMA_MODEL=llama3.2 npx jest tests/ai/exports.eval`.

**Eval on `llama3.2`:** 13/15 on the first run, **15/15** after the fix below, and 15/15 again on a second run. 7 of the 15 phrases were read by the server alone, in under 0.1 s, against 2–12 s for the ones that went to the model. Since the shared changes, the other modules' evals are where they were: Departments 16/16, Employees 13/15 (the same two misses), and Projects 14–15/15. In Projects, "Rename Apollo to Apollo Mobile" sometimes comes back as broken JSON from the model, and passes on other runs.

**What the first eval run changed:**

- **The model copied examples from its own instructions.** For "Download attendance", it sent `modules: "all except documents"`, the example in the tool's description. The server trusted it and **downloaded three files nobody asked for**. For "What can I export?", it sent `"everything"`. Two fixes:
  - **The model's reading must be backed by the user's words** (`backedByUser`). An export counts only if the user named it, or nearly spelled it ("emplyees"), in this conversation. "All" counts only if a message of theirs asked for everything.
  - **No example values** in the tool's description or the prompt. The server reads the user's message for modules and exclusions anyway.
- **The model doesn't always fill in `filter`.** For "Download only the active employees" it sent `modules: "active employees"` and no filter. The server now also spots filter words in the message itself (active, overdue, this month, …) for the "can't be filtered" note.

**Fixed after a report from use (2026-10-19): a "thank you" downloaded the files again.**

- **What happened:** after "Download the documents and projects CSV", the user said "thank you for making my work easy". The model called `export_csv` again with the earlier modules. The server let them through, because the conversation still named them (the rule meant for "the same again"), and the files downloaded a second time.
- **The fix:** a download now happens only when the latest message asks for one.
  - **Thanks, greetings and goodbyes get a reply of their own**, in every assistant ("You're welcome!"), with no model call and no tool run. This only applies when the message asks for nothing: "Thanks, now download tasks too" is still a request.
  - **The latest message must ask for files.** It says download, export, CSV, again, same, "I need", and so on, or it is a plain command such as "projects and tasks". Otherwise nothing downloads by itself. Data the message names in passing ("projects are important to me") is offered with a button; modules the message doesn't name at all are never downloaded again ("Nothing to download. Say which data you want …").
  - The eval has three new phrases for this, one of them two-turn: a download, then "You made my work so easy" through the model.

**Changes from the plan, found while building it:**

- **Hindi exclusions come after the data.** "projects ke alawa sab" and "documents chhodkar" leave out what comes *before* them, unlike "except projects". Both word orders are handled.
- **An example request per page.** The input box said "e.g. Add Mike Johnson to Engineering" on every page. Each page now shows its own example ("Download employees and projects" here).

---

## Design choices

| Question | Choice | Why |
|---|---|---|
| Confirm before downloading? | **No.** A clear request downloads straight away. | A download changes no data, and the user just asked for it. A question about an export ("What's in the tasks CSV?") gets a Download button instead. |
| Several modules: one ZIP, or a CSV each? | **One CSV file per module.** | They are the same files as the page's CSV buttons, and they open straight in Excel. The browser may ask once whether the site may download several files (section 5). |
| Who fetches the file? | **The browser**, from the existing `GET /api/v1/exports/:module`. | No CSV passes through the chat, the model or the stored conversation. The endpoint's own permission checks run as they do for the page. |
| Does every message need the model? | **No.** The server reads plain commands itself (section 6). | "Download employees and projects" is the request this page gets most. Reading it without the model saves 2–20 s per request on a CPU. |

---

## 1. Principle

As in every module, **the backend does the work**. The model, or the server alone for a plain command, works out which data the user wants. The server checks what this user may export, and answers with a list of files. The browser then downloads each file from the existing export endpoint with the user's own token, exactly like a click on the page's CSV button.

The model never sees any exported data, and the server never builds a CSV for the assistant.

---

## 2. What can be exported

The four exports on the page come from `GET /api/v1/exports/:module` (`EXPORTABLE_MODULES` in [export.controller.ts](../server/src/controllers/export.controller.ts)). Each holds every current record of the organization, newest first.

| Module | The user may say | Columns |
|---|---|---|
| `employees` | employees, staff, people, team members, users, karmchari | Name, email, job title, department, role, status |
| `documents` | documents, docs | Title, description, category, status, file name |
| `projects` | projects | Name, description, deadline, status |
| `tasks` | tasks, to-dos | Title, description, due date, status, project, members |
| all four | all, everything, every module, sab, sabhi, saare | |

**Exclusions work too:** "everything except documents", "all but tasks", "employees and projects, not tasks".

**Not on this page.** The assistant says where these are instead of downloading anything:

| The user asks for | The assistant says |
|---|---|
| attendance | Attendance is exported from the Team attendance page (admins only). |
| expenses, claims | Expenses are exported from the Claims tab of the Expenses page (admins only). |
| departments | There is no Departments export, but the Employees CSV has each employee's department. |
| roles | There is no Roles export, but the Employees CSV has each employee's role. |

**Exports can't be filtered.** For "Download only the active employees", the full file is downloaded with a note: the CSV has every employee, and it can be filtered in Excel or Google Sheets. For "as Excel" the note says CSV files open in Excel; for "as PDF" it says exports are CSV only.

---

## 3. Who can do what

| Who | Gets |
|---|---|
| Professional plan, `exports: read` | The assistant on this page (`requiredPermission: { module: 'exports', action: 'read' }`) |
| … and read rights on a module | That module's CSV. The endpoint requires both rights, so the assistant checks both. |
| ORG_ADMIN | Every export |

- The server reads the user's rights from `GET /auth/me`, which returns the same permissions the page uses to decide which CSV cards to show. The assistant and the page therefore always agree.
- When a user asks for **everything**, the modules they can't read are left out, and a short note names them.
- When a user **names** a module they can't read, they are told so, and that file is not downloaded.

---

## 4. Example conversations

### 4.1 One module

> **You:** Download the employees CSV
>
> **Assistant:** **Employees** CSV: the name, email, job title, department, role and status of every employee. *[✓ Employees CSV]*

The file downloads as soon as the answer arrives (`employees-2026-10-19.csv`, the same name as from the page). The button downloads it again.

### 4.2 Several modules

> **You:** Download the CSV for employees, documents, projects and tasks
>
> **Assistant:** **4 CSV files**: Employees, Documents, Projects and Tasks. *[✓ Employees CSV] [✓ Documents CSV] [✓ Projects CSV] [✓ Tasks CSV]*
> *If your browser asks whether this site may download multiple files, choose Allow.*

The files download one after another.

### 4.3 Everything, or everything except

> **You:** Export everything except documents
>
> **Assistant:** **3 CSV files**: Employees, Projects and Tasks.

### 4.4 Some modules not allowed (ORG_USER)

A user whose role can read employees and projects only:

> **You:** Download everything
>
> **Assistant:** **2 CSV files**: Employees and Projects. Documents and Tasks are left out: your role can't read them.

> **You:** Download documents and projects
>
> **Assistant:** **Projects** CSV: … *(downloads)* ⚠️ You can't export Documents: your role can't read documents.

### 4.5 A question, not a download

> **You:** What's in the tasks export?
>
> **Assistant:** **Tasks** CSV: the title, description, due date, status, project and members of every task. *[Tasks CSV]*

Nothing downloads until the user clicks the button.

### 4.6 Nothing named

> **You:** What can I export?
>
> **Assistant:** You can download these as CSV. Which ones do you want? *(table: Export · Columns)* *[Employees] [Documents] [Projects] [Tasks] [All of them]*

The buttons run the export straight away, with no model call.

### 4.7 Message → what happens

| Message | Read by | Downloads |
|---|---|---|
| Download the CSV for employees, documents, projects and tasks | server | all four |
| Export projects and tasks | server | projects, tasks |
| Sab download kar do | server | all four |
| Mujhe employees aur projects ki CSV chahiye | server | employees, projects |
| Download everything except documents | server | employees, projects, tasks |
| I need the project list for the board meeting | model → `export_csv({ modules: "projects" })` | projects |
| Download only the active employees | model → `export_csv({ modules: "employees", filter: "only active" })` | employees, with the "can't be filtered" note |
| What's in the tasks export? | model | none: a Download button |
| Download attendance | model | none: "exported from the Team attendance page" |

---

## 5. How a download reaches the browser

```
You: "Download employees and projects"
  │  POST /ai/chat (as for every module)
  ▼
server: which modules? (section 6 or the model) → may this user read them? (GET /auth/me)
  │  SSE message: { text, downloads: [{ label: "Employees CSV", path: "/exports/employees" }, …], autoDownload: true }
  ▼
browser, for each file in turn:
  GET /api/v1/exports/employees  (the user's token: the same request as the page's CSV button)
  → saveBlob(file, name from Content-Disposition)
```

- **The answer carries a list of files** (`AiResult.downloads`) and whether to start them at once (`autoDownload`).
- **Only a live answer downloads by itself.** When the chat history is loaded again later, nothing downloads; each file has a button to download it again.
- **One file after another.** Browsers handle a queue of downloads better than a burst. Chrome and Safari may ask once whether the site may download multiple files; after Allow, they remember it. Each file's own button also works, because each click is allowed one download.
- **The client only downloads from `/exports/…` paths**, whatever an answer says.
- **The endpoint checks again.** If a role changed in the meantime, the download fails with the page's message ("You don't have permission to export …") under the button.
- **With `AI_FAST_READS=false`**, an answer that carries files still goes straight to the user. Otherwise the model would rewrite it as text, and the files would be lost.

---

## 6. Plain commands skip the model

Most messages on this page are plain commands: "Download employees and projects". The server can read these with certainty, so they need no model call:

- A module gets an optional `direct(message, ctx)` hook. It returns the tool call to run, or `null` to ask the model.
- For Exports, `direct` answers only when **every word** of the message is a known export word:
  - verbs and nouns: download, export, CSV, file, sheet, data, list;
  - module names and their other words (section 2);
  - all, everything, except, not;
  - fillers: please, me, the, and, …;
  - common Hinglish words: mujhe, ki, aur, chahiye, kar do, sab.
- Anything else goes to the model: an unknown word, a filter, a typo, a reference to an earlier message ("the same again"), or a question (a message starting with what, which, how, …).

This step runs after the draft fast path and before the model. It doesn't wait in the model queue, so a plain command answers at once, even while another user's request is with the model.

---

## 7. System prompt

```ts
systemPrompt: (ctx) => `${basePrompt(ctx, 'exports')}
You are the Exports assistant. You download the organization's records as CSV files: employees, documents, projects and tasks.
- Call export_csv for every request to download or export data, also when the user writes in Hindi or Hinglish.
- Copy the data the user named into modules, in their own words.
- If the user wants only some of the rows, copy those words into filter.
- Never say that a file was downloaded. The app downloads it and shows that.`
```

The prompt and the tool's description give no example values: in the first eval run the model copied them into unrelated requests.

---

## 8. Tool

| Tool | Kind | Model fills in | Server does |
|---|---|---|---|
| `export_csv` | read | `modules?` (the user's words, or a list), `filter?` | reads the modules (the user's own words first) → `GET /auth/me` for rights → answer with the files, notes and warnings |

Starter chips: "Download everything" (`export_csv({ modules: "all" })`) and "What can I export?" (`export_csv({})`, the list from 4.6).

---

## 9. Server checks

1. **The user's words win.** The modules named in the latest message come first. The model's `modules` are used only when the message names none: a typo the model corrected ("emplyees"), or "the same again" from the conversation. Even then, each module must be backed by the user: named or nearly spelled in their messages, and "all" only when a message of theirs asked for everything. Chips and buttons carry the server's own words, so they skip this check.
2. **A closed list.** Only the four exportable modules can be downloaded. Anything else gets a note (section 2), never a request.
3. **Rights from the API.** `GET /auth/me` decides which named modules this user may export, using the same rules as the page and the endpoint.
4. **Questions don't download.** A message starting with what, which, how, … gets Download buttons instead of an automatic download. A chip or a button always downloads.
5. **Only a message that asks downloads.** The latest message must ask for files (download, export, CSV, again, "I need", …) or be a plain command. Data only named in passing is offered with a button, and modules from earlier messages never download again by themselves.
6. **No invented filters.** The model's `filter` is only used for the note, and only when its words appear in the message. The server also spots filter words in the message itself, for when the model leaves `filter` empty.
7. **No false "downloaded".** A text answer from the model that claims a download is replaced, because only an answer with files downloads anything.

---

## 10. Shared changes

- **Files in answers.** `AiResult` gets `downloads?: { label, path }[]` and `autoDownload?: boolean`, on the server and the client.
- **Answers with files always reach the user.** In the agent, such a read result is answered directly even with `AI_FAST_READS=false`.
- **`AiModule.direct`**, the optional no-model step of section 6.
- **"downloaded" and "exported"** count as claims of a change in `claimsChange()`, with a reply that fits: "Nothing was downloaded yet …".
- **Registry:** the Exports module is added after Departments.

---

## 11. Backend changes

None. The assistant uses the existing `GET /exports/:module` (from the browser) and `GET /auth/me` (for rights).

---

## 12. Client changes

- **Route map:** `/exports` → module `exports`.
- **`useAiDownloads`**: downloads a file with the existing `callApiServices(path, 'get', true, undefined, 'blob')` and `saveBlob()`, and tracks each file's state: downloading, done, or failed with the page's error message.
- **`useAiChat`** passes the files of a live answer with `autoDownload` to `onDownloads`. Answers loaded from history are never passed.
- **`AiMessage`** shows one button per file: a spinner while it downloads, a tick when done, the error under it. Answers with several files add the line about the browser's "multiple downloads" question.
- **The input box** shows an example request for the page: "Download employees and projects" here. Before, every page said "Add Mike Johnson to Engineering".

---

## 13. Testing

- **Unit:**
  - module words and "all" → modules, including "all employees" (Employees only);
  - exclusions;
  - notes for attendance, expenses, departments and roles;
  - questions;
  - the `direct` check: plain commands are read, anything else goes to the model.
- **Agent:** scripted model and a fake API with `/auth/me`.
  - one, several and all modules, with no model call;
  - "everything except";
  - an ORG_USER with some rights;
  - a model-read request;
  - a filter note;
  - a question that only offers buttons;
  - "What can I export?" and its buttons;
  - files still answered directly with `AI_FAST_READS=false`;
  - a false "downloaded" text replaced;
  - the eval's copied "all except documents" and "everything" download nothing;
  - "the same again" downloads the export from the earlier message.
- **Client:**
  - a live answer downloads its files one after another under the server's file names;
  - an answer loaded from history downloads nothing until a button is clicked.
- **Eval on the real model:** `RUN_OLLAMA=1 OLLAMA_MODEL=llama3.2 npx jest tests/ai/exports.eval`. Each phrase records whether the server or the model read it.

---

## 14. File flow: what happens when you type or speak

The shared path, file by file, is in [AI_ASSISTANT_PLAN.md, section 13](AI_ASSISTANT_PLAN.md#13-file-flow-what-happens-when-you-type-or-speak): the drawer, the AI route, the agent's order of decisions, and Confirm. This section shows only what is particular to the Exports assistant. Typing and speaking are the same from the second step on: `useSpeechInput.ts` turns your voice into text, and that text is sent like typed text.

**The files**

| Part | File |
|---|---|
| Route in the drawer | `AiAssistant.tsx`, `MODULE_ROUTES`: `/exports` → `exports` |
| Instructions and tool | `server/src/ai/modules/exports.module.ts`: `export_csv`, plus a `direct` reader |
| Word readers | `exports.helpers.ts` (which exports a message names, "everything except …", whether it asks to download now) |
| REST API it calls | `/auth/me` (your rights). The **browser** downloads `/exports/:module` (`routes/export.routes.ts` → `controllers/export.controller.ts`) |
| Downloads | `client/src/components/AiAssistant/useAiDownloads.ts` |
| After | Nothing to reload: no data changes |

**One request, step by step: "Download employees and projects"**

1. The message reaches `runTurn()`. Step 4, the module's `direct`, reads it **without the model**: `plainRequest()` in `exports.helpers.ts` sees two exports and a request to download.
2. `export_csv.run()` checks your rights with `GET /auth/me`. It answers "Downloading Employees CSV and Projects CSV", with the two files and `autoDownload`.
3. In the browser, `useAiChat.ts` sees a live answer with files and calls `onDownloads`. `useAiDownloads.ts` then fetches `GET /exports/employees` and `GET /exports/projects` one after the other, with your token, as the page's buttons do, and saves them (`saveBlob`).

**No Confirm:** a download changes nothing.

**"Thank you":** answered by `smallTalk.ts` at step 2, so nothing is downloaded again. An answer loaded from history never downloads by itself.
