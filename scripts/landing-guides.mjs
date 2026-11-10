// Long-form, genuinely unique guide copy per landing page slug.
// Each entry is rendered inside a <section> on that page. Write for the
// human who pasted their schema and wants to get something done — not for
// the crawler. Every paragraph must be specific to that page's topic.

export const GUIDES = {
  prisma: `
      <p>Prisma schemas describe your database twice over: once in the <code>model</code> blocks and once in the <code>@relation</code> attributes that wire them together. This tool reads both. A model becomes a table node with all of its scalar fields; a field annotated with <code>@relation(fields: [authorId], references: [id])</code> becomes a drawn edge from the current model to the target model, with the correct one-to-many or one-to-one crow's-foot.</p>
      <p>A few things worth knowing before you paste:</p>
      <ul>
        <li><strong>Implicit many-to-many</strong> — when you write <code>posts Post[]</code> on one side and <code>author User[]</code> on the other without an explicit relation, Prisma creates a hidden <code>_PostToUser</code> join table. The diagram draws a many-to-many edge directly between the two models, which is usually what you want to see.</li>
        <li><strong>Enums and types</strong> — <code>enum</code> blocks are attached to the fields that use them, so you can read them straight off the table node.</li>
        <li><strong>Multi-file schemas</strong> — if you split your schema across files (Prisma's <code>schema/</code> folder with <code>prismaSchemaFolder</code>), concatenate the files in any order and paste the result; models are matched by name.</li>
      </ul>
      <p>A common use case: you inherit a codebase, paste <code>schema.prisma</code>, and within seconds you can see whether the <code>User ↔ Profile</code> relation is one-to-one, which models are orphans with no relations at all, and where a join table was hand-rolled instead of using an implicit relation. Export the PNG and drop it into your team's onboarding doc.</p>`,
  mysql: `
      <p>MySQL dumps are noisy — that's fine here. The parser reads <code>CREATE TABLE</code> bodies and ignores everything else, so you can paste the raw output of <code>mysqldump --no-data</code> including the <code>SET</code> lines, <code>LOCK TABLES</code> comments, and <code>ENGINE=InnoDB AUTO_INCREMENT=17 DEFAULT CHARSET=utf8mb4</code> table options without cleaning anything up.</p>
      <h3>MySQL-specific things that are handled</h3>
      <ul>
        <li><code>AUTO_INCREMENT</code>, <code>UNSIGNED</code>, <code>ZEROFILL</code> and display widths like <code>INT(11)</code>.</li>
        <li>Inline <code>FOREIGN KEY … REFERENCES</code> clauses and named constraints alike.</li>
        <li>Backtick-quoted identifiers: <code>CREATE TABLE \`order items\`</code>.</li>
        <li><code>KEY</code> / <code>INDEX</code> lines are recognised but kept out of the way — the diagram is about tables and relations, not indexes.</li>
      </ul>
      <p>If your schema has no foreign keys declared (common in legacy MySQL apps that enforce relations in application code), render it anyway and then hit <strong>Infer links</strong> in the toolbar — it matches columns by naming convention (<code>customer_id</code> → <code>customers.id</code>) so you still get a connected diagram.</p>`,
  postgresql: `
      <p>Postgres is the dialect people have the most trouble diagramming, for one reason: <code>pg_dump</code> doesn't put foreign keys where you expect. It emits each table with <code>ALTER TABLE ONLY orders ADD CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id)</code> — sometimes thousands of lines away from the <code>CREATE TABLE</code>. This parser collects those <code>ALTER TABLE</code> statements and stitches them back onto the right tables, so a full <code>pg_dump --schema-only</code> paste comes out complete.</p>
      <h3>Postgres features the parser understands</h3>
      <ul>
        <li><code>SERIAL</code>, <code>BIGSERIAL</code>, <code>GENERATED … AS IDENTITY</code>, and <code>GENERATED ALWAYS AS (…) STORED</code> columns.</li>
        <li>Schema-qualified names — <code>public.customers</code> is shown as <code>customers</code>.</li>
        <li><code>CREATE TYPE … AS ENUM</code> usage on columns, arrays like <code>TEXT[]</code>, <code>JSONB</code>, <code>UUID</code>, <code>TIMESTAMPTZ</code>.</li>
        <li>Composite primary keys via <code>PRIMARY KEY (a, b)</code>, and <code>ON DELETE CASCADE</code> actions.</li>
      </ul>
      <p>Only need one schema from a multi-schema database? Filter the dump first: <code>pg_dump --schema-only --no-owner --no-privileges -n myschema your_db</code>. The smaller paste renders faster and the diagram stays readable.</p>`,
  sqlite: `
      <p>SQLite is the easiest dialect to diagram because the database itself can print the schema: open your file with <code>sqlite3 app.db</code> and run <code>.schema</code>. Copy everything — the output is exactly the <code>CREATE TABLE</code> / <code>CREATE INDEX</code> statements this tool parses, including the inline <code>REFERENCES customers(id)</code> column constraints SQLite favours.</p>
      <p>Things worth knowing:</p>
      <ul>
        <li><strong>Foreign keys may be missing from the DDL.</strong> Many SQLite schemas rely on naming convention instead of declared constraints. Paste the schema, then use <strong>Infer links</strong> to draw edges for <code>user_id</code>-style columns.</li>
        <li><code>PRAGMA foreign_key_list(t);</code> is a quick way to double-check which relations the database itself knows about, if the diagram looks sparser than expected.</li>
        <li>Quirks like <code>INTEGER PRIMARY KEY AUTOINCREMENT</code>, <code>WITHOUT ROWID</code>, <code>ON CONFLICT</code> clauses and double-quoted identifiers all parse.</li>
      </ul>
      <p>This is a handy step when documenting an app that ships an embedded database — Electron apps, mobile apps, local-first tools. Render the diagram once, export an SVG, and commit it next to the migration files so the picture can't drift from reality.</p>`,
  'sql-server': `
      <p>The fastest path from SQL Server to a diagram: in SSMS, right-click the database → <strong>Tasks → Generate Scripts</strong>, choose the tables you want, and on the Scripting Options page set <em>Script Data = False</em> and <em>Script Indexes = False</em> (indexes just add noise). Paste the resulting file. The parser handles everything T-SQL-specific about that output: <code>[dbo].[customers]</code> bracket-quoting, <code>IDENTITY(1,1)</code>, <code>NVARCHAR(MAX)</code>, named <code>CONSTRAINT FK_…</code> blocks, and the <code>GO</code> batch separators.</p>
      <p>If you prefer a query over a wizard, script the DDL yourself:</p>
      <pre>SELECT OBJECT_DEFINITION(f.object_id) FROM sys.foreign_keys f;</pre>
      <p>— or just paste your hand-written <code>CREATE TABLE</code> scripts; nothing needs to be pretty. Azure SQL Database and Synapse output works the same way. One tip: generate only the tables you actually want on the diagram. A 400-table ERP paste renders, but a 30-table slice of the sales schema is far more useful in a design review.</p>`,
  dbml: `
      <p>DBML (Database Markup Language) is the DSL behind dbdiagram.io, dbdocs and dbml-cli, and it was designed to be read by humans — which makes it a great input for a diagram. This page renders DBML the way dbdiagram does, but interactive: drag tables, hide the ones you don't care about, zoom, and export.</p>
      <h3>DBML syntax that's supported</h3>
      <ul>
        <li><code>Table</code> blocks with <code>[pk, increment]</code>, <code>[unique]</code>, <code>[not null]</code> and <code>[default: …]</code> settings.</li>
        <li>Standalone <code>Ref: orders.customer_id &gt; customers.id</code> lines and inline <code>[ref: &gt; users.id]</code> column settings — both one-to-many (<code>&gt;</code>) and one-to-one (<code>-</code>).</li>
        <li>Multi-column relations: <code>Ref: t.(a,b) &gt; u.(a,b)</code>.</li>
        <li><code>Enum</code> definitions attached to the columns that use them.</li>
      </ul>
      <p>Styling directives like <code>headercolor</code> and <code>TableGroup</code> blocks are safely skipped. If you're migrating off dbdiagram.io (pricing change, offline need, or you just want the data to stay local), paste your project here — the whole diagram renders client-side, and you can export back to SQL, Mermaid, PlantUML, PNG or SVG.</p>`,
  mermaid: `
      <p>Mermaid <code>erDiagram</code> blocks are everywhere — GitHub READMEs, GitLab wikis, Notion pages, Obsidian notes — but the default renderer gives you a static picture you can't touch. Paste the same block here and you get a live canvas: every entity becomes a draggable table, every relationship keeps its crow's-foot cardinality, and you can export the result as an image or convert it to DBML or PlantUML.</p>
      <h3>Cardinality notation reference</h3>
      <ul>
        <li><code>||--o{</code> — exactly one to zero-or-many (the classic parent-child).</li>
        <li><code>||--||</code> — one to exactly one.</li>
        <li><code>}o--o{</code> — zero-or-more to zero-or-more (many-to-many).</li>
        <li>Attribute keys: <code>PK</code>, <code>FK</code>, and <code>UK</code> markers on attribute lines are rendered as key badges.</li>
      </ul>
      <p>Entities defined only by relationship lines (no attribute block) render as compact nodes — useful when your diagram is at the "sketch" stage. Comments in double quotes after the relationship (<code>: "places"</code>) are kept as edge labels.</p>`,
  sqlalchemy: `
      <p>SQLAlchemy has two shapes of model code and both paste fine here: the classic <code>Column(Integer, primary_key=True)</code> declarative style, and the 2.0 typed style with <code>Mapped[int]</code> and <code>mapped_column(...)</code>. Tables come from <code>__tablename__</code> (or the class name if you omit it), columns from the <code>Column</code>/<code>mapped_column</code> calls, and every <code>ForeignKey("users.id")</code> — including composite <code>ForeignKey("t.a"), ForeignKey("t.b")</code> pairs — becomes a drawn relation.</p>
      <p>What the parser deliberately ignores: <code>relationship()</code> back-references (the FK is what's drawn — <code>relationship</code> is Python-side only), hybrid properties, and methods. Nothing is executed; the models are read as text, so imports, custom base classes and decorators are all fine.</p>
      <p>If your project uses Alembic, an even more exact route is <code>alembic upgrade head --sql</code> to print raw DDL and paste that instead — it captures server defaults and indexes the models don't show. But for most apps, pasting <code>models.py</code> directly is the two-second path to a diagram for your README or design doc.</p>`,
  sequelize: `
      <p>Sequelize models can be defined three ways — <code>sequelize.define('User', {...})</code>, <code class="nowrap">class User extends Model {}</code> + <code>User.init({...})</code>, or the old <code>sequelize.import</code> — and this page reads all of them as plain text. Attribute names come from the object keys, types from the <code>DataTypes</code> values, and <code>primaryKey: true</code>, <code>unique: true</code>, <code>allowNull: false</code> are picked up as key/constraint badges.</p>
      <p>Relations are drawn from your associations: <code>Post.belongsTo(User)</code> and <code>User.hasMany(Post)</code> both produce the same edge (the foreign key is what matters), <code>belongsToMany</code> through a model renders as many-to-many via the join table, and alias options like <code>{ as: 'author', foreignKey: 'author_id' }</code> are respected when naming the edge.</p>
      <p>An alternative that captures the real database: call <code>await sequelize.sync({ logging: console.log })</code> once against a scratch database and paste the logged <code>CREATE TABLE</code> SQL instead. That shows exactly what Sequelize would build, including the join tables it creates implicitly for <code>belongsToMany</code>.</p>`,
  typeorm: `
      <p>TypeORM entities are decorators over classes — <code>@Entity()</code>, <code>@PrimaryGeneratedColumn()</code>, <code>@Column()</code>, <code>@ManyToOne(() =&gt; User, u =&gt; u.posts)</code> — and while this page works from the SQL TypeORM generates, that's the more reliable path anyway: the generated SQL is the ground truth of what's in your database, including column types resolved from your database driver, explicit constraint names, and join tables created by <code>@ManyToMany(() =&gt; Tag, tag =&gt; tag.posts)</code>.</p>
      <p>The two easiest ways to get that SQL:</p>
      <ul>
        <li><strong>Migrations:</strong> <code>npx typeorm migration:generate -d ./migrations MyFirstMigration</code>, then paste the <code>CREATE TABLE</code> statements from the generated file.</li>
        <li><strong>Synchronize logging:</strong> set <code>logging: true</code> in your DataSource options (or <code>synchronize: true</code> in dev) and copy the schema-sync SQL from the console at startup.</li>
      </ul>
      <p>Both produce standard Postgres/MySQL DDL with <code>ALTER TABLE … ADD CONSTRAINT</code> foreign keys, which the parser stitches back onto the right tables. NestJS projects work identically — the entities are plain TypeORM under the hood.</p>`,
  django: `
      <p>Django doesn't have a schema file to paste — your models live in Python — but it can print the exact SQL it will run, and that's what you paste here. Run <code>python manage.py sqlmigrate yourapp 0001</code> for the initial migration (or <code>sqlmigrate</code> on whichever migration created the tables you care about) and copy the output: <code>CREATE TABLE "blog_post"</code> with an <code>REFERENCES "blog_author"("id")</code> foreign key, ready to diagram.</p>
      <p>Tips for multi-app projects:</p>
      <ul>
        <li>Run <code>sqlmigrate</code> once per app and paste the outputs together — tables link up by their foreign keys automatically, and the <code>appname_</code> table prefixes keep the diagram readable.</li>
        <li><code>ForeignKey</code> becomes a drawn relation; <code>ManyToManyField</code> shows up as the auto-created join table (<code>blog_post_tags</code>) exactly as Django builds it.</li>
        <li>If you use <code>django-extensions</code>, the <code>graph_model</code> command is an alternative — but its output is static dot/PyGraphviz, while this renders interactive and exportable.</li>
      </ul>
      <p>The result reflects the real database Django creates — including the <code>id BIGINT PRIMARY KEY</code> auto-pk and <code>_id</code> column naming — so it's accurate even when your models use custom <code>db_table</code> or <code>related_name</code> tricks.</p>`,
  'sql-to-mermaid': `
      <p>The export maps your SQL one-to-one onto Mermaid's <code>erDiagram</code> grammar: each <code>CREATE TABLE</code> becomes an entity block, columns keep their types, <code>PRIMARY KEY</code> / <code>FOREIGN KEY</code> / <code>UNIQUE</code> become <code>PK</code> / <code>FK</code> / <code>UK</code> markers, and each foreign key becomes a relationship line with the right cardinality — <code>||--o{</code> for a plain one-to-many, <code>||--||</code> for a unique foreign key.</p>
      <p>Where the output works: GitHub and GitLab Markdown (fenced as a <code>mermaid</code> code block), Notion code blocks, Obsidian, GitBook, MkDocs with <code>mkdocs-material</code>, and the Mermaid Live Editor. If your target renderer chokes on something, the usual culprit is an exotic column type — rename it to a simple word (<code>string</code>, <code>int</code>) in the export and it will render anywhere.</p>
      <p>Why convert via a diagram tool instead of by hand: the live preview catches mistakes before you paste. If the edge between <code>orders</code> and <code>customers</code> looks wrong on the canvas, the Mermaid will be wrong too — fix the SQL, re-export. The canvas is the proof, the export is the artifact.</p>`,
  'prisma-to-dbml': `
      <p>The conversion follows DBML's semantics: a Prisma <code>model</code> becomes a <code>Table</code>, <code>@id</code> becomes <code>[pk]</code>, <code>@default(autoincrement())</code> becomes <code>[increment]</code>, <code>@unique</code> becomes <code>[unique]</code>, and each <code>@relation(fields: [authorId], references: [id])</code> becomes a standalone <code>Ref: "Post"."authorId" &gt; "User"."id"</code> line. Scalar lists (<code>String[]</code>) and enums carry over as column types.</p>
      <p>Why you'd want this: DBML is the interchange format for dbdiagram.io, dbdocs.io and the <code>@softwaretechnik/dbml-renderer</code> CLI. Converting your <code>schema.prisma</code> to DBML lets you paste the schema into dbdiagram for pretty static renders, publish dbdocs documentation, or diff schemas textually. The conversion runs entirely in your browser — the schema never touches a server, which matters when the schema contains real customer table names.</p>
      <p>Check the live diagram before you copy the export: if a relation is missing on the canvas, the <code>@relation</code> was probably implicit on both sides, and the DBML will contain a many-to-many edge rather than a hidden join table — which is usually the honest representation.</p>`,
  'dbml-to-er-diagram': `
      <p>This is the dbdiagram-style rendering flow, without the account: export your DBML from dbdiagram.io (<strong>Export → DBML</strong>), or grab any <code>.dbml</code> file from your repo, paste it here, and the diagram appears immediately. From there it diverges from dbdiagram in useful ways:</p>
      <ul>
        <li><strong>You can rearrange by hand.</strong> Drag tables into domain groups — the auto-layout is a starting point, not a cage.</li>
        <li><strong>You can hide tables.</strong> Presenting the billing schema? Hide the other 80 tables and screenshot only what matters.</li>
        <li><strong>Exports go both ways.</strong> PNG and SVG for docs, but also Mermaid for Markdown and PlantUML for Confluence — DBML in, any format out.</li>
      </ul>
      <p>Everything runs locally: the paste, the parse, the render. For internal schemas at companies with strict data policies, that's the reason this page exists — no upload step to argue with security about. The share link (if you use it) encodes the whole diagram in the URL fragment itself; there's no database on the other end holding your schema.</p>`,
  'mermaid-to-erd': `
      <p>Mermaid renders your <code>erDiagram</code> as a fixed SVG — you take what the layout engine gives you. Paste the same block here and it becomes a real ERD canvas: entities are tables you can drag into place, relationships re-route as you move things, and the whole picture stays consistent when you edit it.</p>
      <p>The typical flow: copy the <code>erDiagram</code> out of your README or design doc, paste, untangle the layout (auto-arrange first, then drag the exceptions), and export an SVG that actually fits the slide. Along the way you can convert the Mermaid into DBML — handy when the sketch graduated into a real schema that lives in a DBML-based tool.</p>
      <p>Supported syntax: all nine cardinality combinations (<code>||</code>, <code>o|</code>, <code>}o</code>, <code>||</code>… on both ends), attribute blocks with <code>PK</code>/<code>FK</code>/<code>UK</code> key markers, quoted relationship labels, and entities referenced before they're defined. If your block renders in GitHub, it will parse here — the grammar is the same, the output is just editable.</p>`,
  oracle: `
      <p>Oracle schemas reach you in a few dialects of DDL and all of them parse here. The two common sources: SQL Developer's export (right-click the schema → <strong>Export</strong>, format SQL, data = no), and <code>SELECT DBMS_METADATA.GET_DDL('TABLE', t.table_name) FROM user_tables t;</code> which prints <code>CREATE TABLE</code> statements directly. Paste either, including the <code>ALTER TABLE … ADD CONSTRAINT</code> blocks that follow.</p>
      <h3>Oracle-isms that are handled</h3>
      <ul>
        <li><code>NUMBER(38,0)</code>, <code>VARCHAR2</code>, <code>RAW</code>, <code>CLOB</code>/<code>BLOB</code>, and <code>TIMESTAMP(6) WITH TIME ZONE</code>.</li>
        <li>Identity columns: <code>GENERATED BY DEFAULT AS IDENTITY</code> (12c+) and legacy <code>SEQUENCE</code>-based keys.</li>
        <li>Double-quoted identifiers, <code>TABLESPACE</code>/<code>STORAGE</code> clauses, and <code>PCTFREE</code> noise — parsed or skipped cleanly.</li>
      </ul>
      <p>A practical tip for big ERP-style schemas: export only the modules you're diagramming. Oracle instances routinely have thousands of tables across owners; a focused paste of, say, the <code>AP</code> and <code>AR</code> tables gives a diagram a finance team can actually read. And since nothing is uploaded, it's safe for schemas whose table names are sensitive.</p>`,
  mariadb: `
      <p>MariaDB speaks MySQL's DDL dialect, so everything on the MySQL path works identically: <code>mysqldump --no-data</code> (the MariaDB client ships the same tool), paste, done. The parser additionally tolerates MariaDB-specific syntax you'll hit in the wild: <code>UUID()</code> column defaults, <code>DEFAULT (UUID())</code> expressions, <code>SYSTEM VERSIONED</code> temporal tables, and the <code>json</code> type (which is an alias for <code>LONGTEXT</code> under the hood — shown as <code>json</code> on the diagram, as you'd expect).</p>
      <p>Storage-engine table options (<code>ENGINE=Aria</code>, <code>ENGINE=ColumnStore</code>, <code>ENGINE=InnoDB</code>) are ignored gracefully — they don't belong on an ER diagram anyway. If you're migrating MariaDB → PostgreSQL and want a before/after picture, diagram both sides and export matching SVGs; the visual diff of missing relations is often faster to read than any schema-diff tool output.</p>
      <p>And as with MySQL: schemas without declared foreign keys (relations enforced in app code) still diagram fine — use <strong>Infer links</strong> to draw the <code>_id</code> conventions as edges.</p>`,
  snowflake: `
      <p>Warehouse DDL has its own shape and this page speaks it. The canonical way to get Snowflake DDL: <code>SELECT GET_DDL('TABLE', 'customers');</code> in a worksheet — or for a whole schema, <code>SELECT GET_DDL('SCHEMA', 'analytics');</code>. Paste the output; <code>CREATE OR REPLACE TABLE</code>, <code>CREATE TRANSIENT TABLE</code>, cluster-by clauses and <code>COMMENT = '…'</code> strings all parse or get skipped cleanly.</p>
      <h3>Snowflake types on the diagram</h3>
      <ul>
        <li>Semi-structured columns — <code>VARIANT</code>, <code>OBJECT</code>, <code>ARRAY</code> — render as-is so you can spot where the JSON lives.</li>
        <li><code>NUMBER(38,0)</code> defaults, <code>TIMESTAMP_NTZ / _LTZ / _TZ</code>, and <code>BOOLEAN</code>.</li>
        <li>Foreign keys are usually only declared in the <code>INFORMATION_SCHEMA</code> if your ELT tool wrote them — if the diagram shows no edges, the constraints genuinely don't exist; use <strong>Infer links</strong> for convention-based ones.</li>
      </ul>
      <p>This is popular with analytics teams documenting dbt sources: paste the raw source tables, export SVG, and drop it next to the dbt docs. Since the paste never leaves the browser, production warehouse DDL is safe to run through it.</p>`,
  bigquery: `
      <p>This page does something the others don't: it diagrams <em>queries</em>, not just schemas. Paste a BigQuery <code>WITH … AS (…)</code> statement and each CTE becomes a node on the canvas — its columns inferred from the <code>SELECT</code> list — with edges drawn to every table or CTE it reads from, including backtick-quoted <code>project.dataset.table</code> references. It's a dependency graph of your query, laid out and exportable.</p>
      <p>For schema diagrams, grab real DDL from <code>INFORMATION_SCHEMA</code>:</p>
      <pre>SELECT ddl FROM \`mydataset.INFORMATION_SCHEMA.TABLES\` t
JOIN \`mydataset.INFORMATION_SCHEMA.TABLES_DDL_QUERY\` …</pre>
      <p>— or simply <code>bq show --schema --format=prettyjson</code> per table and paste the <code>CREATE TABLE</code> form. Standard types (<code>STRING</code>, <code>INT64</code>, <code>NUMERIC</code>, <code>STRUCT</code>, <code>ARRAY&lt;STRUCT&lt;…&gt;&gt;</code>) render on the nodes.</p>
      <p>Note that BigQuery doesn't enforce foreign keys — so a pure DDL paste gives you tables without edges. That's honest: use <strong>Infer links</strong> to draw the <code>_id</code> conventions, or diagram the CTE query that joins them to see the real relationships in use.</p>`,
  plantuml: `
      <p>PlantUML's entity and class diagrams have been the default way to put an ERD in a wiki for a decade — but rendering them requires the PlantUML jar, a Java runtime, or a round-trip to the public PlantUML server. This page renders them client-side: paste your <code>@startuml … @enduml</code> block and get an interactive canvas instead of a fixed image.</p>
      <h3>What's supported</h3>
      <ul>
        <li><code>entity users { * id : int … }</code> blocks — the <code>*</code> mandatory marker becomes a NOT-NULL badge, types carry over.</li>
        <li>Class-diagram style <code>class users { id : int }</code> blocks (common in older diagrams).</li>
        <li>Relationship connectors with IE crow's-foot notation: <code>users ||--o{ orders</code>, plus <code>--</code> plain associations.</li>
      </ul>
      <p>Skinparam, theme and <code>hide circle</code> directives are skipped — they're render hints, not schema. The point isn't to replace PlantUML for every diagram type; it's that when the diagram is <em>about your database</em>, you should be able to drag a table two inches to the left without re-running a render pipeline. Export SVG/PNG when you're happy, or convert to Mermaid/DBML to move the schema into a different toolchain.</p>`,
  'ddl-to-er-diagram': `
      <p>DDL — <code>CREATE TABLE</code>, <code>ALTER TABLE</code>, <code>ADD CONSTRAINT</code> — is the most complete description of a schema that exists, and this page turns any dialect of it into a diagram. The reason this page exists separately from the per-database pages: real-world DDL is dialect soup. A migration folder might contain Postgres DDL; a vendor handover might include a SQL Server <code>.sql</code> script with <code>GO</code> batches; an ORM might emit SQLite-flavoured DDL. Paste any of them, or a mixture — the parser handles inline <code>REFERENCES</code>, named <code>CONSTRAINT fk_… FOREIGN KEY</code> blocks, and the <code>ALTER TABLE</code>-after-the-fact style that <code>pg_dump</code> produces.</p>
      <p>Good sources of DDL you already have:</p>
      <ul>
        <li>Your migrations folder — every framework's migrations are just DDL with extra steps.</li>
        <li><code>pg_dump --schema-only</code>, <code>mysqldump --no-data</code>, SSMS "Generate Scripts", <code>sqlite3 .schema</code>.</li>
        <li>Terraform/Infrastrucure repos that manage databases declaratively.</li>
      </ul>
      <p>Statements that don't affect the diagram — <code>CREATE INDEX</code>, <code>GRANT</code>, <code>INSERT</code>, <code>CREATE VIEW</code> — are skipped without complaint, so whole dump files paste fine.</p>`,
  'sql-to-dbml': `
      <p>The conversion is deliberately boring and predictable: <code>CREATE TABLE users</code> becomes <code>Table users</code>, column types are normalised to DBML's style (<code>SERIAL</code> → <code>serial</code> with <code>[pk, increment]</code>), <code>NOT NULL</code> becomes <code>[not null]</code>, <code>UNIQUE</code> becomes <code>[unique]</code>, and each foreign key — whether inline or in an <code>ALTER TABLE</code> — becomes a <code>Ref:</code> line. Nothing is invented, nothing is dropped silently.</p>
      <p>Why people convert SQL to DBML:</p>
      <ul>
        <li><strong>dbdiagram.io import</strong> — DBML is its native format; paste and it renders.</li>
        <li><strong>Readable diffs</strong> — a 400-line DDL dump becomes a 400-line DBML file that reads like documentation and reviews well in PRs.</li>
        <li><strong>Toolchain entry</strong> — dbml-cli, dbdocs and several schema tools speak DBML, so it's the interchange step out of a raw dump.</li>
      </ul>
      <p>The live diagram on this page is the verification step: if the canvas shows the relations you expect, the DBML contains them too — both come from the same parse. Export, copy, done. And since the conversion is client-side, production dumps with real table and column names never leave your machine.</p>`,
  'sql-to-plantuml': `
      <p>The export produces a classic PlantUML entity diagram: each table becomes an <code>entity</code> block with a <code>*</code>-marked primary key and typed fields, and each foreign key becomes a crow's-foot connector (<code>users ||--o{ posts</code>). It's the notation your Confluence, XWiki, AsciiDoc or Doxygen setup already renders — no new toolchain to adopt.</p>
      <p>Where people take the output:</p>
      <ul>
        <li>Confluence pages with the PlantUML macro — paste, save, done.</li>
        <li>READMEs rendered through <code>plantuml</code> GitHub Actions or pre-commit renderers.</li>
        <li>VS Code with any PlantUML preview extension for a local render loop.</li>
      </ul>
      <p>The difference from generating PlantUML by hand or with a script: the live diagram here verifies the relationships before you commit the artifact. A wrong join shows up as a wrong crow's-foot immediately. And if PlantUML turns out to be the wrong target — your docs move to Markdown, say — the same parse exports Mermaid and DBML too. One paste, three notations, all client-side.</p>`,
  'dbml-to-mermaid': `
      <p>This conversion maps DBML's relational model onto Mermaid's <code>erDiagram</code> grammar: each <code>Table</code> becomes an entity block, <code>[pk]</code>/<code>[unique]</code>/<code>[ref:</code> settings become <code>PK</code>/<code>UK</code>/<code>FK</code> attribute markers, and each <code>Ref:</code> line becomes a relationship with matching cardinality — a one-to-many <code>&gt;</code> ref becomes <code>||--o{</code>, a one-to-one <code>-</code> ref becomes <code>||--||</code>.</p>
      <p>The destination matters: Mermaid renders natively in GitHub, GitLab, Notion, Obsidian and most static-site generators. Converting DBML → Mermaid is how you take a schema that lives in a DBML toolchain (dbdiagram, dbdocs) and put it in a README that must render without JavaScript or images — Mermaid blocks are text, so they diff, review and survive repo moves.</p>
      <p>As with every export on this site, the live diagram is the proof: what you see on the canvas before copying is exactly what the Mermaid encodes, because both come from the same parse. If a <code>Ref</code> is missing from the render, it was missing from the DBML — fix it once, export again.</p>`,
  'dbml-viewer': `
      <p>A viewer, not an editor: paste DBML — from dbdiagram.io's export dialog, a <code>.dbml</code> file in your repo, or a snippet someone sent you — and see it as a diagram in about a second. No project to create, no schema to upload, no account.</p>
      <h3>Opening a .dbml file</h3>
      <ol>
        <li>Open the <code>.dbml</code> file in any text editor (it's plain text).</li>
        <li>Select all, copy, paste here. Or drag the file onto the editor pane.</li>
        <li>The diagram renders; drag tables to tidy up, hide what you don't need.</li>
      </ol>
      <p>Because rendering is local, this is the viewer to reach for when the DBML contains real names — production table names, internal codenames, client project schemas. Nothing is transmitted; the share link, if you use one, encodes the diagram entirely in the URL fragment, so there is no server-side copy anywhere. When viewing turns into editing — rearranging for a deck, exporting an SVG for docs — the same paste works in the full editor via the button at the top.</p>`,
  'prisma-schema-visualizer': `
      <p>The Prisma ecosystem's own visualization options all require running things: <code>prisma-erd-generator</code> (renders at <code>prisma generate</code> time into a static SVG), or third-party CLIs that read the schema file. This page skips the toolchain entirely — paste the contents of <code>schema.prisma</code> and the ER diagram renders in the browser, interactive and exportable.</p>
      <p>When that's the better path:</p>
      <ul>
        <li><strong>Code review</strong> — paste a PR's proposed schema change and look at the relations before approving.</li>
        <li><strong>Restricted machines</strong> — no npm install, no generator in the build; a browser tab is enough.</li>
        <li><strong>Multi-file schemas</strong> — concatenate your <code>schema/</code> folder files and paste once.</li>
        <li><strong>Sensitive schemas</strong> — the schema text never leaves the tab.</li>
      </ul>
      <p>Models render with all scalar fields, enums attach to their columns, <code>@relation</code> attributes draw with correct cardinality, and implicit many-to-many relations draw as a direct edge between the models. From the same render you can export DBML (for dbdiagram), Mermaid (for Markdown), or PNG/SVG for docs — the visualizer is also a converter.</p>`,
  'plantuml-viewer': `
      <p>The usual way to view PlantUML is a round trip: the jar and Java, or a company PlantUML server, or the public server — which means sending your diagram text to something. This viewer renders entity and class diagrams entirely in the browser: paste the <code>@startuml … @enduml</code> block, and the diagram appears with zero requests.</p>
      <p>That privacy property is the reason most people bookmark this page — the diagram text for an internal database schema is itself sensitive, and "paste it into a public web service" is a non-starter in a lot of organisations. Here the paste is the whole story: no upload endpoint exists to receive it.</p>
      <p>Supported input: <code>entity</code> and <code>class</code> blocks with typed fields, <code>*</code> mandatory-field markers, and crow's-foot relationship connectors (<code>||--o{</code> etc.). Skinparams and themes are ignored. What you get that a static render doesn't give you: drag to rearrange, hide tables to focus, and export PNG/SVG at whatever arrangement looks best — or convert the schema to Mermaid or DBML if your docs platform changed under you.</p>`,
  'er-diagram-generator': `
      <p>This is the general-purpose entry point: paste SQL from any of the supported dialects — PostgreSQL, MySQL/MariaDB, SQLite, SQL Server, Oracle, Snowflake, BigQuery — and the generator detects the dialect, draws every table with its columns and keys, and connects foreign keys as relations. Dumps are fine: <code>pg_dump --schema-only</code>, <code>mysqldump --no-data</code>, SSMS scripts, <code>.schema</code> output — noise statements are skipped, <code>ALTER TABLE</code> foreign keys are stitched back on.</p>
      <h3>Getting a good diagram out</h3>
      <ul>
        <li><strong>Start with auto-arrange</strong>, then drag clusters apart by domain — the layout is a first draft, not a verdict.</li>
        <li><strong>Hide tables</strong> you don't need; a 25-table diagram communicates more than a 200-table one.</li>
        <li><strong>No foreign keys in the schema?</strong> Use <strong>Infer links</strong> — it draws relations from <code>user_id</code>-style column conventions.</li>
        <li><strong>Export SVG</strong> for docs (scales forever), PNG for slides and tickets.</li>
      </ul>
      <p>Everything happens in your browser — the schema is parsed and rendered locally, and never uploaded. That's not a limitation; it's the feature that makes pasting a production dump unremarkable.</p>`,
};
