# bin-calendar — UI Design Concepts

**Prepared:** 2026-03-28
**Author:** Product Design Review
**Scope:** Three alternative UI design directions for the bin-calendar SPA

---

## Current UI Assessment

### What the app does

bin-calendar is a self-hosted utility that:
1. Fetches bin collection schedules from East Ayrshire Council
2. Syncs them to Google Calendar or iCloud
3. Lets users manage multiple properties
4. Shows sync history and status

### Current design summary

- **Layout:** Fixed 220px left sidebar + scrollable content area
- **Theme:** Deep dark navy (`#06080f`) with electric teal (`#00d4aa`) accent
- **Type:** Syne (display) + Outfit (body) — geometric, modern
- **Navigation:** Three views — Dashboard, Properties, Logs
- **Interaction style:** Cards, tables, multi-step modal wizards

### User journey (current)

```
PERSONA: Alan, self-hoster, technical, checks occasionally

STAGE:      FIRST SETUP     DAILY USE     TROUBLESHOOT
Actions:    Add property    Glance status  Check logs
Touchpoint: Properties view Dashboard      Logs view
Emotion:    Focused         Satisfied      Frustrated
Pain point: Multi-step       Info density  Log parsing
            wizard friction  is high        is verbose
```

### Current UI pain points

1. **Dashboard is info-dense** — status badges, dates, and action buttons compete for attention. The "next sync" bar and property cards feel disconnected.
2. **Properties table + modal mismatch** — the table view and the modal wizard feel like two different apps. The Google OAuth paste-URL step is awkward.
3. **Logs are just a list** — collapsible rows are functional but provide no at-a-glance sense of health over time.
4. **Sidebar navigation wastes horizontal space** — with only three nav items, a 220px sidebar is disproportionate.
5. **No visual hierarchy for "what matters now"** — the next bin collection date and sync health are buried.

---

## Design Concept 1: "Home Hub"

**Tagline:** The status page you glance at, not manage.

### Philosophy

Treat bin-calendar like a home automation dashboard — a heads-up display that tells you what you need to know at a glance. The next bin collection is the hero element. Configuration is secondary and hidden behind progressive disclosure.

### Layout

```
+------------------------------------------------------------------+
|  [bin-calendar]                             [Settings]  [Logs]   |  ← Minimal top bar
+------------------------------------------------------------------+
|                                                                  |
|   NEXT COLLECTION                                                |
|  +------------------------------------------+                   |
|  |  📅  Wednesday, 2 April                  |   ← Hero card     |
|  |      2 days away                         |    (large, full   |
|  |      General Waste · Recycling            |     width)        |
|  +------------------------------------------+                   |
|                                                                  |
|   YOUR PROPERTIES                                                |
|  +--------------+  +--------------+  +--------------+           |
|  | 12 Main St   |  | 45 Oak Ave   |  | + Add         |           |
|  | Connected    |  | Action req.  |  |               |           |
|  | Last: 2h ago |  | Reconnect    |  |               |           |
|  +--------------+  +--------------+  +--------------+           |
|                                                                  |
|   SYNC HEALTH           Last 7 runs                             |
|  [●][●][●][●][●][●][○]  ← sparkline dots, green/red             |
|  Next auto-sync: 1 April 2026 · [Sync Now]                      |
|                                                                  |
+------------------------------------------------------------------+
```

### Key design decisions

- **No sidebar.** Top navigation bar with only two items: Settings (wraps Properties configuration) and Logs. Navigation is rare — most users never leave the dashboard.
- **Hero card for next collection.** The upcoming bin collection date is the single most useful piece of information. Make it unavoidable.
- **Compact property tiles** replace the current table. Each tile shows connection health with a colour-coded border (green = connected, amber = warning, red = action required). The "+ Add" tile is always visible.
- **Sync health sparkline** — seven dots representing the last seven sync runs (filled green = success, filled red = failure, empty = pending). Communicates history in one line.
- **Settings view** (behind Settings nav item) replaces the current Properties table + modal, presented as a vertical stack of expandable property accordions rather than a table + modal combination.

### Visual language

- **Theme:** Light with strong colour accents. White base (`#ffffff`), light grey surfaces (`#f5f7fa`), charcoal text (`#1a2035`).
- **Accent:** Bin-type colours — green for general waste, blue for recycling, brown for garden waste. The accent adapts to what's coming next.
- **Typography:** Single font family — Inter. Large display weight for the hero date, regular for body.
- **Borders:** No card borders. Depth via shadow (`box-shadow: 0 2px 8px rgba(0,0,0,0.08)`). Property tiles use a 3px left border for status colour.
- **Iconography:** Bin emoji or simple SVG icons for waste types. Calendar icon for dates.

### When this concept works best

- Primary use case is "glance and go" — user opens the app, sees the next collection, closes it.
- User has 2–4 properties max.
- Mobile or tablet access is likely.

---

## Design Concept 2: "Command Centre"

**Tagline:** Every metric, in the open, all the time.

### Philosophy

Power-user monitoring interface. Inspired by infrastructure dashboards (Grafana, Datadog). All information is visible simultaneously — no modals, no accordions, no hidden state. The Logs view is elevated from an afterthought to a first-class citizen. Users who self-host this tool are technical; don't hide complexity, embrace it.

### Layout

```
+--[bin-calendar]--[Dashboard]--[Properties]--[Logs]------[Sync Now ▶]--+
|                                                                        |
|  SYSTEM STATUS                                                         |
|  ┌──────────────────────────────────────────────────────────────────┐  |
|  │ Sync       HEALTHY   │ Last run  2h ago  │ Next run  4 days      │  |
|  │ Properties 2/2 OK    │ Duration  1.2s    │ Schedule  1st/month   │  |
|  └──────────────────────────────────────────────────────────────────┘  |
|                                                                        |
|  PROPERTIES                        RECENT RUNS                        |
|  ┌──────────────────────────┐      ┌──────────────────────────────┐   |
|  │ # │ Label    │ Cal  │ ✓  │      │ 26/03  SUCCESS  1.1s  +8 -0  │   |
|  │ 1 │ Main St  │  G   │ ● │      │ 26/02  SUCCESS  0.9s  +6 -0  │   |
|  │ 2 │ Oak Ave  │  iC  │ ● │      │ 26/01  PARTIAL  2.1s  +3 -0  │   |
|  │ + │ Add new  │      │   │      │ 26/12  FAILURE  —     —       │   |
|  └──────────────────────────┘      │ 26/11  SUCCESS  1.0s  +5 -0  │   |
|                                    └──────────────────────────────┘   |
|                                                                        |
|  NEXT COLLECTIONS                                                      |
|  ┌──────────────────────────────────────────────────────────────────┐  |
|  │  02 Apr  General Waste  · Recycling     12 Main St               │  |
|  │  09 Apr  General Waste                  12 Main St               │  |
|  │  02 Apr  General Waste  · Garden Waste  45 Oak Ave               │  |
|  └──────────────────────────────────────────────────────────────────┘  |
|                                                                        |
+------------------------------------------------------------------------+
```

### Key design decisions

- **Horizontal top navigation.** Three views on a thin top bar. "Sync Now" is a persistent action button in the top-right — always accessible, never buried on the dashboard.
- **Three-panel dashboard.** System status bar (full width), then a two-column layout: Properties on the left, Recent Runs on the right. Below: a unified Next Collections table spanning all properties.
- **Properties as an inline table** with minimal chrome. No modal for adding — clicking "+ Add new" expands an inline form row. Editing happens inline. This reduces the dissonance between the table and the modal.
- **Recent Runs column** shows the last five sync runs with compact stats (+events added, duration). Click any row to jump to the Logs view filtered to that run.
- **Next Collections table** is new — aggregate view across all properties of upcoming bin events pulled from ICS data. Currently the app only shows "last sync date"; this elevates what the data actually contains.
- **Logs view** gains a simple filter bar (date range, status) and displays runs as a table rather than collapsible cards.

### Visual language

- **Theme:** Dark, but not pure black. Warm near-black (`#141414`) with slightly warmer surfaces (`#1e1e1e`). This avoids the current "space" feel and reads more like a developer tool.
- **Accent:** Single accent — a sharp electric green (`#39d353`, the GitHub contribution graph green). Used only for success states and CTAs.
- **Typography:** Monospace throughout — `JetBrains Mono` or `Fira Code`. All text is code. Numbers are always tabular.
- **Borders:** Hairline borders (`1px solid #2a2a2a`) on all panels. No shadows. No gradients.
- **Status indicators:** Filled circle ● = connected/healthy, empty circle ○ = disconnected, triangle ▲ = warning. No verbose badge text.
- **Density:** Compact row height (36px), small font (13px base). Information over whitespace.

### When this concept works best

- User is technical and comfortable with dense UIs.
- User has many properties (5+) or monitors across multiple households.
- The app is open in a browser tab alongside other self-hosted dashboards.
- User cares about sync reliability and wants immediate visibility of failures.

---

## Design Concept 3: "Weekly Planner"

**Tagline:** A calendar, not a config panel.

### Philosophy

Reframe the app entirely around the *calendar metaphor* it's built on. Instead of an admin dashboard, it looks and feels like a personal planner or scheduling app (think Fantastical or Notion's calendar view). The user's mental model is "my bin schedule" — show them that, not a list of synced properties.

### Layout

```
+------------------------------------------------------------------+
|  bin-calendar                   March 2026        [< Prev][Next >]|
+------------------------------------------------------------------+
|  Mon    Tue    Wed    Thu    Fri    Sat    Sun                    |
|  ──────────────────────────────────────────────────────────────  |
|  30     31     1      2      3      4      5                     |
|                      [GW]   [REC]                                |
|                                                                  |
|  6      7      8      9      10     11     12                    |
|                                                                  |
|  13     14     15     16     17     18     19                    |
|  ...                                                             |
+------------------------------------------------------------------+
|  SIDEBAR                                                         |
|  ┌──────────────────────────────────────────────────────────┐   |
|  │ PROPERTIES                                               │   |
|  │  ● 12 Main St      Google Calendar   Connected           │   |
|  │  ● 45 Oak Ave      iCloud            Connected           │   |
|  │  + Add property                                          │   |
|  │                                                          │   |
|  │ SYNC STATUS                                              │   |
|  │  Last sync: 26 Mar 2026 · Success                        │   |
|  │  Next sync: 1 Apr 2026                                   │   |
|  │  [Sync Now]                                              │   |
|  │                                                          │   |
|  │ [View Logs]                                              │   |
|  └──────────────────────────────────────────────────────────┘   |
+------------------------------------------------------------------+
```

### Key design decisions

- **Calendar grid is the primary UI.** A standard month-view calendar with bin collection events rendered as colour-coded chips directly in the date cells. General Waste = charcoal chip, Recycling = blue, Garden Waste = green. The user immediately sees their collection schedule without any syncing to Google Calendar — the ICS data is surfaced right here.
- **Right sidebar** (collapsible) contains Properties management and Sync status. It is secondary to the calendar view.
- **Clicking a calendar event chip** opens a small inline popover showing which properties have that collection and whether it was synced successfully. No modals for viewing event detail.
- **Adding/editing a property** uses a slide-in panel from the right rather than a centred modal — feels more native to a sidebar-driven layout.
- **Month navigation** allows viewing past months (to see what was collected when) and future months (to plan ahead). Historical syncs are shown with success/failure indicators on the date cells.
- **Logs** are replaced by clicking any past-month date — it shows a popover with the sync run details for that date rather than a separate Logs view. This collapses three views into one coherent one.

### Visual language

- **Theme:** Warm off-white (`#fafaf8`) base. This is the only concept with a light theme option *and* a dark mode toggle, because the calendar metaphor is very legible in light mode.
- **Surfaces:** Paper-white cards (`#ffffff`) with subtle warm shadow.
- **Accent:** No single accent colour — bin type colours are the UI language. General Waste: `#4a4a4a` (charcoal). Recycling: `#3b82f6` (blue). Garden Waste: `#16a34a` (green). Food Waste: `#ea580c` (orange).
- **Typography:** `Lato` or `Source Sans 3` — friendly, legible, approachable. Not a developer font.
- **Calendar chips:** Rounded pill shape, 12px font, 4px top padding. Overflow to "+N more" if a date has >3 events.
- **No tables.** The Properties sidebar uses a simple stacked list. No table headers, no columns.

### When this concept works best

- User's primary question is "when is my next bin collection?" not "did my sync succeed?"
- User has family members who might also use the app and are not technical.
- The self-hosted tool is accessed from a household tablet or home screen bookmark.
- Bin types vary (4+ types) and the user wants to track which type is collected when.

---

## Comparison Matrix

| Criterion                      | Concept 1: Home Hub | Concept 2: Command Centre | Concept 3: Weekly Planner |
|-------------------------------|---------------------|--------------------------|--------------------------|
| Navigation structure           | Top bar (minimal)   | Top bar (3 tabs)         | Calendar + sidebar        |
| Primary user action            | Glance status       | Monitor & debug          | View collection schedule  |
| Properties management          | Settings page       | Inline table             | Sidebar slide-in panel    |
| Logs/history                   | Sparkline dots      | Dedicated table view     | Calendar popover          |
| Information density            | Low                 | High                     | Medium                    |
| Technical user fit             | Medium              | High                     | Low                       |
| Non-technical user fit         | High                | Low                      | High                      |
| Mobile/responsive suitability  | High                | Low                      | Medium                    |
| Setup complexity (to redesign) | Low                 | Medium                   | High (new ICS parsing UI) |

---

## Recommendation

**Primary recommendation: Concept 1 (Home Hub)**

For a self-hosted single-user or household utility, the most impactful change is elevating the *next collection date* to a hero element and simplifying the navigation to a top bar. The current sidebar navigation is oversized for three items, and the dashboard doesn't immediately answer the user's primary question.

This concept requires the least structural re-engineering — it's largely a layout and hierarchy change, with the main new component being the next-collection hero card.

**Secondary recommendation: Concept 2 (Command Centre)**

If the primary user is technical and has multiple properties to manage, Concept 2 provides superior information density and removes the modal/table mismatch. The inline property row editing is a concrete UX improvement over the current modal wizard.

**Concept 3 (Weekly Planner)** is the most distinctive but requires surfacing ICS event data directly in the frontend (currently the frontend only shows sync status, not parsed events). It would need backend API changes and is better suited as a longer-term v2 direction.

---

## Suggested Next Steps

1. **Choose a direction** and open a GitHub issue with the chosen concept.
2. **Run `/analyse`** on the chosen concept to refine requirements.
3. **Run `/design`** to produce a detailed component spec and implementation plan.
4. Consider **mobile responsiveness** in any redesign — the current sidebar layout breaks on small screens.
5. Regardless of concept chosen, fix the **top nav vs sidebar** decision first — it affects every view.
