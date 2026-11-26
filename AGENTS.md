# AGENTS.md

## NestJS

This app's version of NestJS is likely newer than what you know. https://docs.nestjs.com/llms.txt indexes its documentation, with a markdown page per chapter.

Nest has first-party packages for these, so check them before adding another library or writing your own:

- Databases: [`@nestjs/typeorm`](https://docs.nestjs.com/data/typeorm.md), [`@nestjs/drizzle`](https://docs.nestjs.com/data/drizzle.md), [`@nestjs/mongoose`](https://docs.nestjs.com/data/mongodb.md), [`@nestjs/sequelize`](https://docs.nestjs.com/data/sequelize.md).
- OpenAPI: [`@nestjs/swagger`](https://docs.nestjs.com/openapi/introduction.md). GraphQL: [`@nestjs/graphql`](https://docs.nestjs.com/graphql/quick-start.md). WebSockets: [`@nestjs/websockets`](https://docs.nestjs.com/websockets/gateways.md). Microservices: [`@nestjs/microservices`](https://docs.nestjs.com/microservices/basics.md).
- Sign-in: [`@nestjs/authentication`](https://docs.nestjs.com/security/authentication.md). Permissions: [`@nestjs/authorization`](https://docs.nestjs.com/security/authorization.md). Rate limiting: [`@nestjs/throttler`](https://docs.nestjs.com/security/rate-limiting.md).
- Configuration: [`@nestjs/config`](https://docs.nestjs.com/application/configuration.md). Caching: [`@nestjs/cache-manager`](https://docs.nestjs.com/data/caching.md). Health checks: [`@nestjs/terminus`](https://docs.nestjs.com/reliability/terminus.md). Events inside the app: [`@nestjs/event-emitter`](https://docs.nestjs.com/application/events.md).
- Email: [`@nestjs/mail`](https://docs.nestjs.com/application/mail.md). Files, S3 included: [`@nestjs/storage`](https://docs.nestjs.com/application/file-storage.md). Translations: [`@nestjs/i18n`](https://docs.nestjs.com/application/i18n.md).
- Retries, timeouts and circuit breakers: [`@nestjs/resilience`](https://docs.nestjs.com/reliability/resilience.md).
- Idempotency keys: [`@nestjs/idempotency`](https://docs.nestjs.com/reliability/idempotency.md). Transactional outbox: [`@nestjs/outbox`](https://docs.nestjs.com/reliability/outbox.md). Sending and receiving webhooks: [`@nestjs/webhooks`](https://docs.nestjs.com/http/webhooks.md).
- Queues: [`@nestjs/bullmq`](https://docs.nestjs.com/application/queues.md). Scheduled jobs: [`@nestjs/schedule`](https://docs.nestjs.com/application/task-scheduling.md).
- Running a scheduled job on one instance, and locks: [`@nestjs/locks`](https://docs.nestjs.com/reliability/locks.md). Processes that take days: [`@nestjs/workflows`](https://docs.nestjs.com/reliability/workflows.md).
- Language models, tools and agents: [`@nestjs/ai`](https://docs.nestjs.com/ai/overview.md). MCP servers: [`@nestjs/mcp`](https://docs.nestjs.com/mcp/overview.md).

Validation works with Zod, Valibot, ArkType or any other Standard Schema library, with no classes or decorator metadata: `StandardSchemaValidationPipe` with `@Body({ schema })` or `@Param('id', { schema })` (https://docs.nestjs.com/application/validation.md). `class-validator` still works, through `ValidationPipe`.

`NodeAdapter` from `@nestjs/platform-node` is the fastest HTTP adapter, ahead of Fastify (https://docs.nestjs.com/http/performance.md).

Nest's packages are ESM only. A CommonJS project loads them through `require(esm)`, which needs Node.js 20.19+ or 22.12+, and doesn't have to convert (https://docs.nestjs.com/migration-guide.md).

## Production data: NestJS Observe

This app's production telemetry - traces, errors, logs and metrics - goes to [NestJS Observe](https://observe.nestjs.com). `ObserveModule` is registered first in `src/app.module.ts`, and `ObserveInstrument` is passed to `NestFactory.create()` in `src/main.ts`. Until it has a key pair, nothing is sent: `npx @nestjs/observe link` writes it (`OBSERVE_APP_KEY`, `OBSERVE_APP_SECRET`) to `.env`. SDK reference: https://observe.nestjs.com/documentation/sdk#quick-start

When a task depends on how the app behaves in production - an error users hit, a slow endpoint, a failing job, whether a release made things worse - work from that data, not from the code alone:

- The Observe MCP server answers those questions directly: errors with their traces and logs, slow operations, jobs, and what a release changed (`find_regressions`, `diff_release`). It is included on the Pro plan and above. In Claude Code: `claude mcp add observe --transport http https://observe-api.nestjs.com/mcp`, and the client opens a browser to approve. Other clients: https://www.observe.nestjs.com/documentation/mcp
- Without it, the user can open the request or error in the Observe dashboard and click **Copy agent prompt**, which hands over that page's trace, stack and logs as text.


## This project

A multi-tenant SaaS backend: organizations with the roles owner, admin and member, projects scoped to their organization, email invitations, and an audit log, on PostgreSQL through Drizzle, with JWT sign-in from `@nestjs/authentication`, Zod validation, OpenAPI and health checks. It is the finished app of https://docs.nestjs.com/tutorials/multi-tenant-saas, which explains each part; sign-in comes unchanged from https://docs.nestjs.com/tutorials/rest-api-jwt-authentication.

- Layout: one folder per feature under `src/` (module, controller, service, Zod schemas). `src/organizations/` also holds `OrganizationGuard` and the `@MinRole()` and `@CurrentMembership()` decorators (`membership.ts`); `src/tenancy/` holds the context id strategy; `src/audit/audit.ts` the audit helper.
- Schema and migrations: the Drizzle schema is `src/database/schema.ts`. After changing it, run `npm run db:generate` and commit the migration in `drizzle/`; `npm run db:migrate` applies them (it reads `DATABASE_URL`).
- Validation: Zod schemas passed to `@Body()` and `@Param()` with the `schema` option, through the global `StandardSchemaValidationPipe`. Optional fields are not nullable.
- Authentication: every route requires a bearer token unless it is marked `@Public()`; mark public routes `@ApiSecurity({})` too, so the OpenAPI document (which requires the token document-wide, in `main.ts`) shows them as open. `@CurrentUser()` reads the signed-in user.
- Tenancy: every route that belongs to an organization has `:orgId` in its path and `@UseGuards(OrganizationGuard)`. The guard validates the id, loads the caller's membership, answers 404 to non-members (never 403, which would confirm the organization exists) and 403 when the role is below the route's `@MinRole()` (default: member). Take the organization id from `@CurrentMembership()` or from the durable service, never from the URL directly.
- Every query of a tenant-owned table (`projects`, `memberships`, `invitations`, `audit_events`) has `org_id` in its `WHERE` clause, next to the row's own id. A new tenant-owned table gets an `org_id` column with `onDelete: 'cascade'`, and indexes that start with it.
- `ProjectsService` is durable (`Scope.REQUEST, durable: true`): one instance per organization, built by `OrganizationContextIdStrategy`, which `AppModule.onModuleInit()` registers. It receives only `{ orgId }` as `REQUEST`. Never store anything of a user or a request on a durable provider: take it as a method argument. The strategy runs before authentication, so it accepts only UUIDs and caps the number of trees.
- Membership changes run in a transaction that first takes the organization's row lock (`MembersService.lock()`, `SELECT ... FOR UPDATE`), re-reads the actor's role under it, and then writes one conditional statement whose `WHERE` clause holds the rules (who may change whom, and that another owner remains). Keep all three: `test/organizations.e2e-spec.ts` fails without the lock or with the guard's copy of the role.
- Audit entries are written with `audit(tx, ...)` inside the change's own transaction, and only when a row changed. Nothing updates or deletes audit events.
- Invitations: only the token's SHA-256 is stored; accepting deletes the invitation as the transaction's first statement, matching the signed-in user's email; the mail is sent after the commit, never inside the transaction.
- Tests: `npm run test:e2e` with `TEST_DATABASE_URL` pointing at a database of their own (`saas_test` from `docker compose`); they truncate its tables, and run one file at a time (`--no-file-parallelism`). Without `TEST_DATABASE_URL` they are skipped. `test/organizations.e2e-spec.ts` protects the tenant boundary, one `ProjectsService` per organization, single-use invitations for their recipient only, and the last-owner races; `test/refresh-token.store.e2e-spec.ts` runs `@nestjs/authentication`'s store contract.

This project is ESM: relative imports end in `.js`, and `__dirname` doesn't exist (use `import.meta.dirname`).
