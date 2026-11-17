# SalesFire 🔥

SalesFire is a full-stack, enterprise-grade cold email outreach and sales automation platform. It provides high-deliverability email campaigns, automated warm-up schedules, AI-assisted multi-step sequence building, real-time analytics, and lead discovery.

---

## Architecture Overview

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Lucide Icons, Socket.IO client.
- **Backend**: Node.js, Express, Sequelize ORM (supporting SQLite for local dev & MySQL 8 in production), Socket.IO.
- **Security**: Argon2id password hashing, AES-256-GCM credential encryption at rest, httpOnly JWT cookies, strict CORS, rate limiting.
- **AI Engine**: OpenAI-compatible provider integration (Groq, Moonshot, OpenAI) for automated sequence generation, spintax creation, and variable-depth email personalization.

---

## Project Structure

```
SalesFire/
├── .github/workflows/          # CI/CD & security workflows
├── backend-node/               # Express + Sequelize API backend
│   ├── migrations/             # Database migration scripts
│   ├── models/                 # Sequelize data models
│   ├── routes/                 # REST API endpoints (auth, campaigns, AI, leads, etc.)
│   ├── services/               # Core business logic (AI, email engine, warmup, crypto)
│   ├── test/                   # Automated API and unit test suites
│   ├── .env.example            # Environment configuration template
│   └── server.js               # Application entry point
├── frontend/                   # React + TypeScript SPA
│   ├── src/
│   │   ├── components/         # Reusable UI components & sequence editor
│   │   ├── contexts/           # Authentication & state management
│   │   ├── pages/              # Dashboard, Campaign, Leads, Analytics views
│   │   └── services/           # Axios API services
│   └── vite.config.ts
└── docs/                       # Technical architecture & security documentation
```

---

## Getting Started

### Prerequisites

- **Node.js**: v18 or later
- **npm**: v9 or later

---

### Backend Setup

1. Navigate to the backend directory:
   ```bash
   cd backend-node
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create your local environment file:
   ```bash
   cp .env.example .env
   ```

4. Configure your environment variables in `.env`:
   - `PORT`: Server port (default `8000`).
   - `JWT_SECRET` & `JWT_REFRESH_SECRET`: Secrets for signing tokens.
   - `ENCRYPTION_KEY`: 32-character key for AES-256-GCM encryption of SMTP credentials.
   - `DATABASE_URL`: `sqlite:./database.sqlite` (local) or MySQL connection string.
   - `KIMI_API_KEY`: API key for AI generation (e.g. Groq, Moonshot, or OpenAI).
   - `KIMI_BASE_URL`: OpenAI-compatible endpoint (e.g. `https://api.groq.com/openai/v1`).
   - `KIMI_MODEL`: Model name (e.g. `qwen/qwen3.8-27b`).

5. Start the backend:
   ```bash
   node server.js
   ```

---

### Frontend Setup

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the Vite dev server:
   ```bash
   npm run dev
   ```

4. Open your browser at `http://localhost:5173`.

---

## Running Tests

Run backend tests:
```bash
cd backend-node
npm test
```

Run frontend tests:
```bash
cd frontend
npm test
```

---

## Security & Best Practices

- **Zero-Secret Commits**: All `.env` files and SQLite databases are strictly excluded via `.gitignore`.
- **Credential Hygiene**: Sensitive SMTP passwords are encrypted using AES-256-GCM before being stored in the database.
- **Untrusted AI Handling**: All AI-generated email templates and sequences are sanitized server-side prior to rendering or dispatching.
