# UZH Student Socializer – API (Local Backend)

Lightweight Express + SQLite backend powering authentication for the MVP. The stack keeps everything local today but is schema-compatible with a future managed Postgres/Supabase deployment.

## Getting Started

```bash
# from repo root
cd server
npm install
npm run prisma:generate
npm run db:init   # creates the SQLite schema
npm run dev       # starts http://localhost:4000 by default
```

Environment variables live in `.env`. Copy `.env.example` and adjust as needed:

```bash
cp .env.example .env
```

Key variables:

- `PORT` – HTTP port (default 4000)
- `DATABASE_URL` – SQLite file path (defaults to `file:./dev.db`)
- `JWT_SECRET` – secret used to sign auth tokens (change this!)
- `ALLOWED_EMAIL_DOMAIN` – restricts registrations (defaults to `uzh.ch`)

## API Overview

### `POST /auth/register`
Creates a new student account. Body schema:

```json
{
  "fullName": "Jane Doe",
  "email": "jane.doe@uzh.ch",
  "password": "super-secret",
  "age": 21,
  "location": "Zürich",
  "fieldOfStudies": "Computer Science",
  "universityEmail": "jane.doe@uzh.ch",
  "interests": ["Networking", "Hiking"]
}
```

Rules:
- `email` (and `universityEmail` if provided) must end with `@uzh.ch` (configurable).
- Passwords require ≥ 8 characters and are stored with bcrypt.
- `interests` are stored as a comma-separated list for now.

Response:
```json
{
  "user": { "id": "...", "email": "...", "fullName": "...", ... },
  "token": "<JWT>"
}
```

### `POST /auth/login`
Body:
```json
{ "email": "jane.doe@uzh.ch", "password": "super-secret" }
```
Returns the same shape as registration. Non-matching credentials return `401`.

### `GET /health`
Simple readiness probe (`{"status":"ok"}`).

### `GET /profile`
Returns the authenticated user's profile. Requires a `Bearer` JWT in the `Authorization` header. Response includes profile metadata plus a resolved `profileImageUrl` if a picture has been uploaded.

### `PUT /profile`
Multipart endpoint (accepts `multipart/form-data`) that updates a user's profile. Fields: first/last name, primary email, university email, age, date of birth, gender, about, location, field of studies, interests (`comma`-separated or repeated inputs), and an optional `profileImage` upload (PNG or JPEG, ≤5 MB). The handler enforces:
- University email must match `ALLOWED_EMAIL_DOMAIN`
- Age must be ≥ 16
- Profile pictures must be PNG or JPEG

On success the updated user payload is returned. Profile images are stored locally in `uploads/profile-images` and served from `/uploads/...`.

## Project Structure

- `src/env.ts` – Zod-based ENV validation.
- `src/app.ts` – Express app factory + middleware wiring.
- `src/routes/auth.ts` – login & registration handlers.
- `src/routes/profile.ts` – authenticated profile read/update endpoints (with image uploads).
- `scripts/init-db.ts` – ensures the SQLite schema exists (used by `npm run db:init`).
- `prisma/schema.prisma` – Prisma data model (mirrors the SQLite schema).

## Inspecting the Database

Prisma Studio offers a quick UI to browse records (e.g., newly registered users):

```bash
npx prisma studio
```

This opens a local web app with the `User` table so you can confirm inserts and timestamps.

## Next Steps

1. Expand the schema (events, RSVPs) and move DDL into real Prisma migrations once binary downloads are allowed.
2. Integrate session storage (httpOnly cookies) or attach the JWT to Supabase/Auth provider later.
3. Add automated tests (Vitest) around the auth flows and password hashing.
4. Wire the `web` frontend forms to these endpoints (`/auth/register`, `/auth/login`).
