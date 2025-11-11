const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'bid_database.sqlite');

let db = null;

async function initDatabase() {
  const SQL = await initSqlJs();
  
  // Try to load existing database
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
    console.log('Loaded existing database');
  } else {
    db = new SQL.Database();
    console.log('Created new database');
    createTables();
  }
  
  return db;
}

function createTables() {
  // Projects table
  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      building_sf REAL,
      project_date TEXT,
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

  console.log('Database tables created');
  saveDatabase();
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
