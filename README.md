# Auth App

A full-stack authentication app built to learn production-style auth patterns: JWT access tokens, rotating HttpOnly-cookie refresh tokens, single-active-session enforcement, and a React auth context.

## Tech stack

- **Frontend:** React + Vite + React Router DOM, custom CSS
- **Backend:** Node.js + Express (CommonJS)
- **Database:** PostgreSQL
- **Auth:** JWT access tokens (15m) + rotating refresh tokens (7d) stored hashed in Postgres, HttpOnly cookie for the refresh token
- **Password hashing:** bcryptjs

## Project structure

```
API/
├── backend/           Express API (port 3000)
│   ├── config/db.js   PostgreSQL pool
│   ├── controller/    Auth logic (register, login, refresh, logout, profile)
│   ├── middleware/    Access-token + session validation
│   ├── routes/        /api/auth/* routes
│   ├── db/schema.sql  Tracked DB schema
│   └── server.js
└── auth-frontend/     React app (port 5173)
    └── src/
        ├── context/AuthContext.jsx   Global auth state (user, loading, login, logout)
        ├── components/ProtectedRoute.jsx
        ├── pages/{Login,Register,Dashboard}.jsx
        └── services/auth.js         Fetch wrapper: refresh-and-retry, shared refresh promise
```

## Prerequisites

- Node.js **20.20.2** (an `.nvmrc` is provided in both `backend/` and `auth-frontend/` — run `nvm use` in each)
- A running PostgreSQL instance

## Setup

1. **Install dependencies**

   ```bash
   cd backend && nvm use && npm install
   cd ../auth-frontend && nvm use && npm install
   ```

2. **Configure the backend environment**

   ```bash
   cd backend
   cp .env.example .env
   ```

   Edit `.env` and fill in real values for `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `JWT_SECRET`, and `JWT_REFRESH_SECRET` (use long random strings for the two secrets — they must be different from each other).

3. **Create the database schema**

   ```bash
   psql -U <DB_USER> -d <DB_NAME> -f backend/db/schema.sql
   ```

4. **Run both servers** (in separate terminals)

   ```bash
   cd backend && npm run dev        # http://localhost:3000
   cd auth-frontend && npm run dev  # http://localhost:5173
   ```

5. Visit `http://localhost:5173/register` to create an account, then log in.

## Environment variables (backend)

| Variable | Purpose |
|---|---|
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | PostgreSQL connection |
| `JWT_SECRET` | Signs access tokens |
| `JWT_EXPIRES_IN` | Access token lifetime (default `15m`) |
| `JWT_REFRESH_SECRET` | Signs refresh tokens (must differ from `JWT_SECRET`) |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token lifetime (default `7d`) |
| `NODE_ENV` | Set to `production` to enable the `Secure` flag on the refresh-token cookie |

See `backend/.env.example` for the full template.

## API endpoints

All routes are under `/api/auth`.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/register` | — | Create a user |
| POST | `/login` | — | Log in; revokes any other active session, sets refresh cookie |
| POST | `/refresh` | Refresh cookie | Rotates the refresh token, returns a new access token |
| POST | `/logout` | Refresh cookie | Revokes the current session, clears the cookie |
| GET | `/profile` | `Authorization: Bearer <accessToken>` | Returns the current user |

## Key design notes

- Every protected request re-checks the session against the `refresh_tokens` table (not just the JWT signature), so logging out or logging in elsewhere invalidates already-issued access tokens immediately.
- The refresh token is never stored in plaintext — only its SHA-256 hash is persisted.
- Logging in anywhere revokes all other active sessions for that user (single-active-session enforcement).

## Scripts

| Location | Command | Purpose |
|---|---|---|
| `backend` | `npm run dev` | Start the API server |
| `auth-frontend` | `npm run dev` | Start the Vite dev server |
| `auth-frontend` | `npm run build` | Production build |
| `auth-frontend` | `npm run lint` | ESLint |
