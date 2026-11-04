# 🍔 — US election widget for OBS

A free-to-view 480 × 360 OBS overlay at **[burger.perd.dev](https://burger.perd.dev/)**. It displays 2026 Senate and House election results from civicAPI, with a US map, an enlarged state, scrolling digits, and sliding text. The interface is in English.

## Add to OBS

No download, account, API key, or local server is needed to use the hosted widget. Keep an internet connection active while streaming.

1. In OBS, open **Sources → + → Browser**, create a source, and open its properties.
2. Leave **Local file** off and enter the URL and size below.
3. Click **OK**. The card should appear in the scene; position it wherever you want it on stream.

| Setting | Value |
| --- | --- |
| Local file | Off |
| URL | `https://burger.perd.dev/` |
| Width | `480` |
| Height | `360` |
| Custom frame rate | Optional, 30 or 60 FPS |
| Shutdown source when not visible | Off, to keep the rotation and refresh active |

The page background is transparent. The paper card has its own opaque background. These links work directly in OBS on any computer. [OBS Browser Source documentation](https://obsproject.com/kb/browser-source).

Choose a URL for each Browser source:

| URL | Display |
| --- | --- |
| [https://burger.perd.dev/](https://burger.perd.dev/) | Senate and House, alternating every 36 seconds |
| [https://burger.perd.dev/senate](https://burger.perd.dev/senate) | Senate only |
| [https://burger.perd.dev/house](https://burger.perd.dev/house) | House only |

To show both chambers at once, add two Browser sources: one with `https://burger.perd.dev/senate` and one with `https://burger.perd.dev/house`. Set each to **480 × 360**. All hosted widgets use the same shared data cache.

If the card shows **Waiting**, the source has no published result for that race yet. Dashes mean vote shares are unavailable. **Offline** means the widget is showing its last saved data. Check the [source status page](https://burger.perd.dev/sources) for details; it is separate from the on-stream card.

## Behavior

- Each open widget checks for data 60 seconds after its previous request completes. Hosted widgets share a D1 cache across viewers and Worker instances; upstream refresh attempts are at least 60 seconds apart and start when a viewer requests an update. Each refresh requests one Senate aggregate and one House aggregate from civicAPI.
- Each race is shown for 12 seconds. The root URL changes chamber after three races: Senate for 36 seconds, then House for 36 seconds. The chamber-specific URLs keep rotating races within their selected chamber.
- The selection favors close races with reported votes. Races without votes follow in a stable order. The map locates the selected race's state; House district shapes are not shown.
- Seat counts include only the **35 Senate contests and 435 House seats being elected in 2026**. Senate holdovers are excluded. These numbers are not a full-chamber majority count.
- A leader does not count as a winner. A seat counts only when civicAPI marks an individual candidate as a winner. These calls come from civicAPI’s own decision desk, not AP. Newer source corrections can retract or change a call. National party seat totals are never used.
- Test, dry-run, demo, and simulation records are excluded. There is no automatic fallback to demo election numbers.
- The footer time is the last successful API synchronization, shown in the browser's local timezone using English formatting. It does not mean votes changed at that moment. The sources page lists the upstream chamber update time for each race. The aggregate feeds do not expose individual result or call timestamps; call times are shown as unknown.
- On a connection failure, the last results remain visible with **Offline**. The timestamp stays unchanged. Missing or invalid chamber feeds retain their last values and are marked stale, including when a response is older. The browser keeps a local copy across reloads and restores unavailable races and calls after a server restart; explicit newer corrections still replace saved values.
- If a chamber feed has never loaded, its seat totals remain unknown (dashes). A failed chamber refresh marks its previously known totals stale; the other chamber can still update.
- Races with no reported votes are shown as waiting, with dashes for vote shares. Source feed failures appear on the off-air sources page. A waiting race is not automatically called, including an uncontested race.
- Reduced-motion browser settings disable animated transitions.

Waiting states use candidate metadata from civicAPI. Reported and called states are also checked with explicit test fixtures.

## Sources and attribution

The off-air page at **[burger.perd.dev/sources](https://burger.perd.dev/sources)** lists chamber feed health, source update timestamps, and links to civicAPI race records. Include attribution in the stream description or accompanying credits:

> Election data and race calls: civicAPI, https://civicapi.org/. Calls are civicAPI projections, not AP calls or state certification. Data status: https://burger.perd.dev/sources.

The adapter uses the civicAPI v2 [Senate aggregate](https://civicapi.org/api/v2/race/87528) and [House aggregate](https://civicapi.org/api/v2/race/87524), following its [API documentation](https://civicapi.org/api-documentation). Use is free for personal and commercial projects with attribution. The adapter validates the election date, office, non-test status, complete 35/435 contest coverage, and candidate records before replacing a saved feed. It sums individual winner flags and excludes Senate holdovers. No early-vote turnout data is used.

Party symbols: [Font Awesome Free](https://fontawesome.com/), CC BY 4.0. Map: [us-atlas 3.0.1](https://github.com/topojson/us-atlas), ISC. Nunito: SIL Open Font License 1.1; the full license is in [public/fonts/OFL.txt](public/fonts/OFL.txt). Fonts and map graphics are bundled with the widget.

## Local development

This section is for running or changing the code. OBS users can use the hosted URLs above without these steps.

Requires Node.js 22.18 or newer and the Vite+ CLI (`vp`). Clone this repository and run the commands from its root directory.

### Node server

The local Node server needs no project dependencies, API key, or build step:

```sh
vp run start
```

Open <http://127.0.0.1:8787/>. Local-only modes are <http://127.0.0.1:8787/senate> and <http://127.0.0.1:8787/house>; local source status is <http://127.0.0.1:8787/sources>. To test these URLs in OBS, run the server on the same computer as OBS and keep it running. Set `PORT` before starting if port 8787 is already in use.

The Node server shares an in-memory cache only within that process. It does not use the hosted D1 database.

### Cloudflare preview and checks

Install the development tools and build once to generate runtime and binding types before checking the project:

```sh
vp install
vp run build
vp run check
vp run test
```

For a local Workers preview, initialize the local D1 schema and start the preview:

```sh
vpx cf d1 migrations apply 7ba4237a-ee8a-4c17-8fb2-35d44e41b716 --dir migrations --local --persist-to .cloudflare/state
vp run dev:cloud
```

The preview opens at <http://127.0.0.1:8793/> and supports the same `/senate`, `/house`, and `/sources` paths. Local and production databases are separate. Generated types, build output, and local database state live under ignored `.cloudflare/`.

## Cloudflare deployment

The production site is **[burger.perd.dev](https://burger.perd.dev/)**. Deployment is only needed when publishing code changes, not when adding the widget to OBS.

The hosted version uses Cloudflare Workers, Static Assets, and D1. `cloudflare.config.ts` is the deployment source of truth; Vite builds the Worker and copies `public/`. The frontend stays buildless in the local Node server. All interface and demo text is English.

`lib/shared-cache.mjs` stores the last successful snapshot and upstream chamber feeds in D1. A conditional SQL claim grants one updater a short lease, with at least 60 seconds between attempts across all Worker instances. Other viewers read saved results. Missing data and outages retain the last good values; late writers cannot overwrite a newer update. There is no public write endpoint.

The configuration targets the current owner's account, database, and domain. Deploying there requires access to that Cloudflare account. For your own deployment, change those values in `cloudflare.config.ts` and provision your own D1 database first.

With the development tools installed, sign in, apply schema changes to the configured production database, and deploy:

```sh
vpx cf auth login
vpx cf d1 migrations apply 7ba4237a-ee8a-4c17-8fb2-35d44e41b716 --dir migrations
vp run build
vp run check
vp run test
vp run deploy
```

Cloudflare usage is billed under the owning account's existing Workers/D1 plan. A concurrency test with 1000 callers verifies a single upstream refresh; it is not a production throughput guarantee. The original OpenPencil files and PNGs are design references, while `public/` and the standalone demo contain the English interface.

## Design files

- `usa-election-widget.fig`: editable design and state-zoom storyboard.
- `election-widget-demo.html`: the separate, self-contained animation demo with explicitly fictional values. It is not the live OBS source.
- `public/`: the live overlay and its local assets.
