# Frontend Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild every screen of `apps/frontend` on the shadcn asset kit with a new page map (Today, Syllabus, Progress, Plan, Settings), one global Record sheet, a ⌘K palette, and a themed visual system, without changing any backend endpoint.

**Architecture:** Tailwind v4 is added beside the existing CSS Modules. The assets move to `src/components/ui/` and are themed by mapping the existing tokens in `tokens.css` onto shadcn's CSS variables. Pages are rebuilt one at a time on the existing data layer (`lib/api.ts`, `lib/hooks.ts`, React Query). Old routes redirect, and the old CSS Modules are deleted once nothing imports them. Pure logic goes into small `lib/` modules with vitest tests. UI is verified by typecheck, build, and a real browser.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind CSS v4 (`@tailwindcss/postcss`), `tw-animate-css`, `radix-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `recharts`, `vaul`, `react-day-picker`, `input-otp`, `@tanstack/react-virtual`, `jotai`, `cmdk`, `sonner`, `next-themes`, React Query 5, vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-14-frontend-redesign-design.md`. Read it in full before Task 1. Its "Screens" section fixes the order of content on every page, and this plan does not repeat it.

## Global Constraints

- No backend changes. Every endpoint the UI calls already exists. The proxy allowlist (`src/app/api/proxy/allowlist.ts`) is frontend code.
- Behaviour shipped on 2026-11-14 and 2026-11-15 is kept as built: day-end debrief clock (`lib/day-end.ts`), Postponed and Off plan cells, plan-shaped record (`useCreateSession`, `POST plans/:id/sessions`), Start over (`POST plans/:id/restart`).
- Tokens in `src/app/tokens.css` keep their values, with one exception: `--radius-input` changes from `2px` to `4px`.
- Radius by role: data marks 0, inputs and buttons 4px, panels 8px, sheets and dialogs 12px. Shadow (`--shadow-float`) only on popovers, sheets, dialogs, and the command palette.
- Type: Archivo for interface text and numbers, Newsreader for curriculum text (outcome statements, reading titles in detail views, coach sentences). Load both with `next/font/google`. They are currently referenced but never loaded. Scale in px: 12, 13, 14, 16, 20, 26, 34. Numbers use `tabular-nums`, never a monospace face.
- Sentence case everywhere. No all-caps labels, no eyebrow labels, no arrow glyph appended to link text. In user-facing copy, never use em-dashes or double hyphens.
- Not a card kit: separate panels with space and a hairline (`--rule`). Never wrap every section in a rounded card.
- Every data region has loading (`Skeleton` in the real shape), empty (one sentence + one action), error (`messageForStatus` text + Retry), and offline (cached data + "Offline, showing saved data").
- Motion: only in answer to an action, plus one orchestrated reveal (the Syllabus map's first render). Respect `prefers-reduced-motion`.
- Mobile: works at 390px wide, touch rows 44px, desktop rows 36px, safe-area padding on the bottom bar.
- CSP in `next.config.ts` stays as is. `next/font` self-hosts, so `font-src 'self'` holds.
- Front-end work runs through `/frontend-design:frontend-design`, and each screen is audited with `/impeccable` before its commit.
- Code comments explain why, not what, and stay compact.
- After every task: `pnpm --filter frontend typecheck`, `pnpm --filter frontend test`, and `pnpm --filter frontend build` are green before the commit.
- Commits go straight to `main` (owner's instruction), one per task, using Conventional Commits. Each message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push to `origin main` after the final task.

## Review Focus

1. A signed-in user with no active plan opens any app route. Expected: they land on `/onboarding`, never a blank page or a crash. (Task 3, `planGuardTarget` test.)
2. The `R` shortcut fires while the user is typing in an input, textarea, or combobox. Expected: it types the letter and does not open the Record sheet. (Task 3, `isTypingTarget` test.)
3. Long curriculum text: outcome statements over 300 characters and module names over 80. Expected: rows truncate with the full text in a tooltip, treemap cells too small for a label show none, and nothing overflows horizontally at 390px. (Task 5, `cellLabel` test.)
4. An old bookmark (`/los/abc`, `/coverage/xyz`, `/watchdogs`). Expected: it lands on the new home with the same thing open. (Task 2, `LEGACY_REDIRECTS` test.)
5. The exam has passed, or it is exam day. Expected: Today, Progress, and Plan each show their end state with a working link, never a negative countdown. (Task 4, `examPhase` test.)

---

### Task 1: Foundation: Tailwind, assets, theme

**Files:**
- Modify: `apps/frontend/package.json` (dependencies)
- Create: `apps/frontend/postcss.config.mjs`
- Create: `apps/frontend/src/app/globals.css`
- Modify: `apps/frontend/src/app/tokens.css` (`--radius-input: 4px`)
- Modify: `apps/frontend/src/app/layout.tsx` (fonts, `globals.css`, Toaster from `components/ui/sonner`)
- Move: `apps/frontend/src/external-ui-assets/*.tsx` → `apps/frontend/src/components/ui/` (lowercase file names kept, `git mv`)
- Create: `apps/frontend/src/lib/utils.ts`, `apps/frontend/src/hooks/ui/use-mobile.ts`, `apps/frontend/src/hooks/ui/use-media-query.ts`
- Modify: `apps/frontend/src/components/ui/combo-box.tsx`, `apps/frontend/src/components/ui/footer.tsx`
- Test: `apps/frontend/src/lib/utils.test.ts`

**Interfaces:**
- Produces: `cn(...inputs: ClassValue[]): string`; `useIsMobile(): boolean` (breakpoint 768px); `useMediaQuery(query: string): boolean`; every asset importable as `@/components/ui/<name>`; Tailwind colour utilities `bg-background`, `text-foreground`, `bg-card`, `text-muted-foreground`, `bg-primary`, `border-border`, `ring-ring`, `bg-destructive`, `chart-1..5`; plus project utilities `bg-conf-1..4`, `bg-stage-fp-reading` and the other three stages, `text-strong`, `text-alarm-ink`, `text-claimed-ink`, `font-ui`, `font-prose`.

- [ ] **Step 1: Write the failing test** `src/lib/utils.test.ts`

```ts
import { test, expect } from "vitest";
import { cn } from "./utils";
test("cn merges conflicting tailwind classes, last wins", () => {
  expect(cn("px-2 text-sm", false && "hidden", "px-4")).toBe("text-sm px-4");
});
```

- [ ] **Step 2: Run** `pnpm --filter frontend test -- utils`. Expected: FAIL, cannot find `./utils`.

- [ ] **Step 3: Install the dependencies**

Run in `apps/frontend`: `pnpm add tailwindcss @tailwindcss/postcss tw-animate-css radix-ui class-variance-authority clsx tailwind-merge lucide-react recharts vaul react-day-picker input-otp @tanstack/react-virtual jotai`

- [ ] **Step 4: Implement `cn` in `src/lib/utils.ts`** with `twMerge(clsx(inputs))`. Implement the two hooks with `matchMedia` and a `change` listener. Each starts `false` on the server so hydration matches.

- [ ] **Step 5: Run** the test. Expected: PASS.

- [ ] **Step 6: Tailwind and theme**
  - `postcss.config.mjs` exports `{ plugins: { "@tailwindcss/postcss": {} } }`.
  - `globals.css`:
    - Starts with `@import "tailwindcss"; @import "tw-animate-css"; @import "./tokens.css";`
    - Declares `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));`, because next-themes writes `data-theme`.
    - Has one `@theme inline` block that maps the shadcn variables to tokens exactly as the spec's colour table says: `--color-background: var(--ground)`, card and popover to `--raised`, foreground to `--text`, `--color-muted-foreground: var(--muted)`, primary to `--claimed`, `--color-border: var(--rule)`, `--color-input: var(--rule-strong)`, `--color-ring: var(--focus)`, `--color-destructive: var(--alarm)`, chart-1..4 to the four stage tokens, chart-5 to `--conf-3`.
    - The same block adds `--color-conf-1..4`, `--color-stage-*`, `--color-strong`, `--color-alarm-ink`, `--color-claimed-ink`, `--font-ui`, `--font-prose`, and radius `--radius-sm: 4px; --radius-md: 4px; --radius-lg: 8px; --radius-xl: 12px`.
    - `primary-foreground` is `#fff` in light and `--ground` in dark.
    - Base layer: `body { @apply bg-background text-foreground font-ui antialiased; font-size: 14px }`, 16px under `(max-width: 767px)`, and `font-variant-numeric: tabular-nums` on `table, [data-num]`.
  - `layout.tsx`: load `Archivo` (axes `wdth`, variable `--font-archivo`) and `Newsreader` (variable `--font-newsreader`) with `next/font/google`. Put both variables on `<html>`. Point `--font-ui` and `--font-prose` in `tokens.css` at them, keeping the current fallbacks. Import `./globals.css` in place of `./tokens.css`.

- [ ] **Step 7: Make the assets compile**
  - `git mv` all 42 files into `src/components/ui/` and remove the empty folder.
  - `combo-box.tsx`: delete the `@/utils/persian-fuzzy-searching` import and filter with `cmdk`'s built-in filtering (remove `shouldFilter={false}` or its equivalent and the custom matcher).
  - `footer.tsx`: rename to a version line. English copy: "Version {displayVersion}", stage names "Alpha", "Beta", "Release candidate". It reads `version` from `apps/frontend/package.json` (fix the relative import depth after the move).
  - `use-toast.tsx`: keep the file but mount nothing from it.
  - `tree-map.tsx`: keep the default `TreemapExample` export only if it compiles; export the `Treemap` component and its types as named exports.

- [ ] **Step 8: Restyle the variants to the system.** In `button.tsx`, `badge.tsx`, `input.tsx`, `select.tsx`, `textarea.tsx`, `tabs.tsx`, `toggle.tsx`, `card.tsx`, `dialog.tsx`, `sheet.tsx`, `popover.tsx`, `dropdown-menu.tsx`, `command.tsx`:
  - Remove `shadow-xs` from non-floating parts.
  - Inputs and buttons use `rounded-sm` (4px).
  - Popover, menu, and command panels use `rounded-lg` + `shadow-[var(--shadow-float)]`.
  - Sheet and dialog use `rounded-xl` on their free edges.
  - Default button height is `h-9` on desktop and `h-11` on touch, via `max-md:h-11`.
  - Keep all focus-visible rings.

- [ ] **Step 9: Verify.** Run typecheck, test, and build. Expected: all green. Old pages still render (CSS Modules untouched).

- [ ] **Step 10: Commit** `feat(ui): adopt the asset kit on tailwind, themed from our tokens`

---

### Task 2: Routing fixes: allowlist, auth middleware, legacy redirects

**Files:**
- Modify: `src/app/api/proxy/allowlist.ts`, `src/app/api/proxy/allowlist.test.ts`
- Create: `src/middleware.ts`, `src/lib/routes.ts`, `src/lib/routes.test.ts`, `src/lib/session-cookie.ts`
- Modify: `src/lib/session.ts` (re-export `SESSION_COOKIE` from `session-cookie.ts`)

**Interfaces:**
- Produces:
  - `APP_ROUTES: readonly string[]` = `["/today", "/syllabus", "/progress", "/plan", "/settings", "/onboarding"]`.
  - `needsLogin(pathname: string, hasSession: boolean): boolean`.
  - `LEGACY_REDIRECTS: { source: string; destination: string; permanent: false }[]`.

- [ ] **Step 1: Write the failing tests.**
  - In `allowlist.test.ts`, add `"auth/account/delete"` to the allowed set.
  - In `routes.test.ts`:

```ts
test("app routes need a session, auth routes never do", () => {
  expect(needsLogin("/today", false)).toBe(true);
  expect(needsLogin("/syllabus/abc", false)).toBe(true);
  expect(needsLogin("/today", true)).toBe(false);
  expect(needsLogin("/login", false)).toBe(false);
  expect(needsLogin("/reset-password", false)).toBe(false);
});
test("every legacy route has a new home", () => {
  const map = Object.fromEntries(LEGACY_REDIRECTS.map(r => [r.source, r.destination]));
  expect(map["/coverage"]).toBe("/syllabus");
  expect(map["/coverage/explore"]).toBe("/syllabus?view=3d");
  expect(map["/coverage/:topicId"]).toBe("/syllabus/:topicId");
  expect(map["/los/:losId"]).toBe("/syllabus?los=:losId");
  expect(map["/pace"]).toBe("/progress?tab=pace");
  expect(map["/mocks"]).toBe("/progress?tab=mocks");
  expect(map["/logs"]).toBe("/progress?tab=journal");
  expect(map["/watchdogs"]).toBe("/settings#system");
});
```

- [ ] **Step 2: Run** the tests. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - Add `/^auth\/account\/delete$/` to `ALLOWED` with a one-line comment.
  - `needsLogin` is true for any path under `APP_ROUTES` when there is no session.
  - Move `SESSION_COOKIE` into `src/lib/session-cookie.ts`, which has no imports, because `session.ts` imports `next/headers` and middleware must not pull that in.
  - `middleware.ts` reads `request.cookies.get(SESSION_COOKIE)`. When `needsLogin` is true it redirects to `/login`. Matcher: the six `APP_ROUTES` with `/:path*`.
  - Do not wire `LEGACY_REDIRECTS` into `next.config.ts` yet. Config redirects run before page files, so wiring them now would send `/coverage` to a `/syllabus` that does not exist. Task 10 wires them.

- [ ] **Step 4: Run** the tests, typecheck, and build. Expected: PASS.

- [ ] **Step 5: Commit** `fix(routing): allow account delete, guard app routes, map old urls`

---

### Task 3: Shell: sidebar, top bar, mobile bar, ⌘K, Record sheet, plan guard

**Files:**
- Create: `src/app/(app)/layout.tsx`. This is the route group for every signed-in page; URLs do not change.
- Move: `git mv` `today`, `plan`, `settings`, `coverage`, `los`, `pace`, `mocks`, `logs`, `watchdogs` from `src/app/` into `src/app/(app)/`, and remove each page's own `<AppShell>` wrapper and `<Composer>` mount so it renders inside the new shell. Old pages keep working until their task rewrites them.
- Create: `src/components/shell/app-sidebar.tsx`, `top-bar.tsx`, `mobile-bar.tsx`, `command-palette.tsx`, `plan-guard.tsx`
- Create: `src/components/record/record-provider.tsx`, `record-sheet.tsx` (rebuilds `components/composer.tsx` on the assets)
- Create: `src/lib/shell.ts`, `src/lib/shell.test.ts`
- Modify: `src/components/composer.tsx` (delete in Task 10, not now)

**Interfaces:**
- Consumes: `cn`, `useIsMobile`, the `ui/*` assets; `usePlan`, `useCurriculum`, `flattenCurriculum`, `useCreateSession`, `useSubmitTask`, `usePrescription`, `usePackages` from `lib/hooks.ts`.
- Produces:
  - `type RecordPreset = { taskId?: string; losId?: string; date?: string }`.
  - `useRecord(): { open(preset?: RecordPreset): void; close(): void }`.
  - `NAV: { href: string; label: string; icon: LucideIcon }[]` in the order Today, Syllabus, Progress, Plan, then Settings.
  - From `lib/shell.ts`:
    - `isTypingTarget(el: Element | null): boolean`
    - `planGuardTarget(status: "ok" | 404 | 401 | "error", pathname: string): string | null`
    - `commandItems(curriculum: Curriculum | undefined): { group: "Outcomes" | "Topics" | "Pages" | "Actions"; id: string; label: string; href?: string; action?: string }[]`

- [ ] **Step 1: Write the failing tests** in `src/lib/shell.test.ts`

```ts
test("R does not fire while typing", () => {
  const input = document.createElement("input");
  const area = document.createElement("textarea");
  const div = document.createElement("div"); div.contentEditable = "true";
  const combo = document.createElement("button"); combo.setAttribute("role", "combobox");
  for (const el of [input, area, div, combo]) expect(isTypingTarget(el)).toBe(true);
  expect(isTypingTarget(document.createElement("button"))).toBe(false);
  expect(isTypingTarget(null)).toBe(false);
});
test("no plan sends app pages to onboarding, never loops", () => {
  expect(planGuardTarget(404, "/today")).toBe("/onboarding");
  expect(planGuardTarget(404, "/settings")).toBeNull(); // account and security still reachable
  expect(planGuardTarget(404, "/onboarding")).toBeNull();
  expect(planGuardTarget(401, "/plan")).toBe("/login");
  expect(planGuardTarget("ok", "/today")).toBeNull();
  expect(planGuardTarget("error", "/today")).toBeNull(); // offline must not bounce
});
test("palette lists every outcome and the five pages", () => {
  const items = commandItems(fixtureCurriculum);
  expect(items.filter(i => i.group === "Pages").map(i => i.href))
    .toEqual(["/today", "/syllabus", "/progress", "/plan", "/settings"]);
  expect(items.filter(i => i.group === "Outcomes")).toHaveLength(fixtureLosCount);
  expect(items.find(i => i.group === "Outcomes")!.href).toMatch(/^\/syllabus\?los=/);
});
```

  Build `fixtureCurriculum` inline: 2 topics, 3 readings, 5 outcomes. Add `// @vitest-environment jsdom` at the top of the file.

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Implement `lib/shell.ts`** to pass. Actions group: "Record study", "Add mock exam", "Add holiday", "Export everything", "Toggle theme", "Sign out".

- [ ] **Step 4: Build the shell.**
  - `(app)/layout.tsx` wraps children in `SidebarProvider`, `PlanGuard`, `RecordProvider`, `TopBar`, `MobileBar`, `CommandPalette`.
  - Sidebar (`ui/sidebar`):
    - `collapsible="icon"`.
    - Header: the vortex mark (`components/mark.tsx`).
    - Nav groups: the four primary items, a separator, Settings.
    - Footer: theme toggle (`DropdownMenu` with Light, Dark, System, via `useTheme`), install (reuse `lib/install.ts`), account `Avatar` menu.
  - Top bar:
    - `Breadcrumb` built from the pathname and tab.
    - Search button showing "Search" and the `⌘K` / `Ctrl K` hint by platform.
    - Primary `Button` "Record" with lucide `Plus`.
  - Mobile bar (`md:hidden`): Today, Syllabus, a centre Record button, Progress, Plan. Each item shows a label under its icon. `pb-[env(safe-area-inset-bottom)]`. On mobile, Settings is reached from the top bar avatar.
  - Command palette: `CommandDialog` built from `commandItems`. It opens on `⌘K` / `Ctrl+K` and on the search button.
  - Record sheet:
    - `Sheet side="right"` on desktop, `Drawer` on mobile (`useIsMobile`), with the same fields, order, endpoint, and match-a-planned-cell offer as today's `composer.tsx` (read it first).
    - Section and module use `Combobox`, type uses `ToggleGroup`, package uses `Select`. Minutes, questions answered, and questions correct use `Input`; questions only show for question types and show live accuracy. Confidence uses a `ToggleGroup` coloured `bg-conf-1..4`. Date uses `DatePicker`, note uses `Textarea`.
    - Shows a preview line of the resulting cell.
    - Buttons "Record" and "Record and next".
    - Success toast "Recorded". Planned cells get an Undo action through `useSubmitTask` back to pending.
    - `R` opens the sheet unless `isTypingTarget(document.activeElement)`.
  - `PlanGuard`: reads `usePlan` and calls `router.replace(planGuardTarget(...))` when it is non-null.

- [ ] **Step 5: Verify.**
  - Tests pass, then run typecheck and build.
  - `pnpm --filter frontend dev`. In a browser, check `/today` at 1440px and 390px, light and dark.
  - With the keyboard only: tab through the sidebar, open and close ⌘K, record a session with `R`.
  - Run the `/impeccable` audit on the shell and fix what it finds.

- [ ] **Step 6: Commit** `feat(shell): sidebar, top bar, command palette and one record sheet`

---

### Task 4: Today

**Files:**
- Rewrite: `src/app/(app)/today/page.tsx`. Delete `today.module.css`.
- Create: `src/components/today/day-header.tsx`, `todays-work.tsx`, `standing-panel.tsx`, `study-next.tsx`, `week-strip.tsx`. The new week strip is rebuilt in Tailwind; the old one is deleted in Task 10.
- Create: `src/lib/today.ts`, `src/lib/today.test.ts`

**Interfaces:**
- Consumes: `useRecord().open({ taskId })` and `open({ losId })`; `usePrescription`, `useProgress`, `usePlan`, `useLogs`, `useHolidays`, `useMocks`; `readPace`, `missedDays` (`lib/pace.ts`); `msUntilDayEnd`, `debriefTime` (`lib/day-end.ts`).
- Produces:
  - `examPhase(examDate: string, todayISO: string): "before" | "exam-day" | "after"`
  - `studyNextRows(p: Progress, limit = 5): { losId: string; reason: "weak" | "stale" | "untouched" | "flagged"; label: string }[]`. Reason is derived from `status` and `lastRatedAt` exactly as `components/study-next-list.tsx` does.

- [ ] **Step 1: Write the failing tests**

```ts
test("exam phase", () => {
  expect(examPhase("2027-05-20", "2027-05-19")).toBe("before");
  expect(examPhase("2027-05-20", "2027-05-20")).toBe("exam-day");
  expect(examPhase("2027-05-20", "2027-05-21")).toBe("after");
});
test("study next keeps backend order and caps at five", () => {
  const rows = studyNextRows(progressFixture);
  expect(rows).toHaveLength(5);
  expect(rows[0].losId).toBe(progressFixture.studyNext[0].losId);
});
```

- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.

- [ ] **Step 5: Build the page** in the spec's Today order.
  - Two columns at `lg` (work column, then a 320px Standing column); one column below that.
  - Rows carry `Badge` "Postponed from {EEE d MMM}" when `postponedFrom` is set, and "Off plan" when `offPlan` is true. Off-plan rows sort last and have no Undo.
  - Materials go in a row `DropdownMenu`.
  - The "unrealistic" `Alert` lives only in the Standing panel and links to `/plan?tab=setup`.
  - Each Standing figure links to its home: pace to `/progress?tab=pace`, coverage to `/syllabus`, next mock to `/progress?tab=mocks`.
  - Handle the no-plan state (the guard covers it, but render an empty state too), exam day, and after-exam with a "Start a new plan" link to `/settings#start-over`.
  - When the day ends (`msUntilDayEnd` reaches 0), invalidate the prescription as the current page does.

- [ ] **Step 6: Verify** in the browser: 390px and 1440px, light and dark, keyboard, offline (DevTools offline with the cache warm). Run `/impeccable` on Today.

- [ ] **Step 7: Commit** `feat(today): one column of work, one of standing, record from the row`

---

### Task 5: Syllabus, topic page, outcome sheet

**Files:**
- Create: `src/app/(app)/syllabus/page.tsx`, `src/app/(app)/syllabus/[topicId]/page.tsx`
- Create: `src/components/syllabus/syllabus-map.tsx` (wraps `ui/tree-map`), `syllabus-table.tsx`, `outcome-sheet.tsx`, `status-strip.tsx`
- Move: `components/massif.tsx` stays, loaded with `next/dynamic` `ssr:false` inside the 3D view.
- Create: `src/lib/syllabus.ts`, `src/lib/syllabus.test.ts`
- Delete in Task 10: `app/(app)/coverage/**`, `app/(app)/los/**`

**Interfaces:**
- Consumes: `useCurriculum`, `useLogs`, `usePackages`, `usePlan`; `weightedCoveragePercent` and `sortByStake` (`lib/coverage.ts`); `useRecord`.
- Produces:
  - `syllabusTree(curriculum: Curriculum, logs: LogEntry[]): TreemapDataItem[]`.
    - Topic value = `(examWeightMin + examWeightMax) / 2`.
    - Each outcome's value = topic value ÷ the topic's outcome count; a reading's value is the sum of its outcomes.
    - `metadata` = `{ confidence: number | null, covered: number, total: number, accuracy: number | null, kind: "topic" | "reading" | "los" }`.
  - `confidenceFill(c: number | null): string` returns `var(--conf-1..4)`, or `"untouched"` for null.
  - `cellLabel(name: string, widthPx: number): string | null` returns null under 48px and truncates with "…" to fit about `widthPx / 7` characters.
  - `useOutcomeParam(): [losId: string | null, set: (id: string | null) => void]` keeps `?los=` in the URL.

- [ ] **Step 1: Write the failing tests**

```ts
test("topic area is midpoint weight; outcomes split it equally", () => {
  const [t] = syllabusTree(oneTopicTwoReadings /* weights 10-15, 3 + 1 outcomes */, []);
  expect(t.value).toBe(12.5);
  expect(t.children![0].value).toBeCloseTo(12.5 * 3 / 4);
  expect(t.children![1].children![0].value).toBeCloseTo(12.5 / 4);
});
test("untouched outcomes have null confidence", () => {
  const [t] = syllabusTree(oneTopicTwoReadings, []);
  expect(t.children![0].children![0].metadata!.confidence).toBeNull();
  expect(confidenceFill(null)).toBe("untouched");
});
test("labels hide in small cells and truncate long text", () => {
  expect(cellLabel("Equity valuation", 40)).toBeNull();
  const long = "x".repeat(300);
  expect(cellLabel(long, 140)!.length).toBeLessThanOrEqual(20);
  expect(cellLabel(long, 140)!.endsWith("…")).toBe(true);
});
```

- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.

- [ ] **Step 5: Build the pages** in the spec's Syllabus order.
  - The view switch is a `SegmentedControl` (Map, Table, 3D) held in `?view=`.
  - Map:
    - Fill comes from `confidenceFill`. Untouched cells use a 45° hatch of `--rule-strong` on `--raised`, as a CSS `repeating-linear-gradient`.
    - Drill-down uses the asset's breadcrumb; clicking an outcome calls `setLos(id)`.
    - Tooltip shows the weight range, "Covered X of Y", and accuracy.
    - Legend line: "Area is exam weight. Inside a topic every outcome counts the same."
    - One orchestrated reveal: cells fade and scale in by topic, 40ms stagger, 240ms each, skipped under reduced motion.
  - Table: `Table` with sortable headers and `Accordion` rows for readings.
  - The topic page and outcome sheet follow the spec's order. The outcome sheet's history uses `Table` + `Pagination` (`usePaged`, 8 rows), and its "Record" calls `open({ losId })`.
  - Keep the "flagged because" logic and the monoculture nudge from `app/los/[losId]/page.tsx` (read it first).

- [ ] **Step 6: Verify** in the browser: drill down with the keyboard, then open `/syllabus?los=<id>` directly and check that Back closes the sheet. Check 390px. Run `/impeccable`.

- [ ] **Step 7: Commit** `feat(syllabus): weight map, table, 3D and the outcome sheet`

---

### Task 6: Progress: pace, mocks, journal

**Files:**
- Create: `src/app/(app)/progress/page.tsx`, `src/components/progress/pace-tab.tsx`, `mocks-tab.tsx`, `journal-tab.tsx`, `add-mock-dialog.tsx`
- Create: `src/lib/journal.ts`, `src/lib/journal.test.ts`
- Reuse: `components/pace-field.tsx` (restyle in Tailwind), `readPace` and the rollups in `app/pace/page.tsx` (move the pure parts into `lib/pace.ts` with the existing tests)

**Interfaces:**
- Consumes: `useLogs`, `useMocks`, `usePackages`, `useHolidays`, `useDeleteLog`, `useOutcomeParam` (Task 5, which opens the outcome sheet from any page because it lives in `(app)/layout.tsx`). Move the `OutcomeSheet` mount into the layout in this task.
- Produces: `filterJournal(logs: LogEntry[], f: { topicId?: string; packageId?: string; from?: string; to?: string }, losToTopic: Map<string, string>): LogEntry[]`.

- [ ] **Step 1: Write the failing test**

```ts
test("journal filters combine and keep newest first", () => {
  const out = filterJournal(logsFixture, { topicId: "t1", from: "2026-11-01" }, losToTopic);
  expect(out.every(l => losToTopic.get(l.losId) === "t1" && l.date >= "2026-11-01")).toBe(true);
  expect(out.map(l => l.date)).toEqual([...out.map(l => l.date)].sort().reverse());
});
```

- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.

- [ ] **Step 5: Build the tabs.** `Tabs` held in `?tab=pace|mocks|journal`, default `pace`. Follow the spec's Progress section.
  - The mock chart uses `ui/chart` (recharts).
  - Delete confirmations use `Dialog`, never `window.confirm`.
  - The journal list is virtualised (keep `react-virtuoso` as it is today) and grouped by day. Rows open `?los=`.
  - "Export log, CSV" calls `export/log`.

- [ ] **Step 6: Verify** in the browser at both widths and with the keyboard. Run `/impeccable`.

- [ ] **Step 7: Commit** `feat(progress): pace, mocks and journal on one desk`

---

### Task 7: Plan: campaign, calendar, setup

**Files:**
- Rewrite: `src/app/(app)/plan/page.tsx`
- Create: `src/components/plan/campaign-tab.tsx`, `calendar-tab.tsx`, `setup-tab.tsx`, and editors `exam-date-editor.tsx`, `hours-editor.tsx`, `holidays-editor.tsx`, `packages-editor.tsx`
- Reuse, restyled in Tailwind: `campaign-chart.tsx`, `planner-settings.tsx`, `prior-work.tsx`, `day-plan.tsx` (read-only mode)
- Create: `src/lib/plan-invalidation.ts`, `src/lib/plan-invalidation.test.ts`

**Interfaces:**
- Consumes: `useCampaign`, `usePrescription`, `usePlan`, `useHolidays`, `usePlanPackages`, `usePackages`, `keys` from `lib/hooks.ts`.
- Produces:
  - `invalidateAfterSetup(qc: QueryClient, planId: string): Promise<void>`. It invalidates `keys.plan`, every `campaign` query, and every `prescription` query for the plan.
  - Each editor is exported for Task 9: `HoursEditor({ value, onChange })`, `PackagesEditor({ selected, onChange })`, and `PriorWork` (existing). All are controlled, so onboarding can reuse them without saving.

- [ ] **Step 1: Write the failing test.** Use a real `QueryClient` seeded with `keys.plan`, a campaign key, and two prescription keys. After `invalidateAfterSetup`, every one of them is `isInvalidated`, and an unrelated `packages` key is not.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Build the tabs.** `?tab=campaign|calendar|setup`. Follow the spec's Plan section.
  - The calendar pages by week with `Button`s and links the current week to `/today`.
  - Every Setup save calls `invalidateAfterSetup`.
  - The JSON export is removed from this page.
- [ ] **Step 6: Verify:** change weekly hours, then check that Campaign and Today reflect it without a reload. Check 390px. Run `/impeccable`.
- [ ] **Step 7: Commit** `feat(plan): campaign, calendar and every setup input in one place`

---

### Task 8: Settings

**Files:**
- Rewrite: `src/app/(app)/settings/page.tsx`
- Create: `src/components/settings/settings-nav.tsx` and one section file each: `account.tsx`, `security.tsx`, `coach-devices.tsx`, `location.tsx`, `system-health.tsx`, `your-data.tsx`, `danger-zone.tsx`
- Reuse, restyled: `security-settings.tsx`, `coach-settings.tsx`, `restart-plan.tsx`, `delete-account.tsx`, `install-card.tsx`; system health logic from `app/watchdogs/page.tsx`
- Modify: none in `lib/`

**Interfaces:**
- Consumes: `useCronStatus`, `usePushDevices`, `lib/push.ts`, `useLogs`, `useMocks`, `ui/footer` (version line).
- Produces: section anchors `#account`, `#security`, `#coach`, `#location`, `#system`, `#data`, `#start-over`, `#delete`.

- [ ] **Step 1: Build the sections** in the spec's Settings order. Desktop has a sticky left sub-nav that tracks the active section by `IntersectionObserver`; mobile stacks the sections.
  - Two-factor uses `InputOTP` (6 slots).
  - Devices show their `label`, falling back to "Unnamed device".
  - The "Missed day alerts" switch is not carried over.
  - Start over is a `Collapsible` with an explanation and a second confirm button, behaving exactly as `restart-plan.tsx` does now.
  - Delete account uses a `Dialog` and now works (Task 2 allowlist).
- [ ] **Step 2: Verify.**
  - System health at `#system` shows the last run and the 30-night grid (the `/watchdogs` redirect is checked in Task 10).
  - Run now and backfill work.
  - Delete account succeeds against a throwaway account.
  - Run `/impeccable`.
- [ ] **Step 3: Commit** `feat(settings): one page for account, devices, health and data`

---

### Task 9: Auth and onboarding

**Files:**
- Rewrite in place: `src/app/login/page.tsx`, `src/app/forgot-password/page.tsx`, `src/app/reset-password/page.tsx`, `src/app/onboarding/page.tsx`. Delete their `*.module.css`.
- Create: `src/components/auth/auth-panel.tsx`

**Interfaces:**
- Consumes: `signIn`, `api`, the existing passkey and MFA calls (keep the logic, replace the markup), `HoursEditor`, `PackagesEditor`, `PriorWork` (Task 7), `useLevels`, `usePlan`.

- [ ] **Step 1: Build.**
  - `AuthPanel`: a centred 400px panel on `bg-background` with the vortex mark above it, used by all three auth pages.
  - Login: `Tabs` for "Sign in" and "Create account", the email and password form (`react-hook-form` + zod as now), OAuth `Button`s with `provider-marks`, "Use a passkey", and a link to "Forgotten your password?". The MFA step uses `InputOTP`.
  - Onboarding:
    - Full screen with a `Progress` header and the same six steps, gates, and `cfa-onboarding-draft` draft. Steps 3 to 5 use the Plan editors.
    - If `usePlan` succeeds, show "You already have a plan" with links to `/plan` and `/settings#start-over`.
- [ ] **Step 2: Verify:** sign in with a password, with TOTP, and with a passkey. Reset password through a token link. Complete onboarding at 390px. Run `/impeccable`.
- [ ] **Step 3: Commit** `feat(auth): one panel for sign in, reset and setup`

---

### Task 10: Remove the old UI and record the change

**Files:**
- Delete:
  - `src/app/(app)/coverage/**`, `los/**`, `pace/**`, `mocks/**`, `logs/**`, `watchdogs/**`.
  - `components/app-shell.*`, `utility-strip.*`, `composer.*`, `study-next-list.*`, `weight-gap.*`, `pager.*`, and every other `components/*.module.css` and component that `grep` shows nothing imports.
- Modify:
  - `next.config.ts`: add `redirects: async () => LEGACY_REDIRECTS` (from `src/lib/routes.ts`).
  - `docs/superpowers/specs/2026-11-07-cfa-frontend-screens.md`: frontmatter `status: superseded`, `updated: 2026-11-15`.
  - The redesign spec: `status: active`, `updated` bumped.

- [ ] **Step 1: Find orphans.** `grep -rL` each component name across `src/`, then delete only those with no importer.
- [ ] **Step 2: Verify.**
  - Typecheck, test, and build are green.
  - In the browser: every legacy URL from Task 2's test redirects correctly.
  - Check the console on every page for errors.
- [ ] **Step 3: Commit** `chore(ui): remove the old screens and css modules`
- [ ] **Step 4: Push.** `git push origin main`. Expected: the push succeeds. If it is rejected, run `git pull --rebase origin main`, re-run typecheck, test, and build, then push. Never force-push.
