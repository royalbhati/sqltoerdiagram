// Content for the programmatic landing pages. Each entry → public/<slug>/index.html
// Keep the primary content (h1/lead/steps/example/faq) genuinely distinct per page.

const R = {
  home: { href: '/', label: 'SQL to ER Diagram (home)' },
  prisma: { href: '/prisma/', label: 'Prisma to ER diagram' },
  mysql: { href: '/mysql/', label: 'MySQL to ER diagram' },
  postgresql: { href: '/postgresql/', label: 'PostgreSQL to ER diagram' },
  sqlite: { href: '/sqlite/', label: 'SQLite to ER diagram' },
  sqlserver: { href: '/sql-server/', label: 'SQL Server to ER diagram' },
  dbml: { href: '/dbml/', label: 'DBML to ER diagram' },
  mermaid: { href: '/mermaid/', label: 'Mermaid to ER diagram' },
  sqlalchemy: { href: '/sqlalchemy/', label: 'SQLAlchemy to ER diagram' },
  sequelize: { href: '/sequelize/', label: 'Sequelize to ER diagram' },
  typeorm: { href: '/typeorm/', label: 'TypeORM to ER diagram' },
  django: { href: '/django/', label: 'Django to ER diagram' },
  sql2mermaid: { href: '/sql-to-mermaid/', label: 'SQL to Mermaid' },
  prisma2dbml: { href: '/prisma-to-dbml/', label: 'Prisma to DBML' },
  dbml2er: { href: '/dbml-to-er-diagram/', label: 'DBML to ER diagram' },
  mermaid2erd: { href: '/mermaid-to-erd/', label: 'Mermaid to ERD' },
  oracle: { href: '/oracle/', label: 'Oracle to ER diagram' },
  mariadb: { href: '/mariadb/', label: 'MariaDB to ER diagram' },
  snowflake: { href: '/snowflake/', label: 'Snowflake to ER diagram' },
  bigquery: { href: '/bigquery/', label: 'BigQuery to ER diagram' },
  plantuml: { href: '/plantuml/', label: 'PlantUML to ER diagram' },
  ddl2er: { href: '/ddl-to-er-diagram/', label: 'DDL to ER diagram' },
  sql2dbml: { href: '/sql-to-dbml/', label: 'SQL to DBML' },
  sql2plantuml: { href: '/sql-to-plantuml/', label: 'SQL to PlantUML' },
  dbml2mermaid: { href: '/dbml-to-mermaid/', label: 'DBML to Mermaid' },
  dbmlViewer: { href: '/dbml-viewer/', label: 'DBML viewer' },
  prismaViz: { href: '/prisma-schema-visualizer/', label: 'Prisma schema visualizer' },
  plantumlViewer: { href: '/plantuml-viewer/', label: 'PlantUML viewer' },
  erdGen: { href: '/er-diagram-generator/', label: 'ER diagram generator from SQL' },
};

const PRIVATE = '<strong>Private:</strong> everything runs in your browser — nothing is uploaded or stored on a server.';
const INTERACTIVE = '<strong>Interactive:</strong> drag tables, auto-arrange, hide noise, add notes, and manually link columns.';
const EXPORT = '<strong>Export</strong> a high-res PNG, vector SVG, or the schema as Mermaid / DBML / PlantUML code.';
const FREE = '<strong>Free &amp; open source</strong> — no account, no sign-up.';
const FAQ_PRIVATE = { q: 'Is my schema uploaded anywhere?', a: 'No. Everything runs locally in your browser — your schema is never uploaded to or stored on any server.' };
const FAQ_FREE = { q: 'Is it free?', a: 'Yes. It is completely free and open source, with no account or sign-up required.' };
const FAQ_EXPORT = { q: 'Can I export the diagram?', a: 'Yes — export a high-resolution PNG or vector SVG, copy the schema as Mermaid, DBML or PlantUML, or share a link that encodes the whole diagram in the URL.' };

export const PAGES = [
  // ---------------- ORMs ----------------
  {
    slug: 'prisma',
    crumb: 'Prisma',
    title: 'Prisma to ER Diagram — Free Online Prisma Schema Visualizer',
    description: 'Paste your schema.prisma and instantly generate a clean, interactive ER diagram. Visualize Prisma models, fields and relations online — free, open source, runs in your browser, nothing uploaded.',
    keywords: 'prisma to er diagram, prisma erd, visualize prisma schema, prisma schema diagram, prisma schema visualizer, schema.prisma diagram, prisma database diagram',
    h1: 'Prisma to <span class="a">ER Diagram</span>',
    lead: 'Paste your <code>schema.prisma</code> and instantly get a clean, interactive entity-relationship diagram — models, fields and relations, drawn automatically. Free, open source, and 100% in your browser.',
    steps: [
      'Copy the contents of your <code>schema.prisma</code> file.',
      'Paste it into the editor — the format is <strong>auto-detected as Prisma</strong>.',
      'Every <code>model</code> becomes a table; relations are drawn from your <code>@relation</code> fields.',
      'Drag tables to arrange, hide noise, then export as PNG/SVG or share a link.',
    ],
    exampleIntro: 'A Prisma schema like this:',
    example: `model User {
  id     Int     @id @default(autoincrement())
  email  String  @unique
  posts  Post[]
}

model Post {
  id        Int    @id @default(autoincrement())
  title     String
  author    User   @relation(fields: [authorId], references: [id])
  authorId  Int
}`,
    exampleAfter: '…renders as two tables (<code>User</code>, <code>Post</code>) with a relation from <code>Post.authorId</code> → <code>User.id</code>.',
    why: [
      '<strong>Relations drawn automatically</strong> from <code>@relation</code> — no manual wiring.',
      PRIVATE, INTERACTIVE, EXPORT, FREE,
    ],
    badges: ['Prisma', 'SQL', 'SQLAlchemy', 'Sequelize'],
    faq: [
      { q: 'How do I turn a Prisma schema into an ER diagram?', a: 'Paste your <code>schema.prisma</code> into the editor. It auto-detects Prisma, renders every model as a table, and draws relations from your <code>@relation</code> fields — instantly, in the browser.' },
      { q: 'What else is supported besides Prisma?', a: 'Raw SQL (<code>CREATE TABLE</code> for PostgreSQL, MySQL, SQLite, SQL Server, Oracle, Snowflake), plus DBML, Mermaid, SQLAlchemy and Sequelize models.' },
      FAQ_PRIVATE, FAQ_EXPORT, FAQ_FREE,
    ],
    related: [R.prismaViz, R.prisma2dbml, R.sqlalchemy, R.sequelize, R.dbml2er, R.home],
  },

  // ---------------- DIALECTS ----------------
  {
    slug: 'mysql',
    crumb: 'MySQL',
    title: 'MySQL to ER Diagram — Free Online MySQL Schema Visualizer',
    description: 'Paste MySQL CREATE TABLE statements or a mysqldump and instantly generate an interactive ER diagram. Free, open source, runs in your browser — nothing uploaded.',
    keywords: 'mysql to er diagram, mysql erd, mysql schema diagram, visualize mysql database, mysqldump diagram, mysql entity relationship diagram',
    h1: 'MySQL to <span class="a">ER Diagram</span>',
    lead: 'Paste your MySQL <code>CREATE TABLE</code> statements (or a <code>mysqldump</code>) and get a clean, interactive entity-relationship diagram — tables, columns, keys and foreign keys, drawn automatically.',
    steps: [
      'Dump your schema with <code>mysqldump --no-data your_db</code>, or copy your <code>CREATE TABLE</code> statements.',
      'Paste it into the editor — MySQL is parsed automatically.',
      'Every table is rendered with its columns; <code>FOREIGN KEY</code> constraints become relations.',
      'Arrange, hide tables, then export PNG/SVG or share a link.',
    ],
    exampleIntro: 'A MySQL schema like this:',
    example: `CREATE TABLE customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
) ENGINE=InnoDB;`,
    exampleAfter: '…renders two tables with a relation from <code>orders.customer_id</code> → <code>customers.id</code>.',
    why: [PRIVATE, INTERACTIVE, EXPORT, '<strong>Handles big dumps</strong> — hundreds of tables stay smooth.', FREE],
    badges: ['MySQL', 'MariaDB', 'PostgreSQL', 'SQLite', 'SQL Server'],
    faq: [
      { q: 'How do I turn a MySQL database into an ER diagram?', a: 'Export the schema with <code>mysqldump --no-data</code> (or copy your CREATE TABLE statements), paste it in, and the diagram is drawn instantly with foreign keys as relations.' },
      { q: 'Does it work with mysqldump output?', a: 'Yes. Paste the dump as-is — it reads CREATE TABLE definitions and FOREIGN KEY constraints, ignoring the INSERT data.' },
      FAQ_PRIVATE, FAQ_EXPORT, FAQ_FREE,
    ],
    related: [R.erdGen, R.postgresql, R.mariadb, R.sqlite, R.sqlserver, R.prisma, R.home],
  },
  {
    slug: 'postgresql',
    crumb: 'PostgreSQL',
    title: 'PostgreSQL to ER Diagram — Free Online Postgres Schema Visualizer',
    description: 'Paste PostgreSQL CREATE TABLE statements or pg_dump output and instantly generate an interactive ER diagram. Free, open source, runs in your browser — nothing uploaded.',
    keywords: 'postgresql to er diagram, postgres erd, pg_dump diagram, visualize postgres schema, postgresql entity relationship diagram, postgres schema diagram',
    h1: 'PostgreSQL to <span class="a">ER Diagram</span>',
    lead: 'Paste your PostgreSQL schema — <code>CREATE TABLE</code> statements or a <code>pg_dump</code> — and get an interactive ER diagram with every table, column and foreign key drawn for you.',
    steps: [
      'Dump the schema with <code>pg_dump --schema-only your_db</code>, or copy your <code>CREATE TABLE</code> statements.',
      'Paste it into the editor — Postgres is parsed automatically, including <code>ALTER TABLE … ADD CONSTRAINT</code> foreign keys.',
      'Tables render with columns and types; relations are drawn from the constraints.',
      'Arrange, hide tables, then export PNG/SVG or share a link.',
    ],
    exampleIntro: 'A PostgreSQL schema like this:',
    example: `CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE
);

CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id)
);`,
    exampleAfter: '…renders two tables with a relation from <code>orders.customer_id</code> → <code>customers.id</code>.',
    why: [PRIVATE, '<strong>pg_dump-friendly</strong> — handles <code>ALTER TABLE ONLY … ADD CONSTRAINT</code> foreign keys.', INTERACTIVE, EXPORT, FREE],
    badges: ['PostgreSQL', 'pg_dump', 'MySQL', 'SQLite', 'Prisma'],
    faq: [
      { q: 'How do I turn a Postgres database into an ER diagram?', a: 'Run <code>pg_dump --schema-only</code> and paste the output. Tables and foreign keys (including those added via ALTER TABLE) are drawn automatically.' },
      { q: 'Does it support pg_dump?', a: 'Yes — pg_dump emits foreign keys as separate ALTER TABLE statements, which are parsed and turned into relations.' },
      FAQ_PRIVATE, FAQ_EXPORT, FAQ_FREE,
    ],
    related: [R.mysql, R.oracle, R.sqlite, R.sqlserver, R.snowflake, R.home],
  },
  {
    slug: 'sqlite',
    crumb: 'SQLite',
    title: 'SQLite to ER Diagram — Free Online SQLite Schema Visualizer',
    description: 'Paste your SQLite schema (the .schema output) and instantly generate an interactive ER diagram. Free, open source, runs in your browser — nothing uploaded.',
    keywords: 'sqlite to er diagram, sqlite erd, sqlite schema diagram, visualize sqlite database, .schema diagram, sqlite entity relationship diagram',
    h1: 'SQLite to <span class="a">ER Diagram</span>',
    lead: 'Paste your SQLite schema — the output of <code>.schema</code> — and get an interactive ER diagram of every table, column and relationship.',
    steps: [
      'In the <code>sqlite3</code> shell run <code>.schema</code> (or <code>.schema --indent</code>) and copy the output.',
      'Paste it into the editor — SQLite is parsed automatically.',
      'Tables render with columns; <code>REFERENCES</code> become relations.',
      'Arrange, hide tables, then export PNG/SVG or share a link.',
    ],
    exampleIntro: 'A SQLite schema like this:',
    example: `CREATE TABLE customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id)
);`,
    exampleAfter: '…renders two tables with a relation from <code>orders.customer_id</code> → <code>customers.id</code>.',
    why: [PRIVATE, INTERACTIVE, EXPORT, FREE],
    badges: ['SQLite', 'PostgreSQL', 'MySQL', 'SQL Server'],
    faq: [
      { q: 'How do I diagram a SQLite database?', a: 'Open it with <code>sqlite3 mydb.db</code>, run <code>.schema</code>, and paste the output here. The diagram is generated instantly.' },
      FAQ_PRIVATE, FAQ_EXPORT, FAQ_FREE,
    ],
    related: [R.postgresql, R.mysql, R.sqlserver, R.dbml, R.home],
  },
  {
    slug: 'sql-server',
    crumb: 'SQL Server',
    title: 'SQL Server to ER Diagram — Free Online T-SQL Schema Visualizer',
    description: 'Paste SQL Server / T-SQL CREATE TABLE statements and instantly generate an interactive ER diagram. Free, open source, runs in your browser — nothing uploaded.',
    keywords: 'sql server to er diagram, t-sql erd, mssql schema diagram, sql server entity relationship diagram, visualize sql server database, tsql diagram',
    h1: 'SQL Server to <span class="a">ER Diagram</span>',
    lead: 'Paste your SQL Server (T-SQL) <code>CREATE TABLE</code> statements and get an interactive entity-relationship diagram — tables, columns, primary keys and foreign keys, drawn automatically.',
    steps: [
      'Script the schema from SSMS (right-click the database → Tasks → Generate Scripts), or copy your <code>CREATE TABLE</code> statements.',
      'Paste it into the editor — T-SQL is parsed automatically.',
      'Tables render with columns; <code>FOREIGN KEY</code> constraints become relations.',
      'Arrange, hide tables, then export PNG/SVG or share a link.',
    ],
    exampleIntro: 'A T-SQL schema like this:',
    example: `CREATE TABLE customers (
  id INT IDENTITY(1,1) PRIMARY KEY,
  email NVARCHAR(255) NOT NULL UNIQUE
);

CREATE TABLE orders (
  id INT IDENTITY(1,1) PRIMARY KEY,
  customer_id INT NOT NULL,
  CONSTRAINT FK_orders_customers
    FOREIGN KEY (customer_id) REFERENCES customers(id)
);`,
    exampleAfter: '…renders two tables with a relation from <code>orders.customer_id</code> → <code>customers.id</code>.',
    why: [PRIVATE, INTERACTIVE, EXPORT, '<strong>Handles named constraints</strong> like <code>CONSTRAINT FK_… FOREIGN KEY</code>.', FREE],
    badges: ['SQL Server', 'T-SQL', 'PostgreSQL', 'MySQL', 'SQLite'],
    faq: [
      { q: 'How do I create an ER diagram from SQL Server?', a: 'In SSMS use Tasks → Generate Scripts to script the schema, then paste it here. Tables and foreign-key constraints are drawn automatically.' },
      FAQ_PRIVATE, FAQ_EXPORT, FAQ_FREE,
    ],
    related: [R.postgresql, R.mysql, R.oracle, R.sqlite, R.home],
  },

  // ---------------- FORMATS ----------------
  {
    slug: 'dbml',
    crumb: 'DBML',
    title: 'DBML to ER Diagram — Free Online DBML Visualizer',
    description: 'Paste DBML (Database Markup Language) and instantly render an interactive ER diagram. Import DBML, export PNG/SVG. Free, open source, runs in your browser.',
    keywords: 'dbml to er diagram, dbml visualizer, render dbml, dbml diagram, database markup language diagram, dbdiagram alternative',
    h1: 'DBML to <span class="a">ER Diagram</span>',
    lead: 'Paste <strong>DBML</strong> (Database Markup Language) and get an interactive ER diagram instantly. A free, in-browser DBML visualizer — import DBML, export PNG, SVG, Mermaid or PlantUML.',
    steps: [
      'Copy your <code>.dbml</code> file or DBML snippet.',
      'Paste it into the editor — DBML is auto-detected.',
      'Each <code>Table</code> renders with its columns; <code>Ref:</code> and inline <code>[ref: &gt; …]</code> become relations.',
      'Arrange, hide tables, then export PNG/SVG or convert to Mermaid/PlantUML.',
    ],
    exampleIntro: 'DBML like this:',
    example: `Table users {
  id integer [pk]
  email varchar [unique]
}

Table posts {
  id integer [pk]
  user_id integer [ref: > users.id]
}`,
    exampleAfter: '…renders two tables with a relation from <code>posts.user_id</code> → <code>users.id</code>.',
    why: [PRIVATE, '<strong>Round-trip:</strong> import DBML and export it back, or convert to Mermaid / PlantUML / SVG.', INTERACTIVE, FREE],
    badges: ['DBML', 'Mermaid', 'PlantUML', 'SQL', 'Prisma'],
    faq: [
      { q: 'What is DBML?', a: 'DBML (Database Markup Language) is a simple, readable DSL for defining database schemas, popularized by dbdiagram.io. Paste it here to visualize it instantly.' },
      { q: 'Can I convert DBML to SQL or Mermaid?', a: 'Paste your DBML, then use Export to get Mermaid or PlantUML, or a PNG/SVG image of the diagram.' },
      FAQ_PRIVATE, FAQ_FREE,
    ],
    related: [R.dbmlViewer, R.mermaid, R.dbml2mermaid, R.prisma2dbml, R.dbml2er, R.home],
  },
  {
    slug: 'mermaid',
    crumb: 'Mermaid',
    title: 'Mermaid to ER Diagram — Free Online Mermaid erDiagram Viewer',
    description: 'Paste a Mermaid erDiagram and render it as an interactive ER diagram you can drag, arrange and export. Free, open source, runs in your browser.',
    keywords: 'mermaid to er diagram, mermaid erdiagram viewer, render mermaid er diagram, mermaid erd, visualize mermaid schema',
    h1: 'Mermaid to <span class="a">ER Diagram</span>',
    lead: 'Paste a <strong>Mermaid</strong> <code>erDiagram</code> and turn it into a fully interactive ER diagram you can drag, auto-arrange, and export — no Markdown renderer required.',
    steps: [
      'Copy your Mermaid <code>erDiagram</code> block.',
      'Paste it into the editor — Mermaid is auto-detected.',
      'Each entity becomes a table; relationships are drawn with the right cardinality.',
      'Arrange, hide tables, then export PNG/SVG or convert to DBML/PlantUML.',
    ],
    exampleIntro: 'A Mermaid erDiagram like this:',
    example: `erDiagram
  USERS ||--o{ POSTS : writes
  USERS {
    int id PK
    string email
  }
  POSTS {
    int id PK
    int user_id FK
  }`,
    exampleAfter: '…renders two tables with a relation between <code>USERS</code> and <code>POSTS</code>.',
    why: [PRIVATE, '<strong>Interactive</strong>, unlike a static Mermaid render — drag, arrange and hide tables.', EXPORT, FREE],
    badges: ['Mermaid', 'DBML', 'PlantUML', 'SQL', 'Prisma'],
    faq: [
      { q: 'Can I edit a Mermaid ER diagram visually?', a: 'Paste the Mermaid erDiagram to render it, then drag and arrange tables on the canvas. You can also convert it to SQL-style images or DBML via Export.' },
      { q: 'Does it support Mermaid cardinality?', a: 'Yes — one-to-one, one-to-many and many-to-many crow’s-foot notations are recognised and drawn.' },
      FAQ_PRIVATE, FAQ_FREE,
    ],
    related: [R.dbml, R.mermaid2erd, R.sql2mermaid, R.prisma, R.home],
  },
  {
    slug: 'sqlalchemy',
    crumb: 'SQLAlchemy',
    title: 'SQLAlchemy to ER Diagram — Free Online Model Visualizer',
    description: 'Paste your SQLAlchemy models and instantly generate an interactive ER diagram. Free, open source, runs in your browser — nothing uploaded.',
    keywords: 'sqlalchemy to er diagram, sqlalchemy erd, visualize sqlalchemy models, sqlalchemy schema diagram, python orm diagram',
    h1: 'SQLAlchemy to <span class="a">ER Diagram</span>',
    lead: 'Paste your <strong>SQLAlchemy</strong> declarative models and get an interactive ER diagram — tables from <code>__tablename__</code>, columns, and relations from <code>ForeignKey</code>.',
    steps: [
      'Copy your SQLAlchemy model classes (declarative <code>Base</code> / <code>db.Model</code>).',
      'Paste them into the editor — SQLAlchemy is auto-detected.',
      'Each model becomes a table; <code>ForeignKey("table.col")</code> becomes a relation.',
      'Arrange, hide tables, then export PNG/SVG or share a link.',
    ],
    exampleIntro: 'SQLAlchemy models like this:',
    example: `class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String, unique=True)

class Post(Base):
    __tablename__ = "posts"
    id = Column(Integer, primary_key=True)
    author_id = Column(Integer, ForeignKey("users.id"))`,
    exampleAfter: '…renders two tables with a relation from <code>posts.author_id</code> → <code>users.id</code>.',
    why: [PRIVATE, INTERACTIVE, EXPORT, FREE],
    badges: ['SQLAlchemy', 'Prisma', 'Sequelize', 'SQL'],
    faq: [
      { q: 'How do I visualize SQLAlchemy models?', a: 'Paste your declarative model classes. Tables come from <code>__tablename__</code>, columns from <code>Column(...)</code>, and relations from <code>ForeignKey</code>.' },
      { q: 'Do I need to run my app?', a: 'No — it reads the model source directly in the browser, nothing is imported or executed.' },
      FAQ_PRIVATE, FAQ_FREE,
    ],
    related: [R.prismaViz, R.django, R.prisma, R.sequelize, R.postgresql, R.home],
  },
  {
    slug: 'sequelize',
    crumb: 'Sequelize',
    title: 'Sequelize to ER Diagram — Free Online Model Visualizer',
    description: 'Paste your Sequelize models and instantly generate an interactive ER diagram. Free, open source, runs in your browser — nothing uploaded.',
    keywords: 'sequelize to er diagram, sequelize erd, visualize sequelize models, sequelize schema diagram, node orm diagram',
    h1: 'Sequelize to <span class="a">ER Diagram</span>',
    lead: 'Paste your <strong>Sequelize</strong> model definitions and get an interactive ER diagram — tables, columns from <code>DataTypes</code>, and relations from associations.',
    steps: [
      'Copy your Sequelize models (<code>sequelize.define(...)</code> or <code>Model.init(...)</code>).',
      'Paste them into the editor — Sequelize is auto-detected.',
      'Each model becomes a table; associations like <code>belongsTo</code> become relations.',
      'Arrange, hide tables, then export PNG/SVG or share a link.',
    ],
    exampleIntro: 'Sequelize models like this:',
    example: `const User = sequelize.define('User', {
  email: { type: DataTypes.STRING, unique: true }
});

const Post = sequelize.define('Post', {
  title: DataTypes.STRING
});

Post.belongsTo(User);`,
    exampleAfter: '…renders <code>User</code> and <code>Post</code> with a relation between them.',
    why: [PRIVATE, INTERACTIVE, EXPORT, FREE],
    badges: ['Sequelize', 'Prisma', 'SQLAlchemy', 'SQL'],
    faq: [
      { q: 'How do I diagram Sequelize models?', a: 'Paste your <code>sequelize.define</code> or <code>Model.init</code> definitions. Columns come from DataTypes and relations from associations like belongsTo / hasMany.' },
      FAQ_PRIVATE, FAQ_FREE,
    ],
    related: [R.typeorm, R.prisma, R.sqlalchemy, R.mysql, R.home],
  },
  {
    slug: 'typeorm',
    crumb: 'TypeORM',
    title: 'TypeORM to ER Diagram — Visualize Your Entities',
    description: 'Turn your TypeORM entities into an interactive ER diagram. Paste your entity classes (or the SQL TypeORM generates) to visualize tables and relations. Free, in your browser.',
    keywords: 'typeorm to er diagram, typeorm erd, visualize typeorm entities, typeorm schema diagram, nestjs database diagram',
    h1: 'TypeORM to <span class="a">ER Diagram</span>',
    lead: 'Visualize your <strong>TypeORM</strong> entities as an interactive ER diagram. Paste the entity classes as they are — <code>@Entity</code>, <code>@Column</code>, <code>@ManyToOne</code> and <code>@ManyToMany</code> are read directly — or paste the SQL TypeORM generates if you want every database-level detail.',
    steps: [
      'Copy your entity classes — one file or several pasted together.',
      'Paste them into the editor (or drop the <code>.ts</code> file on the page). TypeORM is detected automatically.',
      'Each <code>@Entity</code> becomes a table; <code>@ManyToOne</code> / <code>@OneToOne</code> become foreign keys and <code>@ManyToMany</code> with <code>@JoinTable</code> becomes a junction table.',
      'Arrange, hide tables, then export PNG/SVG or convert to Mermaid/DBML.',
    ],
    exampleIntro: 'Paste TypeORM entities like these:',
    example: `@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  email: string;
}

@Entity()
export class Post {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  title: string;

  @ManyToOne(() => User)
  author: User;
}`,
    exampleAfter: '…and you get <code>User</code> and <code>Post</code> with a relation from <code>Post.authorId</code> → <code>User.id</code>.',
    why: [PRIVATE, '<strong>Straight from code:</strong> no migration run and no database needed — the entity decorators are read as they are.', INTERACTIVE, EXPORT, FREE],
    badges: ['TypeORM', 'SQL', 'Prisma', 'Sequelize'],
    faq: [
      { q: 'How do I get an ER diagram from TypeORM?', a: 'Paste your entity classes into the editor. Every class marked <code>@Entity</code> becomes a table, its <code>@Column</code> properties become columns, and its relations become foreign keys.' },
      { q: 'Which TypeORM features are read?', a: 'Decorator-style entities: <code>@Entity</code>, <code>@PrimaryGeneratedColumn</code>, <code>@PrimaryColumn</code>, <code>@Column</code>, the date and version columns, <code>@ManyToOne</code>, <code>@OneToOne</code> with <code>@JoinColumn</code>, and <code>@ManyToMany</code> with <code>@JoinTable</code>. <code>EntitySchema</code> definitions are read too. For exact database types, paste the SQL from <code>typeorm migration:generate</code> instead.' },
      FAQ_PRIVATE, FAQ_FREE,
    ],
    related: [R.sequelize, R.prisma, R.postgresql, R.sqlalchemy, R.home],
  },
  {
    slug: 'django',
    crumb: 'Django',
    title: 'Django Models to ER Diagram — Visualize Your Schema',
    description: 'Turn your Django models into an interactive ER diagram. Paste models.py (or the SQL from sqlmigrate) to visualize tables and relations. Free, in your browser.',
    keywords: 'django to er diagram, django models erd, visualize django models, django schema diagram, django database diagram',
    h1: 'Django to <span class="a">ER Diagram</span>',
    lead: 'Visualize your <strong>Django</strong> models as an interactive ER diagram. Paste <code>models.py</code> as it is — fields, <code>ForeignKey</code>, <code>OneToOneField</code>, <code>ManyToManyField</code> and abstract base models are read directly — or paste the SQL from <code>sqlmigrate</code> for the exact database tables.',
    steps: [
      'Copy your <code>models.py</code> — one app or several pasted together.',
      'Paste it into the editor (or drop the <code>.py</code> file on the page). Django is detected automatically.',
      'Each model becomes a table with Django’s implicit <code>id</code>; <code>ForeignKey</code> and <code>OneToOneField</code> become foreign keys and <code>ManyToManyField</code> becomes a junction table.',
      'Arrange, hide tables, then export PNG/SVG or convert to Mermaid/DBML.',
    ],
    exampleIntro: 'Paste Django models like these:',
    example: `from django.db import models

class Author(models.Model):
    name = models.CharField(max_length=100)

class Post(models.Model):
    title = models.CharField(max_length=200)
    author = models.ForeignKey(Author, on_delete=models.CASCADE)`,
    exampleAfter: '…and you get <code>Author</code> and <code>Post</code> with a relation from <code>Post.author_id</code> → <code>Author.id</code>.',
    why: [PRIVATE, '<strong>Straight from code:</strong> no migration run and no database needed — <code>models.py</code> is read as it is.', INTERACTIVE, EXPORT, FREE],
    badges: ['Django', 'SQL', 'SQLAlchemy', 'PostgreSQL'],
    faq: [
      { q: 'How do I make an ER diagram from Django models?', a: 'Paste your <code>models.py</code> into the editor. Each model becomes a table, and <code>ForeignKey</code>, <code>OneToOneField</code> and <code>ManyToManyField</code> become relations.' },
      { q: 'Can I see all apps at once?', a: 'Yes. Paste the models from several apps together — relations written as <code>"app.Model"</code> are linked by the model name.' },
      { q: 'Are the table names the real database names?', a: 'A model that sets <code>db_table</code> in its <code>Meta</code> is shown under that name. Otherwise the table is labelled with the model class name (<code>Post</code>), because Django’s default <code>app_post</code> name depends on the app label, which <code>models.py</code> doesn’t contain. For the exact tables, paste the output of <code>python manage.py sqlmigrate yourapp 0001</code> instead.' },
      FAQ_PRIVATE, FAQ_FREE,
    ],
    related: [R.sqlalchemy, R.postgresql, R.prisma, R.mysql, R.home],
  },

  // ---------------- CONVERTERS ----------------
  {
    slug: 'sql-to-mermaid',
    crumb: 'SQL to Mermaid',
    title: 'SQL to Mermaid — Convert SQL Schema to a Mermaid erDiagram',
    description: 'Paste SQL CREATE TABLE statements and export a Mermaid erDiagram. Free online SQL → Mermaid converter that also draws the live diagram. Runs in your browser.',
    keywords: 'sql to mermaid, convert sql to mermaid, sql to mermaid erdiagram, generate mermaid from sql, create table to mermaid',
    h1: 'SQL to <span class="a">Mermaid</span>',
    lead: 'Paste your SQL <code>CREATE TABLE</code> statements and get a <strong>Mermaid <code>erDiagram</code></strong> you can copy straight into Markdown, GitHub, or your docs — plus a live, interactive diagram.',
    steps: [
      'Paste your SQL schema into the editor (PostgreSQL, MySQL, SQLite or SQL Server).',
      'The diagram renders instantly so you can check it.',
      'Click <strong>Export → Mermaid</strong> and copy the <code>erDiagram</code> code.',
      'Drop it into any Mermaid-aware Markdown (GitHub, GitLab, Notion, Obsidian…).',
    ],
    exampleIntro: 'This SQL:',
    example: `CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE
);
CREATE TABLE posts (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id)
);`,
    example2: `erDiagram
    users {
        serial id PK
        text email
    }
    posts {
        serial id PK
        int user_id FK
    }
    users ||--o{ posts : "user_id"`,
    example2label: '…exports as this Mermaid:',
    exampleAfter: 'Copy it from <strong>Export → Mermaid</strong>.',
    why: [PRIVATE, '<strong>Paste-ready Mermaid</strong> for GitHub / GitLab / Notion / Obsidian.', '<strong>Verify visually</strong> — see the live diagram before you copy.', FREE],
    badges: ['SQL → Mermaid', 'SQL → DBML', 'SQL → PlantUML', 'PNG / SVG'],
    faq: [
      { q: 'How do I convert SQL to a Mermaid ER diagram?', a: 'Paste your CREATE TABLE statements, then click Export → Mermaid and copy the erDiagram code. Foreign keys become relationships.' },
      { q: 'Where can I use the Mermaid output?', a: 'Anywhere Mermaid renders: GitHub & GitLab Markdown, Notion, Obsidian, docs sites, and the Mermaid Live Editor.' },
      FAQ_PRIVATE, FAQ_FREE,
    ],
    related: [R.mermaid, R.sql2dbml, R.sql2plantuml, R.dbml, R.home],
  },
  {
    slug: 'prisma-to-dbml',
    crumb: 'Prisma to DBML',
    title: 'Prisma to DBML — Convert a Prisma Schema to DBML',
    description: 'Paste your schema.prisma and export DBML. Free online Prisma → DBML converter that also renders the live ER diagram. Runs entirely in your browser.',
    keywords: 'prisma to dbml, convert prisma to dbml, prisma schema to dbml, generate dbml from prisma, schema.prisma to dbml',
    h1: 'Prisma to <span class="a">DBML</span>',
    lead: 'Paste your <code>schema.prisma</code> and export it as <strong>DBML</strong> — ready for dbdiagram.io and other DBML tools — while you preview the live ER diagram.',
    steps: [
      'Paste the contents of your <code>schema.prisma</code> — Prisma is auto-detected.',
      'The diagram renders so you can confirm models and relations.',
      'Click <strong>Export → DBML</strong> and copy the result.',
      'Paste it into dbdiagram.io or any DBML-based workflow.',
    ],
    exampleIntro: 'This Prisma schema:',
    example: `model User {
  id    Int    @id @default(autoincrement())
  email String @unique
  posts Post[]
}
model Post {
  id       Int  @id @default(autoincrement())
  author   User @relation(fields: [authorId], references: [id])
  authorId Int
}`,
    example2: `Table "User" {
  "id" Int [pk]
  "email" String [unique]
}
Table "Post" {
  "id" Int [pk]
  "authorId" Int
}
Ref: "Post"."authorId" > "User"."id"`,
    example2label: '…exports as this DBML:',
    exampleAfter: 'Copy it from <strong>Export → DBML</strong>.',
    why: [PRIVATE, '<strong>dbdiagram.io-ready</strong> DBML output.', '<strong>Preview first</strong> — see the relations drawn before exporting.', FREE],
    badges: ['Prisma → DBML', 'Prisma → Mermaid', 'Prisma → SVG'],
    faq: [
      { q: 'How do I convert a Prisma schema to DBML?', a: 'Paste your schema.prisma, then click Export → DBML and copy the output. Models become Tables and @relation fields become Refs.' },
      FAQ_PRIVATE, FAQ_FREE,
    ],
    related: [R.prisma, R.dbml, R.sql2mermaid, R.dbml2er, R.home],
  },
  {
    slug: 'dbml-to-er-diagram',
    crumb: 'DBML to ER Diagram',
    title: 'DBML to ER Diagram — Render DBML Online, Free',
    description: 'Paste DBML and render an interactive ER diagram instantly — a free dbdiagram-style DBML viewer that runs in your browser. Export PNG, SVG, Mermaid.',
    keywords: 'dbml to er diagram, render dbml online, dbml viewer, dbml diagram generator, dbdiagram alternative, visualize dbml',
    h1: 'DBML to <span class="a">ER Diagram</span>',
    lead: 'Paste <strong>DBML</strong> and instantly render an interactive entity-relationship diagram — drag, arrange, and export. A free, in-browser DBML viewer.',
    steps: [
      'Copy your DBML (from dbdiagram.io or a <code>.dbml</code> file).',
      'Paste it into the editor — DBML is auto-detected.',
      'Tables and <code>Ref:</code> relations are drawn immediately.',
      'Arrange, hide tables, then export PNG/SVG or convert to Mermaid/PlantUML.',
    ],
    exampleIntro: 'DBML like this:',
    example: `Table users {
  id integer [pk]
  email varchar [unique]
}
Table orders {
  id integer [pk]
  user_id integer [ref: > users.id]
  total decimal
}`,
    exampleAfter: '…renders two tables with a relation from <code>orders.user_id</code> → <code>users.id</code>.',
    why: [PRIVATE, INTERACTIVE, '<strong>Convert</strong> DBML to Mermaid, PlantUML, PNG or SVG.', FREE],
    badges: ['DBML', 'Mermaid', 'PlantUML', 'SQL'],
    faq: [
      { q: 'Is this a free dbdiagram alternative?', a: 'Yes — paste DBML and get an interactive diagram for free, with no account. You can also export to Mermaid, PlantUML, PNG or SVG.' },
      { q: 'Does it support Ref and inline references?', a: 'Yes — both standalone <code>Ref:</code> lines and inline <code>[ref: &gt; table.col]</code> settings are parsed.' },
      FAQ_PRIVATE, FAQ_FREE,
    ],
    related: [R.dbmlViewer, R.dbml, R.mermaid2erd, R.prisma2dbml, R.sql2mermaid, R.home],
  },
  {
    slug: 'mermaid-to-erd',
    crumb: 'Mermaid to ERD',
    title: 'Mermaid to ERD — Render a Mermaid erDiagram, Interactive',
    description: 'Paste a Mermaid erDiagram and turn it into an interactive ERD you can drag, arrange and export. Free, open source, runs in your browser.',
    keywords: 'mermaid to erd, mermaid erdiagram to diagram, render mermaid er diagram, interactive mermaid erd, mermaid er viewer',
    h1: 'Mermaid to <span class="a">ERD</span>',
    lead: 'Paste a <strong>Mermaid</strong> <code>erDiagram</code> and turn the text into a fully interactive ERD — drag tables, auto-arrange, and export to image, DBML or PlantUML.',
    steps: [
      'Copy your Mermaid <code>erDiagram</code>.',
      'Paste it into the editor — Mermaid is auto-detected.',
      'Entities become draggable tables; relationships are drawn with cardinality.',
      'Arrange, then export PNG/SVG or convert to DBML/PlantUML.',
    ],
    exampleIntro: 'A Mermaid erDiagram like this:',
    example: `erDiagram
  CUSTOMER ||--o{ ORDER : places
  CUSTOMER {
    int id PK
    string name
  }
  ORDER {
    int id PK
    int customer_id FK
  }`,
    exampleAfter: '…becomes an interactive ERD with <code>CUSTOMER</code> linked to <code>ORDER</code>.',
    why: [PRIVATE, '<strong>Interactive</strong> — not a static image; drag and rearrange freely.', '<strong>Convert</strong> Mermaid to DBML, PlantUML, PNG or SVG.', FREE],
    badges: ['Mermaid', 'DBML', 'PlantUML', 'PNG / SVG'],
    faq: [
      { q: 'How do I turn Mermaid text into a diagram I can edit?', a: 'Paste the Mermaid erDiagram here — it renders as draggable tables you can arrange, then export as an image or convert to DBML/PlantUML.' },
      FAQ_PRIVATE, FAQ_FREE,
    ],
    related: [R.mermaid, R.dbml2er, R.sql2mermaid, R.prisma, R.home],
  },

  // ---------------- DIALECTS (expansion) ----------------
  {
    slug: 'oracle',
    crumb: 'Oracle',
    title: 'Oracle to ER Diagram — Free Online Oracle Schema Visualizer',
    description: 'Paste Oracle SQL (CREATE TABLE / DDL) and instantly generate an interactive ER diagram. Free, open source, runs in your browser — nothing uploaded.',
    keywords: 'oracle to er diagram, oracle erd, oracle schema diagram, visualize oracle database, oracle entity relationship diagram, oracle ddl diagram',
    h1: 'Oracle to <span class="a">ER Diagram</span>',
    lead: 'Paste your Oracle <code>CREATE TABLE</code> statements (or DDL from a schema export) and get a clean, interactive entity-relationship diagram — tables, columns, primary keys and foreign keys, drawn automatically.',
    steps: [
      'Export the schema DDL — in SQL Developer (right-click the schema → Export), or via <code>DBMS_METADATA.GET_DDL</code>.',
      'Paste it into the editor — the Oracle SQL is parsed automatically.',
      'Tables render with columns and types; <code>CONSTRAINT … FOREIGN KEY</code> relations are drawn.',
      'Arrange, hide tables, then export PNG/SVG or convert to Mermaid/DBML.',
    ],
    exampleIntro: 'An Oracle schema like this:',
    example: `CREATE TABLE customers (
  id NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  email VARCHAR2(255) NOT NULL UNIQUE
);

CREATE TABLE orders (
  id NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  customer_id NUMBER NOT NULL,
  CONSTRAINT fk_orders_customers
    FOREIGN KEY (customer_id) REFERENCES customers(id)
);`,
    exampleAfter: '…renders two tables with a relation from <code>orders.customer_id</code> → <code>customers.id</code>.',
    why: [PRIVATE, INTERACTIVE, EXPORT, '<strong>Handles Oracle types</strong> like <code>NUMBER</code> / <code>VARCHAR2</code> and named constraints.', FREE],
    badges: ['Oracle', 'PL/SQL', 'PostgreSQL', 'MySQL', 'SQL Server'],
    faq: [
      { q: 'How do I create an ER diagram from an Oracle database?', a: 'Export the schema DDL with SQL Developer or <code>DBMS_METADATA.GET_DDL</code>, then paste the CREATE TABLE statements here. Foreign-key constraints become relations automatically.' },
      FAQ_PRIVATE, FAQ_EXPORT, FAQ_FREE,
    ],
    related: [R.postgresql, R.mysql, R.sqlserver, R.snowflake, R.home],
  },
  {
    slug: 'mariadb',
    crumb: 'MariaDB',
    title: 'MariaDB to ER Diagram — Free Online MariaDB Schema Visualizer',
    description: 'Paste MariaDB CREATE TABLE statements or a mysqldump and instantly generate an interactive ER diagram. Free, open source, runs in your browser — nothing uploaded.',
    keywords: 'mariadb to er diagram, mariadb erd, mariadb schema diagram, visualize mariadb database, mariadb entity relationship diagram',
    h1: 'MariaDB to <span class="a">ER Diagram</span>',
    lead: 'Paste your MariaDB <code>CREATE TABLE</code> statements (or a <code>mysqldump</code>) and get an interactive entity-relationship diagram — tables, columns, keys and foreign keys, drawn automatically.',
    steps: [
      'Dump your schema with <code>mysqldump --no-data your_db</code> (MariaDB ships the same client), or copy your <code>CREATE TABLE</code> statements.',
      'Paste it into the editor — the SQL is parsed automatically.',
      'Every table renders with its columns; <code>FOREIGN KEY</code> constraints become relations.',
      'Arrange, hide tables, then export PNG/SVG or share a link.',
    ],
    exampleIntro: 'A MariaDB schema like this:',
    example: `CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE posts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;`,
    exampleAfter: '…renders two tables with a relation from <code>posts.user_id</code> → <code>users.id</code>.',
    why: [PRIVATE, INTERACTIVE, EXPORT, '<strong>mysqldump-friendly</strong> — paste the dump as-is.', FREE],
    badges: ['MariaDB', 'MySQL', 'PostgreSQL', 'SQLite'],
    faq: [
      { q: 'Does it work with MariaDB dumps?', a: 'Yes — MariaDB uses the same CREATE TABLE / mysqldump syntax as MySQL. Paste the schema dump and tables + foreign keys are drawn instantly.' },
      FAQ_PRIVATE, FAQ_EXPORT, FAQ_FREE,
    ],
    related: [R.mysql, R.postgresql, R.sqlite, R.sqlserver, R.home],
  },
  {
    slug: 'snowflake',
    crumb: 'Snowflake',
    title: 'Snowflake to ER Diagram — Free Online Snowflake Schema Visualizer',
    description: 'Paste Snowflake SQL (CREATE TABLE / CREATE OR REPLACE TABLE) and instantly generate an interactive ER diagram. Free, open source, runs in your browser — nothing uploaded.',
    keywords: 'snowflake to er diagram, snowflake erd, snowflake schema diagram, visualize snowflake database, snowflake entity relationship diagram',
    h1: 'Snowflake to <span class="a">ER Diagram</span>',
    lead: 'Paste your Snowflake <code>CREATE TABLE</code> (or <code>CREATE OR REPLACE TABLE</code>) statements and get an interactive entity-relationship diagram of your warehouse schema — tables, columns and foreign keys, drawn automatically.',
    steps: [
      'Get the DDL with <code>SELECT GET_DDL(\'TABLE\', \'your_table\')</code> in a worksheet, or copy your <code>CREATE TABLE</code> statements.',
      'Paste it into the editor — Snowflake SQL parses, including <code>CREATE OR REPLACE</code> and <code>TRANSIENT</code> tables.',
      'Tables render with types like <code>VARIANT</code>, <code>NUMBER</code> and <code>TIMESTAMP_NTZ</code>; foreign keys become relations.',
      'Arrange, hide tables, then export PNG/SVG or convert to Mermaid/DBML.',
    ],
    exampleIntro: 'A Snowflake schema like this:',
    example: `CREATE OR REPLACE TABLE customers (
  id NUMBER(38,0) PRIMARY KEY,
  email VARCHAR NOT NULL,
  profile VARIANT
);

CREATE TABLE orders (
  id NUMBER(38,0) PRIMARY KEY,
  customer_id NUMBER(38,0) REFERENCES customers(id)
);`,
    exampleAfter: '…renders two tables with a relation from <code>orders.customer_id</code> → <code>customers.id</code>.',
    why: [PRIVATE, INTERACTIVE, EXPORT, '<strong>Snowflake-aware</strong> — <code>CREATE OR REPLACE</code>, <code>TRANSIENT</code> tables and <code>VARIANT</code> all parse.', FREE],
    badges: ['Snowflake', 'BigQuery', 'PostgreSQL', 'SQL Server'],
    faq: [
      { q: 'How do I diagram a Snowflake schema?', a: 'Run <code>SELECT GET_DDL(\'TABLE\', \'your_table\')</code> (or script several tables) and paste the DDL here. CREATE OR REPLACE TABLE and foreign keys are handled.' },
      FAQ_PRIVATE, FAQ_EXPORT, FAQ_FREE,
    ],
    related: [R.bigquery, R.postgresql, R.sqlserver, R.mysql, R.home],
  },
  {
    slug: 'bigquery',
    crumb: 'BigQuery',
    title: 'BigQuery to ER Diagram — Visualize CTEs & Schemas, Free',
    description: 'Paste a BigQuery WITH / CTE query or CREATE TABLE DDL and instantly render an interactive diagram. Free, open source, runs in your browser — nothing uploaded.',
    keywords: 'bigquery to er diagram, bigquery erd, bigquery cte diagram, visualize bigquery query, bigquery schema diagram, bigquery lineage',
    h1: 'BigQuery to <span class="a">ER Diagram</span>',
    lead: 'Turn a <strong>BigQuery</strong> query into a diagram. Paste a <code>WITH … AS (…)</code> CTE query and each CTE becomes a node, with edges inferred from the <code>FROM</code> / <code>JOIN</code> tables it reads — or paste plain <code>CREATE TABLE</code> DDL for a classic ER diagram.',
    steps: [
      'Copy a BigQuery <code>WITH</code> / CTE query, or your <code>CREATE TABLE</code> DDL.',
      'Paste it into the editor — BigQuery CTE queries are auto-detected.',
      'Each CTE becomes a node; columns come from its <code>SELECT</code> list, and <code>FROM</code>/<code>JOIN</code> references (including backtick <code>project.dataset.table</code>) are drawn as edges.',
      'Arrange, hide nodes, then export PNG/SVG or convert to Mermaid/DBML.',
    ],
    exampleIntro: 'A BigQuery CTE query like this:',
    example: `WITH customers AS (
  SELECT id, email FROM \`proj.shop.customers_raw\`
),
orders AS (
  SELECT o.id, o.customer_id
  FROM \`proj.shop.orders_raw\` o
)
SELECT * FROM orders`,
    exampleAfter: '…renders <code>customers</code> and <code>orders</code> as nodes, linked to the base tables they read from.',
    why: [PRIVATE, '<strong>CTE lineage</strong> — see how each <code>WITH</code> step depends on tables and other CTEs.', INTERACTIVE, EXPORT, FREE],
    badges: ['BigQuery', 'CTE / WITH', 'Snowflake', 'SQL'],
    faq: [
      { q: 'How do I visualize a BigQuery CTE query?', a: 'Paste your <code>WITH … AS (…)</code> query. Each CTE becomes a node, columns come from its SELECT list, and references to other CTEs or backtick-quoted <code>project.dataset.table</code> tables are drawn as edges.' },
      { q: 'Does it work with BigQuery CREATE TABLE DDL too?', a: 'Yes — paste standard CREATE TABLE statements and it draws a classic ER diagram with foreign-key relations.' },
      FAQ_PRIVATE, FAQ_FREE,
    ],
    related: [R.snowflake, R.postgresql, R.sql2mermaid, R.mysql, R.home],
  },

  // ---------------- FORMATS (expansion) ----------------
  {
    slug: 'plantuml',
    crumb: 'PlantUML',
    title: 'PlantUML to ER Diagram — Free Online PlantUML Viewer',
    description: 'Paste a PlantUML entity/class diagram and render it as an interactive ER diagram you can drag, arrange and export. Free, open source, runs in your browser.',
    keywords: 'plantuml to er diagram, plantuml erd, render plantuml online, plantuml entity diagram, visualize plantuml schema, plantuml er viewer',
    h1: 'PlantUML to <span class="a">ER Diagram</span>',
    lead: 'Paste a <strong>PlantUML</strong> entity or class diagram and turn it into a fully interactive ER diagram — drag tables, auto-arrange, and export — no Java or PlantUML server required.',
    steps: [
      'Copy your PlantUML <code>@startuml … @enduml</code> block (entity or class diagram).',
      'Paste it into the editor — PlantUML is auto-detected.',
      'Each <code>entity</code> / <code>class</code> becomes a table; relationship lines become relations.',
      'Arrange, hide tables, then export PNG/SVG or convert to Mermaid/DBML.',
    ],
    exampleIntro: 'PlantUML like this:',
    example: `@startuml
entity users {
  * id : int
  email : varchar
}
entity orders {
  * id : int
  user_id : int
}
users ||--o{ orders
@enduml`,
    exampleAfter: '…renders two tables with a relation from <code>orders</code> → <code>users</code>.',
    why: [PRIVATE, '<strong>No server needed</strong> — renders instantly in the browser, unlike a PlantUML render pipeline.', INTERACTIVE, EXPORT, FREE],
    badges: ['PlantUML', 'Mermaid', 'DBML', 'SQL'],
    faq: [
      { q: 'Do I need a PlantUML server or Java?', a: 'No — paste the PlantUML text and it renders directly in your browser as an interactive diagram you can edit and export.' },
      { q: 'Which PlantUML diagrams work?', a: 'Entity-relationship and class diagrams: <code>entity</code> / <code>class</code> blocks with fields, plus relationship connectors like <code>||--o{</code>.' },
      FAQ_PRIVATE, FAQ_FREE,
    ],
    related: [R.plantumlViewer, R.mermaid, R.dbml, R.sql2plantuml, R.sql2mermaid, R.home],
  },

  // ---------------- CONVERTERS (expansion) ----------------
  {
    slug: 'ddl-to-er-diagram',
    crumb: 'DDL to ER Diagram',
    title: 'DDL to ER Diagram — Turn SQL DDL into a Diagram, Free',
    description: 'Paste your SQL DDL (CREATE TABLE / ALTER TABLE) and instantly generate an interactive ER diagram. Free, open source, runs in your browser — nothing uploaded.',
    keywords: 'ddl to er diagram, ddl to erd, sql ddl diagram, create table to er diagram, generate er diagram from ddl, ddl visualizer',
    h1: 'DDL to <span class="a">ER Diagram</span>',
    lead: 'Paste your database <strong>DDL</strong> — the <code>CREATE TABLE</code> and <code>ALTER TABLE</code> statements that define your schema — and get an interactive ER diagram with every table, column and foreign key drawn automatically.',
    steps: [
      'Copy your DDL from a migration, schema dump, or your database client.',
      'Paste it into the editor — PostgreSQL, MySQL, SQLite, SQL Server, Oracle and Snowflake DDL all parse.',
      'Tables render with columns; inline <code>REFERENCES</code> and <code>FOREIGN KEY</code> constraints become relations.',
      'Arrange, hide tables, then export PNG/SVG or convert to Mermaid/DBML.',
    ],
    exampleIntro: 'DDL like this:',
    example: `CREATE TABLE authors (
  id BIGINT PRIMARY KEY,
  name VARCHAR(120) NOT NULL
);

CREATE TABLE books (
  id BIGINT PRIMARY KEY,
  author_id BIGINT NOT NULL
);

ALTER TABLE books
  ADD CONSTRAINT fk_books_authors
  FOREIGN KEY (author_id) REFERENCES authors(id);`,
    exampleAfter: '…renders two tables with a relation from <code>books.author_id</code> → <code>authors.id</code>, including the <code>ALTER TABLE</code> foreign key.',
    why: [PRIVATE, '<strong>Dialect-agnostic</strong> — paste DDL from any major database.', INTERACTIVE, EXPORT, FREE],
    badges: ['DDL', 'PostgreSQL', 'MySQL', 'Oracle', 'SQL Server'],
    faq: [
      { q: 'What counts as DDL?', a: 'Data Definition Language — the <code>CREATE TABLE</code>, <code>ALTER TABLE</code> and constraint statements that define your schema. Paste them and the diagram is drawn instantly.' },
      { q: 'Does it read ALTER TABLE foreign keys?', a: 'Yes — foreign keys added via <code>ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY</code> (as pg_dump emits) are parsed and drawn as relations.' },
      FAQ_PRIVATE, FAQ_FREE,
    ],
    related: [R.erdGen, R.postgresql, R.mysql, R.oracle, R.sqlserver, R.home],
  },
  {
    slug: 'sql-to-dbml',
    crumb: 'SQL to DBML',
    title: 'SQL to DBML Converter — Free, Online, No Signup',
    description: 'Convert SQL to DBML free — paste your CREATE TABLE statements and export dbdiagram.io-ready DBML, with a live ER diagram to verify it. No signup, nothing uploaded, runs in your browser.',
    keywords: 'sql to dbml, convert sql to dbml, create table to dbml, generate dbml from sql, sql schema to dbml, dbml converter',
    h1: 'SQL to <span class="a">DBML</span>',
    lead: 'Paste your SQL <code>CREATE TABLE</code> statements and export them as <strong>DBML</strong> — ready for dbdiagram.io and other DBML tools — while you preview the live ER diagram.',
    steps: [
      'Paste your SQL schema into the editor (PostgreSQL, MySQL, SQLite, SQL Server, Oracle…).',
      'The diagram renders instantly so you can confirm the tables and relations.',
      'Click <strong>Export → DBML</strong> and copy the result.',
      'Paste it into dbdiagram.io or any DBML-based workflow.',
    ],
    exampleIntro: 'This SQL:',
    example: `CREATE TABLE customers (
  id BIGINT PRIMARY KEY,
  name VARCHAR(120) NOT NULL
);
CREATE TABLE invoices (
  id BIGINT PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id),
  total NUMERIC(10,2)
);`,
    example2: `Table "customers" {
  "id" bigint [pk]
  "name" varchar(120) [not null]
}

Table "invoices" {
  "id" bigint [pk]
  "customer_id" bigint [not null]
  "total" "numeric(10,2)"
}

Ref: "invoices"."customer_id" > "customers"."id"`,
    example2label: '…exports as this DBML:',
    exampleAfter: 'Copy it from <strong>Export → DBML</strong>.',
    why: [PRIVATE, '<strong>dbdiagram.io-ready</strong> DBML output.', '<strong>Verify visually</strong> — see the live diagram before you copy.', FREE],
    badges: ['SQL → DBML', 'SQL → Mermaid', 'SQL → PlantUML', 'PNG / SVG'],
    faq: [
      { q: 'How do I convert SQL to DBML?', a: 'Paste your CREATE TABLE statements, then click Export → DBML and copy the output. Tables become <code>Table</code> blocks and foreign keys become <code>Ref:</code> lines.' },
      { q: 'Is this a free dbdiagram importer?', a: 'Yes — convert SQL to DBML for free and paste it straight into dbdiagram.io, with no account.' },
      FAQ_PRIVATE, FAQ_FREE,
    ],
    related: [R.dbml, R.sql2mermaid, R.sql2plantuml, R.dbml2er, R.home],
  },
  {
    slug: 'sql-to-plantuml',
    crumb: 'SQL to PlantUML',
    title: 'SQL to PlantUML — Convert SQL to a PlantUML ER Diagram',
    description: 'Paste SQL CREATE TABLE statements and export a PlantUML entity diagram. Free online SQL → PlantUML converter that also draws the live diagram. Runs in your browser.',
    keywords: 'sql to plantuml, convert sql to plantuml, sql to plantuml er diagram, generate plantuml from sql, create table to plantuml',
    h1: 'SQL to <span class="a">PlantUML</span>',
    lead: 'Paste your SQL <code>CREATE TABLE</code> statements and get a <strong>PlantUML</strong> entity diagram you can drop into your docs or wiki — plus a live, interactive diagram to check it first.',
    steps: [
      'Paste your SQL schema into the editor (PostgreSQL, MySQL, SQLite, SQL Server, Oracle…).',
      'The diagram renders instantly so you can verify it.',
      'Click <strong>Export → PlantUML</strong> and copy the <code>@startuml</code> block.',
      'Paste it into any PlantUML renderer, Confluence, or your docs.',
    ],
    exampleIntro: 'This SQL:',
    example: `CREATE TABLE teams (
  id INT PRIMARY KEY,
  name VARCHAR(80) NOT NULL
);
CREATE TABLE players (
  id INT PRIMARY KEY,
  team_id INT REFERENCES teams(id),
  nickname VARCHAR(40)
);`,
    example2: `@startuml
hide circle
skinparam linetype ortho

entity "teams" as teams {
  * id : int <<PK>>
  --
  name : varchar(80)
}

entity "players" as players {
  * id : int <<PK>>
  --
  team_id : int <<FK>>
  nickname : varchar(40)
}

teams ||--o{ players
@enduml`,
    example2label: '…exports as this PlantUML:',
    exampleAfter: 'Copy it from <strong>Export → PlantUML</strong>.',
    why: [PRIVATE, '<strong>Docs-ready</strong> PlantUML for Confluence, wikis and READMEs.', '<strong>Preview first</strong> — see the diagram before exporting.', FREE],
    badges: ['SQL → PlantUML', 'SQL → Mermaid', 'SQL → DBML', 'PNG / SVG'],
    faq: [
      { q: 'How do I convert SQL to PlantUML?', a: 'Paste your CREATE TABLE statements, then click Export → PlantUML and copy the <code>@startuml</code> block. Foreign keys become relationship connectors.' },
      FAQ_PRIVATE, FAQ_FREE,
    ],
    related: [R.plantuml, R.sql2mermaid, R.sql2dbml, R.mermaid, R.home],
  },
  {
    slug: 'dbml-to-mermaid',
    crumb: 'DBML to Mermaid',
    title: 'DBML to Mermaid — Convert DBML to a Mermaid erDiagram',
    description: 'Paste DBML and export a Mermaid erDiagram. Free online DBML → Mermaid converter that also renders the live diagram. Runs entirely in your browser.',
    keywords: 'dbml to mermaid, convert dbml to mermaid, dbml to mermaid erdiagram, generate mermaid from dbml, dbml mermaid converter',
    h1: 'DBML to <span class="a">Mermaid</span>',
    lead: 'Paste <strong>DBML</strong> and export it as a <strong>Mermaid <code>erDiagram</code></strong> you can drop into Markdown, GitHub or your docs — while you preview the live, interactive diagram.',
    steps: [
      'Paste your DBML (from dbdiagram.io or a <code>.dbml</code> file) — DBML is auto-detected.',
      'The diagram renders instantly so you can confirm tables and relations.',
      'Click <strong>Export → Mermaid</strong> and copy the <code>erDiagram</code> code.',
      'Drop it into any Mermaid-aware Markdown (GitHub, GitLab, Notion, Obsidian…).',
    ],
    exampleIntro: 'This DBML:',
    example: `Table users {
  id integer [pk]
  email varchar [unique]
}
Table posts {
  id integer [pk]
  user_id integer [ref: > users.id]
}`,
    example2: `erDiagram
    users {
        integer id PK
        varchar email
    }
    posts {
        integer id PK
        integer user_id FK
    }
    users ||--o{ posts : "user_id"`,
    example2label: '…exports as this Mermaid:',
    exampleAfter: 'Copy it from <strong>Export → Mermaid</strong>.',
    why: [PRIVATE, '<strong>Paste-ready Mermaid</strong> for GitHub / GitLab / Notion / Obsidian.', '<strong>Round-trip</strong> — import DBML, export Mermaid, PlantUML, PNG or SVG.', FREE],
    badges: ['DBML → Mermaid', 'DBML → PlantUML', 'DBML → SVG'],
    faq: [
      { q: 'How do I convert DBML to Mermaid?', a: 'Paste your DBML, then click Export → Mermaid and copy the <code>erDiagram</code> code. Tables become entities and <code>Ref:</code> relations become Mermaid relationships.' },
      { q: 'Where can I use the Mermaid output?', a: 'Anywhere Mermaid renders: GitHub & GitLab Markdown, Notion, Obsidian, docs sites, and the Mermaid Live Editor.' },
      FAQ_PRIVATE, FAQ_FREE,
    ],
    related: [R.dbml, R.mermaid, R.sql2mermaid, R.dbml2er, R.home],
  },

  // ---------------- VIEWER / VISUALIZER INTENT ----------------
  {
    slug: 'dbml-viewer',
    crumb: 'DBML Viewer',
    title: 'DBML Viewer — View & Render DBML Online, Free',
    description: 'A free online DBML viewer — paste any DBML or .dbml file and instantly see an interactive ER diagram. No signup, nothing uploaded, runs in your browser. Export PNG, SVG, Mermaid.',
    keywords: 'dbml viewer, dbml online viewer, dbml file viewer, view dbml, render dbml online, dbml reader, open dbml file',
    h1: 'DBML <span class="a">Viewer</span>',
    lead: 'A free, in-browser <strong>DBML viewer</strong>. Paste any DBML — or the contents of a <code>.dbml</code> file — and see it rendered as an interactive entity-relationship diagram you can drag, arrange and export. Nothing is uploaded.',
    steps: [
      'Open your <code>.dbml</code> file (or copy DBML from dbdiagram.io).',
      'Paste it into the viewer — DBML is auto-detected.',
      'Every <code>Table</code> renders with its columns; <code>Ref:</code> and inline <code>[ref: &gt; …]</code> become relations.',
      'Drag to arrange, then export PNG/SVG or convert to Mermaid/PlantUML.',
    ],
    exampleIntro: 'Paste DBML like this:',
    example: `Table projects {
  id integer [pk]
  name varchar [not null]
}
Table tasks {
  id integer [pk]
  project_id integer [ref: > projects.id]
  title varchar
  done boolean
}`,
    exampleAfter: '…and the viewer draws two tables with a relation from <code>tasks.project_id</code> → <code>projects.id</code>.',
    why: [PRIVATE, '<strong>Opens any DBML</strong> — dbdiagram.io exports, <code>.dbml</code> files or snippets.', INTERACTIVE, '<strong>Convert</strong> what you view to Mermaid, PlantUML, PNG or SVG.', FREE],
    badges: ['DBML', 'Mermaid', 'PlantUML', 'SQL'],
    faq: [
      { q: 'How do I open a .dbml file?', a: 'Copy the contents of the <code>.dbml</code> file and paste it here — it renders instantly as an interactive diagram. Nothing is uploaded; it all runs in your browser.' },
      { q: 'Is this a free dbdiagram viewer?', a: 'Yes — paste DBML and view it as an interactive ER diagram for free, with no account, and export to Mermaid, PlantUML, PNG or SVG.' },
      FAQ_PRIVATE, FAQ_EXPORT, FAQ_FREE,
    ],
    related: [R.dbml2er, R.dbml, R.dbml2mermaid, R.prisma2dbml, R.home],
  },
  {
    slug: 'prisma-schema-visualizer',
    crumb: 'Prisma Schema Visualizer',
    title: 'Prisma Schema Visualizer — Visualize schema.prisma Online, Free',
    description: 'A free online Prisma schema visualizer — paste your schema.prisma and instantly see an interactive ER diagram of your models and relations. No signup, nothing uploaded.',
    keywords: 'prisma schema visualizer, prisma visualizer, visualize prisma schema, prisma er diagram, prisma schema visualization, schema.prisma diagram, prismalizer',
    h1: 'Prisma Schema <span class="a">Visualizer</span>',
    lead: 'A free, in-browser <strong>Prisma schema visualizer</strong>. Paste your <code>schema.prisma</code> and instantly see every model, field and relation drawn as an interactive ER diagram — no CLI, no generators, nothing uploaded.',
    steps: [
      'Copy the contents of your <code>schema.prisma</code>.',
      'Paste it into the visualizer — Prisma is auto-detected.',
      'Each <code>model</code> becomes a table; <code>@relation</code> fields become relations with the right cardinality.',
      'Drag to arrange, then export PNG/SVG or convert to DBML/Mermaid.',
    ],
    exampleIntro: 'Paste a schema like this:',
    example: `model Team {
  id      Int      @id @default(autoincrement())
  name    String   @unique
  members Member[]
}
model Member {
  id     Int    @id @default(autoincrement())
  email  String
  team   Team   @relation(fields: [teamId], references: [id])
  teamId Int
}`,
    exampleAfter: '…and the visualizer draws <code>Team</code> and <code>Member</code> with a relation between them.',
    why: [PRIVATE, '<strong>Reads schema.prisma directly</strong> — no <code>prisma generate</code> or extra tooling.', INTERACTIVE, '<strong>Convert</strong> to DBML, Mermaid, PlantUML, PNG or SVG.', FREE],
    badges: ['Prisma', 'DBML', 'Mermaid', 'SQL'],
    faq: [
      { q: 'Is there a way to visualize Prisma schema models and their relations graphically?', a: 'Yes — paste your <code>schema.prisma</code> here and every model and <code>@relation</code> is drawn as an interactive ER diagram, instantly and for free.' },
      { q: 'Do I need to run Prisma or install anything?', a: 'No. It reads the schema text directly in your browser — nothing is generated, executed or uploaded.' },
      FAQ_PRIVATE, FAQ_EXPORT, FAQ_FREE,
    ],
    related: [R.prisma, R.prisma2dbml, R.dbml2er, R.sqlalchemy, R.home],
  },
  {
    slug: 'plantuml-viewer',
    crumb: 'PlantUML Viewer',
    title: 'PlantUML Viewer — Render PlantUML Online, No Server, Free',
    description: 'A free online PlantUML viewer for entity & class diagrams — paste your @startuml block and render it instantly in the browser. No Java, no server, nothing uploaded.',
    keywords: 'plantuml viewer, plantuml online viewer, online puml viewer, render plantuml online, view plantuml, plantuml er viewer',
    h1: 'PlantUML <span class="a">Viewer</span>',
    lead: 'A free, in-browser <strong>PlantUML viewer</strong> for entity and class diagrams. Paste your <code>@startuml … @enduml</code> block and see it rendered as an interactive diagram — no Java, no PlantUML server, nothing uploaded.',
    steps: [
      'Copy your PlantUML <code>@startuml … @enduml</code> block.',
      'Paste it into the viewer — PlantUML is auto-detected.',
      'Each <code>entity</code> / <code>class</code> becomes a table; relationship lines become relations.',
      'Drag to arrange, then export PNG/SVG or convert to Mermaid/DBML.',
    ],
    exampleIntro: 'Paste PlantUML like this:',
    example: `@startuml
entity authors {
  * id : int
  name : varchar
}
entity books {
  * id : int
  author_id : int
  title : varchar
}
authors ||--o{ books
@enduml`,
    exampleAfter: '…and the viewer draws two tables with a relation from <code>books</code> → <code>authors</code>.',
    why: [PRIVATE, '<strong>No server, no Java</strong> — renders instantly in the browser, unlike a PlantUML render pipeline.', INTERACTIVE, EXPORT, FREE],
    badges: ['PlantUML', 'Mermaid', 'DBML', 'SQL'],
    faq: [
      { q: 'Do I need a PlantUML server or Java to view a diagram?', a: 'No — paste the PlantUML text and it renders directly in your browser as an interactive diagram you can edit and export.' },
      { q: 'Which PlantUML diagrams can I view?', a: 'Entity-relationship and class diagrams: <code>entity</code> / <code>class</code> blocks with fields, plus relationship connectors like <code>||--o{</code>.' },
      FAQ_PRIVATE, FAQ_EXPORT, FAQ_FREE,
    ],
    related: [R.plantuml, R.sql2plantuml, R.mermaid, R.dbml, R.home],
  },
  {
    slug: 'er-diagram-generator',
    crumb: 'ER Diagram Generator',
    title: 'ER Diagram Generator from SQL — Free, Online, No Signup',
    description: 'A free online ER diagram generator — paste your SQL (CREATE TABLE / DDL) and instantly generate an interactive entity-relationship diagram. No signup, nothing uploaded.',
    keywords: 'er diagram generator, er diagram generator from sql, erd generator from sql, sql er diagram generator, generate er diagram from sql, entity relationship diagram generator',
    h1: 'ER Diagram <span class="a">Generator</span>',
    lead: 'A free online <strong>ER diagram generator</strong>. Paste your SQL — <code>CREATE TABLE</code> statements or a full DDL dump — and instantly generate an interactive entity-relationship diagram with every table, column and foreign key drawn for you.',
    steps: [
      'Copy your SQL schema (PostgreSQL, MySQL, SQLite, SQL Server, Oracle, Snowflake…).',
      'Paste it into the generator — the dialect is detected automatically.',
      'The ER diagram is generated instantly: tables with columns, and foreign keys as relations.',
      'Arrange, hide tables, then export PNG/SVG or convert to Mermaid/DBML/PlantUML.',
    ],
    exampleIntro: 'Paste SQL like this:',
    example: `CREATE TABLE authors (
  id BIGINT PRIMARY KEY,
  name VARCHAR(120) NOT NULL
);

CREATE TABLE books (
  id BIGINT PRIMARY KEY,
  author_id BIGINT NOT NULL REFERENCES authors(id),
  title VARCHAR(200)
);`,
    exampleAfter: '…and the generator draws two tables with a relation from <code>books.author_id</code> → <code>authors.id</code>.',
    why: [PRIVATE, '<strong>Any SQL dialect</strong> — Postgres, MySQL, SQLite, SQL Server, Oracle, Snowflake, BigQuery.', INTERACTIVE, EXPORT, FREE],
    badges: ['SQL', 'PostgreSQL', 'MySQL', 'Oracle', 'SQL Server'],
    faq: [
      { q: 'How do I generate an ER diagram from SQL?', a: 'Paste your <code>CREATE TABLE</code> statements (or a schema dump) and the ER diagram is generated instantly — tables become entities and foreign keys become relations. No signup, nothing uploaded.' },
      { q: 'Which databases does the generator support?', a: 'PostgreSQL, MySQL, MariaDB, SQLite, SQL Server, Oracle, Snowflake and BigQuery DDL, plus Prisma, DBML, Mermaid, SQLAlchemy and Sequelize.' },
      FAQ_PRIVATE, FAQ_EXPORT, FAQ_FREE,
    ],
    related: [R.ddl2er, R.postgresql, R.mysql, R.sql2dbml, R.home],
  },
];

// ---------------- "At a glance" facts ----------------
// Per-page input/output phrasing for the quotable "At a glance" block and llms-full.txt.
//   thing    — noun phrase completing "…turns <thing> into <outThing>."
//   input    — full sentence: exactly what to paste
//   outThing — noun phrase (defaults to an interactive ER diagram)
//   output   — full sentence (defaults to GLANCE_DEFAULTS.output)
// Keep these plain, declarative and true: AI answer engines quote them verbatim.
export const GLANCE_DEFAULTS = {
  outThing: 'an interactive entity-relationship (ER) diagram',
  output: 'An interactive ER diagram you can rearrange, then export as PNG, SVG, Mermaid, DBML or PlantUML, or share as a link.',
  cost: 'Free. MIT-licensed open source. No account or signup.',
  privacy: 'Runs entirely in your browser. The schema is never uploaded, and share links carry the diagram in the URL fragment, which is not sent to a server.',
  limits: 'It never connects to your database itself: you paste schema text, or run one read-only catalog query in your own client and paste the result. There are no accounts, so there is no real-time multi-user editing; diagrams are kept in your browser, as a saved file, or as a share link. Layout stays smooth at around 300 tables.',
};
const SQL_CONVERT_IN = 'SQL <code>CREATE TABLE</code> statements for PostgreSQL, MySQL, MariaDB, SQLite, SQL Server, Oracle or Snowflake.';
export const GLANCE = {
  prisma: { thing: 'a Prisma schema', input: 'A Prisma schema: the contents of <code>schema.prisma</code>.' },
  mysql: { thing: 'a MySQL schema', input: 'MySQL <code>CREATE TABLE</code> statements, or the output of <code>mysqldump --no-data</code>.' },
  postgresql: { thing: 'a PostgreSQL schema', input: 'PostgreSQL <code>CREATE TABLE</code> and <code>ALTER TABLE</code> statements, or the output of <code>pg_dump --schema-only</code>.' },
  sqlite: { thing: 'a SQLite schema', input: 'SQLite <code>CREATE TABLE</code> statements, such as the output of <code>.schema</code>.' },
  'sql-server': { thing: 'a SQL Server schema', input: 'SQL Server (T-SQL) <code>CREATE TABLE</code> statements.' },
  dbml: { thing: 'DBML', input: 'DBML (Database Markup Language) text.' },
  mermaid: { thing: 'a Mermaid <code>erDiagram</code>', input: 'A Mermaid <code>erDiagram</code> block.' },
  sqlalchemy: { thing: 'SQLAlchemy models', input: 'SQLAlchemy declarative model classes (Python source).' },
  sequelize: { thing: 'Sequelize models', input: 'Sequelize model definitions (JavaScript source).' },
  typeorm: { thing: 'TypeORM entities', input: 'Decorator-style TypeORM entity classes (<code>@Entity</code>, <code>@Column</code>, <code>@ManyToOne</code>, <code>@ManyToMany</code>…), <code>EntitySchema</code> definitions, or the SQL TypeORM generates from them.' },
  django: { thing: 'Django models', input: 'A Django <code>models.py</code> (fields, <code>ForeignKey</code>, <code>OneToOneField</code>, <code>ManyToManyField</code>, abstract base models), or the SQL that <code>sqlmigrate</code> prints.' },
  'sql-to-mermaid': { thing: 'SQL <code>CREATE TABLE</code> statements', input: SQL_CONVERT_IN, outThing: 'a Mermaid <code>erDiagram</code>', output: 'Mermaid <code>erDiagram</code> code to copy, alongside a live interactive diagram.' },
  'prisma-to-dbml': { thing: 'a Prisma schema', input: 'A Prisma schema: the contents of <code>schema.prisma</code>.', outThing: 'DBML', output: 'DBML code to copy, alongside a live interactive diagram.' },
  'dbml-to-er-diagram': { thing: 'DBML', input: 'DBML (Database Markup Language) text.' },
  'mermaid-to-erd': { thing: 'a Mermaid <code>erDiagram</code>', input: 'A Mermaid <code>erDiagram</code> block.' },
  oracle: { thing: 'an Oracle schema', input: 'Oracle <code>CREATE TABLE</code> statements, or DDL from a schema export.' },
  mariadb: { thing: 'a MariaDB schema', input: 'MariaDB <code>CREATE TABLE</code> statements, or the output of <code>mysqldump --no-data</code>.' },
  snowflake: { thing: 'a Snowflake schema', input: 'Snowflake <code>CREATE TABLE</code> or <code>CREATE OR REPLACE TABLE</code> statements.' },
  bigquery: { thing: 'a BigQuery CTE query or BigQuery DDL', input: 'A BigQuery <code>WITH … AS (…)</code> CTE query, or BigQuery <code>CREATE TABLE</code> DDL.', outThing: 'an interactive diagram', output: 'An interactive diagram with one node per CTE or table and an edge for each table it reads, exportable as PNG or SVG.' },
  plantuml: { thing: 'a PlantUML entity or class diagram', input: 'A PlantUML entity or class diagram: an <code>@startuml … @enduml</code> block.' },
  'ddl-to-er-diagram': { thing: 'SQL DDL', input: 'SQL DDL: <code>CREATE TABLE</code> and <code>ALTER TABLE</code> statements for PostgreSQL, MySQL, MariaDB, SQLite, SQL Server, Oracle or Snowflake.' },
  'sql-to-dbml': { thing: 'SQL <code>CREATE TABLE</code> statements', input: SQL_CONVERT_IN, outThing: 'DBML', output: 'DBML code to copy, alongside a live interactive diagram.' },
  'sql-to-plantuml': { thing: 'SQL <code>CREATE TABLE</code> statements', input: SQL_CONVERT_IN, outThing: 'a PlantUML entity diagram', output: 'PlantUML entity-diagram code to copy, alongside a live interactive diagram.' },
  'dbml-to-mermaid': { thing: 'DBML', input: 'DBML (Database Markup Language) text.', outThing: 'a Mermaid <code>erDiagram</code>', output: 'Mermaid <code>erDiagram</code> code to copy, alongside a live interactive diagram.' },
  'dbml-viewer': { thing: 'DBML', input: 'DBML text, or the contents of a <code>.dbml</code> file.' },
  'prisma-schema-visualizer': { thing: 'a Prisma schema', input: 'A Prisma schema: the contents of <code>schema.prisma</code>.' },
  'plantuml-viewer': { thing: 'a PlantUML entity or class diagram', input: 'A PlantUML entity or class diagram: an <code>@startuml … @enduml</code> block.' },
  'er-diagram-generator': { thing: 'SQL', input: 'SQL <code>CREATE TABLE</code> statements or a full DDL dump, for PostgreSQL, MySQL, MariaDB, SQLite, SQL Server, Oracle or Snowflake.' },
};
