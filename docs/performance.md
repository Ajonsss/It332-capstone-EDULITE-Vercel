# Login and dashboard performance

The public deployment was serving the frontend through Singapore but invoking
the API in `iad1` (Northern Virginia). The Atlas cluster is in AWS
`ap-southeast-1` (Singapore), as confirmed by the project owner. The backend
function is now configured for Vercel `sin1` in `vercel.json`.

Deploy the frontend and backend together: the dashboard now uses one authenticated
`GET /api/dashboard` request instead of nine independent requests. Existing read
endpoints remain available for forms and other tools. The combined endpoint uses
the same readers and grading calculations, with fresh account/session validation
and academic context per request. Responses are private and not cached.

Section, subject and assessment counts use batched, projected queries instead of
one count query per item. The academic query middleware still enforces account,
school-year and active-student scope. Authentication checks are not cached.

Cold read requests and sign-in no longer wait for academic index creation. The
same index setup still completes before academic writes, and local server startup
still prepares those indexes. Excel upload code is imported only on import routes.
Successful logins skip the redundant failure-counter reset only when the counter
and lock are already clear; password hashing, lockouts and token settings remain
the same. Dashboard JavaScript downloads while sign-in is in progress.

Validation includes tests for session revocation, year changes, account isolation,
failed-login lockouts, batched counts, single-request dashboard loading, existing
grading behavior and mutation refreshes. Public timing checks were anonymous;
authenticated production performance must be measured after redeployment.

After deploying, confirm the API function region is `sin1` in Vercel and compare
sign-in and dashboard request timings in browser Network tools for a cold visit
and subsequent visits. The initial dashboard data should require one request to
`/api/dashboard`; student insights load separately when a record is opened.

References: [Vercel function regions](https://vercel.com/docs/functions/configuring-functions/region),
[service configuration](https://vercel.com/docs/services/config-reference).
