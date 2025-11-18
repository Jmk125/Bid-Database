const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'bid_database.sqlite');

let db = null;

async function initDatabase() {
  const SQL = await initSqlJs();

  const databaseExists = fs.existsSync(DB_PATH);

  // Try to load existing database
  if (databaseExists) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
    console.log('Loaded existing database');
  } else {
    db = new SQL.Database();
    console.log('Created new database');
  }

  // Enforce foreign key cascades so deletions clean up related records
  db.run('PRAGMA foreign_keys = ON');

  const schemaUpdated = ensureSchema();

  if (!databaseExists || schemaUpdated) {
    saveDatabase();
  }

  return db;
}

function ensureSchema() {
  let schemaUpdated = false;

  createTables();
  cleanupOrphanedRecords();

  // Ensure packages table has GMP estimate column
  const pragmaResult = db.exec('PRAGMA table_info(packages)');
  const packageColumns = pragmaResult[0]?.values || [];
  const hasGmpAmount = packageColumns.some(column => column[1] === 'gmp_amount');

  if (!hasGmpAmount) {
    db.run('ALTER TABLE packages ADD COLUMN gmp_amount REAL');
    schemaUpdated = true;
    console.log('Added gmp_amount column to packages table');
  }

  // Ensure projects table has precon notes column
  const projectPragma = db.exec('PRAGMA table_info(projects)');
  const projectColumns = projectPragma[0]?.values || [];
  const hasPreconNotes = projectColumns.some(column => column[1] === 'precon_notes');
  const hasCountyName = projectColumns.some(column => column[1] === 'county_name');
  const hasCountyState = projectColumns.some(column => column[1] === 'county_state');

  if (!hasPreconNotes) {
    db.run('ALTER TABLE projects ADD COLUMN precon_notes TEXT');
    schemaUpdated = true;
    console.log('Added precon_notes column to projects table');
  }

  if (!hasCountyName) {
    db.run('ALTER TABLE projects ADD COLUMN county_name TEXT');
    schemaUpdated = true;
    console.log('Added county_name column to projects table');
  }

  if (!hasCountyState) {
    db.run('ALTER TABLE projects ADD COLUMN county_state TEXT');
    schemaUpdated = true;
    console.log('Added county_state column to projects table');
  }

  return schemaUpdated;
}

function createTables() {
  // Projects table
  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      building_sf REAL,
      project_date TEXT,
      precon_notes TEXT,
      county_name TEXT,
      county_state TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      modified_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Bid Events table (tracks which Excel file/upload added packages)
  db.run(`
    CREATE TABLE IF NOT EXISTS bid_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      source_filename TEXT,
      upload_date TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);

  // Bidders table (normalized bidder names)
  db.run(`
    CREATE TABLE IF NOT EXISTS bidders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_name TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Bidder aliases (for tracking variations of the same bidder)
  db.run(`
    CREATE TABLE IF NOT EXISTS bidder_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bidder_id INTEGER NOT NULL,
      alias_name TEXT NOT NULL,
      FOREIGN KEY (bidder_id) REFERENCES bidders(id) ON DELETE CASCADE
    )
  `);

  // Packages table
  db.run(`
    CREATE TABLE IF NOT EXISTS packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      bid_event_id INTEGER,
      package_code TEXT NOT NULL,
      package_name TEXT NOT NULL,
      csi_division TEXT,
      status TEXT DEFAULT 'bid' CHECK(status IN ('bid', 'estimated', 'bid-override')),
      selected_bidder_id INTEGER,
      selected_amount REAL,
      gmp_amount REAL,
      low_bid REAL,
      median_bid REAL,
      high_bid REAL,
      average_bid REAL,
      cost_per_sf REAL,
      override_flag INTEGER DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (bid_event_id) REFERENCES bid_events(id) ON DELETE SET NULL,
      FOREIGN KEY (selected_bidder_id) REFERENCES bidders(id)
    )
  `);

  // Project validations table
  db.run(`
    CREATE TABLE IF NOT EXISTS project_validations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      validator_initials TEXT NOT NULL,
      metrics_json TEXT NOT NULL,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);

  // Bids table (stores all bids received for each package)
  db.run(`
    CREATE TABLE IF NOT EXISTS bids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      package_id INTEGER NOT NULL,
      bidder_id INTEGER NOT NULL,
      bid_amount REAL NOT NULL,
      was_selected INTEGER DEFAULT 0,
      FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE CASCADE,
      FOREIGN KEY (bidder_id) REFERENCES bidders(id)
    )
  `);

  console.log('Database tables ensured');
}

function cleanupOrphanedRecords() {
  if (!db) {
    return;
  }

  // Remove bids whose packages were deleted or belong to deleted projects
  db.run(`
    DELETE FROM bids
    WHERE NOT EXISTS (
      SELECT 1
      FROM packages pkg
      JOIN projects proj ON proj.id = pkg.project_id
      WHERE pkg.id = bids.package_id
    )
  `);

  // Remove packages that belong to deleted projects
  db.run(`
    DELETE FROM packages
    WHERE NOT EXISTS (
      SELECT 1
      FROM projects proj
      WHERE proj.id = packages.project_id
    )
  `);
}

function saveDatabase() {
  if (db) {
    const data = db.export();
    fs.writeFileSync(DB_PATH, data);
  }
}

function getDatabase() {
  return db;
}

module.exports = {
  initDatabase,
  getDatabase,
  saveDatabase
};
