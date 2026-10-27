# RBAC System (Sentinel)

A multi-tenant HR and admin platform with role-based access control. A **Super Admin** onboards organizations; each **Org Admin** buys a plan, defines roles with a per-module permission matrix, and invites **Org Users**.

Modules: employees, departments, documents, projects, tasks, dashboard, attendance, leave and holidays, announcements and posts, expenses and reimbursements, onboarding/offboarding, performance (goals and reviews), notifications, CSV exports and audit logs. Which ones an organization gets depends on its plan (Basic or Professional).

| Part | Stack |
| --- | --- |
| [`server/`](server/) | Node.js, TypeScript, Express, Mongoose 9 (MongoDB), Zod, JWT, bcrypt, Razorpay, Nodemailer, node-cron |
| [`client/`](client/) | React 19, TypeScript, Vite 5, Ant Design 5, Redux Toolkit, React Router 7, React Hook Form + Zod, Tailwind CSS |

---

## Prerequisites

- **Node.js 20 or newer** and **npm**
- **MongoDB**: any reachable instance. Pick one:
  - Local: install [MongoDB Community](https://www.mongodb.com/try/download/community)
  - Docker: `docker run -d --name rbac-mongo -p 27017:27017 mongo:7`
  - Cloud: a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster (copy its `mongodb+srv://` connection string)
- Optional: **Razorpay test keys**, needed to activate a plan for an organization (see [Plans and payments](#plans-and-payments))
- Optional: **SMTP credentials**. Without them, emails go to a throwaway Ethereal inbox in development
- Optional: **Ollama**, for the AI chat assistant (Professional plan). Steps for macOS, Windows and Linux are in [AI assistant (Ollama)](#ai-assistant-ollama). The rest of the app works without it

---

## Quick start

The client and server are separate npm projects. Run each in its own terminal.

### 1. Server (API)

```bash
cd server
npm install
cp .env.example .env        # Windows (PowerShell): Copy-Item .env.example .env
```

Edit `server/.env`. At minimum set:

- `MONGODB_URI`: your MongoDB connection string
- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`: two different long random strings. Generate each with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```
- `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`, `SUPERADMIN_NAME`: your first login

Then create the Super Admin and start the API:

```bash
npm run seed:superadmin     # idempotent, safe to re-run
npm run dev
```

The API runs at `http://localhost:4000/api/v1`. Check it with:

```bash
curl http://localhost:4000/api/v1/health    # {"status":"ok"}
```

### 2. Client (web app)

```bash
cd client
npm install
cp .env.example .env        # Windows (PowerShell): Copy-Item .env.example .env
npm run dev
```

Open **http://localhost:5173** and log in with the `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` you set.

### 3. AI assistant (optional)

To use the chat assistant, install Ollama and download a model first: see [AI assistant (Ollama)](#ai-assistant-ollama). Then set `AI_ENABLED=true` in `server/.env` and restart the server.

---

## First run walkthrough

1. **Log in as Super Admin** and invite an Org Admin (name, email, organization name). A temporary password is shown in the response and also emailed (or printed as an Ethereal preview link in the server console).
2. **Log in as that Org Admin.** You'll be asked to change the temporary password, then land on **Billing** until the organization has an active plan.
3. **Buy a plan** with Razorpay test mode (see below).
4. As Org Admin, **create roles** (Roles & Permissions) and **invite users** with those roles.

---

## Environment variables

### `server/.env`

See [`server/.env.example`](server/.env.example) for the full template with comments.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `MONGODB_URI` | **yes** | | MongoDB connection string |
| `JWT_ACCESS_SECRET` | **yes** | | Signs access tokens |
| `JWT_REFRESH_SECRET` | **yes** | | Signs refresh tokens |
| `NODE_ENV` | no | `development` | `development`, `test` or `production` |
| `PORT` | no | `4000` | API port |
| `JWT_ACCESS_EXPIRES_IN` | no | `15m` | Access token lifetime |
| `JWT_REFRESH_EXPIRES_IN` | no | `7d` | Refresh token lifetime |
| `CORS_ORIGIN` | no | `http://localhost:5173` | Exact frontend origin allowed to call the API with cookies |
| `API_BASE_URL` | no | `http://localhost:4000` | Public API origin, used to build absolute URLs such as avatars |
| `SUPERADMIN_EMAIL` / `_PASSWORD` / `_NAME` | for seeding | | Used by `npm run seed:superadmin` (password: 8+ characters) |
| `RAZOR_PAY_API_KEY` / `RAZOR_PAY_SECRET` | for payments | | Razorpay key id and secret. Payment endpoints return 503 without them |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | no | | Outgoing mail. Empty `SMTP_HOST` in development uses Ethereal |
| `MAIL_FROM` | no | `Sentinel <no-reply@sentinel.local>` | Sender on outgoing email |
| `AI_ENABLED` | no | `false` | Turns on the AI chat assistant. Needs Ollama (see [AI assistant (Ollama)](#ai-assistant-ollama)) |
| `OLLAMA_HOST` | no | `http://localhost:11434` | Where Ollama listens |
| `OLLAMA_MODEL` | no | `qwen2.5:3b` | The model to use. `llama3.2` is recommended: the assistants' test phrases were run on it |
| `AI_MAX_CONCURRENT`, `AI_REQUEST_TIMEOUT_MS`, `AI_NUM_CTX`, … | no | see `.env.example` | Tuning. The defaults suit a machine without a GPU |

### `client/.env`

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `http://localhost:4000/api/v1` | Backend API base URL, including `/api/v1` |

`VITE_*` values are compiled into the bundle, so never put secrets in the client env. Restart `npm run dev` after editing it.

---

## Plans and payments

New organizations have no plan. The Org Admin pays through Razorpay Checkout on the Billing page, and the server verifies the payment signature before activating the plan.

| Plan | Monthly | Includes |
| --- | --- | --- |
| Basic | ₹300 | Dashboard, employees, documents, departments, projects, tasks, roles, expenses, onboarding |
| Professional | ₹600 | Everything in Basic, plus CSV exports, audit logs and performance |

Quarterly and yearly cycles are 3× and 12× the monthly price.

To test locally:

1. Create a free account at [dashboard.razorpay.com](https://dashboard.razorpay.com) and switch to **Test Mode**.
2. Under **Account & Settings → API Keys**, generate a key and put the key id and secret into `RAZOR_PAY_API_KEY` and `RAZOR_PAY_SECRET` in `server/.env`. Restart the server.
3. Pay with one of Razorpay's [test cards or test UPI IDs](https://razorpay.com/docs/payments/payments/test-card-details/). No real money moves.

The key id reaches the browser through the API; the secret never leaves the server.

---

## Email

Emails (temporary passwords, password reset, plan expiry, onboarding and performance reminders) are sent with Nodemailer.

- **No setup (development):** leave `SMTP_HOST` empty. The server creates an [Ethereal](https://ethereal.email) test inbox and logs a preview link for every email.
- **Gmail:** `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER=<your address>`, `SMTP_PASS=<16-character App Password>` from [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (needs 2-step verification).
- **Mailtrap or another provider:** paste its SMTP host, port, user and password. Port 465 uses TLS; any other port uses STARTTLS.

No emails are sent while running tests.

---

## AI assistant (Ollama)

Most pages have a chat assistant: you type or speak a request ("Create a project called Apollo due 31 December", "Apply for leave from 3 Nov to 5 Nov"), and it answers or prepares the change for you to confirm. It runs on a **local AI model through [Ollama](https://ollama.com)**, so HR data never leaves your machine.

- It is on the **Professional** plan only, and off until you set `AI_ENABLED=true`.
- The rest of the app works the same without it.
- How it works, page by page, is in [`docs/AI_ASSISTANT_PLAN.md`](docs/AI_ASSISTANT_PLAN.md).

### What your computer needs

| | Minimum | Better |
| --- | --- | --- |
| RAM | 8 GB (the model takes about 2.5 GB while loaded) | 16 GB |
| Disk | About 2 GB free per model | |
| CPU | Any 64-bit CPU | 4 cores or more |
| GPU | Not needed | Used by itself when present: Apple Silicon Macs, NVIDIA cards with current drivers, supported AMD cards |

Without a GPU, a reply takes about 5–15 seconds, and the first one after a restart up to about 40 seconds while the model loads. On an Apple Silicon Mac or with a GPU, a few seconds.

### Step 1: install Ollama

Install it on the same system the server runs on, so the server can reach it at `localhost:11434`.

#### macOS

- **Recommended: the app.**
  1. Download it from [ollama.com/download/mac](https://ollama.com/download/mac). The page lists the minimum macOS version.
  2. Open the `.zip`, and drag **Ollama** into **Applications**.
  3. Open it once. It runs in the menu bar, adds the `ollama` command, and starts again when you log in.
- **Or with Homebrew:**
  ```bash
  brew install ollama
  brew services start ollama      # starts it now and at every login
  ```

#### Windows

- **Recommended: the installer.**
  1. Download `OllamaSetup.exe` from [ollama.com/download/windows](https://ollama.com/download/windows), and run it. It needs Windows 10 or 11 (64-bit), and installs for your user without admin rights.
  2. Ollama then runs in the background (an icon in the system tray), and starts with Windows.
  3. Open a **new** PowerShell window, so the `ollama` command is found.
- **Or with winget:**
  ```powershell
  winget install Ollama.Ollama
  ```
- **If you run the server inside WSL**, install the Linux version inside WSL instead (next section), so `localhost:11434` is the same machine for both.

#### Linux

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

This installs the `ollama` command and a `systemd` service that starts at boot. To read the script before running it, download it first with `curl -fsSL https://ollama.com/install.sh -o install.sh`.

On a system without `systemd` (some containers, or WSL with it turned off), run `ollama serve` in its own terminal and leave it open.

#### Any system: Docker

```bash
docker run -d --name ollama -p 11434:11434 -v ollama:/root/.ollama ollama/ollama
```

- With an NVIDIA GPU on Linux, add `--gpus=all`. That needs the NVIDIA Container Toolkit.
- On a Mac, Docker can't use the Apple GPU, so the app above is much faster there.

### Step 2: check that it's running

```bash
ollama --version
curl http://localhost:11434/api/version     # expect {"version":"..."}
```

On Windows PowerShell, type `curl.exe` instead of `curl`.

If it isn't running:

| System | Start it with |
| --- | --- |
| macOS | Open the Ollama app, or `brew services start ollama` |
| Windows | Open **Ollama** from the Start menu |
| Linux | `sudo systemctl start ollama`; check with `systemctl status ollama` |
| Docker | `docker start ollama` |
| Anywhere | `ollama serve` in a terminal you leave open |

### Step 3: download the model

```bash
ollama pull llama3.2      # 2.0 GB, once
ollama list               # llama3.2 should be listed
ollama run llama3.2 "Reply with one short line: hello"
```

With Docker, prefix each command with `docker exec -it ollama`, for example `docker exec -it ollama ollama pull llama3.2`.

| Model | When |
| --- | --- |
| `llama3.2` (3B) | **Recommended.** Every assistant's test phrases in `docs/` were run on it |
| `qwen2.5:3b` (3B) | The server's default when `OLLAMA_MODEL` isn't set; also works |
| 7B models | More accurate, but need about 8 GB of free RAM, and are much slower without a GPU |

### Step 4 (recommended without a GPU): keep the model loaded

By default, Ollama unloads the model after 5 idle minutes, and loading it again takes seconds. These settings keep it loaded for 30 minutes, with one request at a time:

| Setting | Value |
| --- | --- |
| `OLLAMA_KEEP_ALIVE` | `30m` |
| `OLLAMA_NUM_PARALLEL` | `1` |
| `OLLAMA_MAX_LOADED_MODELS` | `1` |

How to set them:

- **Linux:** run `sudo systemctl edit ollama`, add these lines, and save:
  ```ini
  [Service]
  Environment="OLLAMA_KEEP_ALIVE=30m"
  Environment="OLLAMA_NUM_PARALLEL=1"
  Environment="OLLAMA_MAX_LOADED_MODELS=1"
  ```
  Then run `sudo systemctl daemon-reload && sudo systemctl restart ollama`.
- **macOS:** run these, then quit Ollama from the menu bar and open it again:
  ```bash
  launchctl setenv OLLAMA_KEEP_ALIVE 30m
  launchctl setenv OLLAMA_NUM_PARALLEL 1
  launchctl setenv OLLAMA_MAX_LOADED_MODELS 1
  ```
- **Windows:** quit Ollama from the system tray. Run these in PowerShell, then open Ollama again:
  ```powershell
  setx OLLAMA_KEEP_ALIVE 30m
  setx OLLAMA_NUM_PARALLEL 1
  setx OLLAMA_MAX_LOADED_MODELS 1
  ```
- **Docker:** add `-e OLLAMA_KEEP_ALIVE=30m -e OLLAMA_NUM_PARALLEL=1 -e OLLAMA_MAX_LOADED_MODELS=1` to `docker run`.

### Step 5: turn it on in the app

1. Add these lines to `server/.env`:
   ```env
   AI_ENABLED=true
   OLLAMA_HOST=http://localhost:11434
   OLLAMA_MODEL=llama3.2
   ```
2. Restart the server (`npm run dev`). It logs `AI ready: llama3.2 at http://localhost:11434`. If Ollama isn't reachable or the model is missing, it logs a warning instead, and the chat says the assistant is offline.
3. Log in as a member of an organization on the **Professional** plan, and open a page with an assistant: Employees, Projects, Departments, Tasks, Documents, Exports, Roles, Expenses, Audit Logs, or the Me page's Leave, Attendance and Expenses tabs.
4. Click the round button in the bottom-right corner. Type, or click the mic and speak. The mic works in Chrome, Edge and Safari, on `localhost` or `https://`.

### Testing the assistant against the model

Each assistant has an eval: about 15–20 real phrases, run against your local model.

```bash
cd server
RUN_OLLAMA=1 OLLAMA_MODEL=llama3.2 npx jest tests/ai/project.eval --runInBand
```

Swap `project` for another module: `employee`, `department`, `exports`, `task`, `document`, `role`, `expense`, `me` or `auditLog`. Run one at a time: each loads the model, and several at once can run out of memory. Ordinary `npm test` never calls Ollama.

---

## Scripts

### Server (`cd server`)

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the API with auto-reload (`ts-node-dev`) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled build (`node dist/server.js`). Run `npm run build` first |
| `npm test` | Jest + Supertest suite on an in-memory MongoDB. No database or `.env` needed |
| `npm run seed:superadmin` | Create the first Super Admin from the `SUPERADMIN_*` variables |

### Client (`cd client`)

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on port 5173 |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Vitest suite (jsdom + MSW) |
| `npm run typecheck` | TypeScript check only |

The first `npm test` in `server/` downloads a MongoDB binary for `mongodb-memory-server`, so it needs internet access once and can take a minute.

---

## Running in production

**Server**

```bash
cd server
npm ci
npm run build
NODE_ENV=production npm start
```

- Set `NODE_ENV=production`, strong JWT secrets, a real `MONGODB_URI`, real SMTP, and live Razorpay keys.
- Set `CORS_ORIGIN` to the deployed frontend origin (for example `https://app.example.com`) and `API_BASE_URL` to the public API origin.
- Serve the API over HTTPS. The refresh token is an httpOnly cookie, and browsers are strict about cross-site cookies on plain HTTP.
- Scheduled jobs (plan expiry, onboarding and performance reminders) run daily inside the API process via `node-cron`. Run a **single** instance, or reminders will be sent once per instance.
- Uploaded files (documents, avatars, receipts) are stored in MongoDB GridFS, so there is no upload folder to persist.

**Client**

```bash
cd client
npm ci
VITE_API_BASE_URL=https://api.example.com/api/v1 npm run build
```

Deploy `client/dist/` to any static host (Nginx, Netlify, Vercel, S3 + CloudFront). It is a single-page app, so configure the host to fall back to `index.html` for unknown paths.

---

## Running on another machine or the local network

To open the app from a different device (for example a phone on the same Wi-Fi), replace `localhost` with the host machine's IP, say `192.168.1.20`:

- `client/.env`: `VITE_API_BASE_URL=http://192.168.1.20:4000/api/v1`
- `server/.env`: `CORS_ORIGIN=http://192.168.1.20:5173` and `API_BASE_URL=http://192.168.1.20:4000`
- Start the client with `npm run dev -- --host` so Vite listens on all interfaces.

---

## Authentication

- **Access token:** short-lived JWT returned in the login response and sent as `Authorization: Bearer <token>`.
- **Refresh token:** long-lived JWT in an httpOnly cookie, stored hashed on the server, rotated on every refresh and revoked on logout. The client refreshes automatically when the access token expires.
- Invited accounts must change their temporary password on first login.

### Roles and permissions

| Role | Scope |
| --- | --- |
| `SUPER_ADMIN` | Platform-wide: invites Org Admins, lists organizations and admins |
| `ORG_ADMIN` | Full access within their organization, manages billing, roles and users |
| `ORG_USER` | Access defined by their assigned role |

An Org Admin's role grants `read` / `create` / `update` / `delete` per module. `read` is a gate: the other three only apply when `read` is also granted, and this is enforced on the server.

---

## Project structure

```
.
├── client/
│   └── src/
│       ├── pages/          one folder per screen (employees, leave, billing, ...)
│       ├── components/     shared UI
│       ├── routes/         router plus guards (auth, role, permission, plan)
│       ├── services/       axios client, token refresh, API endpoints
│       ├── store/          Redux Toolkit store
│       ├── permissions/    client-side permission checks
│       ├── validation/     Zod form schemas
│       └── theme/          Ant Design theme and light/dark mode
├── server/
│   ├── src/
│   │   ├── config/         env loading and validation
│   │   ├── routes/         Express routers, all under /api/v1
│   │   ├── controllers/    request handling
│   │   ├── services/       business logic (auth, invites, mail, payments, ...)
│   │   ├── repositories/   data access (soft delete, audit stamping)
│   │   ├── models/         Mongoose schemas
│   │   ├── middlewares/    authenticate, authorize, validate, rate limit, upload, errors
│   │   ├── validators/     Zod request schemas
│   │   ├── jobs/           daily cron reminders
│   │   ├── ai/             the AI assistant: agent, Ollama client, one module per page
│   │   └── scripts/        seedSuperAdmin
│   └── tests/              Jest + Supertest integration tests (tests/ai: the assistant)
└── docs/                   the AI assistant's design, one document per page
```

The assistant's chat drawer is in `client/src/components/AiAssistant/`. How a typed or spoken message travels through the files is in [`docs/AI_ASSISTANT_PLAN.md`](docs/AI_ASSISTANT_PLAN.md), section 13.

Request flow on the server: `Route → Controller → Service → Repository → MongoDB`.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Server exits with a Zod error about `MONGODB_URI` or `JWT_*` | `server/.env` is missing or incomplete. Copy it from `.env.example` and fill in the required values |
| `Failed to start server` / `MongooseServerSelectionError` | MongoDB isn't reachable. Check it's running and that `MONGODB_URI` is right. For Atlas, allow your IP under Network Access |
| Browser shows CORS errors, or you're logged out on every reload | `CORS_ORIGIN` in `server/.env` must exactly match the URL in the address bar (scheme, host and port) |
| Client calls the wrong API | Check `VITE_API_BASE_URL` in `client/.env` and restart `npm run dev` |
| Billing says payments are unavailable (503) | Set `RAZOR_PAY_API_KEY` and `RAZOR_PAY_SECRET` and restart the server |
| No emails arrive | With `SMTP_HOST` empty, look for the Ethereal preview link in the server console. For Gmail, use an App Password, not your normal password |
| Port 4000 or 5173 already in use | Change `PORT` in `server/.env` (and update `VITE_API_BASE_URL`), or run the client with `npm run dev -- --port 5174` (and update `CORS_ORIGIN`) |
| `bcrypt` fails to install | It compiles a native module. Use Node 20+ LTS; on Linux install `build-essential` and `python3`, on Windows the Visual Studio Build Tools |
| `ollama: command not found` right after installing | Open a new terminal (on Windows, a new PowerShell window), so it picks up the new `PATH` |
| Server logs `connect ECONNREFUSED 127.0.0.1:11434` | Ollama isn't running: see [Step 2](#step-2-check-that-its-running) for each system |
| Server logs that the model isn't found | Run `ollama pull llama3.2`, or set `OLLAMA_MODEL` to a name from `ollama list` |
| No assistant button | The organization is on Basic, `AI_ENABLED` isn't `true`, the page has no assistant, or your role can't read that page |
| No mic button, or the mic won't start | Firefox has no speech recognition: use Chrome, Edge or Safari. Browsers allow the mic only on `localhost` or `https://` |
| Replies are very slow, or the computer freezes | Not enough free RAM, so the model is swapping. Close other apps, keep to a 3B model, and check with `ollama ps` |
| Ollama runs on Windows but the server in WSL can't reach it | Install the Linux version inside WSL instead, or point `OLLAMA_HOST` at the Windows host's address |
