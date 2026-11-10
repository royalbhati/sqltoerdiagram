// Example-gallery schemas. Each renders as a live embedded diagram + "Open in editor".
// Targets "<domain> database schema example / diagram" searches.

export const GALLERY = [
  {
    slug: 'ecommerce',
    name: 'E-commerce',
    title: 'E-commerce Database Schema Example (ER Diagram)',
    description: 'A complete e-commerce database schema example — customers, products, orders, order items, payments and reviews — as an interactive ER diagram you can open and edit.',
    keywords: 'ecommerce database schema example, ecommerce er diagram, online store database design, shopping cart schema, order database schema',
    lead: 'A realistic <strong>e-commerce</strong> schema — customers and addresses, a product catalog, orders and line items, payments and reviews — shown as an interactive ER diagram.',
    about: 'This models a typical online store: customers place orders made up of line items referencing products, ship to saved addresses, pay via payments, and leave product reviews.',
    sql: `CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  full_name VARCHAR(120),
  created_at TIMESTAMP
);
CREATE TABLE addresses (
  id SERIAL PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES customers(id),
  line1 VARCHAR(255), city VARCHAR(80), country CHAR(2)
);
CREATE TABLE categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  parent_id INT REFERENCES categories(id)
);
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  category_id INT REFERENCES categories(id),
  sku VARCHAR(64) UNIQUE, name VARCHAR(200),
  price_cents INT, active BOOLEAN
);
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES customers(id),
  address_id INT REFERENCES addresses(id),
  status VARCHAR(32), total_cents INT, placed_at TIMESTAMP
);
CREATE TABLE order_items (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL REFERENCES orders(id),
  product_id INT NOT NULL REFERENCES products(id),
  quantity INT, unit_cents INT
);
CREATE TABLE payments (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL REFERENCES orders(id),
  amount_cents INT, method VARCHAR(32), paid_at TIMESTAMP
);
CREATE TABLE reviews (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id),
  customer_id INT NOT NULL REFERENCES customers(id),
  rating SMALLINT, body TEXT
);`,
  },
  {
    slug: 'blog',
    name: 'Blog / CMS',
    title: 'Blog Database Schema Example — SQL + Interactive ER Diagram',
    description: 'A complete blog / CMS database schema example — users, posts, comments, categories and tags — with the full SQL to copy and an interactive ER diagram. Free, no signup.',
    keywords: 'blog database schema example, cms database design, blog er diagram, posts comments tags schema, wordpress-like schema',
    lead: 'A classic <strong>blog / CMS</strong> schema — authors writing posts, threaded comments, categories, and many-to-many tags — as an interactive ER diagram.',
    about: 'Authors (users) write posts in a category; readers leave comments; posts and tags have a many-to-many relationship through a join table.',
    sql: `CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE,
  bio TEXT
);
CREATE TABLE categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(120) UNIQUE
);
CREATE TABLE posts (
  id SERIAL PRIMARY KEY,
  author_id INT NOT NULL REFERENCES users(id),
  category_id INT REFERENCES categories(id),
  title VARCHAR(200), slug VARCHAR(220) UNIQUE,
  body TEXT, published_at TIMESTAMP
);
CREATE TABLE comments (
  id SERIAL PRIMARY KEY,
  post_id INT NOT NULL REFERENCES posts(id),
  author_id INT REFERENCES users(id),
  parent_id INT REFERENCES comments(id),
  body TEXT, created_at TIMESTAMP
);
CREATE TABLE tags (
  id SERIAL PRIMARY KEY,
  name VARCHAR(60) UNIQUE NOT NULL
);
CREATE TABLE post_tags (
  post_id INT NOT NULL REFERENCES posts(id),
  tag_id INT NOT NULL REFERENCES tags(id),
  PRIMARY KEY (post_id, tag_id)
);`,
  },
  {
    slug: 'saas',
    name: 'SaaS (multi-tenant)',
    title: 'SaaS Multi-Tenant Database Schema Example (ER Diagram)',
    description: 'A multi-tenant SaaS database schema example — organizations, users, memberships, projects, plans and subscriptions — as an interactive ER diagram you can open and edit.',
    keywords: 'saas database schema example, multi-tenant database design, saas er diagram, organizations users subscriptions schema, b2b saas schema',
    lead: 'A <strong>multi-tenant SaaS</strong> schema — organizations with members, per-org projects, and plan-based subscriptions with invoices — as an interactive ER diagram.',
    about: 'Each organization (tenant) has users joined through memberships (with roles), owns projects, and subscribes to a plan; invoices belong to a subscription.',
    sql: `CREATE TABLE organizations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  slug VARCHAR(120) UNIQUE,
  created_at TIMESTAMP
);
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(120)
);
CREATE TABLE memberships (
  id SERIAL PRIMARY KEY,
  organization_id INT NOT NULL REFERENCES organizations(id),
  user_id INT NOT NULL REFERENCES users(id),
  role VARCHAR(20)
);
CREATE TABLE projects (
  id SERIAL PRIMARY KEY,
  organization_id INT NOT NULL REFERENCES organizations(id),
  name VARCHAR(160), archived BOOLEAN
);
CREATE TABLE plans (
  id SERIAL PRIMARY KEY,
  name VARCHAR(60), price_cents INT, seats INT
);
CREATE TABLE subscriptions (
  id SERIAL PRIMARY KEY,
  organization_id INT NOT NULL REFERENCES organizations(id),
  plan_id INT NOT NULL REFERENCES plans(id),
  status VARCHAR(20), renews_at TIMESTAMP
);
CREATE TABLE invoices (
  id SERIAL PRIMARY KEY,
  subscription_id INT NOT NULL REFERENCES subscriptions(id),
  amount_cents INT, issued_at TIMESTAMP, paid BOOLEAN
);`,
  },
  {
    slug: 'social-network',
    name: 'Social network',
    title: 'Social Network Database Schema Example — SQL + ER Diagram',
    description: 'A social network database schema example — users, followers, posts, likes, comments and DMs — with the full SQL to copy and an interactive ER diagram. Free, no signup.',
    keywords: 'social network database schema, social media database design, followers schema, posts likes comments schema, social app er diagram',
    lead: 'A <strong>social network</strong> schema — users following each other, posting, liking and commenting, plus direct messages — as an interactive ER diagram.',
    about: 'Users follow other users (self-referencing many-to-many via follows), create posts, like and comment on them, and send each other direct messages.',
    sql: `CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  handle VARCHAR(30) UNIQUE NOT NULL,
  display_name VARCHAR(80), avatar_url TEXT
);
CREATE TABLE follows (
  follower_id INT NOT NULL REFERENCES users(id),
  followee_id INT NOT NULL REFERENCES users(id),
  created_at TIMESTAMP,
  PRIMARY KEY (follower_id, followee_id)
);
CREATE TABLE posts (
  id SERIAL PRIMARY KEY,
  author_id INT NOT NULL REFERENCES users(id),
  body VARCHAR(280), created_at TIMESTAMP
);
CREATE TABLE likes (
  user_id INT NOT NULL REFERENCES users(id),
  post_id INT NOT NULL REFERENCES posts(id),
  PRIMARY KEY (user_id, post_id)
);
CREATE TABLE comments (
  id SERIAL PRIMARY KEY,
  post_id INT NOT NULL REFERENCES posts(id),
  author_id INT NOT NULL REFERENCES users(id),
  body VARCHAR(280), created_at TIMESTAMP
);
CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  sender_id INT NOT NULL REFERENCES users(id),
  recipient_id INT NOT NULL REFERENCES users(id),
  body TEXT, sent_at TIMESTAMP
);`,
  },
  {
    slug: 'project-management',
    name: 'Project management',
    title: 'Project Management Database Schema Example (ER Diagram)',
    description: 'A project management database schema example (Jira-style) — projects, tasks, assignees, labels and comments — as an interactive ER diagram you can open and edit.',
    keywords: 'project management database schema, task tracker database design, jira-like schema, tasks projects er diagram, issue tracker schema',
    lead: 'A <strong>project management</strong> schema (think Jira/Trello) — projects containing tasks, with assignees, labels and comments — as an interactive ER diagram.',
    about: 'Projects contain tasks; tasks are assigned to users through a join table, carry many-to-many labels, and accumulate comments.',
    sql: `CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(120)
);
CREATE TABLE projects (
  id SERIAL PRIMARY KEY,
  key VARCHAR(10) UNIQUE, name VARCHAR(160),
  lead_id INT REFERENCES users(id)
);
CREATE TABLE tasks (
  id SERIAL PRIMARY KEY,
  project_id INT NOT NULL REFERENCES projects(id),
  title VARCHAR(200), status VARCHAR(20),
  priority SMALLINT, due_date DATE,
  reporter_id INT REFERENCES users(id)
);
CREATE TABLE task_assignees (
  task_id INT NOT NULL REFERENCES tasks(id),
  user_id INT NOT NULL REFERENCES users(id),
  PRIMARY KEY (task_id, user_id)
);
CREATE TABLE labels (
  id SERIAL PRIMARY KEY,
  name VARCHAR(40) UNIQUE, color VARCHAR(7)
);
CREATE TABLE task_labels (
  task_id INT NOT NULL REFERENCES tasks(id),
  label_id INT NOT NULL REFERENCES labels(id),
  PRIMARY KEY (task_id, label_id)
);
CREATE TABLE task_comments (
  id SERIAL PRIMARY KEY,
  task_id INT NOT NULL REFERENCES tasks(id),
  author_id INT NOT NULL REFERENCES users(id),
  body TEXT, created_at TIMESTAMP
);`,
  },
  {
    slug: 'inventory',
    name: 'Inventory / warehouse',
    title: 'Inventory Database Schema Example (ER Diagram)',
    description: 'An inventory / warehouse database schema example — suppliers, products, warehouses, stock levels and purchase orders — as an interactive ER diagram you can open and edit.',
    keywords: 'inventory database schema example, warehouse database design, stock management schema, purchase order er diagram, supplier product schema',
    lead: 'An <strong>inventory / warehouse</strong> schema — suppliers and products, per-warehouse stock levels, and purchase orders with line items — as an interactive ER diagram.',
    about: 'Suppliers provide products; stock tracks quantity of each product per warehouse; purchase orders to suppliers contain line items for products.',
    sql: `CREATE TABLE suppliers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  email VARCHAR(255)
);
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  supplier_id INT REFERENCES suppliers(id),
  sku VARCHAR(64) UNIQUE, name VARCHAR(200),
  unit_cost_cents INT
);
CREATE TABLE warehouses (
  id SERIAL PRIMARY KEY,
  code VARCHAR(10) UNIQUE, name VARCHAR(120),
  location VARCHAR(160)
);
CREATE TABLE stock (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id),
  warehouse_id INT NOT NULL REFERENCES warehouses(id),
  quantity INT
);
CREATE TABLE purchase_orders (
  id SERIAL PRIMARY KEY,
  supplier_id INT NOT NULL REFERENCES suppliers(id),
  warehouse_id INT REFERENCES warehouses(id),
  status VARCHAR(20), ordered_at TIMESTAMP
);
CREATE TABLE purchase_order_items (
  id SERIAL PRIMARY KEY,
  purchase_order_id INT NOT NULL REFERENCES purchase_orders(id),
  product_id INT NOT NULL REFERENCES products(id),
  quantity INT, unit_cost_cents INT
);`,
  },
  {
    slug: 'crm',
    name: 'CRM',
    title: 'CRM Database Schema Example — SQL + Interactive ER Diagram',
    description: 'A complete CRM database schema example — accounts, contacts, leads, opportunities, activities and deals — with the full SQL to copy and an interactive ER diagram. Free.',
    keywords: 'crm database schema example, crm er diagram, sales crm database design, contacts leads opportunities schema, customer relationship management schema',
    lead: 'A realistic <strong>CRM</strong> schema — accounts and their contacts, leads converting to opportunities, a sales pipeline of deals, and logged activities — shown as an interactive ER diagram.',
    about: 'Accounts (companies) have many contacts; leads are captured and converted into opportunities tied to an account; opportunities move through pipeline stages as deals, while activities (calls, emails, meetings) are logged against contacts and opportunities.',
    sql: `CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120), email VARCHAR(255) UNIQUE
);
CREATE TABLE accounts (
  id SERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  industry VARCHAR(80), owner_id INT REFERENCES users(id)
);
CREATE TABLE contacts (
  id SERIAL PRIMARY KEY,
  account_id INT REFERENCES accounts(id),
  first_name VARCHAR(80), last_name VARCHAR(80),
  email VARCHAR(255), phone VARCHAR(40)
);
CREATE TABLE leads (
  id SERIAL PRIMARY KEY,
  name VARCHAR(160), email VARCHAR(255),
  source VARCHAR(60), status VARCHAR(30),
  owner_id INT REFERENCES users(id)
);
CREATE TABLE opportunities (
  id SERIAL PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id),
  name VARCHAR(160), amount_cents INT,
  stage VARCHAR(40), close_date DATE,
  owner_id INT REFERENCES users(id)
);
CREATE TABLE activities (
  id SERIAL PRIMARY KEY,
  contact_id INT REFERENCES contacts(id),
  opportunity_id INT REFERENCES opportunities(id),
  type VARCHAR(30), notes TEXT, occurred_at TIMESTAMP
);`,
  },
  {
    slug: 'erp',
    name: 'ERP',
    title: 'ERP Database Schema Example — SQL + Interactive ER Diagram',
    description: 'A complete ERP database schema example — employees, departments, products, purchase and sales orders, invoices and general ledger — with full SQL and an interactive ER diagram.',
    keywords: 'erp database schema, erp er diagram, enterprise resource planning database design, accounting general ledger schema, erp modules schema example',
    lead: 'An <strong>ERP</strong> schema tying together HR, procurement, sales and accounting — employees in departments, products, purchase and sales orders, invoices, and general-ledger entries — as an interactive ER diagram.',
    about: 'Employees belong to departments; the company buys products via purchase orders to suppliers and sells them via sales orders to customers; each order produces an invoice, and invoices post entries to accounts in the general ledger.',
    sql: `CREATE TABLE departments (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL
);
CREATE TABLE employees (
  id SERIAL PRIMARY KEY,
  department_id INT REFERENCES departments(id),
  name VARCHAR(160), email VARCHAR(255) UNIQUE,
  hired_on DATE
);
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  sku VARCHAR(64) UNIQUE, name VARCHAR(200),
  unit_cost_cents INT, unit_price_cents INT
);
CREATE TABLE suppliers (
  id SERIAL PRIMARY KEY, name VARCHAR(160) NOT NULL
);
CREATE TABLE customers (
  id SERIAL PRIMARY KEY, name VARCHAR(160) NOT NULL
);
CREATE TABLE purchase_orders (
  id SERIAL PRIMARY KEY,
  supplier_id INT NOT NULL REFERENCES suppliers(id),
  status VARCHAR(20), ordered_at TIMESTAMP
);
CREATE TABLE sales_orders (
  id SERIAL PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES customers(id),
  status VARCHAR(20), ordered_at TIMESTAMP
);
CREATE TABLE invoices (
  id SERIAL PRIMARY KEY,
  sales_order_id INT REFERENCES sales_orders(id),
  amount_cents INT, issued_at TIMESTAMP, paid BOOLEAN
);
CREATE TABLE gl_accounts (
  id SERIAL PRIMARY KEY,
  code VARCHAR(20) UNIQUE, name VARCHAR(120), type VARCHAR(20)
);
CREATE TABLE ledger_entries (
  id SERIAL PRIMARY KEY,
  invoice_id INT REFERENCES invoices(id),
  account_id INT NOT NULL REFERENCES gl_accounts(id),
  debit_cents INT, credit_cents INT, entered_at TIMESTAMP
);`,
  },
  {
    slug: 'hospital',
    name: 'Hospital',
    title: 'Hospital Database Schema Example (ER Diagram)',
    description: 'A hospital database schema example — patients, doctors, departments, appointments, admissions and prescriptions — as an interactive ER diagram you can open and edit for free.',
    keywords: 'hospital database schema example, hospital management database design, patient doctor appointment schema, healthcare er diagram, hospital management system schema',
    lead: 'A <strong>hospital management</strong> schema — patients and doctors, departments, appointments, inpatient admissions, and prescriptions — shown as an interactive ER diagram.',
    about: 'Doctors work in departments and see patients through appointments; patients may be admitted to a room during a stay, and doctors write prescriptions for medications against a patient visit.',
    sql: `CREATE TABLE departments (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL
);
CREATE TABLE doctors (
  id SERIAL PRIMARY KEY,
  department_id INT REFERENCES departments(id),
  name VARCHAR(160), specialty VARCHAR(80)
);
CREATE TABLE patients (
  id SERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  date_of_birth DATE, phone VARCHAR(40)
);
CREATE TABLE appointments (
  id SERIAL PRIMARY KEY,
  patient_id INT NOT NULL REFERENCES patients(id),
  doctor_id INT NOT NULL REFERENCES doctors(id),
  scheduled_at TIMESTAMP, status VARCHAR(20)
);
CREATE TABLE rooms (
  id SERIAL PRIMARY KEY,
  number VARCHAR(10) UNIQUE, ward VARCHAR(40)
);
CREATE TABLE admissions (
  id SERIAL PRIMARY KEY,
  patient_id INT NOT NULL REFERENCES patients(id),
  room_id INT REFERENCES rooms(id),
  admitted_at TIMESTAMP, discharged_at TIMESTAMP
);
CREATE TABLE medications (
  id SERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL, form VARCHAR(40)
);
CREATE TABLE prescriptions (
  id SERIAL PRIMARY KEY,
  appointment_id INT REFERENCES appointments(id),
  medication_id INT NOT NULL REFERENCES medications(id),
  dosage VARCHAR(60), duration_days INT
);`,
  },
  {
    slug: 'school',
    name: 'School / LMS',
    title: 'School Database Schema Example (LMS) — SQL + ER Diagram',
    description: 'A school / LMS database schema example — students, teachers, courses, enrollments, assignments and grades — with the full SQL to copy and an interactive ER diagram. Free.',
    keywords: 'school database schema example, student management database design, lms database schema, courses enrollments grades schema, school er diagram',
    lead: 'A <strong>school / LMS</strong> schema — students and teachers, courses and their enrollments, assignments and grades — shown as an interactive ER diagram.',
    about: 'Teachers teach courses; students enroll in courses through an enrollment join table; each course has assignments, and each enrolled student receives grades on those assignments.',
    sql: `CREATE TABLE teachers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL, email VARCHAR(255) UNIQUE
);
CREATE TABLE students (
  id SERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL, email VARCHAR(255) UNIQUE,
  enrolled_on DATE
);
CREATE TABLE courses (
  id SERIAL PRIMARY KEY,
  code VARCHAR(16) UNIQUE, title VARCHAR(200),
  teacher_id INT REFERENCES teachers(id)
);
CREATE TABLE enrollments (
  id SERIAL PRIMARY KEY,
  student_id INT NOT NULL REFERENCES students(id),
  course_id INT NOT NULL REFERENCES courses(id),
  enrolled_on DATE,
  UNIQUE (student_id, course_id)
);
CREATE TABLE assignments (
  id SERIAL PRIMARY KEY,
  course_id INT NOT NULL REFERENCES courses(id),
  title VARCHAR(200), due_date DATE, max_points INT
);
CREATE TABLE grades (
  id SERIAL PRIMARY KEY,
  enrollment_id INT NOT NULL REFERENCES enrollments(id),
  assignment_id INT NOT NULL REFERENCES assignments(id),
  points NUMERIC(5,2), graded_at TIMESTAMP
);`,
  },
];
