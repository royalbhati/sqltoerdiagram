# SQL to ER Diagram

**A free, open-source online ERD generator.** Paste a SQL schema (`CREATE TABLE`
statements) → get a clean, interactive entity-relationship diagram.

![deps](https://img.shields.io/badge/runtime%20deps-dagre%20%2B%202%20fonts-blue) ![bundle](https://img.shields.io/badge/initial%20JS-39KB%20gzip-brightgreen)

**100% local · no signup · no upload.** It runs entirely in your browser, so your
schema never leaves your machine — no server, no backend. Live at
**[sqltoerdiagram.com](https://sqltoerdiagram.com)**.

## Why

Every other SQL-diagram tool is either paywalled, ugly, or slow. SQL to ER Diagram is
a single static page that stays smooth at **hundreds of tables**, edits your SQL
two-way, and shares a whole diagram in a single link — with no account and nothing
leaving your browser.

## Features

### Parse

- Standard `CREATE TABLE` / `ALTER TABLE` DDL across **PostgreSQL, MySQL, SQLite,
  SQL Server & Snowflake**.

### Visualize & navigate

- **Canvas renderer** with cached bitmaps + viewport culling — smooth at hundreds of
  tables (benchmarked **~120fps** while zooming 300 tables / 593 FKs).
- **Declutter dense schemas**: FK lines are soft by default; **hover** a table to
  highlight just its relationships, **click** to pin focus (fades every unrelated
  table and line), click empty space to clear.
- **Drag** tables, **scroll / pinch to zoom**, and pan.
- **Lines that go around tables**: relations are drawn as angled lines with rounded corners
  that steer around other tables instead of passing behind them (**Arrange ▾ → Lines** switches
  to smooth curves). Up to 200 tables; beyond that the lines stay angled but stop detouring.
- **Jump anywhere with ⌘K / Ctrl+K**: the command palette finds any table or column
  (`users`, `orders.user_id`) and flies the camera to it, and runs every app action.
- **Minimap**: an overview appears whenever part of the diagram is off-screen; click or
  drag it to move around (**M** toggles it).
- **Undo / redo everything** (⌘Z / ⇧⌘Z): table moves, canvas edits, notes, hidden
  tables, links and SQL typing share one history.

### Smart layout

- **Hub-aware layered auto-arrange**: the most-connected table is placed on one side
  with its related tables aligned beside it. **Horizontal / Vertical** direction and
  **Compact / Comfortable / Spacious** spacing live under the **Arrange ▾** menu.
- **Overlap-free**: auto-arrange runs a separation pass so no two tables overlap.
- **Never blocks the page**: layout runs in a Web Worker, and tables glide to their new
  positions (motion is skipped when the OS asks for reduced motion).
- **Your arrangement is saved**: positions and the camera persist automatically, so
  reloading restores your exact layout. Editing SQL keeps your manual positions —
  only brand-new tables get auto-placed beside the rest. **Arrange** re-runs layout
  on demand.

### Edit on the canvas → SQL updates

- **Double-click** a table name, column name, or column type to edit it inline. The
  change is applied as a *surgical text edit* (comments, formatting, and unsupported
  clauses are preserved), and a table rename updates every `REFERENCES` to it.
- **Add columns**: pin a table, then **+ add column**. The new column is inserted into
  your SQL with a default type for the selected **dialect** (PostgreSQL / MySQL /
  SQLite / SQL Server / Snowflake) and opens inline so you can name it. Editing a
  column type shows dialect-aware suggestions.

### Read the details

- **Hover a column** for what the compact card can't show: full type, nullability, default,
  indexes, the table it references, enum values and its comment.
- Parsed from SQL: `COMMENT ON TABLE/COLUMN`, MySQL inline `COMMENT '…'`,
  `CREATE TYPE … AS ENUM`, `CREATE [UNIQUE] INDEX` and MySQL `KEY` lines.
- **Colour tables** from the right-click menu (applies to the whole selection); colours are
  saved, shared and exported.
- Clicking or hovering a table also tints the exact columns each highlighted relation joins.

### Annotate

- A bottom-left palette adds **sticky notes** and **group boxes** to label and cluster
  sections. Drag to move, drag the corner to resize, double-click to edit text, click
  to select (colour swatches + delete), or press Delete. They're part of the diagram —
  included in saves, share links, and PNG/SVG exports.

### Bring a schema in

- **Paste or type** SQL, Prisma, DBML, Mermaid or PlantUML — or ORM models: SQLAlchemy,
  Django (`models.py`), Sequelize and TypeORM (decorator entities). The format is detected
  automatically.
- **Drop a file** anywhere on the page.
- **Import from a live database** (File → Import from database…): copy one read-only
  catalog query for PostgreSQL, MySQL/MariaDB, SQLite or SQL Server, run it in your own
  client, and paste the result. It reads table/column/key names only, and nothing leaves
  the browser.

### Diagrams & versions

- **My diagrams**: keep several named diagrams in this browser and switch between them
  from the title in the top bar. A share link opens as its own diagram instead of
  replacing the one you were working on.
- **Version history**: snapshots are taken automatically every few minutes while you make
  changes, and you can name one any time. Restore (undoable) or compare any version.
- **Compare & migrate**: diff the current schema against an earlier version or pasted SQL —
  a plain-language change list plus migration SQL (`ALTER TABLE …`) for PostgreSQL, MySQL,
  SQLite, SQL Server or Snowflake.

### Save, share & export

- **Save / Open projects**: **Save** downloads a `.json` project (SQL + layout + camera
  + dialect); **Open** loads one back.
- **Share link**: **Share** copies a URL with the entire project encoded in the hash —
  gzip-compressed + base64. The `#…` fragment is never sent to a server, so sharing
  needs **no backend**, and opening the link restores the exact diagram.
- **Export** to **PNG** (raster, optionally with a transparent background) and **SVG**
  (vector), or **copy the diagram as a PNG** straight to the clipboard.
- **Snapshot** (Export → Snapshot…): a share-ready picture of the diagram on a gradient,
  plain or transparent backdrop, with an optional title — copy it, download it, or send it
  through the system share sheet where the browser supports that.
- **Convert between databases**: export the schema as `CREATE TABLE` DDL for PostgreSQL,
  MySQL, SQLite, SQL Server or Snowflake, with column types translated (e.g. `jsonb` →
  `json`, `tinyint(1)` → `boolean`); unrecognised types pass through unchanged.
- **Open anything**: drop a `.sql` / Prisma / DBML / Mermaid / PlantUML file or a saved
  project anywhere on the page, or paste a schema with the canvas focused.
- **Works offline**: a service worker caches the app after the first visit.

### Editor & appearance

- **Parse problems are pointed out, not swallowed**: anything that couldn't be read
  (an unclosed table, `CREATE TABLE … AS`, a foreign key to a table that isn't defined)
  gets a squiggly underline and is listed in the status bar — click an issue to jump to
  its line.

- **Syntax-highlighted SQL editor**: keywords / types / strings / comments / numbers
  are colored via a paint layer behind the textarea. Re-tokenizing is a single linear
  pass coalesced to one animation frame, so typing stays instant (~6ms full repaint on
  a 45KB / 300-table script, sub-ms on normal schemas).
- **Hide the SQL panel** (⬚ in the toolbar) for a full-width diagram.
- **Six themes** (Midnight, Tokyo Night, Nord, Dracula, Daylight, Solarized Light) from the
  theme button; the canvas, editor and exports all follow. It remembers your last schema locally.

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173
```

## Build & host

```bash
npm run build    # outputs static files to dist/
npm run preview  # preview the production build locally
```

`dist/` is plain static HTML/JS/CSS — drop it on any static host:

- **GitHub Pages** — push `dist/` to a `gh-pages` branch, or use an action.
- **Netlify / Vercel / Cloudflare Pages** — build command `npm run build`, publish dir `dist`.
- **Any web server / S3 bucket** — just upload the contents of `dist/`.

## Supported SQL

- `CREATE [OR REPLACE] [TEMPORARY | TRANSIENT] TABLE [IF NOT EXISTS] name ( ... )` with quoted / backtick / `[bracket]` / `schema.qualified` names.
- Inline column constraints: `PRIMARY KEY`, `NOT NULL`, `UNIQUE`, `REFERENCES other(col)`.
- Table-level constraints: `PRIMARY KEY (...)`, `UNIQUE (...)`,
  `FOREIGN KEY (...) REFERENCES other(...)`, `CONSTRAINT ... FOREIGN KEY ...`.
- `ALTER TABLE [ONLY] x ADD [CONSTRAINT ...] FOREIGN KEY (...) REFERENCES y(...)`, and
  `… ADD [CONSTRAINT ...] PRIMARY KEY (...)` / `UNIQUE (...)` — the way `pg_dump` declares keys.
- Multi-word types: `character varying(n)`, `double precision`, `timestamp with time zone`.
- Line (`--`, `#`) and block (`/* */`) comments are ignored.

## BigQuery

Select **BigQuery** from the dialect dropdown to work with BigQuery SQL instead of DDL.

- Paste a raw `WITH … AS (…)` query — no `CREATE TABLE` statements needed. Each CTE becomes a table node in the diagram.
- Column names are extracted from the `SELECT` list of each CTE (using aliases where present).
- Relationships are inferred automatically from `FROM` and `JOIN` references: a CTE that reads from another CTE gets an edge between them, and references to base tables create stub nodes connected to the CTE.
- Backtick-quoted three-part names (`project.dataset.table`) are supported — the table portion is used as the node label.

## Tests

```bash
npm test
```

Runs the edit round-trip tests, unit tests for undo history / palette ranking / parse
warnings / layout, and a **parser regression corpus**: every schema in `test/fixtures`
(pg_dump, mysqldump, SQLite, SQL Server, Snowflake, Oracle, Prisma, DBML, Mermaid,
PlantUML, SQLAlchemy, Sequelize) is parsed and compared with `test/fixtures/snapshot.json`.
After an intentional parser change, review the diff and run
`node test/parse.test.mjs --update`.

## Limits worth knowing

- Diagrams and versions live in this browser's `localStorage` (about 5 MB). Version history
  is capped per diagram and sheds its oldest automatic snapshots first. Use **Save project**
  for a real backup.
- Migration SQL treats a rename as a drop + add, and can't name a dropped foreign-key
  constraint — both are called out in the generated script.
- The MySQL and SQL Server import queries are written against their documented catalogs but
  have only been exercised here against PostgreSQL and SQLite.

## Tech

- **Vite** — build + dev server.
- **@dagrejs/dagre** — layered auto-layout, run in a Web Worker (it never ships in the
  main bundle).
- Non-SQL parsers, exporters and the visual editor are separate chunks loaded on first use.
- Custom canvas renderer + SQL DDL parser (no heavy SQL-parser dependency).

## Shortcuts

| Key | Action |
| --- | --- |
| **⌘ / Ctrl + K** or **/** | Search tables, columns and actions |
| **⌘ / Ctrl + Z**, **⇧⌘Z** / **Ctrl + Y** | Undo, redo |
| **⌘ / Ctrl + Enter** | Re-arrange |
| **F** | Fit diagram to screen |
| **M** | Toggle the minimap |
| **+** / **−** | Zoom in / out |
| **H** | Hide the selected tables |
| **Double-click** canvas | Zoom in |
| Drag the pane divider | Resize the editor |

## License

[MIT](./LICENSE) © Royal Bhati. Fork it, self-host it, add your own SQL dialects — go for it.
