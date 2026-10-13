# Vercel deployment

Import this repository as one Vercel project with its Root Directory set to the
repository root. The root `vercel.json` builds the Express `backend` and Vite
`frontend` independently.

## Public routes and bindings

- `/api` and `/api/*` enter the backend. All Express routes are mounted under
  `/api`, including login, student records, Gemini, and PDF downloads.
- Every other path enters the frontend. Its service-level rewrites send the
  React Router page paths to `index.html`. This supports
  refreshing React Router pages such as `/dashboard` and `/student-form/123`.
  Assets and Vite development modules retain their original paths. Add a
  corresponding frontend rewrite when adding a new client-side page route.
- There are no internal-only services and no bindings in this application.
  React runs in the browser and calls the same-origin public `/api` URL. A
  runtime binding cannot be used by a static Vite build or browser code.
- MongoDB Atlas and Google Gemini are external dependencies, not services in
  this repository. If a server-side service is added later, declare its binding
  on the caller, read the injected URL inside a function, and do not set that
  URL yourself in an environment file or the Vercel dashboard.

## Environment

Set `MONGODB_URI`, `JWT_SECRET`, and `GEMINI_API_KEY` in the Vercel project
environment for each deployment environment you use. `GEMINI_MODEL` is optional.
Use an Atlas database reachable by the deployment and a strong JWT secret.
No backend secrets belong in `VITE_*` variables. Vercel does not receive the
ignored local `backend/.env`; `backend/.env.example` lists the required names.

The backend exports its Express application for Vercel Functions. Database
connections and the existing startup indexes initialize on the first API
request and are reused within the function instance. `/api` is a liveness
response, not a database readiness check.

## Local verification

Install each service's dependencies with `npm ci` in `backend` and `frontend`.
Use a current Vercel CLI and run `vercel dev` from the repository root to test
both services together. `vercel dev -L` runs without Vercel Cloud authentication.
For local mode, keep the backend variables in the ignored `backend/.env` or
provide them in the shell before starting the CLI.

For separate local processes, run `npm run dev` in each directory. The backend
loads `backend/.env` when launched there, and the Vite development server
proxies `/api` to port 3000. If you change the standalone backend port, update
the Vite proxy target accordingly.

Check the login page and a refreshed `/dashboard`, then exercise `/api/login`,
`/api/students`, `/api/gemini/status`, and authenticated insight/PDF endpoints.
Unknown API routes should return JSON rather than the frontend HTML.

Run `npm test` in each service and `npm run build` in `frontend` for repository
checks. A deployed smoke test additionally requires the real project environment
and external credentials.

## Platform limits

The existing student import accepts files up to 5 MiB, and JSON parsing allows
25 MB. Vercel Functions have a 4.5 MB request/response body limit, so large
imports, backups, and PDFs may need direct object storage or streaming before
they can exceed that limit on Vercel. This configuration does not raise it.

References: [Services](https://vercel.com/docs/services),
[service bindings](https://vercel.com/docs/services/bindings),
[function limits](https://vercel.com/docs/functions/limitations).
