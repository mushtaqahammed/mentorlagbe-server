# MentorLagbe Server (Backend)

This repository is the **Express/MongoDB backend** of MentorLagbe. The Next.js frontend lives in the sibling repository at `../mentorlagbe-client` and has its own README. This document covers **backend concerns only**.

---

## 1. Backend Project Overview

The backend exposes a REST API for tuition posts, applications, users, bookmarks, platform/admin statistics, payments and subscription state. Authentication is not implemented here: it verifies Better Auth session tokens issued by the frontend by looking them up in the shared MongoDB `session` collection. A separate internal-secret channel (`x-internal-secret` plus identity headers) protects service-to-service endpoints used by the frontend's server code.

## 2. Server Technology Stack

| Technology | Version (`package.json`) | Purpose |
| --- | --- | --- |
| Node.js + Express | express ^5.3.0 | HTTP server, routers, middleware |
| MongoDB Node driver | ^7.9.0 | Collections, queries, aggregation pipelines, ObjectId handling |
| CORS | ^2.8.6 | `app.use(cors())` allows cross-origin requests |
| dotenv | ^18.0.10 | Loads `.env` in `src/config/env.js` |
| ESM modules | `"type": "module"` | All source files use `import`/`export` |

There is **no** Stripe SDK, password library, validation library (e.g. zod), helmet, or rate-limiting dependency in this package. Stripe Checkout/webhook handling lives in the client repository; this server only records payment/subscription state through internal endpoints.

## 3. Installation and Setup

```bash
cd mentorlagbe-server
npm install
# create .env with DB_USER, DB_PASSWORD, INTERNAL_API_SECRET (see section 18)
npm start           # node server.js, default http://localhost:5000
```

There is no `dev` script. `index.js` is a compatibility entry point that simply imports `./server.js`. `npm test` is a placeholder that exits with an error.

## 4. Server Folder Structure

```
mentorlagbe-server/
  server.js                       # app setup, route mounting, startup
  index.js                        # compatibility entry point -> server.js
  src/
    config/env.js                 # dotenv, PORT, INTERNAL_API_SECRET
    config/database.js            # MongoClient, database and collection exports
    routes/
      index.js                    # re-exports all routers
      userRoutes.js, tuitionRoutes.js, applicationRoutes.js
      statsRoutes.js, adminRoutes.js
      bookmarkRoutes.js, paymentRoutes.js, subscriptionRoutes.js
    controllers/
      userController.js, tuitionController.js, applicationController.js
      statsController.js, adminController.js
      bookmarkController.js, paymentController.js, subscriptionController.js
    middleware/
      verifytoken.js              # single Bearer-session verification implementation
      auth.js                     # backwards-compatible re-exports + getTutorFromRequest
      internalAuth.js             # x-internal-secret + identity header helpers
    services/
      paymentService.js           # payment records, filters, revenue aggregation
      subscriptionService.js      # plan catalog and Pro grant/inactive state
      statsService.js            # active-student count for public platform stats
      userService.js              # findUserById
      bookmarkService.js         # bookmarks collection index, CRUD, plan lookup, joins
    utils/
      helpers.js                  # ObjectId/date/string/number/money helpers
      tuition.js                  # tuition serializers, filters, admin filters
      application.js              # application serializers and status counts
```

## 5. Express Server Configuration

`server.js`:

- `const app = express()`; `app.use(cors())` (permissive CORS - all origins); `app.use(express.json())`.
- `GET /` returns the plain text `Hello World!` health/check response.
- Mounts routers in this order: users, tuitions, applications, bookmarks, stats, admin, payments, subscriptions.
- Awaits `ensurePaymentsCollection()` before listening (creates the `payments` collection and a partial unique index on `stripeSessionId`).
- `app.listen(PORT, ...)` logs `Example app listening on port ${PORT}`; exports `app` as default.

`src/config/env.js` exports `PORT` (default `5000`) and `INTERNAL_API_SECRET` (default empty string).

## 6. API Routes

Authentication notation: **Bearer** = `Authorization: Bearer <Better Auth session token>` checked by `verifyToken`; **role** = `requireRole(...)`; **internal** = header `x-internal-secret` matching `INTERNAL_API_SECRET`; **x-user-id / x-admin-id** = identity header re-checked against the `user` collection by `requireInternalIdentity`.

### User endpoints

| Method | Endpoint | Purpose | Auth | Request body |
| --- | --- | --- | --- | --- |
| GET | `/users` | Return all user documents | Bearer + role `admin` | - |
| GET | `/internal/users/:id` | Resolve a user id to `{id, role, name, email}` or `null` | internal | - |

### Tuition endpoints

| Method | Endpoint | Purpose | Auth | Request body |
| --- | --- | --- | --- | --- |
| GET | `/tuitions` | Current tutor's posts (newest first) | Bearer + role `tutor` | - (`?tutorId` must match token user or 403) |
| GET | `/tuitions/count` | Count of current tutor's posts | Bearer + role `tutor` | - |
| POST | `/tuitions` | Create a tuition; server sets tutor identity, `approvalStatus: "Pending"`, `status: "Active"`, timestamps | Bearer + role `tutor` | Tuition fields: `title`, `subject`, `classLevel`, `mode`, `location`, `monthlyFee`, `daysPerWeek`, `description`, `bannerImage` |
| PUT | `/tuitions/:id` | Edit whitelisted fields (`editableFields` in `src/utils/tuition.js`) on own post | Bearer + role `tutor` | Any subset of editable fields |
| PATCH | `/tuitions/:id/status` | Set lifecycle status | Bearer + role `tutor` | `{ "status": "Active" | "Closed" }` |
| DELETE | `/tuitions/:id` | Delete own post | Bearer + role `tutor` | - |
| GET | `/all-tuitions` | Public list of approved+active posts with tutor names | public | - |
| GET | `/all-tuitions/:id` | Public single approved+active post with tutor name | public | - |
| GET | `/featured-tuitions` | Up to 6 newest approved+active posts, serialized for cards | public | - |

### Application endpoints

| Method | Endpoint | Purpose | Auth | Request body |
| --- | --- | --- | --- | --- |
| POST | `/tuitions/:id/apply` | Apply to an approved+active tuition; duplicate applications return 409 | Bearer + role `student` | `{ "phone"?, "preferredSchedule"?, "note"? }` (server fills identity fields) |
| GET | `/student-applications` | Own applications with joined tuition/tutor details and status counts | Bearer + role `student` | - (`?tuitionId` optional filter) |
| DELETE | `/applications/:id` | Cancel own **pending** application (deletes document) | Bearer + role `student` | - |
| GET | `/student-stats` | `{totalApplied, accepted, pending, plan}` | Bearer + role `student` | - |
| GET | `/tutor-applicants` | Applicants on own tuitions with status counts | Bearer + role `tutor` | - |
| PATCH | `/applications/:id/status` | Accept/reject a pending application on own tuition | Bearer + role `tutor` | `{ "status": "accepted" | "rejected" }` |
| GET | `/tutor-stats` | `{totalTuitions, activeApprovedTuitions, totalApplicants, plan}` | Bearer + role `tutor` | - |

### Bookmark endpoints (student only)

Bookmarks are rows in the dedicated `bookmarks` collection. All three routes use `verifyToken` + `requireRole("student")`, and identity/plan come from the verified session and `user` document - never from the request.

| Method | Endpoint | Purpose | Auth | Request body |
| --- | --- | --- | --- | --- |
| POST | `/bookmarks/:tuitionId` | Insert `{studentId, studentEmail, tuitionId, createdAt}`; requires an approved+active tuition; 409 duplicates (compound unique index), 403 free limit, Pro unlimited | Bearer + role `student` | - |
| GET | `/bookmarks` | Newest-first bookmarks joined to the original `tuition` document (title, subject, classLevel, mode, location, monthlyFee, daysPerWeek, description, bannerImage, tutorId, tutorName, tutorEmail, approvalStatus, status) plus `count`, `plan`, `limit`; unavailable/missing references keep `available: false` | Bearer + role `student` | - |
| DELETE | `/bookmarks/:tuitionId` | Delete the caller's row; repeated deletes succeed harmlessly | Bearer + role `student` | - |

### Admin endpoints

| Method | Endpoint | Purpose | Auth | Request body |
| --- | --- | --- | --- | --- |
| GET | `/admin/users` | Paginated user list (`?search`, `?role`, `?page`, `?limit`) | Bearer + role `admin` **and** internal + `x-admin-id` | - |
| PATCH | `/admin/users/:id/role` | Change a user's role to `Student`/`Tutor`/`Admin` (self-change forbidden) | same | `{ "role": "student" | "tutor" | "admin" }` |
| GET | `/admin/tuitions` | Paginated tuition list (`?search`, `?subject`, `?status`, `?sort`, `?page`, `?limit`) | same | - |
| PATCH | `/admin/tuitions/:id/approval` | Approve/reject a tuition | same | `{ "status": "approved" | "rejected" }` |
| GET | `/admin/stats` | User/tutor counts, pending/approved tuition counts, Stripe revenue | same | - |
| GET | `/admin/transactions` | Paginated verified Stripe payments (`?search`, `?role`, `?plan`, `?page`, `?limit`) with summary | same | - |

### Stats, payments and subscription endpoints

| Method | Endpoint | Purpose | Auth | Request body |
| --- | --- | --- | --- | --- |
| GET | `/platform/stats` | Public counters: verified tutors, active students, approved tuitions, accepted applications | public | - |
| POST | `/internal/payments` | Upsert a payment record keyed by `stripeSessionId` | internal | `{userId, userEmail, userRole, planId, planName, amountMinor, currency, paymentStatus, stripeSessionId, stripeSubscriptionId, stripeCustomerId, currentPeriodStart, currentPeriodEnd}` |
| GET | `/internal/subscription-by-session` | Look up subscription state by `?stripeSessionId=` | internal | - |
| GET | `/internal/subscription-state` | Current subscription state for `x-user-id` | internal + `x-user-id` | - |
| POST | `/internal/subscriptions/apply` | Grant or deactivate Pro state for `userId` | internal (optional `x-user-id` must match `userId`) | `{mode: "grant"|"inactive", userId, planId?, status?, stripeSessionId?, stripeSubscriptionId?, stripeCustomerId?, currentPeriodStart?, currentPeriodEnd?}` |

Error responses: `401 { error: "Unauthorized" }`, `403 { error: "Forbidden" }`, `404`/`409`/`400` with `{error: "..."}`, and controller failures `500 { error: "Server error" }`.

## 7. Controllers, Services, Middleware, and Utilities

**Controllers** (`src/controllers/`): request parsing, authorization-scoped queries and JSON responses. `tuitionController.js` (CRUD, public listings, serializer usage), `applicationController.js` (apply, review, stats, scoped lists), `adminController.js` (users, tuitions, stats, transactions), `paymentController.js` (record payment), `subscriptionController.js` (state lookup/apply), `statsController.js`, `userController.js`.

**Services** (`src/services/`): `paymentService.js` (collection setup, idempotent upsert, verification filters, search/plan/role conditions, transaction serialization and revenue aggregations; also reads a legacy `payment` collection for stats), `subscriptionService.js` (`PRO_PLANS`: `pro-tutor` $15, `pro-student` $10; `applySubscriptionState` with `grant`/`inactive` modes writing both `subscriptions` and `user`), `statsService.js` (active-student count from live sessions), `userService.js` (`findUserById`).

**Middleware**: `verifytoken.js` is the single Bearer verification implementation (`getUserFromRequest`, `verifyToken`, `requireRole`, `unauthorized`); `auth.js` re-exports it for older controllers and adds `getTutorFromRequest`; `internalAuth.js` provides `hasInternalSecret`, `requireInternalService`, `requireInternalIdentity`.

**Utilities**: `helpers.js` (`toObjectId`, `cleanText`, `parseInteger`, `asString`, `escapeRegExp`, date conversion, `combine`, `formatMoney`), `tuition.js` (`activeTuitionFilter` = `approvalStatus: /^approved$/i` with active-or-missing `status`; `editableFields`; serializers and admin filters), `application.js` (status normalization/counts, applicant/student serializers).

## 8. MongoDB Connection and Database Structure

`src/config/database.js` builds a `MongoClient` from `DB_USER` and `DB_PASSWORD` and a **hard-coded MongoDB Atlas replica-set host list/connection options** (`ssl=true`, `replicaSet=...`, `authSource=admin`). It connects at module load via top-level `await connectToMongoDB()`, then exports `database = client.db("mentor_lagbe")` and collection handles.

Collections exported and used:

- `user` - Better Auth users (also written by subscription service)
- `session` - Better Auth sessions (read for token verification and active-student stats)
- `tuition` - tuition posts
- `application` - student applications
- `payments` - Stripe subscription payment records
- `subscriptions` - stored Pro subscription state

Indexes: `payments.stripeSessionId` partial unique index created at startup (`ensurePaymentsCollection`); `bookmarks.{studentId, tuitionId}` compound unique index created at startup (`ensureBookmarksIndex`).

## 9. Business Collections (Verified Against Code)

The task description mentions plural `users`, `tuitions`, `applications`, `payments`. The actual code uses:

| Concept | Actual collection name | Notes |
| --- | --- | --- |
| users | `user` (singular) | Better Auth `user` collection; shared with frontend auth |
| tuitions | `tuition` (singular) | Seeded by the client's seed script into `mentor_lagbe.tuition` |
| applications | `application` (singular) | Created by `applyToTuition` |
| payments | `payments` (plural) | Created at startup; a legacy `payment` collection is tolerated for stats only |

Also present: `session`, `subscriptions`, and the dedicated `bookmarks` collection.

## 10. Database Relationships and Important Fields

- `user`: `_id` (ObjectId, used as string id everywhere), `name`, `email`, `emailVerified`, `image`, `phone`, `role` (`"Student" | "Tutor" | "Admin"`; lowercased during token verification), `createdAt`, plus subscription fields `plan`, `subscriptionStatus`, `proPlanId`, `stripeSubscriptionId`, `stripeCustomerId`, `proActivatedAt`, `subscriptionStartDate`, `subscriptionEndDate`.
- `session`: `token` (looked up from the Bearer header), `userId` (string/ObjectId), `expiresAt`.
- `tuition`: `_id`, `tutorId` (string user id), `tutorName`, `tutorEmail`, `title`, `subject`, `classLevel`, `mode`, `location`, `monthlyFee`, `daysPerWeek`, `description`, `bannerImage`, `approvalStatus` (`Pending`/`Approved`/`Rejected`), `status` (`Active`/`Closed`), `createdAt`, `updatedAt`.
- `application`: `_id`, `tuitionId` (string), `studentId`, `studentName`, `studentEmail`, `phone`, `preferredSchedule`, `note`, `tutorId`, `status` (`pending`/`accepted`/`rejected`, legacy capitalized values normalized), `reviewedBy`, `createdAt`, `updatedAt`. Unique per `(tuitionId, studentId)` (enforced in the apply handler, not a DB index).
- `bookmarks`: `_id`, `studentId` (string, from verified session), `studentEmail` (from verified user), `tuitionId` (string), `createdAt`. Compound unique index on `(studentId, tuitionId)` prevents duplicates.
- `payments`: `_id`, `userId`, `userEmail`, `userRole`, `planId`, `planName`, `amount`, `amountMinor`, `amountInMinorUnits`, `currency`, `status`/`paymentStatus`, `provider: "stripe"`, `mode`, `type`, `stripeSessionId`, `stripeSubscriptionId`, `stripeCustomerId`, `currentPeriodStart`, `currentPeriodEnd`, `paidAt`, `createdAt`.
- `subscriptions`: `userId`, `planId`, `isPro`, `status`, `stripeSessionId`, `stripeSubscriptionId`, `stripeCustomerId`, `currentPeriodStart`, `currentPeriodEnd`, `createdAt`, `activatedAt`, `updatedAt`.

Ownership checks always use the verified user id (`req.user.id` / `x-user-id`), never client-supplied `tutorId` or `applicantId`. Tutor names are joined from `user` by `tutorId` for public/admin listings.

## 11. Better Auth Session/Token Verification and Authorization

`getUserFromRequest(req)` reads `Authorization: Bearer <token>`, finds the document in `sessionsCollection` by `token`, rejects missing/expired sessions, loads the user by `_id`, and returns `{id, name, email, phone, role (lowercased), plan (default "free")}`. `verifyToken` sets `req.user` or sends 401; `requireRole(...roles)` checks the lowercased role and sends 403 on mismatch. Controllers scope queries by `req.user.id`.

Separately, `internalAuth.js` protects service endpoints: `requireInternalService` checks `x-internal-secret`; `requireInternalIdentity(req, res, headerName, allowedRoles)` additionally reads `x-user-id` or `x-admin-id`, loads the user from `user` and optionally checks roles (403 otherwise). Admin controllers use this identity path **in addition** to the Bearer/role middleware declared on their routes.

## 12. Role-Based Access Control

- **Student**: apply to tuitions, list/cancel own applications, view own stats, save up to 5 tuitions (unlimited on Pro) via bookmark endpoints.
- **Tutor**: create/edit/status/delete own tuitions, view own count/stats, review applicants on own tuitions.
- **Admin**: list users, change roles (not own), list/approve/reject tuitions, view platform stats and transactions.
- Public (no auth): tuition listings/detail/featured, platform stats, root health route.
- Internal (shared secret): user lookup, payment recording, subscription state/apply/lookup by Stripe session.

Role names in the database are capitalized; route guards and `getUserFromRequest` compare lowercase forms. The sign-up role is sanitized by the frontend's Better Auth hook, so this server assumes the stored role is already valid.

## 13. Tuition Creation, Approval, Rejection, and Application Workflows

1. Tutor creates a post with `POST /tuitions`; the server overwrites tutor identity fields and sets `approvalStatus: "Pending"`, `status: "Active"`.
2. Public endpoints only return posts where `approvalStatus` matches `/^approved$/i` and `status` is `Active` (or missing/null for legacy documents), via `activeTuitionFilter` in `src/utils/tuition.js`.
3. Admin reviews through `GET /admin/tuitions` (filters/pagination) and `PATCH /admin/tuitions/:id/approval` with `status: "approved"|"rejected"`; `serializeAdminTuition` normalizes status and joins tutor identity.
4. Student applies with `POST /tuitions/:id/apply`; duplicate applications return 409. `phone`, `preferredSchedule`, `note` are trimmed/capped (`cleanText`).
5. Tutor lists applicants with `GET /tutor-applicants` (joined tuition titles + counts) and calls `PATCH /applications/:id/status`. Only `pending` applications can be reviewed; ownership of both tuition and stored `tutorId` is verified.
6. Student cancels a pending application with `DELETE /applications/:id` (document is deleted).

## 14. Bookmark Functionality

Bookmarks are rows in the dedicated `bookmarks` collection: `{_id, studentId, studentEmail, tuitionId, createdAt}`. `ensureBookmarksIndex()` creates a compound unique index on `(studentId, tuitionId)` at startup, so duplicates are impossible even under concurrent requests; the controller also checks for an existing row before insert and maps duplicate-key errors to 409. Only approved+active tuitions can be added (`activeTuitionFilter`). The plan is read from `user.plan` via `readStudentAccount()`: free students may hold 5 rows, Pro students unlimited. The controller counts rows before insert and removes the exact inserted row if a race would exceed the free cap. `GET /bookmarks` returns newest-first rows joined to the original `tuition` document (all posted fields, with `approvalStatus`/`status` returned exactly as stored, e.g. `"Approved"`/`"Active"`); deleted, rejected or closed tuitions are kept with `available: false` and can still be removed. Identity, email, role and plan always come from the verified session/user document - never from the request body or headers.

## 15. Stripe Checkout, Payment Verification, and Plan Upgrade (Server Role)

This server **does not** depend on the Stripe SDK and does not create Checkout Sessions or verify webhooks. Those operations are performed by the client repository (`app/api/checkout-sessions`, `app/api/webhooks/stripe`, `lib/subscription.ts`). The server's responsibilities are:

- `POST /internal/payments` -> `recordSubscriptionPayment(payload)`: idempotent `$setOnInsert` upsert keyed by `stripeSessionId`; amount falls back to the catalog plan price; ignores duplicate-key (11000) errors from concurrent confirm/webhook calls.
- `GET /internal/subscription-by-session?stripeSessionId=...`: finds the newest `subscriptions` record for that session.
- `POST /internal/subscriptions/apply` with `mode: "grant"`: writes `isPro: true`, plan/status/Stripe ids/period dates to `subscriptions` and mirrors `plan: "pro"`, `proPlanId`, subscription dates onto `user`; with `mode: "inactive"`: sets `isPro: false`, `plan: "free"` and unsets Pro fields.
- `GET /internal/subscription-state`: returns `serializeSubscriptionState` (Pro only when `isPro === true` and status is `active` or `trialing`).
- Admin stats/transactions aggregate only verified, non-one-time Stripe subscription payments (`verifiedPaymentConditions`), normalize legacy amount formats, and compute revenue.

## 16. Image Upload Handling

**Not handled by this server.** There is no upload route, multipart middleware, or image storage code here. The frontend uploads to ImgBB through its own route handlers and stores the returned URL in `tuition.bannerImage` or the `user.image` field. The server merely stores/serializes those URLs.

## 17. Security, Validation, Error Handling, and CORS

- CORS is fully open (`app.use(cors())` with default options); no origin allowlist configured.
- JSON bodies via `express.json()`; no schema validation library - handlers validate individual fields (`status` enums, integer ranges, message length, ObjectId validity, `cleanText` length caps, `parseInteger` clamps, regex escaping for search).
- `createTuition` spreads `req.body` into the document (whitelisting happens on update only); identity/approval/status fields are overwritten after the spread, so those cannot be forged by that route.
- Token verification rejects missing/invalid/expired sessions; role and internal-secret guards return 401/403; ownership checks use verified identity.
- Errors are logged with `console.error` and returned as generic `500 {error: "Server error"}`; expected conflicts use 400/404/409 with specific messages.
- No helmet, rate limiting, CSRF protection, or request-size limit is configured. Startup and DB failures are logged.

## 18. Server Environment Variables (names and descriptions only)

| Variable | Description |
| --- | --- |
| `DB_USER` | MongoDB Atlas username used in `src/config/database.js` |
| `DB_PASSWORD` | MongoDB Atlas password used in `src/config/database.js` |
| `INTERNAL_API_SECRET` | Shared secret required via `x-internal-secret` on internal endpoints (defaults to empty string) |
| `PORT` | HTTP listen port (optional; defaults to `5000`) |

All other connection details (host list, replica set, `ssl`, `authSource`) are hard-coded in `src/config/database.js`. Never commit real credentials; `.gitignore` excludes `.env`.

## 19. Required npm Packages and Their Purposes

`express` (HTTP framework), `mongodb` (driver), `cors` (cross-origin middleware), `dotenv` (`.env` loading). Dev/test scripts: none configured (`npm test` is a placeholder). No Stripe, auth, or validation packages are installed here.

## 20. Running the Server Locally

```bash
npm install
# create .env with DB_USER, DB_PASSWORD, INTERNAL_API_SECRET (match client's INTERNAL_API_SECRET)
npm start
# GET http://localhost:5000/ -> "Hello World!"
```

The process connects to MongoDB at module load and waits for `ensurePaymentsCollection()` before listening. Set `BACKEND_API_URL=http://localhost:5000` in the client so its server-side helpers target this instance.

## 21. Backend Deployment

The repository has a Vercel project link (`.vercel/project.json`), no `vercel.json`, and no Dockerfile/Procfile. Deployment notes:

1. Deploy as a Node.js service (Vercel or any Node host). The entry point is `server.js` (`npm start`), and the process listens on `PORT`.
2. Configure `DB_USER`, `DB_PASSWORD`, `INTERNAL_API_SECRET` (identical to the client's value) and optionally `PORT` in the hosting environment.
3. The hard-coded Atlas hosts in `src/config/database.js` must be reachable from the deployment; changing clusters requires a source edit.
4. Update `BACKEND_API_URL` in the client to the deployed URL; keep `INTERNAL_API_SECRET` in sync on both sides. Stripe webhooks still point at the client origin.
5. `app.use(cors())` currently allows all origins; restrict it before production if required.

## 22. Current Backend Implementation Status and Known Issues

**Implemented**: Express app with 7 routers; Bearer session verification and role guards; internal-secret identity guards; tuition CRUD + public listings + featured posts; application apply/review/cancel/stats; bookmark add/list/remove with free-plan cap; admin users/tuitions/stats/transactions; platform stats; payment record and subscription grant/inactive state; startup collection/index setup; aggregation-based revenue and transaction reporting.

**Known gaps / issues**:

1. `DB_USER`/`DB_PASSWORD` are combined with **hard-coded Atlas hosts** in `src/config/database.js`; no `MONGODB_URI` variable is supported.
2. No `npm run dev`; no tests; no `middleware` for validation, logging or rate limiting. CORS accepts any origin.
3. `GET /users` returns raw user documents to admins (no projection/serialization, unlike admin endpoints).
4. Admin routes apply **both** Bearer/role middleware and internal-secret/identity-header checks; callers must send both sets of headers.
5. Bookmark duplicates are prevented by the compound unique index; the free-limit pre-check is followed by an insert and a post-insert reconciliation, so a racing request that would exceed 5 rows is rejected and its row removed.
6. No image upload endpoint or Stripe SDK in this repository (sections 15-16).
7. `createTuition` accepts arbitrary body fields (identity/approval/status are overwritten, but unrecognized fields are still stored).
8. The `payments` collection is created at startup but there is no `payment` migration; `getPaymentsCollectionForStats()` only tolerates a legacy `payment` collection when computing stats.
9. Role guards compare lowercase values while the database stores capitalized roles; a manually inserted unexpected role will be denied rather than normalized.
10. Internal identity headers (`x-user-id`, `x-admin-id`) are trusted only after the internal secret check; if `INTERNAL_API_SECRET` is left at its empty default, `hasInternalSecret` always returns false and all internal endpoints are disabled.
11. `getUserFromRequest` uses `session.expiresAt` from the shared Better Auth collection; session cleanup is the frontend's responsibility.

This README was written from the source in this repository. Keep it separate from the client README and update both when the shared API contract changes.
