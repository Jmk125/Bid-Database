const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { initDatabase, getDatabase, saveDatabase } = require('./database');

const app = express();
const PORT = 3020;

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
  const projects = db.exec('SELECT * FROM projects ORDER BY created_at DESC');
  
  if (projects.length === 0) {
    return res.json([]);
  }
  
  const result = projects[0].values.map(row => ({
    id: row[0],
    name: row[1],
    building_sf: row[2],
    project_date: row[3],
    created_at: row[4],
    modified_at: row[5]
  }));
  
  res.json(result);
});

// Get single project with all packages
app.get('/api/projects/:id', (req, res) => {
  const db = getDatabase();
  const projectId = req.params.id;
  
  // Get project details
  const projectQuery = db.exec('SELECT * FROM projects WHERE id = ?', [projectId]);
  
  if (projectQuery.length === 0) {
    return res.status(404).json({ error: 'Project not found' });
  }
  
  const projectRow = projectQuery[0].values[0];
  const project = {
    id: projectRow[0],
    name: projectRow[1],
    building_sf: projectRow[2],
    project_date: projectRow[3],
    created_at: projectRow[4],
    modified_at: projectRow[5]
  };
  
  // Get all packages for this project
  const packagesQuery = db.exec(`
    SELECT p.*, b.canonical_name as bidder_name
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
      low_bid: row[9],
      median_bid: row[10],
      high_bid: row[11],
      average_bid: row[12],
      cost_per_sf: row[13],
      override_flag: row[14],
      notes: row[15],
      created_at: row[16],
      bidder_name: row[17]
    }));
  }
  
  res.json(project);
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
  
  res.json({ id: projectId, name, building_sf, project_date });
});

// Update project
app.put('/api/projects/:id', (req, res) => {
  const db = getDatabase();
  const { name, building_sf, project_date } = req.body;
  const projectId = req.params.id;
  
  db.run(
    'UPDATE projects SET name = ?, building_sf = ?, project_date = ?, modified_at = CURRENT_TIMESTAMP WHERE id = ?',
    [name, building_sf || null, project_date || null, projectId]
  );
  
  saveDatabase();
  
  res.json({ id: projectId, name, building_sf, project_date });
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
     low_bid, median_bid, high_bid, average_bid, cost_per_sf) 
    VALUES (?, ?, ?, ?, 'estimated', ?, ?, ?, ?, ?, ?)`,
    [project_id, package_code, package_name, csi_division, selected_amount, 
     selected_amount, selected_amount, selected_amount, selected_amount, cost_per_sf]
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
      
      // Insert package
      db.run(`
        INSERT INTO packages 
        (project_id, bid_event_id, package_code, package_name, csi_division, status, 
         selected_bidder_id, selected_amount, low_bid, median_bid, high_bid, average_bid, 
         cost_per_sf, override_flag)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        projectId, bidEventId, packageData.package_code, packageData.package_name,
        csi_division, status, selected_bidder_id, selected_amount,
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
        bid_count: packageData.bids.length
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
    const selected = selectedCell === 'y' || selectedCell === 'Y';
    
    bids.push({
      bidder: String(bidderName).trim(),
      amount: amount,
      selected: selected
    });
  }
  
  if (bids.length === 0) return null;
  
  return {
    package_code,
    package_name,
    bids
  };
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
    SELECT b.id, b.canonical_name, GROUP_CONCAT(ba.alias_name, ', ') as aliases
    FROM bidders b
    LEFT JOIN bidder_aliases ba ON b.id = ba.bidder_id
    GROUP BY b.id
    ORDER BY b.canonical_name
  `);
  
  if (query.length === 0) {
    return res.json([]);
  }
  
  const bidders = query[0].values.map(row => ({
    id: row[0],
    canonical_name: row[1],
    aliases: row[2] ? row[2].split(', ') : []
  }));
  
  res.json(bidders);
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
