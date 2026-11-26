# Multi-tenant SaaS backend with NestJS

This is the finished application of the tutorial [Build a multi-tenant SaaS backend in Node.js](https://docs.nestjs.com/tutorials/multi-tenant-saas) in the NestJS documentation. The tutorial builds it step by step and explains every decision; this repository is the result, ready to clone.

## What it does

A multi-tenant API on PostgreSQL through Drizzle, with JWT sign-in from `@nestjs/authentication` and Zod validation:

- Users create organizations and join them, with the roles owner, admin and member.
- Every organization route takes the organization from the path (`/orgs/:orgId/...`). A guard checks the caller's membership and role once per request, and answers 404 to anyone who isn't a member.
- Every query of a tenant's data has the organization's id in its `WHERE` clause, so an id from another tenant finds nothing.
- Admins invite people by email with `@nestjs/mail`. The link works once, and only for the address it was sent to. In development, the mail (link included) is written to the log instead of being sent.
- Role changes and removals take the organization's row lock, so an organization never loses its last owner, even when two owners step down at the same moment.
- Changes to members and invitations, and deleted projects, are written to an audit log in the same transaction as the change.
- The projects' service is a durable provider: one instance per organization, built with the organization's id.

## Run it

You need Node.js 22 or later, and Docker for PostgreSQL.

```bash
git clone https://github.com/nestjs/example-multi-tenant-saas.git
cd example-multi-tenant-saas
npm install
cp .env.example .env              # then set JWT_SECRET: openssl rand -base64 32
docker compose up -d
npm run db:migrate
npm run start
```

The API listens on http://localhost:3000, with Swagger UI at http://localhost:3000/docs. The tutorial's [Try it](https://docs.nestjs.com/tutorials/multi-tenant-saas#try-it) section walks through every endpoint with `curl`.

## Endpoints

Every route needs a bearer token, except sign-up, sign-in, the token routes and the health checks.

| Endpoint | Section of the tutorial |
| --- | --- |
| `POST /auth/sign-up`, `POST /auth/token`, `POST /auth/token/refresh`, `POST /auth/token/revoke`, `GET /me`, `GET /health/live`, `GET /health/ready` | [Start from the JWT API](https://docs.nestjs.com/tutorials/multi-tenant-saas#start-from-the-jwt-api) |
| `POST /orgs`, `GET /orgs`, `GET /orgs/:orgId/audit-events` (admin) | [Create organizations](https://docs.nestjs.com/tutorials/multi-tenant-saas#create-organizations) |
| `GET /orgs/:orgId/projects`, `POST /orgs/:orgId/projects`, `GET /orgs/:orgId/projects/:projectId`, `DELETE /orgs/:orgId/projects/:projectId` (admin) | [Scope every query to the organization](https://docs.nestjs.com/tutorials/multi-tenant-saas#scope-every-query-to-the-organization), [Give each organization its own DI sub-tree](https://docs.nestjs.com/tutorials/multi-tenant-saas#give-each-organization-its-own-di-sub-tree) |
| `GET /orgs/:orgId/members`, `PATCH /orgs/:orgId/members/:userId` (admin), `DELETE /orgs/:orgId/members/:userId` (admin) | [Never lose the last owner](https://docs.nestjs.com/tutorials/multi-tenant-saas#never-lose-the-last-owner) |
| `POST /orgs/:orgId/invitations` (admin), `POST /invitations/accept` | [Invite members by email](https://docs.nestjs.com/tutorials/multi-tenant-saas#invite-members-by-email) |
| `GET /docs` | Swagger UI |

## Layout

| Path | What it holds |
| --- | --- |
| `src/main.ts` | bootstrap on the Node adapter, security headers, CORS, JSON logs in production, Swagger UI |
| `src/app.module.ts` | NestJS Observe, config, database, authentication, mail, throttler, validation pipe, the context id strategy |
| `src/config.ts` | the environment schema |
| `src/database/schema.ts` | Drizzle tables: users, organizations, memberships, invitations, projects, audit_events, refresh_tokens |
| `src/auth/`, `src/users/`, `src/health/` | sign-in and health checks, from the JWT tutorial |
| `src/organizations/` | organizations, members, the `OrganizationGuard` and the `@MinRole()` and `@CurrentMembership()` decorators |
| `src/projects/` | the tenant's projects, through a durable `ProjectsService` |
| `src/tenancy/` | the context id strategy: one DI sub-tree per organization |
| `src/invitations/` | invitations and their mail |
| `src/audit/` | the audit log helper |
| `test/` | e2e tests on PostgreSQL: the tenant boundary, the durable providers, invitations, the last-owner races, the refresh-token store |
| `drizzle/` | migrations |

## Tests

```bash
TEST_DATABASE_URL=postgres://postgres:saas@localhost:5432/saas_test npm run test:e2e
```

`docker compose` creates the `saas_test` database. The tests truncate its tables, so never point them at your development database. Without `TEST_DATABASE_URL`, they are skipped.

## Stack

[NestJS](https://nestjs.com) 12 on the Node adapter, [Zod](https://zod.dev) validation, [`@nestjs/authentication`](https://docs.nestjs.com/security/authentication), [Drizzle](https://docs.nestjs.com/data/drizzle) and PostgreSQL, [`@nestjs/mail`](https://docs.nestjs.com/application/mail), [durable providers](https://docs.nestjs.com/fundamentals/provider-scopes#durable-providers), [`@nestjs/throttler`](https://docs.nestjs.com/security/rate-limiting), [`@nestjs/swagger`](https://docs.nestjs.com/openapi/introduction), [`@nestjs/terminus`](https://docs.nestjs.com/reliability/terminus), [NestJS Observe](https://docs.nestjs.com/observability/overview), and Vitest.

## Production

Read the tutorial's production checklist first: https://docs.nestjs.com/tutorials/multi-tenant-saas#production-checklist. In particular, replace `LogMailTransport` with a real transport: it writes the invitation links into the logs.

The app is wired for [NestJS Observe](https://docs.nestjs.com/observability/overview), which records every request with a trace of its spans, SQL statements included, and its errors and logs. It sends nothing until it has a key pair: `npx @nestjs/observe link` writes `OBSERVE_APP_KEY` and `OBSERVE_APP_SECRET` into `.env`. In production, set them in the platform's environment, since `start:prod` doesn't load `.env`.

## License

MIT
