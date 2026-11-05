# Jappo web — design system

The web app (`apps/web`) uses one small, deliberate visual system. Everything below lives in two files: `app/globals.css` (tokens) and `components/ui/index.tsx` (primitives). Pages compose primitives; they do not restyle them.

## Principles

- **Quiet surfaces, strong type.** Warm off-white canvas, white cards with hairline borders, almost no shadows. Hierarchy comes from type size, weight and tracking, not from colour blocks.
- **One accent.** Green (`brand-*`) marks primary actions, active navigation and "done" states. Amber, red and sky are reserved for status semantics (badges, alerts, map legends).
- **Data first.** Tables and figures use tabular numerals; numeric columns align right; money is always rendered through `formatXof`.
- **Nothing decorative.** No gradients, illustrations or emoji. The only "visual" on the landing page is the reference settlement waterfall, drawn from the SPEC §9.6.3 golden values.

## Tokens (`app/globals.css`)

| Token | Use |
| --- | --- |
| `neutral-50 … 950` | Warm greys (paper → ink). Overrides Tailwind's cool scale so every `neutral-*` utility is on-brand. |
| `brand-50 … 950` | Green accent. `brand-700` is the primary button and the theme colour. |
| `radius-sm/md/lg/xl` | 6 / 8 / 12 / 16 px. Cards are `lg`, controls `md`. |
| `shadow-xs/sm/md/lg` | Barely-there elevation; `lg` is for drawers only. |
| `--font-inter` | Inter variable, self-hosted (`app/fonts/inter-latin.woff2`, latin subset incl. œ and €). |

Base layer: `cv05/cv08/ss03` Inter features, tabular numerals in tables, brand `accent-color` on native checkboxes/radios/ranges, hover row tint and no border on the last table row, a `select-chevron` utility for native selects, and `animate-enter` for page content.

## Primitives (`components/ui`)

| Component | Notes |
| --- | --- |
| `Button`, `buttonVariants`, `IconButton` | `primary` (green), `secondary` (white, hairline), `ghost`, `danger`, `link`; sizes `sm/md/lg`. `buttonVariants` runs through `tailwind-merge`, so a `className` can override any utility. |
| `Input`, `Select`, `Textarea`, `Label`, `Field`, `Checkbox` | 36 px controls with a soft brand focus ring; `Field` handles label, hint and error (`role="alert"`). |
| `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardBody`, `CardFooter` | `CardHeader` is a flex row: put a title left and an action right. |
| `Badge` | Tinted pills: `neutral / green / amber / red / blue`. Use `statusTone` & co. from `lib/utils`. |
| `Alert` | Tinted box with an icon; `error` is `role="alert"`, others `role="status"`. |
| `Table`, `Th`, `Td` | Hairline rows, muted header; add `text-right` on numeric columns. |
| `PageHeader` | Title, optional `eyebrow` (back link / context), subtitle, actions. |
| `Tabs` | Underline tabs; keeps `role="tablist"` / `role="tab"` / `aria-selected`. |
| `SegmentedControl` | Exclusive toggles (list / map, FR / EN); `aria-pressed`. |
| `Stat` | One figure with its label: KPI tiles, totals. |
| `Kv`, `KvGrid` | Description-list pairs for detail panels. |
| `Checklist` | Progress lists (onboarding, next actions, conditions precedent). |
| `Meter` | Horizontal progress bar with `role="progressbar"`. |
| `EmptyState`, `Spinner`, `Skeleton`, `Divider`, `SectionTitle` | Chrome. |

Brand mark and wordmark: `components/brand/logo.tsx`. Chart colours: `lib/chart-theme.ts`.

## Layouts

- **App shell** (`components/layout/app-shell.tsx`): a 240–256 px sidebar on the canvas colour with the organisation switcher, icon navigation generated from `/v1/modules`, settings group, locale, notifications and the user block with logout. No desktop top bar; on phones a slim bar with the menu button. Content is centred at `max-w-6xl`.
- **Public** (`app/(public)/layout.tsx`): translucent sticky header, hairline footer.
- **Auth** (`components/layout/auth-card.tsx`): dark brand panel with the settlement steps on large screens, the form on the right.
- **Farmer portal** and **field PWA** share the same tokens with larger (44 px) controls for phone use.

## Rules for new screens

1. Compose from the primitives above; do not add ad-hoc borders, shadows or colours.
2. Every list page: `PageHeader` → filters → `Card` + `Table`, with `EmptyState` when there is nothing.
3. Every detail page: `PageHeader` with an `eyebrow` back link, status `Badge` in the subtitle, `Tabs` when the resource has facets.
4. Keep the `data-testid`, `id`, `role` and label text used by the Playwright suites; styling changes never rename them.
