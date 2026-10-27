# Documents Assistant: manage documents through chat

On the **Documents** page (`http://localhost:5173/documents`), users list, find, count, upload, change, download and delete documents by typing or speaking. For example: "Upload a document": the assistant asks for the title, the description and the category, and then opens the file picker.

This document covers the Documents module only. The shared parts are described in [AI_ASSISTANT_PLAN.md](AI_ASSISTANT_PLAN.md): Ollama setup, running on a CPU, the agent loop, confirm cards, voice and plan gating. Documents follows the same pattern as Tasks ([AI_TASKS_ASSISTANT.md](AI_TASKS_ASSISTANT.md)). What is new is the file: it lives in the browser, and every other write so far was JSON.

**Contents:** Status · Design choices · 1 Principle · 2 Document fields · 3 Who can do what · 4 Example conversations · 5 How a file reaches the API · 6 System prompt · 7 Tools · 8 Server checks · 9 Backend changes · 10 Shared changes · 11 Client changes · 12 Testing · 13 File flow

---

## Status

**Built (2026-10-19).** The Documents assistant works on `/documents`, uploads included.

| Where | What |
|---|---|
| `server/src/ai/modules/document.module.ts`, `document.helpers.ts` | The six tools; status words, categories, finding a document by its words, what each change needs in the message |
| `server/src/routes/ai.routes.ts`, `controllers/ai.controller.ts`, `ai/agent.service.ts`, `ai/apiClient.ts` | Confirm takes a file (multipart, checked by the upload middleware) and sends it on with the call that asked for it |
| `server/src/controllers/document.controller.ts`, `validators/document.validators.ts` | `GET /documents` filters `category` and `status` |
| `client/src/components/AiAssistant/AiFileField.tsx`, `AiDocumentForm.tsx`, `AiConfirmCard.tsx` | The file field (Choose file, the picker opening by itself on a live card, the type and size check) and the document form |
| `client/src/services/endpoints/ai.endpoints.ts`, `useAiChat.ts`, `useAiDownloads.ts`, `AiAssistant.tsx` | Confirm as multipart with a file; live answers marked; document downloads; `/documents` → `documents` |

**To try it:** with `AI_ENABLED=true` in `server/.env`, open **Documents** as a Professional-plan user whose role can read documents, and say or type "Upload a document".

**Tests:**
- `cd server && npm test` runs 310 tests, 35 of them for Documents, plus 3 route tests for the multipart Confirm.
- Client: `npx vitest run src/components/AiAssistant src/services/endpoints` (17 tests, 4 of them for Documents).
- Eval against the real model: `RUN_OLLAMA=1 OLLAMA_MODEL=llama3.2 npx jest tests/ai/document.eval`.

**Eval on `llama3.2`:** 13/16 on the first run, but that check only looked for the expected row. The model's calls showed changes nobody asked for, so the eval now checks that an update card shows **exactly** the expected rows. With that stricter check it scored 15/16, then **16/16** after the fixes below. In every run, nothing was written without a Confirm. The Tasks lessons (no copyable examples, the user's words must back each value, the wrong tool rerouted) held from the start: "Upload a new version of the employee handbook" and the Hinglish "Handbook ka naya version upload karna hai" both came back as `create_document`, and both became a file replacement.

**What the eval run changed:**

- **The model copied the document's name into other fields.** "Archive the travel policy" came with `category: "Travel Policy"`, and "Restore the leave policy" with `newTitle: "Leave Policy"` and `category: "Leave Policy"`. Each update field now changes only when the message asks for that kind of change:
  - the title: *rename*, *call it*, *new name*;
  - the category: *category*, *move … to*, *file under*;
  - the description: *description*.
- **A category with the description glued on:** "Upload the onboarding checklist under HR: steps for new joiners" came with `category: "HR: steps for new joiners"`. An existing category the message names now wins, and the model's words are cut at a colon.
- **"Move the payroll guide to the HR category" came back as a new upload.** With no word for uploading, a title that names an existing document is a change to it. The model's other fields go along, and update keeps only what the message asks for, reading the category from the message when needed.
- **"Which documents are archived?" came back as a count.** A count asked as "which", "what" or "show" answers with the list.

**After a report from the Exports page (2026-10-19):** a download of a document's file starts by itself only when the message asks for one now (download, get, send, again, …). For anything else, such as "the travel policy looks fine" when the model calls `download_document`, the file is only offered with a button. Thanks and greetings get a reply of their own, with no tool (see [AI_EXPORTS_ASSISTANT.md](AI_EXPORTS_ASSISTANT.md)).

**Changes from the plan, found while building it:**

- **In jsdom, a request whose `FormData` holds a `File` never completes** (msw can't read it). So the client tests stub the confirm request at the endpoint, a unit test checks the multipart body that `confirmAiActionRequest()` builds, and the server's route test sends a real multipart request through supertest. The Documents page's own "attached file" test, failing on the last commit too, has the same cause.
- **The card's document form carries the categories in use** (`categories`), so its Category field can suggest them. Only the server knows them.

---

## Design choices

| Question | Choice | Why |
|---|---|---|
| What does "upload" ask for? | **Title, description and category, then the file.** Status starts as Active. | The three are required by the API. The file comes last, from the picker, because a file can't be spoken or typed. |
| Is a file required? | **Yes, for an upload through chat.** | The page also lets you save a document without a file, but "upload" means a file. The card's Upload button stays disabled until one is chosen. |
| How does the file reach the API? | **With the Confirm click:** the card sends it to the assistant, which calls the existing `POST /documents` with the user's token. | One request, after the user's click, through the same endpoint, checks and audit log as the page. Section 5 explains the flow. |
| When does the file picker open? | **By itself when the card arrives**, if the browser allows it, and always from **Choose file** on the card | Browsers open a file picker only right after a click or a key press. A typed request answered quickly gets the picker at once; after a long model call or a spoken request, the user clicks Choose file. |
| Categories are free text | **An existing category is reused when it matches** ("hr" → "HR"). A new one is allowed, and the card says it's new. | This keeps one spelling per category without forbidding new ones. |

---

## 1. Principle

As in every module: **Ollama understands the request, and the Node.js backend does the work.** The model picks one of the module's tools and copies the user's words. The server turns them into real values (a document, a category, a status), and shows a confirm card. On **Confirm**, it calls the existing `/api/v1/documents` endpoints with the user's own token. The model never sees a file.

---

## 2. Document fields

`POST /api/v1/documents` is a `multipart/form-data` request, checked by `createDocumentSchema` and the upload middleware. `PUT /api/v1/documents/:id` takes the same fields, all optional, and a file replaces the old one.

| User says | API field | Required | How the server fills it |
|---|---|---|---|
| called …, titled … | `title` | yes | Must come from what the user said. Titles are not unique, so the card warns when one already exists. |
| description, about … | `description` | yes | Free text from the user. If it's the only thing missing, the next reply is taken as it, with no model call. |
| category, under … | `category` | yes | Free text. An existing category that matches without regard to case is used as spelled; otherwise the card notes a new category. The question offers the existing categories as buttons. |
| status | `status` | no (default `active`) | `active` (active, restore, unarchive) or `archived` (archive, archived, retire). |
| *(the file)* | `file` | yes, through chat | Chosen on the card. One PDF, Word, JPEG or PNG file of up to 10 MB, as on the page. |

**Deleting is a soft delete**, the same as the page's Delete button.

---

## 3. Who can do what

Like Projects and Tasks, Documents follows the **permission matrix**: the routes use `authorize('documents', …)`.

| Tool | Needs |
|---|---|
| `list_documents`, `count_documents`, `download_document` | `documents: read` |
| `create_document` | `documents: create` |
| `update_document` | `documents: update` |
| `delete_document` | `documents: delete` |

- The model is only given the tools the user's role allows, and the API checks again on Confirm.
- Without `documents: read`, there is no assistant on this page.
- Documents are on both plans; the assistant itself is Professional only.

---

## 4. Example conversations

### 4.1 Upload, asked step by step

> **You:** Upload a document
>
> **Assistant:** I'll add a new document. I still need the **title**, a short **description** and the **category** (HR, Policy or Finance). *[HR] [Policy] [Finance] [Fill in the form instead]*
>
> **You:** Employee handbook, the rules for everyone, under HR
>
> **Assistant:** *(confirm card)* Upload a document · Title **Employee handbook** · Description *the rules for everyone* · Category **HR** · Status **Active** · File *[Choose file]*: PDF, Word, JPEG or PNG, up to 10 MB · **[Upload document]** (disabled until a file is chosen) [Cancel]
>
> *(The file picker opens by itself if the browser allows it. The user picks `handbook.pdf` and clicks Upload document.)*
>
> **Assistant:** ✅ **Document uploaded:** Employee handbook · HR · handbook.pdf (1.2 MB).

When only one of the three is missing, the reply fills it without a model call.

### 4.2 Change, archive, replace the file

| Message | Card |
|---|---|
| Rename the handbook to Employee handbook 2026 | Title: ~~Employee handbook~~ → **Employee handbook 2026** |
| Move the handbook to the Policy category | Category: ~~HR~~ → **Policy** |
| Archive the old travel policy | Status: ~~Active~~ → **Archived** |
| Upload a new version of the handbook | File: ~~handbook.pdf~~ → *[Choose file]* (required) |

When several documents match, the assistant asks which one, with buttons.

### 4.3 Lists, counts and downloads

| Message | Tool call | Backend |
|---|---|---|
| Show all documents | `list_documents({})` | `GET /documents?limit=20&sortBy=title&sortDir=asc` |
| Show HR documents | `list_documents({ category: "HR" })` | `GET /documents?category=HR` |
| Which documents are archived? | `list_documents({ status: "archived" })` | `GET /documents?status=archived` |
| Find the handbook | `list_documents({ search: "handbook" })` | one match → a details line with a Download button |
| How many documents per category? | `count_documents({})` | a table of categories |
| Download the handbook | `download_document({ document: "handbook" })` | the browser downloads `GET /documents/:id/file`, as on Exports |

### 4.4 Delete

> **You:** Delete the old travel policy
>
> **Assistant:** *(red card)* **Delete Travel policy 2024?** · Category Policy · Archived · travel-2024.pdf · **[Delete document]** [Cancel]

A delete needs a word for deleting in the message; otherwise the request is read as a change (as on Tasks).

---

## 5. How a file reaches the API

```
card: Upload a document … [Choose file] → handbook.pdf → [Upload document]
  │  POST /ai/actions/:id/confirm   multipart: file + values (JSON, if the form was edited)
  ▼
AI route: the upload middleware checks the file (type, 10 MB), keeping it in memory
  ▼
confirmAction: the card's call carries `attachFile`
  │  POST /api/v1/documents   multipart: title, description, category, status + file,
  │                           with the user's token and the assistant's audit header
  ▼
the existing document controller stores the file in GridFS and the record, as for the page
```

- **Nothing is sent before the click,** as for every change.
- **The file is checked twice:** by the assistant's route (to fail early, on the card) and by the documents route (the real check).
- **The file is never stored by the assistant.** It's held in memory for the length of the request, and never reaches the model or the conversation; only its name and size are recorded.
- **Calls without `attachFile` stay JSON**, so every other module is unchanged.

---

## 6. System prompt

```ts
systemPrompt: (ctx) => `${basePrompt(ctx, 'documents')}
You are the Documents assistant. You help list, find, count and download documents${writes ? ', and upload, change or delete them' : ''}.
- Call a tool for every request, also when the user writes in Hindi or Hinglish.
- Fill in only details the user actually gave. Never make up a title, a description or a category.
- Copy titles, categories and statuses exactly as the user said them. The server finds the documents.
- To upload or add a document, call create_document. The app asks for the file itself.
- Never say that a document was uploaded, changed or deleted. The app shows that after the backend confirms it.`
```

The upload line is only sent when the user has `create_document`. As the Exports and Tasks evals showed, the model copies example values from its instructions, so the tool descriptions are short labels with no examples.

---

## 7. Tools

| Tool | Kind | Permission | Model fills in | Server does |
|---|---|---|---|---|
| `list_documents` | read | read | `search?`, `category?`, `status?`, `page?` | `GET /documents` with filters → table, details line, or "Show more" |
| `count_documents` | read | read | `category?`, `status?` | `GET /documents?…&limit=1` → total; with no filter, one count per category |
| `download_document` | read | read | `document` | find document → a download for the browser; no file → says so |
| `create_document` | write | create | `title?`, `description?`, `category?`, `status?` | asks for what is missing → card with the file field → `POST /documents` (multipart) |
| `update_document` | write | update | `document`, then any of `newTitle`, `description`, `category`, `status`, `replaceFile` | find document → card with old → new (and the file field for a new file) → `PUT /documents/:id` |
| `delete_document` | write | delete | `document` | find document → red card → `DELETE /documents/:id` |

---

## 8. Server checks

1. **Empty means not given** (`""`, `null`, `"N/A"`).
2. **Title, description and category must come from the user.** Each must share a real word with what the user said, not just "the" or "document" (`heardText`, from Tasks).
3. **Statuses are a closed list, and must be the user's**, as on the other modules.
4. **Categories reuse their existing spelling.** One that matches without regard to case is used as spelled; otherwise the card notes a new category.
5. **Documents are found by their words**, in any order. Only an exact title wins outright; several matches get a question.
6. **Each change needs its own words in the message:** a new title needs *rename* or *call it*, a category *category* or *move … to*, a description *description*. A status is read from the message itself; a new file needs *new version*, *replace* or *re-upload*.
7. **The tool must fit the message.** A delete needs a word for deleting; a create, a word for uploading or adding. Otherwise the request goes to `update_document` (the reroute from Tasks).
8. **The file is checked on the card and again on the server:** one file, of an allowed type, of up to 10 MB.
9. **The card is the last check.** Every field is editable, and Upload stays disabled until the values pass the page form's rules (`client/src/validation/document.schemas.ts`) and a file is chosen.

---

## 9. Backend changes

1. **Filters on `GET /documents`:** `category` (exact, not case-sensitive) and `status` (`active` or `archived`). The Documents page can use them too.
2. **The confirm route takes a file.** `POST /ai/actions/:id/confirm` also accepts `multipart/form-data`, with an optional `file` and `values` as JSON text. It is checked by the same upload middleware as documents.

---

## 10. Shared changes

- **An `ApiCall` can carry the file** (`attachFile: true`). The internal API client then sends the call as `multipart/form-data`: the body's fields plus the file. Without it, calls stay JSON.
- **A confirm card can ask for a file:** `file?: { required: boolean; current?: string }` adds a file field to the card.
- **The card's form gets a fifth kind,** `'document'`.
- **Live answers are marked on the client**, so a card that arrives live can open the file picker by itself; one loaded from history never does.
- **Downloads may come from `/documents/:id/file`** as well as `/exports/…`.
- **`heardText()` and `sameText()` move to `ai/text.ts`**, shared by Tasks and Documents.

---

## 11. Client changes

- **Route map:** `/documents` → module `documents`, with the example "Upload the employee handbook".
- **Starter chips:** "Upload a document" (needs `create`), "Show all documents", "Archived documents" and "Count by category".
- **The file field on the card:** **Choose file**, the chosen name and size, the allowed types, and an error for a wrong type or a file over 10 MB. Confirm sends the file with the click.
- **Document form on the card** (`AiDocumentForm.tsx`): Title, Description, Category (suggesting the existing ones) and Status, with `documentSchema` from the page form.
- After a confirmed change, `fetchDocuments` reloads the table behind the drawer.

---

## 12. Testing

- **Unit:**
  - status and category words;
  - matching a document by its words;
  - the follow-up fast path;
  - the multipart body built for a file call.
- **Agent:** scripted model and fake API.
  - upload asked step by step, then Confirm with a file, sending a multipart `POST /documents`;
  - Confirm without a file refused;
  - an existing category reused;
  - rename, archive and replace the file;
  - delete;
  - download, and a document without a file;
  - lists by category and status, and counts per category;
  - a read-only ORG_USER.
- **Route:** a multipart confirm reaches `confirmAction` with the file and the values; a wrong type or an oversized file is refused.
- **Client:**
  - choosing a file on the card, and Confirm sending it with the values;
  - Upload disabled until a file is chosen;
  - a wrong type refused on the card.
- **Eval on the real model:** `RUN_OLLAMA=1 OLLAMA_MODEL=llama3.2 npx jest tests/ai/document.eval`, about 15 phrases.

---

## 13. File flow: what happens when you type or speak

The shared path, file by file, is in [AI_ASSISTANT_PLAN.md, section 13](AI_ASSISTANT_PLAN.md#13-file-flow-what-happens-when-you-type-or-speak): the drawer, the AI route, the agent's order of decisions, and Confirm. This section shows only what is particular to the Documents assistant. Typing and speaking are the same from the second step on: `useSpeechInput.ts` turns your voice into text, and that text is sent like typed text.

**The files**

| Part | File |
|---|---|
| Route in the drawer | `AiAssistant.tsx`, `MODULE_ROUTES`: `/documents` → `documents` |
| Instructions and tools | `server/src/ai/modules/document.module.ts`: `list_documents`, `count_documents`, `download_document`, `create_document`, `update_document`, `delete_document` |
| Word readers | `document.helpers.ts` (categories, statuses, which field a message asks to change) |
| REST API it calls | `/documents` (`routes/document.routes.ts` → `controllers/document.controller.ts`); the browser downloads `/documents/:id/file` |
| Card form and file | `AiDocumentForm.tsx`, and `AiFileField.tsx` for the file |
| After Confirm | `fetchDocuments` reloads the table |

**One request, step by step: "Upload the employee handbook"**

1. **The model is asked**, and calls `create_document { title: "Employee handbook" }`.
2. `create_document.prepare()` finds the description and category still missing, so it **asks for them**, and keeps a draft. Your replies fill it.
3. The card comes back with a **file field**. `AiFileField.tsx` opens the file picker by itself, because the card arrived live. It checks the type (PDF, Word, JPG, PNG) and the size (10 MB).

**On Confirm, with the file:**

1. `ai.endpoints.ts` `confirmAiActionRequest()` sends the edits and the file as multipart.
2. On the server, `ai.routes.ts` `upload.single('file')` checks it, the same way the Documents page's upload is checked.
3. `confirmAction()` runs the call marked `attachFile`: `apiClient.ts` `multipartBody()` → `POST /documents` → `document.routes.ts` → `document.controller.ts` `createDocument()`.
4. The file is held in memory only for this request, and never stored in the conversation.

**A download:** "Download the handbook" → `download_document` → an answer with the file. `useAiDownloads.ts` fetches `GET /documents/:id/file` with your token.
