# Chat UI: Next.js modernisation review

A review of `services/chat-ui` against current Next.js (16.3) conventions,
using the docs that ship in `node_modules/next/dist/docs`. The changes are on
the `idiomatic-next-js` branch, one commit each. Every commit message gives
the full reasoning.

## Summary

The package was already in good shape. It uses the App Router, the page is a
Server Component that reads cookies, route handlers act as a
backend-for-frontend so the Cognito secret stays on the server, the image uses
`output: 'standalone'`, and the type check runs `next typegen` so tsc checks
pages and routes. The gaps were in styling, linting and a few
conventions that are new in Next.js 16.

`scripts/dev-checks.sh` passes after every commit (34 tests), and
`next build` still compiles. Every route has the same rendering mode as before.

## What changed

### 1. CSS: global stylesheet → CSS Module (`373802d`)

**Before:** every style lived in `app/globals.css`, using hand-namespaced
class names (`.thread-header`, `.message-user`, `.composer-button`).

**After:**

- `app/thread.module.css` holds the thread component's styles, imported as
  `styles` and applied as `className={styles.header}` and so on.
- `globals.css` keeps only what is genuinely global: the box-sizing reset, the
  `body` styles, and the Streamdown `strong` workaround, which targets markup
  that our components don't render.
- The repeated GOV.UK colour literals are now custom properties on `:root`
  (`--text-colour`, `--brand-colour` and so on), shared by the module and any
  future ones.
- The grouped "centred 44rem column" selector is now a `composes: column` rule.

**Why:** Next.js documents global CSS for resets and base styles, and CSS
Modules for component styles. Modules scope class names automatically, so the
manual prefixes go away, names can't collide, and you can tell which component
uses each style. They're built into Next.js, so there's no new dependency.

**Gotcha found:** Turbopack doesn't follow nested `composes`. When
`.userMessage` composed `.message`, which composed `.column`, it got only
`.message` and lost the column width. I found this by inspecting the class
map in the build output. Each message variant now composes
`column message` directly, and a comment explains why.

**Alternatives considered:**

- **Tailwind CSS.** This is the create-next-app default, and Streamdown's
  markup assumes it, which is why the `strong` workaround exists. Adopting it
  would also style Streamdown's tables and code blocks. But it's a new build
  dependency and a styling convention the team hasn't chosen, so I didn't
  switch.
- **`govuk-frontend` (Sass).** If this UI is meant to look like GOV.UK
  rather than just use its colours, the GOV.UK Design System is the natural
  choice, and Next.js supports Sass. That's a product decision.

### 2. Linting: added `eslint-config-next` (`c0bbbf4`)

**Before:** Next.js 16 removed `next lint`, so the Chat UI got only the repo's
generic TypeScript and unicorn rules. Nothing checked the rules of hooks, JSX
accessibility, or Next.js-specific mistakes such as an async Client Component
or a `<head>` element.

**After:** the root `eslint.config.mjs` extends
`eslint-config-next/core-web-vitals` for `services/chat-ui/**` only, with
`settings.next.rootDir` set as the Next.js monorepo docs advise. It adds the
React, React Hooks, jsx-a11y, import and `@next/next` rule sets. I confirmed
with `--print-config` that `chat-api-ts` doesn't get these rules, and that its
lint still passes.

**Why:** this is the config Next.js documents for flat-config ESLint, and the
jsx-a11y rules matter for a government service. The dependency is in the root
`package.json`, next to the other ESLint plugins. It works with the repo's
ESLint 10, and the existing code already passes.

### 3. Cookie helpers moved out of `app/api/chat/` (`418b761`)

**Before:** `page.tsx` imported `readThreadId` from `./api/chat/cookies.ts`,
reaching into a folder that maps to a URL and holds route handlers.

**After:** `src/cookies.ts` (and its test) sits next to `src/chat-api/`.

**Why:** the page and three routes share the helpers, so they belong to no
single route. Next.js's project-structure guide suggests keeping shared code
like this outside `app/`, as `src/chat-api/` already does.

### 4. Removed `export const runtime = 'nodejs'` (`52d0716`)

The Next.js 16 docs list `'nodejs'` as the default and mark `'edge'` as
deprecated, so these exports did nothing. They also implied that a route
without one might run on Edge.

### 5. `poweredByHeader: false` (`4fe9ba3`)

This stops Next.js advertising itself in an `X-Powered-By` header on every
response. It's minor hardening that costs nothing.

### 6. Root layout typed with the generated `LayoutProps<'/'>` (`96c6e23`)

Next.js 16 generates global `LayoutProps` and `PageProps` types for each
route, and the type check already runs `next typegen`. The generated type
replaces the hand-written `{ children: ReactNode }` and will pick up parallel
route slots if any are added.

## Not done: blocked

### `server-only` guard on `src/chat-api/client.ts`

This module fetches the Cognito client secret. Adding `import 'server-only'`
makes the build fail if a Client Component ever imports it, which Next.js
recommends for exactly this case. Installing the package
(`pnpm add server-only` in `services/chat-ui`) was blocked by my session's
permissions, so I left it for you. To finish it:

1. `pnpm add server-only` in `services/chat-ui`.
2. Add `import 'server-only';` at the top of `src/chat-api/client.ts`.
3. In `client.test.ts`, add `vi.doMock('server-only', () => ({}))` alongside
   the existing Cognito mock. Outside the `react-server` export condition
   the package throws on import, so vitest needs the stub. The route tests
   already mock the whole client, so they're unaffected.

## Considered but left alone (worth a team decision)

- **Load history on the server instead of fetching it from the client.**
  Today the page renders, then `thread-history.ts` calls
  `/api/chat/messages`. The idiomatic App Router approach is for `page.tsx`
  to call `listThreadMessages` directly and pass the messages (or a promise of
  them) to the client, which saves a round trip and the empty-then-filled
  flash. I didn't make the change, because the messages route also renews
  the 90-day cookies, and a Server Component can't set cookies. Changing it
  means deciding where cookie renewal happens.
- **"New conversation" as a Server Action.** The commit history records that
  this was deliberately rejected, because Next.js doesn't remount the page
  after an action. The form post plus 303 redirect is sound, so I kept it.
- **`error.tsx` / `global-error.tsx`.** The Next.js production checklist
  recommends them, but the page has almost nothing that can throw at render
  time, and the content and design of an error page is a product call.
- **Moving `chat.tsx`, `thread.tsx` and `thread-history.ts` out of `app/`.**
  Next.js explicitly supports co-locating non-route files in `app/`, and
  they're used only by the home page, so co-location is a reasonable choice.
- **A `@/` import alias.** create-next-app sets one up, but the rest of the
  repo uses relative `.ts` imports, and vitest would need matching config. I
  kept the repo convention.
- **Dockerfile.** It already follows the standalone-output pattern the Next.js
  docs show: a non-root user, static assets copied in, and telemetry off.
  Nothing to change.

## Not verified

I couldn't run the built app in a browser. Starting a local server was blocked
in this session. I checked the CSS change by inspecting the compiled class map
and stylesheet, so please do a quick visual check with `scripts/dev.sh` before
merging.
