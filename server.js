const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { initDatabase, getDatabase, saveDatabase } = require('./database');

const app = express();
const PORT = 3020;

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
  return Number(num.toFixed(2));
}

function normalizeValidationMetrics(metrics) {
  if (!metrics) {
    return null;
  }

  return {
    building_sf: metrics.building_sf != null ? Number(metrics.building_sf) : null,
    project_bid_date: metrics.project_bid_date || null,
    selected_total: roundToTwo(metrics.selected_total),
    selected_cost_per_sf: roundToTwo(metrics.selected_cost_per_sf),
    low_bid_total: roundToTwo(metrics.low_bid_total),
    low_bid_cost_per_sf: roundToTwo(metrics.low_bid_cost_per_sf),
    median_bid_total: roundToTwo(metrics.median_bid_total),
    median_bid_cost_per_sf: roundToTwo(metrics.median_bid_cost_per_sf)
  };
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
    const valueA = key === 'project_bid_date' ? (a[key] || null) : toFiniteNumber(a[key]);
    const valueB = key === 'project_bid_date' ? (b[key] || null) : toFiniteNumber(b[key]);

    if (valueA == null && valueB == null) {
      return true;
    }

    if (valueA == null || valueB == null) {
      return false;
    }

    if (key === 'project_bid_date') {
      return valueA === valueB;
    }

    return Number(valueA.toFixed(2)) === Number(valueB.toFixed(2));
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
     ORDER BY datetime(created_at) DESC
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
  const projects = db.exec(`
    SELECT id, name, building_sf, project_date, precon_notes, created_at, modified_at
    FROM projects
    ORDER BY created_at DESC
  `);
  
  if (projects.length === 0) {
    return res.json([]);
  }
  
  const result = projects[0].values.map(row => ({
    id: row[0],
    name: row[1],
    building_sf: row[2],
    project_date: row[3],
    precon_notes: row[4],
    created_at: row[5],
    modified_at: row[6]
  }));
  
  res.json(result);
});

// Get single project with all packages
app.get('/api/projects/:id', (req, res) => {
  const db = getDatabase();
  const projectId = req.params.id;
  
  // Get project details
  const projectQuery = db.exec(
    `SELECT id, name, building_sf, project_date, precon_notes, created_at, modified_at FROM projects WHERE id = ?`,
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
    created_at: projectRow[5],
    modified_at: projectRow[6]
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
     ORDER BY datetime(created_at) DESC`,
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

// Create new project
app.post('/api/projects', (req, res) => {
  const db = getDatabase();
  const { name, building_sf, project_date } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Project name is required' });
  }
  
  db.run(
    'INSERT INTO projects (name, building_sf, project_date) VALUES (?, ?, ?)',
    [name, building_sf || null, project_date || null]
  );
  
  const result = db.exec('SELECT last_insert_rowid()');
  const projectId = result[0].values[0][0];
  
  saveDatabase();
  
  res.json({ id: projectId, name, building_sf, project_date, precon_notes: null });
});

// Update project
app.put('/api/projects/:id', (req, res) => {
  const db = getDatabase();
  const { name, building_sf, project_date, precon_notes } = req.body;
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
    `SELECT id, name, building_sf, project_date, precon_notes, created_at, modified_at FROM projects WHERE id = ?`,
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
    created_at: row[5],
    modified_at: row[6]
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

// ============ HELPER FUNCTIONS ============

function getOrCreateBidder(db, bidderName) {
  const normalized = normalizeBidderName(bidderName);
  
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
  if (normalized !== bidderName) {
    db.run('INSERT INTO bidder_aliases (bidder_id, alias_name) VALUES (?, ?)', [bidderId, bidderName]);
  }
  
  return bidderId;
}

function normalizeBidderName(name) {
  // Remove common suffixes and normalize
  return name
    .replace(/\*/g, '') // Remove asterisks
    .replace(/,?\s*(Inc\.?|LLC\.?|Co\.?|Corporation|Corp\.?|Company|Ltd\.?)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function parseBidTab(workbook, projectId, filename) {
  const db = getDatabase();
  const XLSX = require('xlsx');

  const gmpEstimates = extractGmpEstimates(workbook, XLSX);

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
      
      // Get selected bid and bidder
      const selectedBid = packageData.bids.find(b => b.selected);
      const selected_amount = selectedBid ? selectedBid.amount : low_bid;
      const selected_bidder_id = selectedBid ? getOrCreateBidder(db, selectedBid.bidder) : null;
      
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
      for (const bid of packageData.bids) {
        const bidder_id = getOrCreateBidder(db, bid.bidder);
        const was_selected = bid.selected ? 1 : 0;
        
        db.run(
          'INSERT INTO bids (package_id, bidder_id, bid_amount, was_selected) VALUES (?, ?, ?, ?)',
          [packageId, bidder_id, bid.amount, was_selected]
        );
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
    building_sf
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
  
  const query = db.exec(`
    SELECT 
      csi_division,
      COUNT(*) as package_count,
      AVG(cost_per_sf) as avg_cost_per_sf,
      MIN(cost_per_sf) as min_cost_per_sf,
      MAX(cost_per_sf) as max_cost_per_sf
    FROM packages
    WHERE csi_division IS NOT NULL AND cost_per_sf IS NOT NULL
    GROUP BY csi_division
    ORDER BY csi_division
  `);
  
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
      'SELECT cost_per_sf FROM packages WHERE csi_division = ? AND cost_per_sf IS NOT NULL',
      [div.csi_division]
    );
    
    if (costsQuery.length > 0) {
      const costs = costsQuery[0].values.map(r => r[0]);
      div.median_cost_per_sf = calculateMedian(costs);
    }
    
    return div;
  });
  
  res.json(divisionsWithMedian);
});

// Get bidder performance across all projects
app.get('/api/aggregate/bidders', (req, res) => {
  const db = getDatabase();
  
  const query = db.exec(`
    SELECT 
      bid.canonical_name as bidder_name,
      COUNT(*) as bid_count,
      COUNT(CASE WHEN b.was_selected = 1 THEN 1 END) as wins,
      AVG(b.bid_amount) as avg_bid_amount
    FROM bids b
    JOIN bidders bid ON b.bidder_id = bid.id
    GROUP BY bid.id
    ORDER BY bid_count DESC
  `);
  
  if (query.length === 0) {
    return res.json([]);
  }
  
  const bidders = query[0].values.map(row => ({
    bidder_name: row[0],
    bid_count: row[1],
    wins: row[2],
    avg_bid_amount: row[3],
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
      COUNT(DISTINCT CASE WHEN pkg.id IS NOT NULL THEN bid.id END) as bid_count,
      SUM(CASE WHEN bid.was_selected = 1 AND pkg.id IS NOT NULL THEN 1 ELSE 0 END) as wins,
      (
        SELECT GROUP_CONCAT(package_code, '||')
        FROM (
          SELECT DISTINCT pkg2.package_code
          FROM bids bid2
          JOIN packages pkg2 ON pkg2.id = bid2.package_id
          WHERE bid2.bidder_id = b.id AND pkg2.package_code IS NOT NULL
          ORDER BY pkg2.package_code
        ) package_list
      ) as packages
    FROM bidders b
    LEFT JOIN bids bid ON bid.bidder_id = b.id
    LEFT JOIN packages pkg ON pkg.id = bid.package_id
    GROUP BY b.id, b.canonical_name
    ORDER BY b.canonical_name
  `);

  if (query.length === 0) {
    return res.json([]);
  }

  const bidders = query[0].values.map(row => {
    const aliasList = row[2] ? row[2].split('||').filter(Boolean) : [];
    const packageList = row[5] ? row[5].split('||').filter(Boolean) : [];

    packageList.sort((a, b) => a.localeCompare(b));

    return {
      id: row[0],
      canonical_name: row[1],
      aliases: aliasList,
      bid_count: row[3] || 0,
      wins: row[4] || 0,
      packages: packageList
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

// Merge bidders
app.post('/api/bidders/merge', (req, res) => {
  const db = getDatabase();
  const { keep_id, merge_id } = req.body;
  
  if (!keep_id || !merge_id) {
    return res.status(400).json({ error: 'Both bidder IDs required' });
  }
  
  // Update all references to point to the kept bidder
  db.run('UPDATE bids SET bidder_id = ? WHERE bidder_id = ?', [keep_id, merge_id]);
  db.run('UPDATE packages SET selected_bidder_id = ? WHERE selected_bidder_id = ?', [keep_id, merge_id]);
  
  // Move aliases
  db.run('UPDATE bidder_aliases SET bidder_id = ? WHERE bidder_id = ?', [keep_id, merge_id]);
  
  // Delete the merged bidder
  db.run('DELETE FROM bidders WHERE id = ?', [merge_id]);
  
  saveDatabase();
  
  res.json({ success: true });
});

// Start server
app.listen(PORT, () => {
  console.log(`Bid Database server running on http://localhost:${PORT}`);
});
