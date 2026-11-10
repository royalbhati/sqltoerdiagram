// Content for the comparison pages: /alternatives/ (hub) and /vs/<slug>/.
//
// ACCURACY RULES for this file
//  - THIS_TOOL holds statements about SQL to ER Diagram only. They are checked against the app.
//  - Statements about third-party products were checked on 2026-11-10 against each vendor's
//    own page (dbdiagram.io, drawsql.app, chartdb.io, github.com/drawdb-io/drawdb) and are
//    worded to match what those pages say. Re-check periodically: these products change.
//  - No prices, no plan limits, no "X cannot do Y". Describe what the other tool is for and
//    when it is the better choice; leave the details to the vendor's own site.

export const THIS_TOOL = {
  name: 'SQL to ER Diagram',
  facts: [
    '<strong>Free and open source</strong> under the MIT license. There are no paid plans.',
    '<strong>No signup.</strong> There are no accounts; you open the page and paste a schema.',
    '<strong>Runs entirely in your browser.</strong> The schema is parsed and drawn locally and is never uploaded to a server.',
    '<strong>Reads the schema you already have:</strong> SQL DDL for PostgreSQL, MySQL, MariaDB, SQLite, SQL Server, Oracle, Snowflake and BigQuery, plus Prisma, DBML, Mermaid, PlantUML, SQLAlchemy, Sequelize, TypeORM entities and Django models.',
    '<strong>Imports from a live database</strong> without connecting to it: you run one read-only catalog query in your own client and paste the result.',
    '<strong>Converts and migrates:</strong> exports the schema as DDL for another SQL dialect, and compares two versions to produce migration SQL.',
    '<strong>Exports</strong> PNG, SVG, Mermaid, DBML and PlantUML, copies the diagram to the clipboard, and makes share-ready snapshot images.',
    '<strong>Share by URL:</strong> a share link encodes the whole diagram in the URL fragment, which browsers do not send to a server.',
    '<strong>Editor features:</strong> undo/redo, a ⌘K command palette that jumps to any table or column, a minimap, and a clickable list of parse problems.',
    '<strong>Works offline</strong> after the first visit, and stays smooth at around 300 tables because layout runs in a Web Worker.',
    '<strong>Headless CLI</strong> that turns a schema file into an SVG, for docs and CI.',
  ],
  // What this tool deliberately is not. Stated plainly so the comparison is fair.
  limits: [
    'It has no accounts and no server, so there is no real-time multi-user editing and no cloud workspace. Diagrams and their version history live in your browser, in a file you save, or in a link you share.',
    'It never connects to your database itself: you paste schema text, or run one read-only catalog query in your own client and paste its result.',
  ],
};

export const COMPETITORS = [
  {
    slug: 'dbdiagram',
    name: 'dbdiagram.io',
    url: 'https://dbdiagram.io/',
    figure: 'blog', // gallery schema shown on the page
    title: 'dbdiagram.io Alternative — Free, Open-Source SQL to ER Diagram',
    description: 'SQL to ER Diagram compared with dbdiagram.io: a free, open-source, no-signup tool that draws an ER diagram from the SQL, Prisma or DBML you already have, entirely in your browser.',
    keywords: 'dbdiagram alternative, dbdiagram.io alternative, free dbdiagram alternative, open source dbdiagram alternative, dbml diagram tool',
    lead: 'Both tools turn text into an ER diagram. dbdiagram.io is an editor built around the DBML language; SQL to ER Diagram is a free, open-source page that reads the schema you already have and never uploads it.',
    about: [
      'dbdiagram.io is a database diagram editor made by Holistics.',
      'You describe the schema as DBML code in its editor and the diagram is drawn from that code as you type.',
      'DBML, the language it is built around, is open source.',
      'It can also generate a diagram from a database or a SQL dump file, and generate the SQL to create the tables.',
      'Diagrams can be shared online, and a team can be invited to collaborate on them.',
    ],
    chooseThem: [
      'You want DBML to be the source you write and keep.',
      'Your team wants to collaborate on the same diagrams online.',
    ],
    chooseUs: [
      'You already have SQL, a database dump, or a Prisma, SQLAlchemy or Sequelize schema and want the diagram without rewriting it as DBML.',
      'The schema must not leave your machine: nothing is uploaded and there is no account.',
      'You want a free, MIT-licensed tool you can self-host or run from a CLI.',
    ],
    bestFor: 'Writing a schema in DBML and collaborating on it online.',
    faq: [
      { q: 'Can I move a diagram between dbdiagram.io and SQL to ER Diagram?', a: 'Yes, through DBML. SQL to ER Diagram reads DBML, so you can paste DBML text into it, and it exports any schema as DBML that other DBML tools can read.' },
      { q: 'Do I need to learn DBML to use SQL to ER Diagram?', a: 'No. Paste the SQL DDL, Prisma schema or ORM models you already have and the diagram is drawn from that. DBML is one of the supported inputs and outputs, not a requirement.' },
    ],
  },
  {
    slug: 'drawsql',
    name: 'DrawSQL',
    url: 'https://drawsql.app/',
    figure: 'saas',
    title: 'DrawSQL Alternative — Free, Open-Source SQL to ER Diagram',
    description: 'SQL to ER Diagram compared with DrawSQL: a free, open-source, no-signup tool that generates an ER diagram from existing SQL, Prisma or DBML, entirely in your browser.',
    keywords: 'drawsql alternative, free drawsql alternative, open source drawsql alternative, er diagram tool no signup',
    lead: 'DrawSQL is a visual database design tool for engineering teams, with real-time collaboration. SQL to ER Diagram is a free, open-source page that draws the diagram from schema text you already have, without an account and without uploading anything.',
    about: [
      'DrawSQL describes itself as visual database design for engineering teams.',
      'It can import SQL: you paste CREATE TABLE statements and get a schema diagram.',
      'It offers real-time multiplayer editing for teams.',
      'It offers a library of real-world schema templates to start from.',
    ],
    chooseThem: [
      'You are designing a schema visually and want to start from a template.',
      'Your team wants to edit the same diagram together in real time.',
    ],
    chooseUs: [
      'Your schema is not only SQL: you also want to read Prisma, DBML, Mermaid, PlantUML, SQLAlchemy, Sequelize, TypeORM or Django models.',
      'You want no signup and no upload: the schema stays in your browser.',
      'You want a free, MIT-licensed tool that also works offline and from a CLI.',
    ],
    bestFor: 'Designing a schema visually with a team, in real time.',
    faq: [
      { q: 'Does SQL to ER Diagram have example schemas like a template gallery?', a: 'Yes. The examples gallery has ready-made schemas (e-commerce, blog, SaaS, CRM, ERP and more), each with the full SQL and a diagram you can open and edit.' },
    ],
  },
  {
    slug: 'chartdb',
    name: 'ChartDB',
    url: 'https://chartdb.io/',
    figure: 'project-management',
    title: 'ChartDB Alternative — Free, Open-Source SQL to ER Diagram',
    description: 'SQL to ER Diagram compared with ChartDB: both are open source. SQL to ER Diagram draws the diagram from pasted SQL, Prisma or DBML with no signup, entirely in your browser.',
    keywords: 'chartdb alternative, open source chartdb alternative, free er diagram tool, sql to er diagram open source',
    lead: 'Both are open-source database diagram tools. ChartDB imports a schema with a single query you run against your database, and adds an AI diagram generator; SQL to ER Diagram reads pasted schema text in many formats and keeps everything in your browser.',
    about: [
      'ChartDB is a free and open-source database design editor.',
      'It is available as a cloud app in the browser and can also be self-hosted.',
      'For each supported database it provides a single query that fetches your entire schema.',
      'It advertises an AI diagram generator that turns a description into an editable ER diagram, and exports DDL in your preferred SQL dialect.',
    ],
    chooseThem: [
      'You want an AI to draft a diagram from a description.',
      'You want a cloud app with a self-hosted option.',
    ],
    chooseUs: [
      'Your starting point is a file: a SQL dump, <code>schema.prisma</code>, DBML, Mermaid, PlantUML, or SQLAlchemy or Sequelize models.',
      'You want share links that carry the whole diagram in the URL fragment, with nothing stored on a server.',
      'You want a headless CLI that writes an SVG for docs or CI.',
    ],
    bestFor: 'Generating a diagram with AI, or from a query run against a live database.',
    faq: [
      { q: 'Are both tools open source?', a: 'SQL to ER Diagram is MIT-licensed and its source is on GitHub. ChartDB also describes itself as free and open source; check its repository for the current license.' },
    ],
  },
  {
    slug: 'drawdb',
    name: 'drawDB',
    url: 'https://drawdb.app/',
    figure: 'inventory',
    title: 'drawDB Alternative — Free, Open-Source SQL to ER Diagram',
    description: 'SQL to ER Diagram compared with drawDB: both are free and open source. SQL to ER Diagram starts from the SQL, Prisma or DBML you already have and draws the diagram in your browser.',
    keywords: 'drawdb alternative, open source drawdb alternative, free er diagram tool, sql to er diagram online',
    lead: 'Both are free, open-source tools that run in the browser. drawDB is a visual editor for building a schema and generating SQL from it; SQL to ER Diagram goes the other way, from existing schema text to a diagram.',
    about: [
      'drawDB is an open-source (AGPL-3.0) entity-relationship diagram editor that runs in the browser.',
      'It is a diagram editor and SQL generator: you build the diagram and export SQL scripts from it.',
      'It can also import SQL scripts.',
      'It can be used without creating an account.',
    ],
    chooseThem: [
      'You are starting from a blank canvas and want SQL generated from what you draw.',
    ],
    chooseUs: [
      'You are starting from code: SQL DDL in eight dialects, or a Prisma, DBML, Mermaid, PlantUML, SQLAlchemy or Sequelize schema.',
      'You want to convert between text formats, for example SQL to Mermaid, DBML or PlantUML.',
      'You want a ⌘K command palette, a minimap and a layout that stays smooth at around 300 tables.',
    ],
    bestFor: 'Drawing a schema from scratch and generating SQL from it.',
    faq: [
      { q: 'Which one should I use for an existing database?', a: 'If you already have the schema as SQL or ORM code, SQL to ER Diagram draws it directly from that text. If you want to design tables by drawing them, a visual editor such as drawDB is built for that.' },
    ],
  },
];

export const HUB = {
  slug: 'alternatives',
  title: 'ER Diagram Tool Alternatives — Free, Open Source, No Signup',
  description: 'How SQL to ER Diagram compares with dbdiagram.io, DrawSQL, ChartDB and drawDB: what each tool is built for and when to pick which. Free, open source, runs in your browser.',
  keywords: 'er diagram tool alternatives, dbdiagram alternative, drawsql alternative, chartdb alternative, drawdb alternative, free er diagram tool, open source er diagram tool',
  lead: 'How SQL to ER Diagram compares with dbdiagram.io, DrawSQL, ChartDB and drawDB: what each one is built for, and when the other tool is the better choice.',
  figure: 'ecommerce',
  bestFor: 'Getting a diagram from SQL, Prisma, DBML or ORM code you already have, with no account and nothing uploaded.',
  faq: [
    { q: 'What is a free alternative to paid ER diagram tools?', a: 'SQL to ER Diagram is free and MIT-licensed open source. There are no accounts or paid plans: you paste a schema and get an interactive ER diagram in your browser.' },
    { q: 'Which ER diagram tool does not upload my schema?', a: 'SQL to ER Diagram parses and draws the schema entirely in your browser. Nothing is uploaded, and share links carry the diagram in the URL fragment, which is not sent to a server.' },
    { q: 'Does SQL to ER Diagram support team collaboration?', a: 'Not in real time. There are no accounts or shared workspaces; you share a diagram by sending a link or a saved file. If your team needs to edit the same saved diagram together, a hosted tool with accounts is the better fit.' },
  ],
};

// Shown on every comparison page.
export const DISCLOSURE = 'This comparison is written by the maintainers of SQL to ER Diagram. It describes other products only in general terms and lists no prices or plan limits, because those change. Check each product’s own site for its current features and pricing. Product names are trademarks of their respective owners.';
