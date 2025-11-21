require('./load-env');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { initDatabase, getDatabase, saveDatabase } = require('./database');

const STATE_ABBREVIATIONS = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
  'DC','PR'
]);

const app = express();
const PORT = 3020;
const EDIT_KEY = (process.env.EDIT_KEY || process.env.DEFAULT_EDIT_KEY || 'letmein').trim();
const EDIT_KEY_HEADER = 'x-edit-key';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const BIDDER_AUTO_MATCH_THRESHOLD = 0.9;
const BIDDER_SUGGESTION_LIMIT = 6;

function toFiniteNumber(value) {
  if (value == null) {
    return null;
  }

  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function roundToTwo(value) {
  const num = toFiniteNumber(value);
  if (num == null) {
    return null;
  }
  const epsilon = Number.EPSILON * Math.max(1, Math.abs(num));
  return Math.round((num + epsilon) * 100) / 100;
}

function normalizeDateValue(value) {
  if (value == null) {
    return null;
  }

  const trimmed = String(value).trim();
  if (!trimmed) {
    return null;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return trimmed;
  }

  return trimmed;
}

function parseDateFilterValue(value) {
  if (!value) {
    return null;
  }

  const normalized = normalizeDateValue(value);
  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return normalized;
}

function parseNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildProjectDateFilters(req, columnName = 'project_date') {
  const startDate = parseDateFilterValue(req.query.startDate || req.query.start_date);
  const endDate = parseDateFilterValue(req.query.endDate || req.query.end_date);
  const county = (req.query.county || '').trim();
  const minSize = parseNumber(req.query.minSize || req.query.min_size);
  const maxSize = parseNumber(req.query.maxSize || req.query.max_size);

  const clauses = [];
  const params = [];

  const tablePrefix = columnName.includes('.') ? columnName.split('.')[0] : 'projects';
  const countyColumn = `${tablePrefix}.county_name`;
  const stateColumn = `${tablePrefix}.county_state`;
  const sizeColumn = `${tablePrefix}.building_sf`;

  if (startDate) {
    clauses.push(`date(${columnName}) >= date(?)`);
    params.push(startDate);
  }

  if (endDate) {
    clauses.push(`date(${columnName}) <= date(?)`);
    params.push(endDate);
  }

  if (county) {
    const [countyName, countyState] = county.split(',').map(part => part.trim());
    clauses.push(`lower(${countyColumn}) = lower(?)`);
    params.push(countyName);

    if (countyState) {
      clauses.push(`lower(${stateColumn}) = lower(?)`);
      params.push(countyState);
    }
  }

  if (minSize !== null) {
    clauses.push(`${sizeColumn} >= ?`);
    params.push(minSize);
  }

  if (maxSize !== null) {
    clauses.push(`${sizeColumn} <= ?`);
    params.push(maxSize);
  }

  return { clauses, params };
}

function normalizeValidationMetrics(metrics) {
  if (!metrics) {
    return null;
  }

  return {
    building_sf: metrics.building_sf != null ? Number(metrics.building_sf) : null,
    project_bid_date: normalizeDateValue(metrics.project_bid_date),
    selected_total: roundToTwo(metrics.selected_total),
    selected_cost_per_sf: roundToTwo(metrics.selected_cost_per_sf),
    low_bid_total: roundToTwo(metrics.low_bid_total),
    low_bid_cost_per_sf: roundToTwo(metrics.low_bid_cost_per_sf),
    median_bid_total: roundToTwo(metrics.median_bid_total),
    median_bid_cost_per_sf: roundToTwo(metrics.median_bid_cost_per_sf)
  };
}

function normalizeCountyName(value) {
  if (value == null) {
    return null;
  }

  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function normalizeStateCode(value) {
  if (value == null) {
    return null;
  }

  const normalized = String(value).trim().toUpperCase();
  if (!normalized || !STATE_ABBREVIATIONS.has(normalized)) {
    return null;
  }

  return normalized;
}

function metricsAreEqual(a, b) {
  if (!a && !b) {
    return true;
  }

  if (!a || !b) {
    return false;
  }

  const keys = [
    'building_sf',
    'project_bid_date',
    'selected_total',
    'selected_cost_per_sf',
    'low_bid_total',
    'low_bid_cost_per_sf',
    'median_bid_total',
    'median_bid_cost_per_sf'
  ];

  return keys.every((key) => {
    if (key === 'project_bid_date') {
      const dateA = normalizeDateValue(a[key]);
      const dateB = normalizeDateValue(b[key]);

      if (!dateA && !dateB) {
        return true;
      }

      return dateA === dateB;
    }

    const valueA = toFiniteNumber(a[key]);
    const valueB = toFiniteNumber(b[key]);

    if (valueA == null && valueB == null) {
      return true;
    }

    if (valueA == null || valueB == null) {
      return false;
    }

    return Math.abs(valueA - valueB) <= 0.005;
  });
}

function computeProjectMetrics(project, packages) {
  const buildingSf = toFiniteNumber(project.building_sf);

  const totals = (packages || []).reduce(
    (acc, pkg) => {
      const selectedAmount = toFiniteNumber(pkg.selected_amount) || 0;
      const lowBid = toFiniteNumber(pkg.low_bid);
      const medianBid = toFiniteNumber(pkg.median_bid);

      acc.selected_total += selectedAmount;
      acc.low_bid_total += lowBid != null ? lowBid : selectedAmount;
      acc.median_bid_total += medianBid != null ? medianBid : selectedAmount;

      return acc;
    },
    { selected_total: 0, low_bid_total: 0, median_bid_total: 0 }
  );

  const metrics = {
    building_sf: buildingSf,
    project_bid_date: project.project_date || null,
    selected_total: totals.selected_total,
    selected_cost_per_sf: buildingSf ? totals.selected_total / buildingSf : null,
    low_bid_total: totals.low_bid_total,
    low_bid_cost_per_sf: buildingSf ? totals.low_bid_total / buildingSf : null,
    median_bid_total: totals.median_bid_total,
    median_bid_cost_per_sf: buildingSf ? totals.median_bid_total / buildingSf : null
  };

  return normalizeValidationMetrics(metrics);
}

function getLatestValidation(db, projectId) {
  const latestQuery = db.exec(
    `SELECT id, validator_initials, metrics_json, notes, created_at
     FROM project_validations
     WHERE project_id = ?
     ORDER BY datetime(created_at) DESC, id DESC
     LIMIT 1`,
    [projectId]
  );

  if (latestQuery.length === 0 || latestQuery[0].values.length === 0) {
    return null;
  }

  const row = latestQuery[0].values[0];
  const metrics = normalizeValidationMetrics(JSON.parse(row[2]));

  return {
    id: row[0],
    validator_initials: row[1],
    metrics,
    notes: row[3],
    created_at: row[4]
  };
}

function getProjectPackagesForMetrics(db, projectId) {
  const query = db.exec(
    `SELECT selected_amount, low_bid, median_bid
     FROM packages
     WHERE project_id = ?`,
    [projectId]
  );

  if (query.length === 0) {
    return [];
  }

  return query[0].values.map((row) => ({
    selected_amount: row[0],
    low_bid: row[1],
    median_bid: row[2]
  }));
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.use((req, res, next) => {
  const method = req.method ? req.method.toUpperCase() : 'GET';

  if (!MUTATING_METHODS.has(method)) {
    return next();
  }

  const providedKey = (req.get(EDIT_KEY_HEADER) || '').trim();
  if (!providedKey || providedKey !== EDIT_KEY) {
    return res.status(401).json({ error: 'A valid edit key is required for this action.' });
  }

  next();
});

app.get('/api/edit-key/status', (req, res) => {
  const providedKey = (req.get(EDIT_KEY_HEADER) || '').trim();

  if (!providedKey || providedKey !== EDIT_KEY) {
    return res.status(401).json({ valid: false, error: 'Invalid edit key.' });
  }

  res.json({ valid: true });
});

// File upload configuration
const upload = multer({ dest: 'uploads/' });

// Initialize database
initDatabase().then(() => {
  console.log('Database initialized');
}).catch(err => {
  console.error('Database initialization failed:', err);
});

// ============ PROJECT ENDPOINTS ============

// Get all projects
app.get('/api/projects', (req, res) => {
  const db = getDatabase();
  const { clauses, params } = buildProjectDateFilters(req);

  const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const projects = db.exec(
    `SELECT id, name, building_sf, project_date, precon_notes, county_name, county_state, created_at, modified_at
     FROM projects
     ${whereClause}
     ORDER BY project_date DESC, created_at DESC`,
    params
  );
  
  if (projects.length === 0) {
    return res.json([]);
  }
  
  const result = projects[0].values.map(row => ({
    id: row[0],
    name: row[1],
    building_sf: row[2],
    project_date: row[3],
    precon_notes: row[4],
    county_name: row[5],
    county_state: row[6],
    created_at: row[7],
    modified_at: row[8]
  }));
  
  res.json(result);
});

// Compare multiple projects at once
app.get('/api/projects/compare', (req, res) => {
  const db = getDatabase();
  const idsParam = req.query.ids;

  if (!idsParam) {
    return res.status(400).json({ error: 'Project IDs are required for comparison.' });
  }

  const ids = idsParam
    .split(',')
    .map((id) => Number(id.trim()))
    .filter((id, index, arr) => Number.isFinite(id) && arr.indexOf(id) === index);

  if (ids.length === 0) {
    return res.status(400).json({ error: 'At least one valid project ID is required.' });
  }

  const placeholders = ids.map(() => '?').join(',');

  const projectQuery = db.exec(
    `SELECT id, name, building_sf, project_date, precon_notes, county_name, county_state, created_at, modified_at
     FROM projects
     WHERE id IN (${placeholders})
     ORDER BY project_date DESC, created_at DESC`,
    ids
  );

  if (projectQuery.length === 0) {
    return res.json([]);
  }

  const packageQuery = db.exec(
    `SELECT
       id,
       project_id,
       package_code,
       package_name,
       csi_division,
       status,
       selected_bidder_id,
       selected_amount,
       gmp_amount,
       low_bid,
       median_bid,
       high_bid,
       (SELECT COUNT(*) FROM bids b WHERE b.package_id = packages.id) AS bid_count
     FROM packages
     WHERE project_id IN (${placeholders})
     ORDER BY project_id, package_code`,
    ids
  );

  const packagesByProject = new Map();
  if (packageQuery.length > 0) {
    packageQuery[0].values.forEach((row) => {
      const pkg = {
        id: row[0],
        project_id: row[1],
        package_code: row[2],
        package_name: row[3],
        csi_division: row[4],
        status: row[5],
        selected_bidder_id: row[6],
        selected_amount: row[7],
        gmp_amount: row[8],
        low_bid: row[9],
        median_bid: row[10],
        high_bid: row[11],
        bid_count: row[12]
      };

      if (!packagesByProject.has(pkg.project_id)) {
        packagesByProject.set(pkg.project_id, []);
      }

      packagesByProject.get(pkg.project_id).push(pkg);
    });
  }

  const projects = projectQuery[0].values.map((row) => {
    const project = {
      id: row[0],
      name: row[1],
      building_sf: row[2],
      project_date: row[3],
      precon_notes: row[4],
      county_name: row[5],
      county_state: row[6],
      created_at: row[7],
      modified_at: row[8]
    };

    const packages = packagesByProject.get(project.id) || [];
    const metrics = computeProjectMetrics(project, packages);

    return {
      ...project,
      package_count: packages.length,
      metrics,
      packages
    };
  });

  res.json(projects);
});

// Get single project with all packages
app.get('/api/projects/:id', (req, res) => {
  const db = getDatabase();
  const projectId = req.params.id;
  
  // Get project details
  const projectQuery = db.exec(
    `SELECT id, name, building_sf, project_date, precon_notes, county_name, county_state, created_at, modified_at FROM projects WHERE id = ?`,
    [projectId]
  );
  
  if (projectQuery.length === 0) {
    return res.status(404).json({ error: 'Project not found' });
  }
  
  const projectRow = projectQuery[0].values[0];
  const project = {
    id: projectRow[0],
    name: projectRow[1],
    building_sf: projectRow[2],
    project_date: projectRow[3],
    precon_notes: projectRow[4],
    county_name: projectRow[5],
    county_state: projectRow[6],
    created_at: projectRow[7],
    modified_at: projectRow[8]
  };
  
  // Get all packages for this project
  const packagesQuery = db.exec(`
    SELECT
      p.id,
      p.project_id,
      p.bid_event_id,
      p.package_code,
      p.package_name,
      p.csi_division,
      p.status,
      p.selected_bidder_id,
      p.selected_amount,
      p.gmp_amount,
      p.low_bid,
      p.median_bid,
      p.high_bid,
      p.average_bid,
      p.cost_per_sf,
      p.override_flag,
      p.notes,
      p.created_at,
      b.canonical_name as bidder_name
    FROM packages p
    LEFT JOIN bidders b ON p.selected_bidder_id = b.id
    WHERE p.project_id = ?
    ORDER BY p.package_code
  `, [projectId]);
  
  project.packages = [];
  if (packagesQuery.length > 0) {
    project.packages = packagesQuery[0].values.map(row => ({
      id: row[0],
      project_id: row[1],
      bid_event_id: row[2],
      package_code: row[3],
      package_name: row[4],
      csi_division: row[5],
      status: row[6],
      selected_bidder_id: row[7],
      selected_amount: row[8],
      gmp_amount: row[9],
      low_bid: row[10],
      median_bid: row[11],
      high_bid: row[12],
      average_bid: row[13],
      cost_per_sf: row[14],
      override_flag: row[15],
      notes: row[16],
      created_at: row[17],
      bidder_name: row[18]
    }));
  }

  const metrics = computeProjectMetrics(project, project.packages);
  const latestValidation = getLatestValidation(db, projectId);
  const isValid = latestValidation ? metricsAreEqual(metrics, latestValidation.metrics) : false;

  project.metrics = metrics;
  project.validation = {
    latest: latestValidation,
    is_valid: Boolean(latestValidation && isValid),
    needs_revalidation: latestValidation ? !isValid : true
  };

  res.json(project);
});

// Get all bids for a project grouped by package
app.get('/api/projects/:id/bids', (req, res) => {
  const db = getDatabase();
  const projectId = req.params.id;

  const projectExists = db.exec('SELECT 1 FROM projects WHERE id = ?', [projectId]);

  if (projectExists.length === 0) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const packagesQuery = db.exec(`
    SELECT p.id, p.package_code, p.package_name, p.selected_bidder_id
    FROM packages p
    WHERE p.project_id = ?
    ORDER BY p.package_code
  `, [projectId]);

  if (packagesQuery.length === 0) {
    return res.json([]);
  }

  const packages = packagesQuery[0].values.map(row => ({
    package_id: row[0],
    package_code: row[1],
    package_name: row[2],
    selected_bidder_id: row[3],
    bids: []
  }));

  const packageIds = packages.map(pkg => pkg.package_id);

  if (packageIds.length === 0) {
    return res.json(packages);
  }

  const placeholders = packageIds.map(() => '?').join(',');
  const bidsQuery = db.exec(`
    SELECT b.id, b.package_id, b.bidder_id, b.bid_amount, b.was_selected, bidder.canonical_name
    FROM bids b
    LEFT JOIN bidders bidder ON b.bidder_id = bidder.id
    WHERE b.package_id IN (${placeholders})
    ORDER BY b.package_id, b.bid_amount
  `, packageIds);

  if (bidsQuery.length > 0) {
    const rows = bidsQuery[0].values;
    const packageMap = new Map(packages.map(pkg => [pkg.package_id, pkg]));

    rows.forEach(row => {
      const pkg = packageMap.get(row[1]);
      if (!pkg) return;

      pkg.bids.push({
        id: row[0],
        bidder_id: row[2],
        bid_amount: row[3],
        was_selected: row[4],
        bidder_name: row[5]
      });
    });
  }

  res.json(packages);
});

// Get validation history for a project
app.get('/api/projects/:id/validations', (req, res) => {
  const db = getDatabase();
  const projectId = req.params.id;

  const projectQuery = db.exec('SELECT id, building_sf, project_date FROM projects WHERE id = ?', [projectId]);

  if (projectQuery.length === 0) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const projectRow = projectQuery[0].values[0];
  const project = {
    id: projectRow[0],
    building_sf: projectRow[1],
    project_date: projectRow[2]
  };

  const packages = getProjectPackagesForMetrics(db, projectId);
  const currentMetrics = computeProjectMetrics(project, packages);

  const historyQuery = db.exec(
    `SELECT id, validator_initials, metrics_json, notes, created_at
     FROM project_validations
     WHERE project_id = ?
     ORDER BY datetime(created_at) DESC, id DESC`,
    [projectId]
  );

  if (historyQuery.length === 0) {
    return res.json([]);
  }

  const history = historyQuery[0].values.map((row) => {
    const metrics = normalizeValidationMetrics(JSON.parse(row[2]));
    return {
      id: row[0],
      validator_initials: row[1],
      metrics,
      notes: row[3],
      created_at: row[4],
      is_current: metricsAreEqual(metrics, currentMetrics)
    };
  });

  res.json(history);
});

// Create a validation record for a project
app.post('/api/projects/:id/validations', (req, res) => {
  const db = getDatabase();
  const projectId = req.params.id;
  const { validator_initials, notes } = req.body;

  if (!validator_initials || !validator_initials.trim()) {
    return res.status(400).json({ error: 'Validator initials are required' });
  }

  const trimmedInitials = validator_initials.trim().toUpperCase().slice(0, 6);

  const projectQuery = db.exec('SELECT id, building_sf, project_date FROM projects WHERE id = ?', [projectId]);

  if (projectQuery.length === 0) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const projectRow = projectQuery[0].values[0];
  const project = {
    id: projectRow[0],
    building_sf: projectRow[1],
    project_date: projectRow[2]
  };

  const packages = getProjectPackagesForMetrics(db, projectId);
  const metrics = computeProjectMetrics(project, packages);

  db.run(
    `INSERT INTO project_validations (project_id, validator_initials, metrics_json, notes)
     VALUES (?, ?, ?, ?)`,
    [projectId, trimmedInitials, JSON.stringify(metrics), notes || null]
  );

  const result = db.exec('SELECT last_insert_rowid()');
  const validationId = result[0].values[0][0];

  const insertedQuery = db.exec(
    `SELECT id, validator_initials, metrics_json, notes, created_at
     FROM project_validations
     WHERE id = ?`,
    [validationId]
  );

  saveDatabase();

  if (insertedQuery.length === 0 || insertedQuery[0].values.length === 0) {
    return res.status(500).json({ error: 'Failed to record validation' });
  }

  const row = insertedQuery[0].values[0];
  const storedMetrics = normalizeValidationMetrics(JSON.parse(row[2]));

  res.json({
    id: row[0],
    validator_initials: row[1],
    metrics: storedMetrics,
    notes: row[3],
    created_at: row[4],
    is_current: true
  });
});

// Delete a validation record for a project
app.delete('/api/projects/:projectId/validations/:validationId', (req, res) => {
  const db = getDatabase();
  const { projectId, validationId } = req.params;

  const validationQuery = db.exec(
    `SELECT id FROM project_validations WHERE id = ? AND project_id = ?`,
    [validationId, projectId]
  );

  if (validationQuery.length === 0 || validationQuery[0].values.length === 0) {
    return res.status(404).json({ error: 'Validation record not found' });
  }

  db.run('DELETE FROM project_validations WHERE id = ?', [validationId]);
  saveDatabase();

  res.json({ success: true });
});

// Create new project
app.post('/api/projects', (req, res) => {
  const db = getDatabase();
  const { name, building_sf, project_date, county_name, county_state } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  const normalizedCounty = normalizeCountyName(county_name);
  const normalizedState = normalizeStateCode(county_state);

  db.run(
    'INSERT INTO projects (name, building_sf, project_date, county_name, county_state) VALUES (?, ?, ?, ?, ?)',
    [
      name,
      building_sf || null,
      project_date || null,
      normalizedCounty,
      normalizedState
    ]
  );
  
  const result = db.exec('SELECT last_insert_rowid()');
  const projectId = result[0].values[0][0];
  
  saveDatabase();
  
  res.json({
    id: projectId,
    name,
    building_sf,
    project_date,
    county_name: normalizedCounty,
    county_state: normalizedState,
    precon_notes: null
  });
});

// Update project
app.put('/api/projects/:id', (req, res) => {
  const db = getDatabase();
  const { name, building_sf, project_date, precon_notes, county_name, county_state } = req.body;
  const projectId = req.params.id;

  const updates = [];
  const values = [];

  if (name !== undefined) {
    updates.push('name = ?');
    values.push(name);
  }

  if (building_sf !== undefined) {
    updates.push('building_sf = ?');
    values.push(building_sf === null ? null : building_sf);
  }

  if (project_date !== undefined) {
    updates.push('project_date = ?');
    values.push(project_date === null ? null : project_date);
  }

  if (precon_notes !== undefined) {
    updates.push('precon_notes = ?');
    values.push(precon_notes === null ? null : precon_notes);
  }

  if (county_name !== undefined) {
    updates.push('county_name = ?');
    values.push(county_name === null ? null : normalizeCountyName(county_name));
  }

  if (county_state !== undefined) {
    updates.push('county_state = ?');
    values.push(county_state === null ? null : normalizeStateCode(county_state));
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No valid fields provided for update' });
  }

  updates.push('modified_at = CURRENT_TIMESTAMP');

  db.run(
    `UPDATE projects SET ${updates.join(', ')} WHERE id = ?`,
    [...values, projectId]
  );

  saveDatabase();

  const updatedProject = db.exec(
    `SELECT id, name, building_sf, project_date, precon_notes, county_name, county_state, created_at, modified_at FROM projects WHERE id = ?`,
    [projectId]
  );

  if (updatedProject.length === 0 || updatedProject[0].values.length === 0) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const row = updatedProject[0].values[0];

  res.json({
    id: row[0],
    name: row[1],
    building_sf: row[2],
    project_date: row[3],
    precon_notes: row[4],
    county_name: row[5],
    county_state: row[6],
    created_at: row[7],
    modified_at: row[8]
  });
});

// Delete project
app.delete('/api/projects/:id', (req, res) => {
  const db = getDatabase();
  const projectId = req.params.id;
  
  db.run('DELETE FROM projects WHERE id = ?', [projectId]);
  saveDatabase();
  
  res.json({ success: true });
});

// ============ PACKAGE ENDPOINTS ============

// Add manual package (estimated)
app.post('/api/packages', (req, res) => {
  const db = getDatabase();
  const { project_id, package_code, package_name, selected_amount } = req.body;
  
  if (!project_id || !package_code || !package_name || !selected_amount) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  // Extract CSI division from package code
  const csi_division = package_code.match(/^\d+/)?.[0] || null;
  
  // Get project's building_sf for cost calculation
  const projectQuery = db.exec('SELECT building_sf FROM projects WHERE id = ?', [project_id]);
  const building_sf = projectQuery[0]?.values[0]?.[0];
  const cost_per_sf = building_sf ? selected_amount / building_sf : null;
  
  // For estimated packages, set low_bid, median_bid, and high_bid equal to selected_amount
  // This ensures they're included in all totals (low, median, high, and selected)
  db.run(
    `INSERT INTO packages
    (project_id, package_code, package_name, csi_division, status, selected_amount,
     gmp_amount, low_bid, median_bid, high_bid, average_bid, cost_per_sf)
    VALUES (?, ?, ?, ?, 'estimated', ?, ?, ?, ?, ?, ?, ?)`,
    [project_id, package_code, package_name, csi_division, selected_amount,
     selected_amount, selected_amount, selected_amount, selected_amount, selected_amount, cost_per_sf]
  );
  
  const result = db.exec('SELECT last_insert_rowid()');
  const packageId = result[0].values[0][0];
  
  saveDatabase();
  
  res.json({ 
    id: packageId, 
    project_id, 
    package_code, 
    package_name, 
    csi_division,
    status: 'estimated',
    selected_amount,
    gmp_amount: selected_amount,
    low_bid: selected_amount,
    median_bid: selected_amount,
    high_bid: selected_amount,
    cost_per_sf
  });
});

// Update package (e.g., convert estimated to bid)
app.put('/api/packages/:id', (req, res) => {
  const db = getDatabase();
  const packageId = req.params.id;
  const {
    selected_amount,
    gmp_amount,
    low_bid,
    median_bid,
    high_bid,
    status,
    bidder_name,
    package_code,
    package_name,
    notes
  } = req.body;
  
  // Get package's project_id to calculate cost_per_sf
  const packageQuery = db.exec('SELECT project_id FROM packages WHERE id = ?', [packageId]);
  if (packageQuery.length === 0) {
    return res.status(404).json({ error: 'Package not found' });
  }
  
  const project_id = packageQuery[0].values[0][0];
  const projectQuery = db.exec('SELECT building_sf FROM projects WHERE id = ?', [project_id]);
  const building_sf = projectQuery[0]?.values[0]?.[0];
  const cost_per_sf = building_sf && selected_amount ? selected_amount / building_sf : null;
  
  // Handle bidder if provided
  let selected_bidder_id = null;
  if (bidder_name) {
    selected_bidder_id = getOrCreateBidder(db, bidder_name);
  }
  
  // Build update query dynamically
  const updates = [];
  const values = [];
  
  if (selected_amount !== undefined) {
    updates.push('selected_amount = ?');
    values.push(selected_amount);
    updates.push('cost_per_sf = ?');
    values.push(cost_per_sf);
  }

  if (gmp_amount !== undefined) {
    updates.push('gmp_amount = ?');
    values.push(gmp_amount);
  }

  if (low_bid !== undefined) {
    updates.push('low_bid = ?');
    values.push(low_bid);
  }
  
  if (median_bid !== undefined) {
    updates.push('median_bid = ?');
    values.push(median_bid);
  }
  
  if (high_bid !== undefined) {
    updates.push('high_bid = ?');
    values.push(high_bid);
  }
  
  if (status) {
    updates.push('status = ?');
    values.push(status);
  }
  
  if (selected_bidder_id) {
    updates.push('selected_bidder_id = ?');
    values.push(selected_bidder_id);
  }
  
  if (package_code) {
    updates.push('package_code = ?');
    values.push(package_code);
    const csi_division = package_code.match(/^\d+/)?.[0] || null;
    updates.push('csi_division = ?');
    values.push(csi_division);
  }
  
  if (package_name) {
    updates.push('package_name = ?');
    values.push(package_name);
  }
  
  if (notes !== undefined) {
    updates.push('notes = ?');
    values.push(notes);
  }
  
  values.push(packageId);
  
  db.run(
    `UPDATE packages SET ${updates.join(', ')} WHERE id = ?`,
    values
  );
  
  saveDatabase();
  
  res.json({ success: true });
});

// Delete package
app.delete('/api/packages/:id', (req, res) => {
  const db = getDatabase();
  const packageId = req.params.id;
  
  db.run('DELETE FROM packages WHERE id = ?', [packageId]);
  saveDatabase();
  
  res.json({ success: true });
});

// Get all bids for a package
app.get('/api/packages/:id/bids', (req, res) => {
  const db = getDatabase();
  const packageId = req.params.id;
  
  const bidsQuery = db.exec(`
    SELECT b.*, bid.canonical_name as bidder_name
    FROM bids b
    JOIN bidders bid ON b.bidder_id = bid.id
    WHERE b.package_id = ?
    ORDER BY b.bid_amount
  `, [packageId]);
  
  if (bidsQuery.length === 0) {
    return res.json([]);
  }
  
  const bids = bidsQuery[0].values.map(row => ({
    id: row[0],
    package_id: row[1],
    bidder_id: row[2],
    bid_amount: row[3],
    was_selected: row[4],
    bidder_name: row[5]
  }));
  
  res.json(bids);
});

// Update bid amounts and selection for a package
app.put('/api/packages/:id/bids', (req, res) => {
  const db = getDatabase();
  const packageId = Number(req.params.id);
  const incomingUpdates = Array.isArray(req.body?.bids) ? req.body.bids : [];
  const incomingAdditions = Array.isArray(req.body?.additions) ? req.body.additions : [];
  const incomingDeletions = Array.isArray(req.body?.deletions) ? req.body.deletions : [];

  if (!Number.isInteger(packageId)) {
    return res.status(400).json({ error: 'Invalid package id.' });
  }

  if (!incomingUpdates.length && !incomingAdditions.length && !incomingDeletions.length) {
    return res.status(400).json({ error: 'Provide at least one bid change.' });
  }

  const packageQuery = db.exec('SELECT project_id FROM packages WHERE id = ?', [packageId]);
  if (packageQuery.length === 0 || packageQuery[0].values.length === 0) {
    return res.status(404).json({ error: 'Package not found.' });
  }

  const projectId = packageQuery[0].values[0][0];

  const existingBidsQuery = db.exec('SELECT id, bidder_id FROM bids WHERE package_id = ?', [packageId]);
  const existingRows = existingBidsQuery[0]?.values || [];
  const validBidIds = new Set(existingRows.map(row => row[0]));

  if (existingRows.length === 0 && (incomingUpdates.length > 0 || incomingDeletions.length > 0)) {
    return res.status(400).json({ error: 'There are no bids recorded for this package yet.' });
  }

  const sanitizedUpdates = [];
  for (const bid of incomingUpdates) {
    const bidId = Number(bid.id);
    const amount = toFiniteNumber(bid.bid_amount);

    if (!Number.isInteger(bidId) || !validBidIds.has(bidId)) {
      return res.status(400).json({ error: 'One or more bids do not belong to this package.' });
    }

    if (amount == null) {
      return res.status(400).json({ error: 'Every bid must include a numeric amount.' });
    }

    sanitizedUpdates.push({
      id: bidId,
      bid_amount: roundToTwo(amount),
      was_selected: bid.was_selected ? 1 : 0
    });
  }

  const sanitizedDeletions = [];
  const deletionSet = new Set();
  for (const value of incomingDeletions) {
    const bidId = Number(value);
    if (!Number.isInteger(bidId) || !validBidIds.has(bidId)) {
      return res.status(400).json({ error: 'One or more deleted bids were not found for this package.' });
    }
    if (!deletionSet.has(bidId)) {
      deletionSet.add(bidId);
      sanitizedDeletions.push(bidId);
    }
  }

  if (sanitizedUpdates.some(update => deletionSet.has(update.id))) {
    return res.status(400).json({ error: 'Cannot update and delete the same bid.' });
  }

  const sanitizedAdditions = [];
  for (const addition of incomingAdditions) {
    const bidderName = (addition.bidder_name || '').trim();
    const amount = toFiniteNumber(addition.bid_amount);

    if (!bidderName) {
      return res.status(400).json({ error: 'Each new bid must include a bidder name.' });
    }

    if (amount == null) {
      return res.status(400).json({ error: 'Each new bid must include a numeric amount.' });
    }

    sanitizedAdditions.push({
      bidder_name: bidderName,
      bid_amount: roundToTwo(amount),
      was_selected: addition.was_selected ? 1 : 0
    });
  }

  const selectedCount = [...sanitizedUpdates, ...sanitizedAdditions].filter(bid => bid.was_selected).length;
  if (selectedCount > 1) {
    return res.status(400).json({ error: 'Only one bid can be marked as selected.' });
  }

  sanitizedUpdates.forEach(update => {
    db.run(
      'UPDATE bids SET bid_amount = ?, was_selected = ? WHERE id = ? AND package_id = ?',
      [update.bid_amount, update.was_selected, update.id, packageId]
    );
  });

  sanitizedDeletions.forEach(bidId => {
    db.run('DELETE FROM bids WHERE id = ? AND package_id = ?', [bidId, packageId]);
  });

  sanitizedAdditions.forEach(addition => {
    const bidderId = getOrCreateBidder(db, addition.bidder_name);
    db.run(
      'INSERT INTO bids (package_id, bidder_id, bid_amount, was_selected) VALUES (?, ?, ?, ?)',
      [packageId, bidderId, addition.bid_amount, addition.was_selected]
    );
  });

  const refreshedQuery = db.exec('SELECT id, bidder_id, bid_amount, was_selected FROM bids WHERE package_id = ?', [packageId]);
  const refreshedRows = refreshedQuery[0]?.values || [];

  const amounts = refreshedRows
    .map(row => toFiniteNumber(row[2]))
    .filter(value => value != null)
    .sort((a, b) => a - b);

  const lowBid = amounts.length ? roundToTwo(amounts[0]) : null;
  const highBid = amounts.length ? roundToTwo(amounts[amounts.length - 1]) : null;
  let medianBid = null;

  if (amounts.length) {
    const mid = Math.floor(amounts.length / 2);
    if (amounts.length % 2 === 0) {
      medianBid = roundToTwo((amounts[mid - 1] + amounts[mid]) / 2);
    } else {
      medianBid = roundToTwo(amounts[mid]);
    }
  }

  const averageBid = amounts.length
    ? roundToTwo(amounts.reduce((sum, value) => sum + value, 0) / amounts.length)
    : null;

  const selectedRow = refreshedRows.find(row => row[3]);
  const selectedBidderId = selectedRow ? selectedRow[1] : null;
  const selectedAmount = selectedRow ? roundToTwo(selectedRow[2]) : null;

  const projectQuery = db.exec('SELECT building_sf FROM projects WHERE id = ?', [projectId]);
  const buildingSf = projectQuery[0]?.values?.[0]?.[0];
  const numericBuildingSf = toFiniteNumber(buildingSf);
  const costPerSf = numericBuildingSf && selectedAmount != null
    ? roundToTwo(selectedAmount / numericBuildingSf)
    : null;

  db.run(
    `UPDATE packages
     SET selected_bidder_id = ?,
         selected_amount = ?,
         low_bid = ?,
         median_bid = ?,
         high_bid = ?,
         average_bid = ?,
         cost_per_sf = ?
     WHERE id = ?`,
    [selectedBidderId, selectedAmount, lowBid, medianBid, highBid, averageBid, costPerSf, packageId]
  );

  saveDatabase();

  res.json({
    success: true,
    package: {
      id: packageId,
      selected_bidder_id: selectedBidderId,
      selected_amount: selectedAmount,
      low_bid: lowBid,
      median_bid: medianBid,
      high_bid: highBid,
      average_bid: averageBid,
      cost_per_sf: costPerSf
    }
  });
});

// ============ BID TAB UPLOAD ENDPOINT ============

app.post('/api/upload-bid-tab', upload.single('file'), async (req, res) => {
  try {
    const projectId = req.body.project_id;
    
    if (!projectId) {
      return res.status(400).json({ error: 'Project ID is required' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Parse the Excel file
    const XLSX = require('xlsx');
    const workbook = XLSX.readFile(req.file.path);
    
    const result = await parseBidTab(workbook, projectId, req.file.originalname);
    
    // Clean up uploaded file
    const fs = require('fs');
    fs.unlinkSync(req.file.path);
    
    res.json(result);
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Bidder review for uploaded bid tabs
app.get('/api/bid-events/:bidEventId/bidder-review', (req, res) => {
  const db = getDatabase();
  const bidEventId = Number(req.params.bidEventId);

  if (!Number.isFinite(bidEventId)) {
    return res.status(400).json({ error: 'Invalid bid event ID.' });
  }

  const payload = getBidderReviewPayload(db, bidEventId);
  if (!payload) {
    return res.status(404).json({ error: 'Bid event not found.' });
  }

  res.json(payload);
});

app.post('/api/bid-events/:bidEventId/bidder-review', (req, res) => {
  const db = getDatabase();
  const bidEventId = Number(req.params.bidEventId);

  if (!Number.isFinite(bidEventId)) {
    return res.status(400).json({ error: 'Invalid bid event ID.' });
  }

  const payloadPreview = getBidderReviewPayload(db, bidEventId);
  if (!payloadPreview) {
    return res.status(404).json({ error: 'Bid event not found.' });
  }

  const decisions = Array.isArray(req.body.decisions) ? req.body.decisions : [];
  if (decisions.length === 0) {
    return res.status(400).json({ error: 'No bidder updates were provided.' });
  }

  let applied = 0;

  decisions.forEach((decision) => {
    const bidId = Number(decision.bid_id);
    if (!Number.isFinite(bidId)) {
      return;
    }

    let bidderId = decision.bidder_id != null ? Number(decision.bidder_id) : null;
    const newName = typeof decision.new_bidder_name === 'string' ? decision.new_bidder_name.trim() : '';

    if (!bidderId && !newName) {
      return;
    }

    const bidQuery = db.exec(
      `SELECT b.id, b.package_id, b.was_selected, pkg.bid_event_id
       FROM bids b
       JOIN packages pkg ON pkg.id = b.package_id
       WHERE b.id = ?
       LIMIT 1`,
      [bidId]
    );

    if (bidQuery.length === 0 || bidQuery[0].values.length === 0) {
      return;
    }

    const bidRow = bidQuery[0].values[0];
    const packageId = bidRow[1];
    const wasSelected = bidRow[2] ? true : false;
    const bidEventForBid = bidRow[3];

    if (bidEventForBid !== bidEventId) {
      return;
    }

    if (!bidderId && newName) {
      bidderId = getOrCreateBidder(db, newName);
    }

    if (!bidderId) {
      return;
    }

    db.run('UPDATE bids SET bidder_id = ? WHERE id = ?', [bidderId, bidId]);

    const stagingQuery = db.exec(
      'SELECT id, raw_bidder_name FROM bid_event_bidders WHERE bid_id = ? LIMIT 1',
      [bidId]
    );

    const rawName = (stagingQuery.length > 0 && stagingQuery[0].values.length > 0)
      ? stagingQuery[0].values[0][1]
      : (typeof decision.raw_bidder_name === 'string' ? decision.raw_bidder_name : '') || newName;

    const canonicalRow = db.exec('SELECT canonical_name FROM bidders WHERE id = ? LIMIT 1', [bidderId]);
    const canonicalName = canonicalRow.length > 0 && canonicalRow[0].values.length > 0
      ? canonicalRow[0].values[0][0]
      : '';

    const normalizedRaw = normalizeBidderName(rawName || newName || canonicalName);
    const normalizedCanonical = normalizeBidderName(canonicalName);
    const manualConfidence = normalizedRaw && normalizedCanonical
      ? computeNameSimilarity(normalizedRaw, normalizedCanonical)
      : 1;
    const matchType = newName ? 'manual-new' : 'manual-existing';

    if (stagingQuery.length > 0 && stagingQuery[0].values.length > 0) {
      const stagingId = stagingQuery[0].values[0][0];
      db.run(
        `UPDATE bid_event_bidders
         SET assigned_bidder_id = ?, match_confidence = ?, match_type = ?, was_auto_created = 0,
             normalized_bidder_name = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [bidderId, manualConfidence, matchType, normalizedRaw || '', stagingId]
      );
    } else {
      db.run(
        `INSERT INTO bid_event_bidders
           (bid_event_id, package_id, bid_id, raw_bidder_name, normalized_bidder_name,
            assigned_bidder_id, match_confidence, match_type, was_auto_created)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [bidEventId, packageId, bidId, rawName || '', normalizedRaw || '', bidderId, manualConfidence, matchType]
      );
    }

    if (rawName && canonicalName && rawName.trim() !== canonicalName.trim()) {
      addBidderAliasIfMissing(db, bidderId, rawName);
    }

    if (wasSelected) {
      db.run('UPDATE packages SET selected_bidder_id = ? WHERE id = ?', [bidderId, packageId]);
    }

    applied += 1;
  });

  if (applied === 0) {
    return res.status(400).json({ error: 'No bidder updates were applied.' });
  }

  saveDatabase();
  const refreshed = getBidderReviewPayload(db, bidEventId);
  res.json({ success: true, bid_event: refreshed });
});

// ============ HELPER FUNCTIONS ============

function getOrCreateBidder(db, bidderName) {
  const fallback = bidderName ? String(bidderName).trim() : '';
  const normalized = normalizeBidderName(bidderName) || fallback || 'Unknown Bidder';

  // Check if bidder exists
  const existingQuery = db.exec(
    'SELECT id FROM bidders WHERE canonical_name = ?',
    [normalized]
  );

  if (existingQuery.length > 0) {
    return existingQuery[0].values[0][0];
  }

  // Create new bidder
  db.run('INSERT INTO bidders (canonical_name) VALUES (?)', [normalized]);
  const result = db.exec('SELECT last_insert_rowid()');
  const bidderId = result[0].values[0][0];

  // Add alias if different from canonical name
  const trimmedInput = bidderName ? String(bidderName).trim() : '';
  if (trimmedInput && trimmedInput !== normalized) {
    addBidderAliasIfMissing(db, bidderId, trimmedInput);
  }

  return bidderId;
}

function normalizeBidderName(name) {
  if (name == null) {
    return '';
  }

  const raw = String(name).trim();
  if (!raw) {
    return '';
  }

  // Remove common suffixes and normalize
  return raw
    .replace(/\*/g, '') // Remove asterisks
    .replace(/,?\s*(Inc\.?|LLC\.?|Co\.?|Corporation|Corp\.?|Company|Ltd\.?)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function loadBidderDirectory(db) {
  const directory = {
    entries: [],
    byId: new Map(),
    normalizedToId: new Map()
  };

  const bidderQuery = db.exec('SELECT id, canonical_name FROM bidders ORDER BY canonical_name ASC');
  if (bidderQuery.length > 0) {
    bidderQuery[0].values.forEach((row) => {
      const id = row[0];
      const canonical = row[1];
      const entry = ensureBidderDirectoryEntry(directory, id, canonical);
      registerBidderName(directory, id, canonical);
      if (!entry.display_name) {
        entry.display_name = canonical;
      }
    });
  }

  const aliasQuery = db.exec('SELECT bidder_id, alias_name FROM bidder_aliases');
  if (aliasQuery.length > 0) {
    aliasQuery[0].values.forEach((row) => {
      registerBidderName(directory, row[0], row[1]);
    });
  }

  return directory;
}

function ensureBidderDirectoryEntry(directory, bidderId, displayName) {
  let entry = directory.byId.get(bidderId);
  if (!entry) {
    entry = { id: bidderId, display_name: displayName || '', names: new Set() };
    directory.byId.set(bidderId, entry);
    directory.entries.push(entry);
  } else if (displayName && !entry.display_name) {
    entry.display_name = displayName;
  }

  return entry;
}

function registerBidderName(directory, bidderId, rawName) {
  if (!rawName) {
    return;
  }

  const normalized = normalizeBidderName(rawName);
  if (!normalized) {
    return;
  }

  const entry = ensureBidderDirectoryEntry(directory, bidderId, rawName);
  entry.names.add(normalized);
  directory.normalizedToId.set(normalized.toLowerCase(), bidderId);
}

function levenshteinDistance(a, b) {
  if (a === b) {
    return 0;
  }

  const strA = a || '';
  const strB = b || '';
  const lenA = strA.length;
  const lenB = strB.length;

  if (lenA === 0) return lenB;
  if (lenB === 0) return lenA;

  const matrix = Array.from({ length: lenA + 1 }, () => new Array(lenB + 1).fill(0));

  for (let i = 0; i <= lenA; i++) {
    matrix[i][0] = i;
  }
  for (let j = 0; j <= lenB; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= lenA; i++) {
    for (let j = 1; j <= lenB; j++) {
      const cost = strA[i - 1] === strB[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[lenA][lenB];
}

function computeNameSimilarity(a, b) {
  if (!a && !b) {
    return 1;
  }

  if (!a || !b) {
    return 0;
  }

  if (a === b) {
    return 1;
  }

  const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase());
  const maxLength = Math.max(a.length, b.length) || 1;
  return 1 - distance / maxLength;
}

function findBestBidderMatch(directory, normalizedName) {
  if (!normalizedName) {
    return null;
  }

  const lower = normalizedName.toLowerCase();
  if (directory.normalizedToId.has(lower)) {
    const bidderId = directory.normalizedToId.get(lower);
    return { bidderId, score: 1, matchedName: normalizedName };
  }

  let best = null;
  for (const entry of directory.entries) {
    for (const candidate of entry.names) {
      const score = computeNameSimilarity(normalizedName, candidate);
      if (!best || score > best.score) {
        best = { bidderId: entry.id, score, matchedName: candidate };
      }
    }
  }

  return best;
}

function addBidderAliasIfMissing(db, bidderId, alias) {
  if (!alias) {
    return;
  }

  const trimmed = String(alias).trim();
  if (!trimmed) {
    return;
  }

  const existing = db.exec('SELECT 1 FROM bidder_aliases WHERE bidder_id = ? AND alias_name = ? LIMIT 1', [bidderId, trimmed]);
  if (existing.length > 0 && existing[0].values.length > 0) {
    return;
  }

  db.run('INSERT INTO bidder_aliases (bidder_id, alias_name) VALUES (?, ?)', [bidderId, trimmed]);
}

function createBidderRecord(db, canonicalName) {
  const name = canonicalName || 'Unknown Bidder';
  db.run('INSERT INTO bidders (canonical_name) VALUES (?)', [name]);
  const result = db.exec('SELECT last_insert_rowid()');
  return result[0].values[0][0];
}

function resolveBidderMatch(db, directory, rawName) {
  const normalizedName = normalizeBidderName(rawName);
  const candidate = normalizedName ? findBestBidderMatch(directory, normalizedName) : null;

  if (candidate && candidate.score >= BIDDER_AUTO_MATCH_THRESHOLD) {
    const matchType = candidate.score === 1 ? 'exact' : 'fuzzy';
    return {
      bidderId: candidate.bidderId,
      matchConfidence: candidate.score,
      matchType,
      normalizedName,
      wasCreated: false
    };
  }

  const canonical = normalizedName || (rawName ? String(rawName).trim() : '');
  const bidderId = createBidderRecord(db, canonical || 'Unknown Bidder');
  registerBidderName(directory, bidderId, canonical || rawName || '');
  if (rawName && canonical !== rawName.trim()) {
    addBidderAliasIfMissing(db, bidderId, rawName);
    registerBidderName(directory, bidderId, rawName);
  }

  return {
    bidderId,
    matchConfidence: 0,
    matchType: 'new',
    normalizedName,
    wasCreated: true
  };
}

function buildBidderSuggestions(directory, rawName, limit = BIDDER_SUGGESTION_LIMIT) {
  const normalized = normalizeBidderName(rawName);
  const results = [];

  for (const entry of directory.entries) {
    let bestScore = 0;
    for (const candidate of entry.names) {
      const score = normalized ? computeNameSimilarity(normalized, candidate) : 0;
      if (score > bestScore) {
        bestScore = score;
      }
    }

    if (bestScore > 0 || entry.display_name) {
      results.push({
        bidder_id: entry.id,
        name: entry.display_name || Array.from(entry.names)[0] || 'Unknown Bidder',
        confidence: Number(bestScore.toFixed(3))
      });
    }
  }

  results.sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));
  return results.slice(0, limit);
}

async function parseBidTab(workbook, projectId, filename) {
  const db = getDatabase();
  const XLSX = require('xlsx');

  const gmpEstimates = extractGmpEstimates(workbook, XLSX);
  const bidderDirectory = loadBidderDirectory(db);
  const reviewStats = { total_bids: 0, flagged_bids: 0, new_bidders: 0 };

  // Create bid event
  db.run(
    'INSERT INTO bid_events (project_id, source_filename) VALUES (?, ?)',
    [projectId, filename]
  );
  const bidEventResult = db.exec('SELECT last_insert_rowid()');
  const bidEventId = bidEventResult[0].values[0][0];
  
  let project_date = null;
  let building_sf = null;
  
  // Try to read GMP Summary sheet for project metadata
  if (workbook.SheetNames.includes('GMP Summary')) {
    const gmpSheet = workbook.Sheets['GMP Summary'];
    
    // Try to read D2 for date (you mentioned this is where you put it)
    if (gmpSheet['D2']) {
      const dateValue = gmpSheet['D2'].v;
      // Handle Excel date serial numbers
      if (typeof dateValue === 'number') {
        const date = new Date((dateValue - 25569) * 86400 * 1000);
        project_date = date.toISOString().split('T')[0];
      } else {
        project_date = dateValue;
      }
    }
    
    // Try to read D3 for building SF (you mentioned this is where you put it)
    if (gmpSheet['D3']) {
      building_sf = parseFloat(gmpSheet['D3'].v);
    }
    
    // Update project if we found these values
    if (project_date || building_sf) {
      const updates = [];
      const values = [];
      
      if (project_date) {
        updates.push('project_date = ?');
        values.push(project_date);
      }
      
      if (building_sf) {
        updates.push('building_sf = ?');
        values.push(building_sf);
      }
      
      values.push(projectId);
      
      db.run(
        `UPDATE projects SET ${updates.join(', ')}, modified_at = CURRENT_TIMESTAMP WHERE id = ?`,
        values
      );
    }
  }
  
  // Get the current building_sf for cost calculations
  const projectQuery = db.exec('SELECT building_sf FROM projects WHERE id = ?', [projectId]);
  const currentBuildingSf = projectQuery[0]?.values[0]?.[0] || building_sf;
  
  const packagesAdded = [];
  
  // Process each sheet (skip GMP Summary and utility sheets)
  for (const sheetName of workbook.SheetNames) {
    if (sheetName === 'GMP Summary') continue;
    if (sheetName.match(/^(V|W|X|Y|Z|Spare\d+)$/)) continue;
    
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    
    // Try to parse this sheet as a bid package
    const packageData = parsePackageSheet(data, sheetName);
    
    if (packageData) {
      // Extract CSI division from package code
      const csi_division = packageData.package_code.match(/^\d+/)?.[0] || null;
      
      // Calculate metrics
      const bidAmounts = packageData.bids.map(b => b.amount).sort((a, b) => a - b);
      const low_bid = Math.min(...bidAmounts);
      const high_bid = Math.max(...bidAmounts);
      const median_bid = calculateMedian(bidAmounts);
      const average_bid = bidAmounts.reduce((a, b) => a + b, 0) / bidAmounts.length;

      // Resolve bidders for each bid to capture matches and review stats
      const resolvedBids = packageData.bids.map((bid) => {
        const match = resolveBidderMatch(db, bidderDirectory, bid.bidder);
        reviewStats.total_bids += 1;
        if (match.matchType === 'new') {
          reviewStats.new_bidders += 1;
        }
        if (match.matchType === 'new' || match.matchConfidence < BIDDER_AUTO_MATCH_THRESHOLD) {
          reviewStats.flagged_bids += 1;
        }
        return { ...bid, match };
      });

      // Get selected bid and bidder
      const selectedBid = resolvedBids.find(b => b.selected);
      const selected_amount = selectedBid ? selectedBid.amount : low_bid;
      const selected_bidder_id = selectedBid ? selectedBid.match.bidderId : null;
      
      // Check if selected bid is not the actual low bid
      const override_flag = selectedBid && selectedBid.amount !== low_bid ? 1 : 0;
      const status = override_flag ? 'bid-override' : 'bid';
      
      // Calculate cost per SF
      const cost_per_sf = currentBuildingSf ? selected_amount / currentBuildingSf : null;
      
      const normalizedPackageCode = packageData.package_code ? packageData.package_code.toUpperCase() : null;
      const gmp_amount = normalizedPackageCode && gmpEstimates[normalizedPackageCode] != null
        ? gmpEstimates[normalizedPackageCode]
        : null;

      // Insert package
      db.run(`
        INSERT INTO packages
        (project_id, bid_event_id, package_code, package_name, csi_division, status,
         selected_bidder_id, selected_amount, gmp_amount, low_bid, median_bid, high_bid, average_bid,
         cost_per_sf, override_flag)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        projectId, bidEventId, packageData.package_code, packageData.package_name,
        csi_division, status, selected_bidder_id, selected_amount, gmp_amount,
        low_bid, median_bid, high_bid, average_bid, cost_per_sf, override_flag
      ]);

      const packageResult = db.exec('SELECT last_insert_rowid()');
      const packageId = packageResult[0].values[0][0];
      
      // Insert all bids
      for (const bid of resolvedBids) {
        const bidder_id = bid.match.bidderId;
        const was_selected = bid.selected ? 1 : 0;

        db.run(
          'INSERT INTO bids (package_id, bidder_id, bid_amount, was_selected) VALUES (?, ?, ?, ?)',
          [packageId, bidder_id, bid.amount, was_selected]
        );

        const bidResult = db.exec('SELECT last_insert_rowid()');
        const bidId = bidResult[0].values[0][0];

        db.run(`
          INSERT INTO bid_event_bidders
          (bid_event_id, package_id, bid_id, raw_bidder_name, normalized_bidder_name,
           assigned_bidder_id, match_confidence, match_type, was_auto_created)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          bidEventId,
          packageId,
          bidId,
          bid.bidder || '',
          bid.match.normalizedName || '',
          bidder_id,
          bid.match.matchConfidence,
          bid.match.matchType,
          bid.match.matchType === 'new' ? 1 : 0
        ]);
      }
      
      packagesAdded.push({
        package_code: packageData.package_code,
        package_name: packageData.package_name,
        bid_count: packageData.bids.length,
        gmp_amount
      });
    }
  }
  
  saveDatabase();
  
  return {
    success: true,
    bid_event_id: bidEventId,
    packages_added: packagesAdded.length,
    packages: packagesAdded,
    project_date,
    building_sf,
    review_summary: {
      total_bids: reviewStats.total_bids,
      flagged_bids: reviewStats.flagged_bids,
      new_bidders: reviewStats.new_bidders
    }
  };
}

function getBidderReviewPayload(db, bidEventId) {
  const eventQuery = db.exec(
    'SELECT id, project_id, source_filename, upload_date FROM bid_events WHERE id = ? LIMIT 1',
    [bidEventId]
  );

  if (eventQuery.length === 0 || eventQuery[0].values.length === 0) {
    return null;
  }

  const eventRow = eventQuery[0].values[0];
  const packagesQuery = db.exec(
    'SELECT id, package_code, package_name FROM packages WHERE bid_event_id = ? ORDER BY package_code',
    [bidEventId]
  );

  const packages = packagesQuery.length > 0
    ? packagesQuery[0].values.map((row) => ({
        id: row[0],
        package_code: row[1],
        package_name: row[2],
        bids: [],
        needs_review_count: 0
      }))
    : [];

  const packagesById = new Map(packages.map(pkg => [pkg.id, pkg]));
  const packageIds = packages.map(pkg => pkg.id);
  const summary = { total_bids: 0, flagged_bids: 0, new_bidders: 0 };
  const directory = loadBidderDirectory(db);
  const allBidders = directory.entries
    .map((entry) => ({
      bidder_id: entry.id,
      name: entry.display_name || Array.from(entry.names)[0] || 'Unknown Bidder'
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (packageIds.length > 0) {
    const placeholders = packageIds.map(() => '?').join(',');
    const bidsQuery = db.exec(
      `SELECT
         b.id,
         b.package_id,
         b.bid_amount,
         b.was_selected,
         b.bidder_id,
         bidder.canonical_name,
         beb.raw_bidder_name,
         beb.normalized_bidder_name,
         beb.match_confidence,
         beb.match_type,
         beb.was_auto_created
       FROM bids b
       LEFT JOIN bidders bidder ON bidder.id = b.bidder_id
       LEFT JOIN bid_event_bidders beb ON beb.bid_id = b.id
       WHERE b.package_id IN (${placeholders})
       ORDER BY b.package_id, b.bid_amount ASC, b.id ASC`,
      packageIds
    );

    if (bidsQuery.length > 0) {
      bidsQuery[0].values.forEach((row) => {
        const bidId = row[0];
        const packageId = row[1];
        const pkg = packagesById.get(packageId);
        if (!pkg) {
          return;
        }

        const bidAmount = row[2];
        const wasSelected = row[3] ? true : false;
        const bidderId = row[4];
        const bidderName = row[5];
        const rawName = row[6] || bidderName || '';
        const matchType = row[9] || 'legacy';
        const matchConfidence = row[8] != null ? Number(row[8]) : (matchType === 'legacy' ? 1 : 0);
        const wasAutoCreated = row[10] ? true : false;
        const suggestions = buildBidderSuggestions(directory, rawName);

        if (bidderId && !suggestions.some(s => s.bidder_id === bidderId)) {
          suggestions.unshift({ bidder_id: bidderId, name: bidderName || rawName || 'Assigned Bidder', confidence: 1 });
        }

        const needsReview = Boolean(
          matchType === 'new' ||
          wasAutoCreated ||
          (matchType !== 'legacy' && matchConfidence < BIDDER_AUTO_MATCH_THRESHOLD)
        );

        summary.total_bids += 1;
        if (matchType === 'new' || wasAutoCreated) {
          summary.new_bidders += 1;
        }
        if (needsReview) {
          summary.flagged_bids += 1;
          pkg.needs_review_count += 1;
        }

        pkg.bids.push({
          bid_id: bidId,
          bid_amount: bidAmount,
          was_selected: wasSelected,
          bidder_id: bidderId,
          bidder_name: bidderName,
          raw_bidder_name: rawName,
          match_confidence: matchConfidence,
          match_type: matchType,
          was_auto_created: wasAutoCreated,
          needs_review: needsReview,
          suggestions
        });
      });
    }
  }

  return {
    bid_event_id: bidEventId,
    project_id: eventRow[1],
    source_filename: eventRow[2],
    upload_date: eventRow[3],
    summary,
    packages,
    all_bidders: allBidders
  };
}

function parsePackageSheet(data, sheetName) {
  // Skip non-package sheets
  if (sheetName === 'GMP Summary' || sheetName.match(/^(V|W|X|Y|Z|Spare\d+)$/)) {
    return null;
  }
  
  if (data.length < 5) return null; // Not enough data
  
  // Package code is the sheet name (e.g., "03A")
  const package_code = sheetName;
  
  // Try to find package name in row 1 (format: "Bid Package - 03A Concrete")
  let package_name = package_code;
  if (data[1] && data[1][1]) {
    const titleRow = String(data[1][1]);
    const nameMatch = titleRow.match(/Bid Package\s*-\s*\d+[A-Z]?\s+(.+)/i);
    if (nameMatch) {
      package_name = nameMatch[1].trim();
    }
  }
  
  // Find the header row (row 2 typically has "Bidder", "Base Bid Amount", etc.)
  let headerRowIndex = -1;
  let bidderColIndex = -1;
  let amountColIndex = -1;
  let selectedColIndex = -1;
  
  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i];
    if (!row) continue;
    
    for (let j = 0; j < row.length; j++) {
      const cell = String(row[j] || '').toLowerCase();
      
      // Look for "Bidder" column
      if (cell === 'bidder' || cell.includes('contractor')) {
        headerRowIndex = i;
        bidderColIndex = j;
      }
      
      // Look for "Base Bid Amount" column
      if (cell.includes('base bid') || (cell.includes('bid') && cell.includes('amount'))) {
        amountColIndex = j;
      }
      
      // Look for "Propose (Y/N)" column
      if (cell.includes('propose') || cell.includes('y/n')) {
        selectedColIndex = j;
      }
    }
    
    if (headerRowIndex !== -1 && bidderColIndex !== -1) break;
  }
  
  if (headerRowIndex === -1 || bidderColIndex === -1) {
    return null; // Couldn't find structure
  }
  
  // If we didn't find amount column explicitly, assume it's the column after bidder
  if (amountColIndex === -1) {
    amountColIndex = bidderColIndex + 1;
  }
  
  // If we didn't find selected column, assume it's column 0
  if (selectedColIndex === -1) {
    selectedColIndex = 0;
  }
  
  // Parse bids (start from row after header)
  const uniqueBids = new Map();
  const bids = [];
  for (let i = headerRowIndex + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;

    const bidderName = row[bidderColIndex];
    const amount = row[amountColIndex];

    // Skip rows without bidder name or amount
    if (!bidderName || !amount) continue;
    if (typeof amount !== 'number' || amount <= 0) continue;

    // Check if this bid is selected (marked with 'y' in first column)
    const selectedCell = row[selectedColIndex];
    const selected = typeof selectedCell === 'string'
      ? selectedCell.trim().toLowerCase().startsWith('y')
      : selectedCell === true;

    const normalizedName = normalizeBidderName(String(bidderName).trim()).toLowerCase();
    const dedupeKey = `${normalizedName}|${amount}`;

    if (uniqueBids.has(dedupeKey)) {
      const existingBid = uniqueBids.get(dedupeKey);
      if (selected && !existingBid.selected) {
        existingBid.selected = true;
      }
      continue;
    }

    const bidEntry = {
      bidder: String(bidderName).trim(),
      amount: amount,
      selected: selected
    };

    uniqueBids.set(dedupeKey, bidEntry);
    bids.push(bidEntry);
  }
  
  if (bids.length === 0) return null;
  
  return {
    package_code,
    package_name,
    bids
  };
}

function extractGmpEstimates(workbook, XLSX) {
  if (!workbook || !Array.isArray(workbook.SheetNames)) {
    return {};
  }

  // Prefer an explicit GMP Summary sheet, otherwise fall back to the first sheet containing "summary"
  const summarySheetName = workbook.SheetNames.find(name => name.toLowerCase() === 'gmp summary')
    || workbook.SheetNames.find(name => name.toLowerCase().includes('summary'));

  if (!summarySheetName) {
    return {};
  }

  const sheet = workbook.Sheets[summarySheetName];
  if (!sheet) {
    return {};
  }

  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  const estimates = {};

  data.forEach(row => {
    if (!Array.isArray(row) || row.length < 2) {
      return;
    }

    const rawAmount = row[1];
    let amount = null;

    if (typeof rawAmount === 'number') {
      amount = rawAmount;
    } else if (typeof rawAmount === 'string') {
      const cleaned = rawAmount
        .replace(/[$,\s]/g, '')
        .replace(/\(/g, '-')
        .replace(/\)/g, '');
      const parsed = parseFloat(cleaned);
      if (!Number.isNaN(parsed)) {
        amount = parsed;
      }
    }

    if (!Number.isFinite(amount)) {
      return;
    }

    let shouldSkipRow = false;
    let detectedCode = null;

    for (let i = 0; i < Math.min(row.length, 4); i++) {
      const cell = row[i];
      if (cell == null || typeof cell === 'number') {
        continue;
      }

      const text = String(cell).trim();
      if (!text) {
        continue;
      }

      const lowered = text.toLowerCase();
      if (lowered.includes('total') || lowered.includes('subtotal') || lowered.includes('allowance')) {
        shouldSkipRow = true;
        break;
      }

      if (lowered.includes('bid package')) {
        continue;
      }

      const match = text.toUpperCase().match(/\b\d{2}[A-Z]?\b/);
      if (match) {
        detectedCode = match[0].toUpperCase();
        break;
      }
    }

    if (shouldSkipRow || !detectedCode) {
      return;
    }

    if (!Number.isFinite(amount)) {
      return;
    }

    if (estimates[detectedCode] == null) {
      estimates[detectedCode] = amount;
    }
  });

  return estimates;
}

function calculateMedian(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 
    ? (sorted[mid - 1] + sorted[mid]) / 2 
    : sorted[mid];
}

// ============ AGGREGATION ENDPOINTS ============

// Get aggregated metrics across all projects by CSI division
app.get('/api/aggregate/divisions', (req, res) => {
  const db = getDatabase();
  const { clauses, params } = buildProjectDateFilters(req, 'proj.project_date');
  const dateFilter = clauses.length ? ` AND ${clauses.join(' AND ')}` : '';

  const query = db.exec(
    `SELECT
      pkg.csi_division,
      COUNT(*) as package_count,
      AVG(pkg.cost_per_sf) as avg_cost_per_sf,
      MIN(pkg.cost_per_sf) as min_cost_per_sf,
      MAX(pkg.cost_per_sf) as max_cost_per_sf
    FROM packages pkg
    JOIN projects proj ON proj.id = pkg.project_id
    WHERE pkg.csi_division IS NOT NULL AND pkg.cost_per_sf IS NOT NULL${dateFilter}
    GROUP BY pkg.csi_division
    ORDER BY pkg.csi_division`,
    params
  );
  
  if (query.length === 0) {
    return res.json([]);
  }
  
  const divisions = query[0].values.map(row => ({
    csi_division: row[0],
    package_count: row[1],
    avg_cost_per_sf: row[2],
    min_cost_per_sf: row[3],
    max_cost_per_sf: row[4]
  }));

  // Calculate median for each division
  const divisionsWithMedian = divisions.map(div => {
    const costsQuery = db.exec(
      `SELECT pkg.cost_per_sf
       FROM packages pkg
       JOIN projects proj ON proj.id = pkg.project_id
       WHERE pkg.csi_division = ? AND pkg.cost_per_sf IS NOT NULL${dateFilter}`,
      [div.csi_division, ...params]
    );
    
    if (costsQuery.length > 0) {
      const costs = costsQuery[0].values.map(r => r[0]);
      div.median_cost_per_sf = calculateMedian(costs);
    }
    
    return div;
  });

  res.json(divisionsWithMedian);
});

// Get per-division cost/SF trends over time
app.get('/api/aggregate/divisions/timeseries', (req, res) => {
  const db = getDatabase();
  const basis = req.query.basis === 'median'
    ? 'median'
    : req.query.basis === 'low'
      ? 'low'
      : 'selected';

  const amountColumn = basis === 'median'
    ? 'pkg.median_bid'
    : basis === 'low'
      ? 'pkg.low_bid'
      : 'pkg.selected_amount';

  const { clauses, params } = buildProjectDateFilters(req, 'proj.project_date');
  const dateFilter = clauses.length ? ` AND ${clauses.join(' AND ')}` : '';

  const query = db.exec(
    `SELECT
      pkg.csi_division,
      strftime('%Y-%m', proj.project_date) as period,
      ${amountColumn} as amount,
      proj.building_sf
    FROM packages pkg
    JOIN projects proj ON proj.id = pkg.project_id
    WHERE pkg.csi_division IS NOT NULL
      AND ${amountColumn} IS NOT NULL
      AND proj.building_sf IS NOT NULL
      AND proj.project_date IS NOT NULL${dateFilter}
    ORDER BY period`,
    params
  );

  if (query.length === 0) {
    return res.json({ basis, series: [], overall: [] });
  }

  const seriesMap = new Map();
  const overallMap = new Map();

  query[0].values.forEach(row => {
    const division = row[0];
    const period = row[1];
    const amount = row[2];
    const buildingSf = row[3];

    if (!period || !Number.isFinite(amount) || !Number.isFinite(buildingSf) || buildingSf === 0) {
      return;
    }

    const costPerSf = amount / buildingSf;

    if (!Number.isFinite(costPerSf)) {
      return;
    }

    if (!seriesMap.has(division)) {
      seriesMap.set(division, new Map());
    }

    const divisionPeriods = seriesMap.get(division);
    if (!divisionPeriods.has(period)) {
      divisionPeriods.set(period, []);
    }
    divisionPeriods.get(period).push(costPerSf);

    if (!overallMap.has(period)) {
      overallMap.set(period, []);
    }
    overallMap.get(period).push(costPerSf);
  });

  const series = Array.from(seriesMap.entries()).map(([division, periodMap]) => ({
    csi_division: division,
    points: Array.from(periodMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([period, values]) => ({
        period,
        median_cost_per_sf: calculateMedian(values),
        avg_cost_per_sf: values.reduce((sum, value) => sum + value, 0) / values.length,
        min_cost_per_sf: Math.min(...values),
        max_cost_per_sf: Math.max(...values)
      }))
  }));

  const overall = Array.from(overallMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, values]) => ({
      period,
      median_cost_per_sf: calculateMedian(values),
      avg_cost_per_sf: values.reduce((sum, value) => sum + value, 0) / values.length,
      min_cost_per_sf: Math.min(...values),
      max_cost_per_sf: Math.max(...values)
    }));

  res.json({ basis, series, overall });
});

// Get bidder performance across all projects
app.get('/api/aggregate/bidders', (req, res) => {
  const db = getDatabase();
  const { clauses, params } = buildProjectDateFilters(req, 'proj.project_date');
  const dateFilter = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const query = db.exec(
    `SELECT
      bid.canonical_name as bidder_name,
      COUNT(*) as bid_count,
      COUNT(CASE WHEN b.was_selected = 1 THEN 1 END) as wins,
      AVG(b.bid_amount) as avg_bid_amount,
      SUM(CASE WHEN b.was_selected = 1 THEN b.bid_amount ELSE 0 END) as awarded_amount
    FROM bids b
    JOIN bidders bid ON b.bidder_id = bid.id
    JOIN packages pkg ON pkg.id = b.package_id
    JOIN projects proj ON proj.id = pkg.project_id
    ${dateFilter}
    GROUP BY bid.canonical_name
    ORDER BY bid_count DESC`,
    params
  );
  
  if (query.length === 0) {
    return res.json([]);
  }
  
  const bidders = query[0].values.map(row => ({
    bidder_name: row[0],
    bid_count: row[1],
    wins: row[2],
    avg_bid_amount: row[3],
    awarded_amount: row[4],
    win_rate: row[1] > 0 ? (row[2] / row[1] * 100).toFixed(1) : 0
  }));
  
  res.json(bidders);
});

// Get all bidders (for management)
app.get('/api/bidders', (req, res) => {
  const db = getDatabase();

  const query = db.exec(`
    SELECT
      b.id,
      b.canonical_name,
      (
        SELECT GROUP_CONCAT(alias_name, '||')
        FROM (
          SELECT DISTINCT alias_name
          FROM bidder_aliases
          WHERE bidder_id = b.id AND alias_name IS NOT NULL
          ORDER BY alias_name
        ) alias_list
      ) as aliases,
      COUNT(DISTINCT CASE WHEN pkg.id IS NOT NULL AND proj.id IS NOT NULL THEN bid.id END) as bid_count,
      SUM(CASE WHEN bid.was_selected = 1 AND pkg.id IS NOT NULL AND proj.id IS NOT NULL THEN 1 ELSE 0 END) as wins,
      (
        SELECT GROUP_CONCAT(package_code, '||')
        FROM (
          SELECT DISTINCT pkg2.package_code
          FROM bids bid2
          JOIN packages pkg2 ON pkg2.id = bid2.package_id
          JOIN projects proj2 ON proj2.id = pkg2.project_id
          WHERE bid2.bidder_id = b.id AND pkg2.package_code IS NOT NULL
          ORDER BY pkg2.package_code
        ) package_list
      ) as packages,
      (
        SELECT GROUP_CONCAT(county_name || '|' || COALESCE(county_state, ''), '||')
        FROM (
          SELECT DISTINCT proj2.county_name, proj2.county_state
          FROM bids bid2
          JOIN packages pkg2 ON pkg2.id = bid2.package_id
          JOIN projects proj2 ON proj2.id = pkg2.project_id
          WHERE bid2.bidder_id = b.id AND proj2.county_name IS NOT NULL
          ORDER BY proj2.county_name, proj2.county_state
        ) county_list
      ) as project_counties
    FROM bidders b
    LEFT JOIN bids bid ON bid.bidder_id = b.id
    LEFT JOIN packages pkg ON pkg.id = bid.package_id
    LEFT JOIN projects proj ON proj.id = pkg.project_id
    GROUP BY b.id, b.canonical_name
    ORDER BY b.canonical_name
  `);

  if (query.length === 0) {
    return res.json([]);
  }

  const bidders = query[0].values.map(row => {
    const aliasList = row[2] ? row[2].split('||').filter(Boolean) : [];
    const packageList = row[5] ? row[5].split('||').filter(Boolean) : [];
    const countyList = row[6]
      ? row[6]
          .split('||')
          .map(entry => entry.split('|'))
          .filter(parts => parts[0])
      : [];

    packageList.sort((a, b) => a.localeCompare(b));

    return {
      id: row[0],
      canonical_name: row[1],
      aliases: aliasList,
      bid_count: row[3] || 0,
      wins: row[4] || 0,
      packages: packageList,
      project_counties: countyList.map(([name, state]) => ({
        name,
        state: state || null
      }))
    };
  });

  res.json(bidders);
});

app.get('/api/bidders/:id/history', (req, res) => {
  const db = getDatabase();
  const bidderId = req.params.id;

  const query = db.exec(`
    WITH bidder_stats AS (
      SELECT
        bid.id,
        bid.package_id,
        bid.bidder_id,
        bid.bid_amount,
        bid.was_selected,
        COUNT(*) OVER (PARTITION BY bid.package_id) AS total_bids,
        RANK() OVER (
          PARTITION BY bid.package_id
          ORDER BY
            CASE WHEN bid.bid_amount IS NULL THEN 1 ELSE 0 END,
            bid.bid_amount ASC
        ) AS bid_rank
      FROM bids bid
    )
    SELECT
      proj.name,
      proj.project_date,
      pkg.package_code,
      pkg.package_name,
      stats.bid_amount,
      proj.building_sf,
      stats.was_selected,
      stats.total_bids,
      stats.bid_rank,
      CASE
        WHEN pkg.selected_amount IS NOT NULL AND pkg.selected_amount > 0
          THEN ((stats.bid_amount - pkg.selected_amount) * 100.0) / pkg.selected_amount
        ELSE NULL
      END AS percent_from_selected
    FROM bidder_stats stats
    JOIN packages pkg ON stats.package_id = pkg.id
    JOIN projects proj ON pkg.project_id = proj.id
    WHERE stats.bidder_id = ?
    ORDER BY
      (proj.project_date IS NULL),
      proj.project_date DESC,
      pkg.package_code
  `, [bidderId]);

  if (query.length === 0) {
    return res.json([]);
  }

  const history = query[0].values.map(row => {
    const cost_per_sf = row[5] ? row[4] / row[5] : null;
    const totalBids = row[7] != null ? Number(row[7]) : null;
    const bidRank = row[8] != null ? Number(row[8]) : null;
    const percentFromSelected = row[9] != null ? Number(row[9]) : null;

    return {
      project_name: row[0],
      project_date: row[1],
      package_code: row[2],
      package_name: row[3],
      bid_amount: row[4],
      cost_per_sf,
      was_selected: row[6] === 1,
      placement_rank: bidRank,
      placement_total: totalBids,
      percent_from_selected: percentFromSelected
    };
  });

  res.json(history);
});

app.get('/api/bidders/:id/counties', (req, res) => {
  const db = getDatabase();
  const bidderId = req.params.id;

  const query = db.exec(`
    SELECT
      proj.county_name,
      UPPER(COALESCE(NULLIF(TRIM(proj.county_state), ''), 'OH')) AS county_state,
      COUNT(DISTINCT pkg.id) AS package_count,
      COUNT(DISTINCT proj.id) AS project_count,
      COUNT(b.id) AS bid_submissions,
      MAX(proj.project_date) AS latest_project_date
    FROM bids b
    JOIN packages pkg ON pkg.id = b.package_id
    JOIN projects proj ON proj.id = pkg.project_id
    WHERE b.bidder_id = ?
      AND proj.county_name IS NOT NULL
    GROUP BY proj.county_name, county_state
    ORDER BY package_count DESC, proj.county_name ASC
  `, [bidderId]);

  if (query.length === 0) {
    return res.json([]);
  }

  const rows = query[0].values.map(row => ({
    county_name: row[0],
    state_code: row[1],
    package_count: row[2],
    project_count: row[3],
    bid_submissions: row[4],
    latest_project_date: row[5]
  }));

  res.json(rows);
});

// Merge bidders
app.post('/api/bidders/merge', (req, res) => {
  const db = getDatabase();
  const keepId = Number(req.body.keep_id);
  const mergeCandidates = [];

  if (Array.isArray(req.body.merge_ids)) {
    mergeCandidates.push(...req.body.merge_ids);
  }

  if (req.body.merge_id != null) {
    mergeCandidates.push(req.body.merge_id);
  }

  const mergeIds = mergeCandidates
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value !== keepId);

  if (!Number.isFinite(keepId) || mergeIds.length === 0) {
    return res.status(400).json({ error: 'Provide a keep_id and at least one merge_id.' });
  }

  mergeIds.forEach((mergeId) => {
    db.run('UPDATE bids SET bidder_id = ? WHERE bidder_id = ?', [keepId, mergeId]);
    db.run('UPDATE packages SET selected_bidder_id = ? WHERE selected_bidder_id = ?', [keepId, mergeId]);
    db.run('UPDATE bidder_aliases SET bidder_id = ? WHERE bidder_id = ?', [keepId, mergeId]);
    db.run('UPDATE bid_event_bidders SET assigned_bidder_id = ? WHERE assigned_bidder_id = ?', [keepId, mergeId]);

    const canonicalRow = db.exec('SELECT canonical_name FROM bidders WHERE id = ? LIMIT 1', [mergeId]);
    const canonicalName = canonicalRow.length > 0 && canonicalRow[0].values.length > 0
      ? canonicalRow[0].values[0][0]
      : '';

    if (canonicalName) {
      addBidderAliasIfMissing(db, keepId, canonicalName);
    }

    db.run('DELETE FROM bidders WHERE id = ?', [mergeId]);
  });

  saveDatabase();

  res.json({ success: true, merged: mergeIds.length });
});

// Start server
app.listen(PORT, () => {
  console.log(`Bid Database server running on http://localhost:${PORT}`);
});
