# MentorLagbe Server

The Express/MongoDB backend of **MentorLagbe**, a tuition and mentorship marketplace. It serves tuition, application, bookmark, admin, statistics, payment and subscription APIs for the Next.js client in `../mentorlagbe-client`. Both projects share the `mentor_lagbe` MongoDB database.

---

## 1. Project Name and Introduction

**MentorLagbe Server** — a production-oriented REST API built with Express 5 and the official MongoDB Node driver. Authentication is delegated to Better Auth; this service verifies the session token it issues.

## 2. Project Overview and Purpose

The backend owns all business data and authorization decisions: tuition CRUD and approval workflows, student applications, per-student bookmarks with plan limits, platform/admin statistics, and Stripe payment/subscription state. The frontend never reads business collections directly.

## 3. Main Features

- Tuition CRUD, public approved/active listings, featured posts, tutor-scoped management
- Student applications: apply, cancel, review, status counts
- Bookmarks in a dedicated collection with Free 5 / Pro unlimited enforcement
- Admin user management, tuition approvals, transactions and statistics
- Stripe payment recording and subscription grants via internal endpoints
- Better Auth session verification and role-based access control
- Shared-secret service-to-service endpoints for trusted Next.js server code

## 4. Roles and Capabilities

| Role | Backend capabilities |
| --- | --- |
| **Student** | Apply/cancel applications, save/remove up to 5 bookmarks (unlimited on Pro), view own stats and testimonials-free profile data |
| **Tutor** | Create/edit/close/delete own tuitions, review applicants, view own stats |
| **Admin** | List users, change roles (not own), list/approve/reject tuitions, view stats and transactions |

Public endpoints: tuition browsing/detail/featured, platform stats and the `GET /` health check. Internal endpoints require `x-internal-secret` and identity headers.

## 5. Technology Stack

Node.js ESM, Express 5, MongoDB Node driver 7, `cors`, `dotenv`. No Stripe SDK, validation library, test framework or ORM is installed here. Runtime secrets come from `.env`.

## 6. Architecture

`server.js` configures CORS/JSON parsing, mounts eight routers, creates the payments collection and bookmark index at startup, then listens on `PORT`. Routers declare `verifyToken`/`requireRole` middleware; controllers parse requests and return JSON; services hold database operations and business rules; utilities provide shared helpers. `src/config/database.js` exports collection handles from one `MongoClient`.

## 7. Folder Structure

```
mentorlagbe-server/
  server.js                 # app setup and startup
  index.js                  # compatibility entry point -> server.js
  src/
    config/{database,env}.js
    routes/{index,user,tuition,application,bookmark,stats,admin,payment,subscription}Routes.js
    controllers/{user,tuition,application,bookmark,stats,admin,payment,subscription}Controller.js
    middleware/{verifytoken,internalAuth}.js
    services/{bookmark,payment,stats,subscription,user}Service.js
    utils/{application,helpers,tuition}.js
  .env, package.json, README.md
```

## 8. Installation and Setup

```bash
cd mentorlagbe-server
npm install
# create .env with DB_USER, DB_PASSWORD, INTERNAL_API_SECRET (section 9)
npm start
```

There is no `dev` script; use `node server.js` or a watcher such as `nodemon index.js`. `npm test` is a placeholder that exits with an error.

## 9. Environment Variables

Placeholders only — never commit real credentials. `.env` is gitignored.

| Variable | Description |
| --- | --- |
| `DB_USER` | MongoDB Atlas username |
| `DB_PASSWORD` | MongoDB Atlas password |
| `INTERNAL_API_SECRET` | Shared secret required via `x-internal-secret` on internal endpoints (empty disables them) |
| `PORT` | Optional listen port; defaults to `5000` |

Atlas hostnames, replica set and `authSource` are hard-coded in `src/config/database.js`; there is no `MONGODB_URI` variable.

## 10. Running Locally

```bash
npm start                     # http://localhost:5000
curl http://localhost:5000/   # "Hello World!"
```

The process connects to MongoDB at module load and prepares `payments`/`bookmarks` before listening. Set `BACKEND_API_URL=http://localhost:5000` in the client and keep `INTERNAL_API_SECRET` identical in both projects.

## 11. API Overview

Auth convention: **Bearer** = `Authorization: Bearer <Better Auth session token>` (`verifyToken`); **internal** = `x-internal-secret`; identity headers `x-user-id`/`x-admin-id` are re-checked against the user collection.

| Method | Endpoint | Purpose | Auth |
| --- | --- | --- | --- |
| GET | `/users` | All users | Bearer + admin |
| GET | `/internal/users/:id` | Resolve user id | internal |
| GET | `/tuitions`, `/tuitions/count` | Tutor's own posts/count | Bearer + tutor |
| POST | `/tuitions` | Create post | Bearer + tutor |
| PUT/PATCH/DELETE | `/tuitions/:id`, `/tuitions/:id/status` | Edit/close/delete own post | Bearer + tutor |
| GET | `/all-tuitions`, `/all-tuitions/:id`, `/featured-tuitions` | Public approved/active listings | public |
| POST | `/tuitions/:id/apply` | Apply | Bearer + student |
| GET/DELETE | `/student-applications`, `/applications/:id` | List/cancel own applications | Bearer + student |
| GET | `/student-stats`, `/tutor-stats` | Dashboard counters | Bearer + role |
| GET | `/tutor-applicants` | Applicants on own posts | Bearer + tutor |
| PATCH | `/applications/:id/status` | Accept/reject pending application | Bearer + tutor |
| GET/POST/DELETE | `/bookmarks`, `/bookmarks/:tuitionId` | List/add/remove bookmarks | Bearer + student |
| GET | `/platform/stats` | Public counters | public |
| GET/PATCH | `/admin/users`, `/admin/users/:id/role` | User administration | Bearer + admin + internal identity |
| GET/PATCH | `/admin/tuitions`, `/admin/tuitions/:id/approval` | Tuition moderation | same |
| GET | `/admin/stats`, `/admin/transactions` | Statistics/revenue | same |
| POST | `/internal/payments` | Record Stripe payment | internal |
| GET | `/internal/subscription-state`, `/internal/subscription-by-session` | Subscription lookup | internal (+ `x-user-id` for state) |
| POST | `/internal/subscriptions/apply` | Grant/deactivate Pro | internal |

Bookmark request bodies: none — the tuition id is the path parameter and all identity data comes from the session/user document.

## 12. MongoDB Configuration

Database `mentor_lagbe`. Collections used by the application:

- `user` — Better Auth users, including `role`, `plan`, subscription fields
- `session` — Better Auth sessions used for Bearer verification
- `tuition` — posts with `approvalStatus` (`Pending`/`Approved`/`Rejected`) and `status` (`Active`/`Closed`)
- `application` — student applications
- `bookmarks` — `{_id, studentId, studentEmail, tuitionId, createdAt}`; compound unique index on `(studentId, tuitionId)`
- `payments`, `subscriptions` — Stripe bookkeeping and Pro state

`account`, `verification` and a legacy `testimonial` collection may also exist (Better Auth/old data) but are not used by current application code.

## 13. Authentication and Authorization

`src/middleware/verifytoken.js` is the single verification implementation: it reads `Bearer <token>`, finds the session in `session`, rejects missing/expired sessions, loads the user from `user`, and exposes a lowercased `role` and `plan` on `req.user`. `requireRole(...)` returns 403 for wrong roles. `internalAuth.js` checks `x-internal-secret` and, for identity endpoints, `x-user-id`/`x-admin-id` against the user document. Controllers scope every query by the verified id; no client-supplied `userId`, email or role is trusted.

## 14. Stripe Payment and Subscription

This service intentionally has **no Stripe SDK**. Stripe Checkout, webhook verification and plan verification live in the client. The backend receives verified results through internal endpoints: `POST /internal/payments` upserts a payment row keyed by `stripeSessionId`; `POST /internal/subscriptions/apply` with `mode: "grant"|"inactive"` writes `subscriptions` and mirrors Pro fields onto `user`; lookup endpoints return the stored state. Admin revenue queries aggregate verified, non-one-time Stripe subscription payments.

## 15. Image Uploads

There is **no upload endpoint or storage code in this repository**. The client validates images and uploads them to ImgBB through its own Route Handlers, then stores the returned URL in `tuition.bannerImage` or `user.image`. This API only persists those URLs.

## 16. Deployment

The repository has a Vercel project link (`.vercel/project.json`) and no `vercel.json`/Dockerfile. Deploy as a Node.js service with `npm start`, configure `DB_USER`, `DB_PASSWORD`, `INTERNAL_API_SECRET` and optional `PORT`, and ensure the hard-coded Atlas hosts are reachable. Deploy this backend before/with the client, then update `BACKEND_API_URL` in the client. CORS currently allows all origins; restrict it if required.

## 17. Project Links

- Local health check: `http://localhost:5000/`
- Vercel project identifiers are stored in `.vercel/project.json` and are not reproduced here.
- Frontend documentation: `../mentorlagbe-client/README.md`.
