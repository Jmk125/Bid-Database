const API_BASE = '/api';

// Get project ID from URL
const urlParams = new URLSearchParams(window.location.search);
const projectId = urlParams.get('id');

if (!projectId) {
    window.location.href = 'index.html';
}

let currentProject = null;
let projectBids = [];
let projectBidsChart = null;
let bidsChartNeedsUpdate = false;
let currentTab = 'overview';
let projectBidsError = false;
let gmpDeltaChart = null;
let gmpChartNeedsUpdate = false;
let latestGmpChartData = null;
let latestComputedMetrics = null;
let validationHistory = [];
let validationHistoryLoaded = false;
let isSavingValidation = false;
let isSavingPreconNotes = false;

const PACKAGE_COLOR_PALETTE = [
    '#0b3d91',
    '#1f4f9c',
    '#2d6da4',
    '#3b88b8',
    '#4fa3c8',
    '#5b7f9f',
    '#7f8c8d',
    '#34495e'
];

// Load project data
async function loadProject() {
    try {
        const response = await fetch(`${API_BASE}/projects/${projectId}`);
        currentProject = await response.json();
        validationHistoryLoaded = false;
        validationHistory = [];
        latestComputedMetrics = currentProject.metrics || null;

        // Update page title
        document.getElementById('projectName').textContent = currentProject.name;
        document.title = `${currentProject.name} - Bid Database`;

        updatePreconNotesButton();

        // Display metrics
        displayMetrics();

        // Display packages
        displayPackages();

        await loadProjectBids();
    } catch (error) {
        console.error('Error loading project:', error);
        alert('Error loading project');
    }
}

function displayMetrics() {
    const container = document.getElementById('projectMetrics');

    const packages = currentProject.packages || [];
    const totalCost = packages.reduce((sum, pkg) => sum + (pkg.selected_amount || 0), 0);
    const totalLowBid = packages.reduce((sum, pkg) => sum + (pkg.low_bid != null ? pkg.low_bid : (pkg.selected_amount || 0)), 0);
    const totalMedianBid = packages.reduce((sum, pkg) => sum + (pkg.median_bid != null ? pkg.median_bid : (pkg.selected_amount || 0)), 0);

    const avgCostPerSF = currentProject.building_sf ? totalCost / currentProject.building_sf : null;
    const lowBidCostPerSF = currentProject.building_sf ? totalLowBid / currentProject.building_sf : null;
    const medianBidCostPerSF = currentProject.building_sf ? totalMedianBid / currentProject.building_sf : null;

    const bidCount = packages.filter(p => p.status !== 'estimated').length;
    const estimatedCount = packages.filter(p => p.status === 'estimated').length;

    // Helper function to add responsive class based on value length
    const getValueClass = (value) => {
        const str = String(value);
        if (str.length > 15) return 'very-long-value';
        if (str.length > 12) return 'long-value';
        return '';
    };

    latestComputedMetrics = {
        building_sf: currentProject.building_sf ? Number(currentProject.building_sf) : null,
        project_bid_date: currentProject.project_date || null,
        selected_total: totalCost,
        selected_cost_per_sf: avgCostPerSF,
        low_bid_total: totalLowBid,
        low_bid_cost_per_sf: lowBidCostPerSF,
        median_bid_total: totalMedianBid,
        median_bid_cost_per_sf: medianBidCostPerSF
    };

    const validationBadge = getValidationBadgeHtml();

    const metricsCards = [
        {
            key: 'building-size',
            title: 'Building Size',
            valueHtml: currentProject.building_sf ? `${formatNumber(currentProject.building_sf)} <span style="font-size: 1rem;">SF</span>` : 'N/A',
            valueClass: getValueClass(currentProject.building_sf ? formatNumber(currentProject.building_sf) : 'N/A'),
            showValidation: true
        },
        {
            key: 'selected-cost',
            title: 'Selected Cost/SF',
            valueHtml: currentProject.building_sf ? formatCurrency(avgCostPerSF) : 'N/A',
            subHtml: `<div style="font-size: 0.875rem; margin-top: 0.5rem; color: #7f8c8d;">Total: ${formatCurrency(totalCost)}</div>`,
            showValidation: true
        },
        {
            key: 'low-cost',
            title: 'Low Bid Cost/SF',
            valueHtml: currentProject.building_sf ? formatCurrency(lowBidCostPerSF) : 'N/A',
            subHtml: `<div style="font-size: 0.875rem; margin-top: 0.5rem; color: #7f8c8d;">Total: ${formatCurrency(totalLowBid)}</div>`,
            showValidation: true
        },
        {
            key: 'median-cost',
            title: 'Median Bid Cost/SF',
            valueHtml: currentProject.building_sf ? formatCurrency(medianBidCostPerSF) : 'N/A',
            subHtml: `<div style="font-size: 0.875rem; margin-top: 0.5rem; color: #7f8c8d;">Total: ${formatCurrency(totalMedianBid)}</div>`,
            showValidation: true
        },
        {
            key: 'packages',
            title: 'Packages',
            valueHtml: `${packages.length}`,
            subHtml: `<div style="font-size: 0.875rem; margin-top: 0.5rem; color: #7f8c8d;">${bidCount} bid, ${estimatedCount} estimated</div>`,
            showValidation: false
        },
        {
            key: 'project-date',
            title: 'Project Bid Date',
            valueHtml: currentProject.project_date
                ? `<span style="font-size: 1.5rem;">${formatDate(currentProject.project_date)}</span>`
                : '<span style="font-size: 1.2rem; color: #7f8c8d;">Not set</span>',
            showValidation: true
        }
    ];

    container.innerHTML = metricsCards.map(card => `
        <div class="metric-card" data-metric-key="${card.key}">
            <h4>${card.title}</h4>
            <div class="value ${card.valueClass || ''}">${card.valueHtml}</div>
            ${card.subHtml || ''}
            ${card.showValidation ? validationBadge : ''}
        </div>
    `).join('');

    updateValidationControls();

    // Display category breakdown
    displayCategoryBreakdown();

    // Display charts
    displayCharts();
}

function getValidationBadgeHtml() {
    if (!currentProject) {
        return '';
    }

    const validation = currentProject.validation || {};
    const latest = validation.latest;
    const isValid = Boolean(validation.is_valid && latest);
    const badgeClass = isValid ? 'metric-validation-badge is-valid' : 'metric-validation-badge needs-validation';
    const icon = isValid ? '✔️' : '⚠️';
    const text = latest ? escapeHtml(latest.validator_initials) : 'Review';

    return `
        <div class="${badgeClass}">
            <span class="badge-icon">${icon}</span>
            <span class="badge-text">${text}</span>
        </div>
    `;
}

function updateValidationControls() {
    const validateBtn = document.getElementById('validateProjectBtn');
    const historyBtn = document.getElementById('validationHistoryBtn');

    const validation = currentProject?.validation || {};
    const hasValidation = Boolean(validation.latest);

    if (validateBtn) {
        validateBtn.textContent = hasValidation ? '🔁 Revalidate' : '✅ Validate';
        validateBtn.disabled = Boolean(isSavingValidation);
    }

    if (historyBtn) {
        historyBtn.disabled = false;
        const hasRecords = hasValidation || validationHistoryLoaded;
        historyBtn.style.opacity = hasRecords ? '1' : '0.85';
        historyBtn.style.cursor = 'pointer';
    }
}

function updatePreconNotesButton() {
    const notesBtn = document.getElementById('preconNotesBtn');

    if (!notesBtn) {
        return;
    }

    const notesValue = typeof currentProject?.precon_notes === 'string' ? currentProject.precon_notes.trim() : '';
    const hasNotes = Boolean(notesValue);

    notesBtn.classList.toggle('has-notes', hasNotes);
    notesBtn.title = hasNotes ? 'View pre-con notes' : 'Add pre-con notes';
    notesBtn.setAttribute('aria-label', hasNotes ? 'View pre-con notes' : 'Add pre-con notes');
}

function openValidateModal() {
    if (!currentProject) return;

    const modal = document.getElementById('validateProjectModal');
    if (!modal) return;

    const initialsInput = document.getElementById('validatorInitials');
    const notesInput = document.getElementById('validationNotes');
    const submitBtn = document.querySelector('#validateProjectForm button[type="submit"]');

    if (initialsInput) {
        initialsInput.value = '';
    }

    if (notesInput) {
        notesInput.value = '';
    }

    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Validate';
    }

    renderValidationMetricsSummary();
    modal.style.display = 'block';

    if (initialsInput) {
        initialsInput.focus();
    }
}

function closeValidateModal() {
    const modal = document.getElementById('validateProjectModal');
    if (modal) {
        modal.style.display = 'none';
    }

    const form = document.getElementById('validateProjectForm');
    if (form) {
        form.reset();
    }

    isSavingValidation = false;
    updateValidationControls();
}

function renderValidationMetricsSummary() {
    const summaryEl = document.getElementById('validationMetricsSummary');
    if (!summaryEl) return;

    if (!latestComputedMetrics) {
        summaryEl.innerHTML = '<div class="empty-state" style="padding: 1.5rem 1rem;">Metrics are not available.</div>';
        return;
    }

    const metrics = latestComputedMetrics;

    const buildingText = metrics.building_sf != null ? `${formatNumber(metrics.building_sf)} SF` : 'N/A';
    const selectedText = formatValidationCostLine(metrics.selected_cost_per_sf, metrics.selected_total);
    const lowText = formatValidationCostLine(metrics.low_bid_cost_per_sf, metrics.low_bid_total);
    const medianText = formatValidationCostLine(metrics.median_bid_cost_per_sf, metrics.median_bid_total);
    const projectDateText = metrics.project_bid_date ? formatDate(metrics.project_bid_date) : 'Not set';

    summaryEl.innerHTML = `
        <div class="validation-metric-row"><span>Building Size</span><span>${buildingText}</span></div>
        <div class="validation-metric-row"><span>Selected Cost/SF</span><span>${selectedText}</span></div>
        <div class="validation-metric-row"><span>Low Bid Cost/SF</span><span>${lowText}</span></div>
        <div class="validation-metric-row"><span>Median Bid Cost/SF</span><span>${medianText}</span></div>
        <div class="validation-metric-row"><span>Project Bid Date</span><span>${projectDateText}</span></div>
    `;
}

async function openValidationHistoryModal() {
    const modal = document.getElementById('validationHistoryModal');
    const content = document.getElementById('validationHistoryContent');

    if (!modal || !content) return;

    modal.style.display = 'block';
    content.innerHTML = '<div class="loading">Loading history...</div>';

    try {
        const response = await fetch(`${API_BASE}/projects/${projectId}/validations`);
        if (!response.ok) {
            throw new Error('Failed to load history');
        }

        const history = await response.json();
        validationHistory = history;
        validationHistoryLoaded = true;
        renderValidationHistory(history);
        updateValidationControls();
    } catch (error) {
        console.error('Error loading validation history:', error);
        content.innerHTML = '<div class="empty-state"><h3>Error loading validation history</h3><p>Please try again.</p></div>';
    }
}

function closeValidationHistoryModal() {
    const modal = document.getElementById('validationHistoryModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function openPreconNotesModal() {
    if (!currentProject) {
        return;
    }

    const modal = document.getElementById('preconNotesModal');
    const textarea = document.getElementById('preconNotesInput');
    const saveBtn = document.getElementById('savePreconNotesBtn');

    if (textarea) {
        textarea.value = currentProject.precon_notes || '';
    }

    if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Notes';
    }

    isSavingPreconNotes = false;

    if (modal) {
        modal.style.display = 'block';
        if (textarea) {
            textarea.focus();
        }
    }
}

function closePreconNotesModal() {
    const modal = document.getElementById('preconNotesModal');
    if (modal) {
        modal.style.display = 'none';
    }

    const saveBtn = document.getElementById('savePreconNotesBtn');
    if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Notes';
    }

    isSavingPreconNotes = false;
}

async function handlePreconNotesSubmit(event) {
    event.preventDefault();

    if (isSavingPreconNotes) {
        return;
    }

    const textarea = document.getElementById('preconNotesInput');
    const saveBtn = document.getElementById('savePreconNotesBtn');
    const notesValue = textarea ? textarea.value.trim() : '';

    try {
        isSavingPreconNotes = true;

        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';
        }

        const response = await fetch(`${API_BASE}/projects/${projectId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                precon_notes: notesValue ? notesValue : null
            })
        });

        if (!response.ok) {
            throw new Error('Failed to save pre-con notes');
        }

        closePreconNotesModal();
        await loadProject();
    } catch (error) {
        console.error('Error saving pre-con notes:', error);
        alert('Error saving pre-con notes');
    } finally {
        isSavingPreconNotes = false;

        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Notes';
        }
    }
}

function renderValidationHistory(entries) {
    const content = document.getElementById('validationHistoryContent');
    if (!content) return;

    if (!entries || entries.length === 0) {
        content.innerHTML = `
            <div class="empty-state" style="padding: 2rem 1rem;">
                <h3>No validations yet</h3>
                <p>Validate the project to start the audit trail.</p>
            </div>
        `;
        return;
    }

    content.innerHTML = entries.map(entry => {
        const metrics = entry.metrics || {};
        const isCurrent = Boolean(entry.is_current);
        const statusClass = isCurrent ? 'status-pill is-valid' : 'status-pill needs-review';
        const statusLabel = isCurrent ? '✔️ Matches current numbers' : '⚠️ Needs revalidation';

        const buildingText = metrics.building_sf != null ? `${formatNumber(metrics.building_sf)} SF` : 'N/A';
        const selectedText = formatValidationCostLine(metrics.selected_cost_per_sf, metrics.selected_total);
        const lowText = formatValidationCostLine(metrics.low_bid_cost_per_sf, metrics.low_bid_total);
        const medianText = formatValidationCostLine(metrics.median_bid_cost_per_sf, metrics.median_bid_total);
        const projectDateText = metrics.project_bid_date ? formatDate(metrics.project_bid_date) : 'Not set';
        const notesHtml = entry.notes ? `<div class="history-note">${escapeHtml(entry.notes)}</div>` : '';

        return `
            <article class="validation-history-item${isCurrent ? ' is-current' : ''}">
                <div class="validation-history-header">
                    <div class="validator">${escapeHtml(entry.validator_initials)}</div>
                    <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 0.35rem;">
                        <span class="${statusClass}">${statusLabel}</span>
                        <span class="timestamp">${formatDateTime(entry.created_at)}</span>
                    </div>
                </div>
                <div class="history-metrics">
                    <span><span class="metric-label">Building Size</span><span class="metric-value">${buildingText}</span></span>
                    <span><span class="metric-label">Selected Cost/SF</span><span class="metric-value">${selectedText}</span></span>
                    <span><span class="metric-label">Low Bid Cost/SF</span><span class="metric-value">${lowText}</span></span>
                    <span><span class="metric-label">Median Bid Cost/SF</span><span class="metric-value">${medianText}</span></span>
                    <span><span class="metric-label">Project Bid Date</span><span class="metric-value">${projectDateText}</span></span>
                </div>
                ${notesHtml}
            </article>
        `;
    }).join('');
}

async function handleValidationSubmit(event) {
    event.preventDefault();

    if (isSavingValidation) {
        return;
    }

    const initialsInput = document.getElementById('validatorInitials');
    const notesInput = document.getElementById('validationNotes');
    const submitBtn = document.querySelector('#validateProjectForm button[type="submit"]');

    const validatorInitials = initialsInput ? initialsInput.value.trim() : '';
    const notes = notesInput ? notesInput.value.trim() : '';

    if (!validatorInitials) {
        alert('Please enter your initials to validate.');
        return;
    }

    isSavingValidation = true;
    updateValidationControls();

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Validating...';
    }

    try {
        const response = await fetch(`${API_BASE}/projects/${projectId}/validations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                validator_initials: validatorInitials,
                notes: notes || null
            })
        });

        if (!response.ok) {
            throw new Error('Failed to save validation');
        }

        await response.json();

        closeValidateModal();
        await loadProject();
    } catch (error) {
        console.error('Error validating project:', error);
        alert('Unable to save the validation. Please try again.');
        isSavingValidation = false;
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Validate';
        }
        updateValidationControls();
    }
}

function displayCategoryBreakdown() {
    const tbody = document.getElementById('categoryBody');
    const packages = currentProject.packages || [];
    
    if (!currentProject.building_sf) {
        tbody.innerHTML = '<tr><td colspan="7">Building SF required to calculate cost/SF by category</td></tr>';
        return;
    }
    
    // Define categories with their CSI divisions
    const categories = [
        { name: 'Structure', divisions: ['03', '04', '05'], color: '#2c3e50' },
        { name: 'Finishes', divisions: ['09'], color: '#3498db' },
        { name: 'Equipment', divisions: ['11'], color: '#e74c3c' },
        { name: 'Furnishings', divisions: ['12'], color: '#f39c12' },
        { name: 'MEPTS', divisions: ['21', '22', '23', '26', '27', '28'], color: '#16a085' },
        { name: 'Sitework', divisions: ['31', '32', '33'], color: '#95a5a6' }
    ];
    
    const totalSelectedCost = packages.reduce((sum, pkg) => sum + (pkg.selected_amount || 0), 0);
    
    const categoryData = categories.map(cat => {
        const categoryPackages = packages.filter(pkg => 
            cat.divisions.includes(pkg.csi_division)
        );
        
        const selectedCost = categoryPackages.reduce((sum, pkg) => sum + (pkg.selected_amount || 0), 0);
        const medianBidCost = categoryPackages.reduce((sum, pkg) => sum + (pkg.median_bid || pkg.selected_amount || 0), 0);
        const highBidCost = categoryPackages.reduce((sum, pkg) => sum + (pkg.high_bid || pkg.selected_amount || 0), 0);
        
        const selectedCostPerSF = selectedCost / currentProject.building_sf;
        const medianBidCostPerSF = medianBidCost / currentProject.building_sf;
        const highBidCostPerSF = highBidCost / currentProject.building_sf;
        
        const percentage = totalSelectedCost > 0 ? (selectedCost / totalSelectedCost * 100) : 0;
        
        return {
            name: cat.name,
            divisions: cat.divisions.join(', '),
            selectedCost: selectedCost,
            selectedCostPerSF: selectedCostPerSF,
            medianBidCostPerSF: medianBidCostPerSF,
            highBidCostPerSF: highBidCostPerSF,
            percentage: percentage,
            color: cat.color
        };
    });
    
    // Filter out categories with no cost
    const nonZeroCategories = categoryData.filter(cat => cat.selectedCost > 0);
    
    if (nonZeroCategories.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7">No packages assigned to standard categories yet</td></tr>';
        return;
    }
    
    tbody.innerHTML = nonZeroCategories.map(cat => `
        <tr>
            <td><strong style="color: ${cat.color}">${escapeHtml(cat.name)}</strong></td>
            <td>${escapeHtml(cat.divisions)}</td>
            <td>${formatCurrency(cat.selectedCost)}</td>
            <td><strong>${formatCurrency(cat.medianBidCostPerSF)}</strong></td>
            <td>${formatCurrency(cat.selectedCostPerSF)}</td>
            <td>${formatCurrency(cat.highBidCostPerSF)}</td>
            <td>${cat.percentage.toFixed(1)}%</td>
        </tr>
    `).join('');
}

async function displayPackages() {
    const tbody = document.getElementById('packagesBody');
    const packages = currentProject.packages || [];

    if (packages.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="empty-state">No packages yet. Upload a bid tab or add a package manually.</td></tr>';
        renderGmpSummary();
        return;
    }
    
    // Sort by package code
    packages.sort((a, b) => a.package_code.localeCompare(b.package_code));
    
    // Fetch bid counts for each package
    const packageBidCounts = {};
    for (const pkg of packages) {
        if (pkg.status !== 'estimated') {
            try {
                const response = await fetch(`${API_BASE}/packages/${pkg.id}/bids`);
                const bids = await response.json();
                packageBidCounts[pkg.id] = bids.length;
            } catch (error) {
                packageBidCounts[pkg.id] = 0;
            }
        }
    }
    
    tbody.innerHTML = packages.map(pkg => {
        const statusClass = `status-${pkg.status}`;
        const statusText = pkg.status === 'bid-override' ? 'Override' :
                          pkg.status.charAt(0).toUpperCase() + pkg.status.slice(1);
        
        // Helper function to format amount with cost/SF
        const formatAmountWithSF = (amount) => {
            if (!amount) return '—';
            const sf = pkg.cost_per_sf && currentProject.building_sf ? 
                       `<div class="sf-cost">${formatCurrency(amount / currentProject.building_sf)}/SF</div>` : '';
            return `<div class="amount-with-sf"><div class="amount">${formatCurrency(amount)}</div>${sf}</div>`;
        };
        
        const bidCount = packageBidCounts[pkg.id] || 0;
        const bidCountCell = pkg.status !== 'estimated' ? 
            `<a href="#" onclick="viewBids(${pkg.id}); return false;" style="color: #3498db; text-decoration: underline;">${bidCount}</a>` :
            '—';
        
        return `
            <tr>
                <td><strong>${escapeHtml(pkg.package_code)}</strong></td>
                <td>${escapeHtml(pkg.package_name)}</td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                <td>${pkg.bidder_name ? escapeHtml(pkg.bidder_name) : '—'}</td>
                <td>${formatAmountWithSF(pkg.selected_amount)}</td>
                <td>${pkg.low_bid ? formatAmountWithSF(pkg.low_bid) : '—'}</td>
                <td>${pkg.median_bid ? formatAmountWithSF(pkg.median_bid) : '—'}</td>
                <td>${pkg.high_bid ? formatAmountWithSF(pkg.high_bid) : '—'}</td>
                <td style="text-align: center;">${bidCountCell}</td>
                <td style="white-space: nowrap;">
                    <button class="btn btn-tiny btn-secondary" onclick="editPackage(${pkg.id})">Edit</button>
                    <button class="btn btn-tiny btn-danger" onclick="deletePackage(${pkg.id}, '${escapeHtml(pkg.package_code)}')">Del</button>
                </td>
            </tr>
        `;
    }).join('');

    renderGmpSummary();
}

function renderGmpSummary() {
    const tbody = document.getElementById('gmpTableBody');
    const totalsRow = document.getElementById('gmpTotalsRow');
    const emptyState = document.getElementById('gmpTableEmpty');

    if (!tbody || !totalsRow) {
        return;
    }

    const packages = (currentProject?.packages || [])
        .slice()
        .sort((a, b) => (a.package_code || '').localeCompare(b.package_code || ''));

    if (packages.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" class="empty-state">No packages yet. Upload a bid tab or add an estimated package to begin.</td></tr>';
        totalsRow.innerHTML = '<th scope="row">Totals</th>' + '<td>—</td>'.repeat(10);
        if (emptyState) {
            emptyState.style.display = 'block';
            const heading = emptyState.querySelector('h3');
            const paragraph = emptyState.querySelector('p');
            if (heading) heading.textContent = 'No packages yet';
            if (paragraph) paragraph.textContent = 'Upload a bid tab with GMP information or add an estimated package to calculate comparisons.';
        }
        latestGmpChartData = null;
        if (currentTab === 'gmp') {
            renderGmpDeltaChart();
        } else {
            gmpChartNeedsUpdate = false;
            const chartEmpty = document.getElementById('gmpChartEmpty');
            const canvas = document.getElementById('gmpDeltaChart');
            if (chartEmpty) chartEmpty.style.display = 'flex';
            if (canvas) canvas.style.display = 'none';
        }
        return;
    }

    const chartLabels = [];
    const lowVsGmp = [];
    const medianVsGmp = [];
    const medianVsLow = [];

    const totals = {
        gmp: 0,
        gmpCount: 0,
        low: 0,
        lowCount: 0,
        median: 0,
        medianCount: 0
    };

    const rowsHtml = packages.map(pkg => {
        const code = pkg.package_code || '—';
        const name = pkg.package_name || '—';
        const gmp = toFiniteNumber(pkg.gmp_amount);
        const low = toFiniteNumber(pkg.low_bid);
        const median = toFiniteNumber(pkg.median_bid);

        if (gmp != null) {
            totals.gmp += gmp;
            totals.gmpCount += 1;
        }

        if (low != null) {
            totals.low += low;
            totals.lowCount += 1;
        }

        if (median != null) {
            totals.median += median;
            totals.medianCount += 1;
        }

        const gmpLowDelta = gmp != null && low != null ? low - gmp : null;
        const gmpLowPercent = gmpLowDelta != null && isValidPercentBase(gmp)
            ? (gmpLowDelta / gmp) * 100
            : null;

        const gmpMedianDelta = gmp != null && median != null ? median - gmp : null;
        const gmpMedianPercent = gmpMedianDelta != null && isValidPercentBase(gmp)
            ? (gmpMedianDelta / gmp) * 100
            : null;

        const medianLowDelta = median != null && low != null ? median - low : null;
        const medianLowPercent = medianLowDelta != null && isValidPercentBase(low)
            ? (medianLowDelta / low) * 100
            : null;

        const label = name && name !== '—' ? `${code} – ${name}` : code;
        chartLabels.push(label);
        lowVsGmp.push(gmpLowDelta != null ? gmpLowDelta : null);
        medianVsGmp.push(gmpMedianDelta != null ? gmpMedianDelta : null);
        medianVsLow.push(medianLowDelta != null ? medianLowDelta : null);

        const gmpLowClass = getBudgetDeltaClass(gmpLowDelta);
        const gmpMedianClass = getBudgetDeltaClass(gmpMedianDelta);
        const medianLowClass = getSpreadDeltaClass(medianLowDelta);

        return `
            <tr>
                <td><strong>${escapeHtml(code)}</strong></td>
                <td>${escapeHtml(name)}</td>
                <td>${gmp != null ? formatCurrency(gmp) : '—'}</td>
                <td>${low != null ? formatCurrency(low) : '—'}</td>
                <td class="${gmpLowClass}">${formatDeltaCurrency(gmpLowDelta)}</td>
                <td class="${gmpLowClass}">${formatPercentageDelta(gmpLowPercent)}</td>
                <td>${median != null ? formatCurrency(median) : '—'}</td>
                <td class="${gmpMedianClass}">${formatDeltaCurrency(gmpMedianDelta)}</td>
                <td class="${gmpMedianClass}">${formatPercentageDelta(gmpMedianPercent)}</td>
                <td class="${medianLowClass}">${formatDeltaCurrency(medianLowDelta)}</td>
                <td class="${medianLowClass}">${formatPercentageDelta(medianLowPercent)}</td>
            </tr>
        `;
    }).join('');

    tbody.innerHTML = rowsHtml;

    const totalLowDelta = totals.lowCount > 0 && totals.gmpCount > 0 ? totals.low - totals.gmp : null;
    const totalLowPercent = totalLowDelta != null && isValidPercentBase(totals.gmp)
        ? (totalLowDelta / totals.gmp) * 100
        : null;

    const totalMedianDelta = totals.medianCount > 0 && totals.gmpCount > 0 ? totals.median - totals.gmp : null;
    const totalMedianPercent = totalMedianDelta != null && isValidPercentBase(totals.gmp)
        ? (totalMedianDelta / totals.gmp) * 100
        : null;

    const totalMedianLowDelta = totals.lowCount > 0 && totals.medianCount > 0 ? totals.median - totals.low : null;
    const totalMedianLowPercent = totalMedianLowDelta != null && isValidPercentBase(totals.low)
        ? (totalMedianLowDelta / totals.low) * 100
        : null;

    const totalLowClass = getBudgetDeltaClass(totalLowDelta);
    const totalMedianClass = getBudgetDeltaClass(totalMedianDelta);
    const totalMedianLowClass = getSpreadDeltaClass(totalMedianLowDelta);

    totalsRow.innerHTML = `
        <th scope="row">Totals</th>
        <td>—</td>
        <td>${totals.gmpCount > 0 ? formatCurrency(totals.gmp) : '—'}</td>
        <td>${totals.lowCount > 0 ? formatCurrency(totals.low) : '—'}</td>
        <td class="${totalLowClass}">${formatDeltaCurrency(totalLowDelta)}</td>
        <td class="${totalLowClass}">${formatPercentageDelta(totalLowPercent)}</td>
        <td>${totals.medianCount > 0 ? formatCurrency(totals.median) : '—'}</td>
        <td class="${totalMedianClass}">${formatDeltaCurrency(totalMedianDelta)}</td>
        <td class="${totalMedianClass}">${formatPercentageDelta(totalMedianPercent)}</td>
        <td class="${totalMedianLowClass}">${formatDeltaCurrency(totalMedianLowDelta)}</td>
        <td class="${totalMedianLowClass}">${formatPercentageDelta(totalMedianLowPercent)}</td>
    `;

    const hasAnyGmp = packages.some(pkg => toFiniteNumber(pkg.gmp_amount) != null);
    if (emptyState) {
        if (hasAnyGmp) {
            emptyState.style.display = 'none';
        } else {
            emptyState.style.display = 'block';
            const heading = emptyState.querySelector('h3');
            const paragraph = emptyState.querySelector('p');
            if (heading) heading.textContent = 'No GMP data yet';
            if (paragraph) paragraph.textContent = 'Upload a bid tab with a GMP summary or add estimated packages to compare values.';
        }
    }

    latestGmpChartData = {
        labels: chartLabels,
        lowVsGmp,
        medianVsGmp,
        medianVsLow
    };

    if (currentTab === 'gmp') {
        renderGmpDeltaChart();
        gmpChartNeedsUpdate = false;
    } else {
        gmpChartNeedsUpdate = true;
        const chartEmpty = document.getElementById('gmpChartEmpty');
        const canvas = document.getElementById('gmpDeltaChart');
        if (chartEmpty) {
            const hasData = latestGmpChartData && hasChartSeriesData(latestGmpChartData);
            chartEmpty.style.display = hasData ? 'none' : 'flex';
        }
        if (canvas) {
            canvas.style.display = 'none';
        }
    }
}

function renderGmpDeltaChart() {
    const canvas = document.getElementById('gmpDeltaChart');
    const emptyState = document.getElementById('gmpChartEmpty');

    if (!canvas || !emptyState) {
        return;
    }

    if (gmpDeltaChart) {
        gmpDeltaChart.destroy();
        gmpDeltaChart = null;
    }

    const chartData = latestGmpChartData;
    const hasData = chartData ? hasChartSeriesData(chartData) : false;

    if (!chartData || !hasData) {
        canvas.style.display = 'none';
        emptyState.style.display = 'flex';
        emptyState.textContent = 'GMP delta chart will appear when estimates and bids are available.';
        return;
    }

    if (typeof Chart !== 'undefined' && typeof ChartDataLabels !== 'undefined') {
        Chart.register(ChartDataLabels);
    }

    emptyState.style.display = 'none';
    canvas.style.display = 'block';

    const context = canvas.getContext('2d');

    gmpDeltaChart = new Chart(context, {
        type: 'bar',
        data: {
            labels: chartData.labels,
            datasets: [
                {
                    label: 'Low vs GMP',
                    data: chartData.lowVsGmp,
                    backgroundColor: 'rgba(192, 57, 43, 0.35)',
                    borderColor: '#c0392b',
                    borderWidth: 1.5,
                    order: 1
                },
                {
                    label: 'Median vs GMP',
                    data: chartData.medianVsGmp,
                    backgroundColor: 'rgba(243, 156, 18, 0.35)',
                    borderColor: '#f39c12',
                    borderWidth: 1.5,
                    order: 2
                },
                {
                    label: 'Median vs Low',
                    data: chartData.medianVsLow,
                    backgroundColor: 'rgba(41, 128, 185, 0.35)',
                    borderColor: '#2980b9',
                    borderWidth: 1.5,
                    order: 3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                y: {
                    ticks: {
                        callback: (value) => formatCompactCurrency(value)
                    },
                    title: {
                        display: true,
                        text: 'Delta ($)'
                    }
                },
                x: {
                    ticks: {
                        maxRotation: 45,
                        minRotation: 0,
                        autoSkip: false
                    }
                }
            },
            plugins: {
                legend: {
                    position: 'bottom'
                },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const value = context.parsed.y;
                            return `${context.dataset.label}: ${formatDeltaCurrency(value)}`;
                        }
                    }
                },
                datalabels: {
                    anchor: 'end',
                    align: 'end',
                    formatter: (value) => value == null ? '' : formatCompactCurrency(value),
                    color: '#34495e',
                    font: {
                        weight: '600'
                    }
                }
            }
        }
    });
}

function setupViewTabs() {
    const tabs = [
        { id: 'overview', buttonId: 'overviewTabBtn', contentId: 'overviewContent' },
        { id: 'gmp', buttonId: 'gmpTabBtn', contentId: 'gmpContent' },
        { id: 'bids', buttonId: 'bidsTabBtn', contentId: 'bidsContent' }
    ];

    tabs.forEach(tab => {
        const button = document.getElementById(tab.buttonId);
        button?.addEventListener('click', () => setActiveTab(tab.id));
    });

    setActiveTab('overview');
}

function setActiveTab(tab) {
    currentTab = tab;

    const configs = [
        { id: 'overview', buttonId: 'overviewTabBtn', contentId: 'overviewContent' },
        { id: 'gmp', buttonId: 'gmpTabBtn', contentId: 'gmpContent' },
        { id: 'bids', buttonId: 'bidsTabBtn', contentId: 'bidsContent' }
    ];

    configs.forEach(({ id, buttonId, contentId }) => {
        const isActive = id === tab;
        const button = document.getElementById(buttonId);
        const content = document.getElementById(contentId);

        button?.classList.toggle('is-active', isActive);
        button?.setAttribute('aria-selected', isActive ? 'true' : 'false');
        content?.classList.toggle('is-active', isActive);
        content?.setAttribute('aria-hidden', isActive ? 'false' : 'true');
    });

    if (tab === 'bids') {
        if (bidsChartNeedsUpdate || !projectBidsChart) {
            renderProjectBidsChart(projectBidsError);
        } else if (projectBidsChart) {
            projectBidsChart.resize();
        }
        bidsChartNeedsUpdate = false;
    }

    if (tab === 'gmp') {
        if (gmpChartNeedsUpdate || !gmpDeltaChart) {
            renderGmpDeltaChart();
        } else if (gmpDeltaChart) {
            gmpDeltaChart.resize();
        }
        gmpChartNeedsUpdate = false;
    }
}

async function loadProjectBids() {
    try {
        const response = await fetch(`${API_BASE}/projects/${projectId}/bids`);

        if (!response.ok) {
            throw new Error('Failed to fetch project bids');
        }

        const data = await response.json();

        projectBids = (data || []).map(pkg => ({
            package_id: pkg.package_id,
            package_code: pkg.package_code,
            package_name: pkg.package_name,
            selected_bidder_id: pkg.selected_bidder_id,
            bids: (pkg.bids || []).map(bid => ({
                id: bid.id,
                bidder_id: bid.bidder_id,
                bidder_name: bid.bidder_name,
                bid_amount: bid.bid_amount,
                was_selected: Boolean(bid.was_selected)
            }))
        })).sort((a, b) => (a.package_code || '').localeCompare(b.package_code || ''));

        renderBidsOverview(false);
    } catch (error) {
        console.error('Error loading project bids:', error);
        projectBids = [];
        renderBidsOverview(true);
    }
}

function renderBidsOverview(hasError = false) {
    projectBidsError = hasError;
    renderProjectBidsList(hasError);

    if (currentTab === 'bids') {
        renderProjectBidsChart(hasError);
    } else {
        bidsChartNeedsUpdate = true;
    }
}

function renderProjectBidsList(hasError = false) {
    const listEl = document.getElementById('projectBidsList');
    if (!listEl) return;

    if (hasError) {
        listEl.innerHTML = '<div class="empty-state">Unable to load bids for this project.</div>';
        return;
    }

    if (!projectBids.length) {
        listEl.innerHTML = '<div class="empty-state">No bid packages found for this project yet.</div>';
        return;
    }

    const sections = projectBids.map(pkg => {
        const safeCode = pkg.package_code ? escapeHtml(pkg.package_code) : '—';
        const safeName = pkg.package_name ? escapeHtml(pkg.package_name) : '';
        const displayName = safeName ? `${safeCode} – ${safeName}` : safeCode;
        const bidCount = pkg.bids.length;
        const headerMeta = bidCount === 0 ? 'No bids yet' : `${bidCount} ${bidCount === 1 ? 'bid' : 'bids'}`;

        if (bidCount === 0) {
            return `
                <article class="bid-package-card">
                    <div class="bid-package-header">
                        <h4>${displayName}</h4>
                        <span>${headerMeta}</span>
                    </div>
                    <div class="empty-state">No bids recorded for this package.</div>
                </article>
            `;
        }

        const sortedBids = [...pkg.bids].sort((a, b) => a.bid_amount - b.bid_amount);

        const entries = sortedBids.map((bid, index) => {
            const isSelected = bid.was_selected || (pkg.selected_bidder_id && bid.bidder_id === pkg.selected_bidder_id);
            const badges = [];

            if (index === 0) {
                badges.push('<span class="badge low">Low</span>');
            }

            if (index === sortedBids.length - 1 && sortedBids.length > 1) {
                badges.push('<span class="badge high">High</span>');
            }

            if (isSelected) {
                badges.push('<span class="badge selected">Selected</span>');
            }

            const bidderName = escapeHtml(bid.bidder_name || 'Unknown Bidder');
            const rankText = `Rank ${index + 1} of ${sortedBids.length}`;
            const amount = bid.bid_amount != null ? formatCurrency(bid.bid_amount) : '—';
            const badgeMarkup = badges.join('');

            return `
                <li class="bid-entry${isSelected ? ' is-selected' : ''}">
                    <div class="bidder-meta">
                        <span class="bidder-name">${bidderName}</span>
                        <div class="bidder-flags">
                            <span class="bidder-rank">${rankText}</span>
                            ${badgeMarkup}
                        </div>
                    </div>
                    <span class="bid-amount">${amount}</span>
                </li>
            `;
        }).join('');

        return `
            <article class="bid-package-card">
                <div class="bid-package-header">
                    <h4>${displayName}</h4>
                    <span>${headerMeta}</span>
                </div>
                <ul class="bid-entries">
                    ${entries}
                </ul>
            </article>
        `;
    }).join('');

    listEl.innerHTML = sections;
}

function renderProjectBidsChart(hasError = false) {
    const canvas = document.getElementById('projectBidsChart');
    const emptyState = document.getElementById('projectBidsEmpty');

    if (!canvas) return;

    if (projectBidsChart) {
        projectBidsChart.destroy();
        projectBidsChart = null;
    }

    if (hasError) {
        if (emptyState) {
            emptyState.style.display = 'flex';
            emptyState.textContent = 'Unable to visualize bids at this time.';
        }
        canvas.style.display = 'none';
        bidsChartNeedsUpdate = false;
        return;
    }

    const packagesWithBids = projectBids.filter(pkg => pkg.bids && pkg.bids.length > 0);

    if (packagesWithBids.length === 0) {
        if (emptyState) {
            emptyState.style.display = 'flex';
            emptyState.textContent = 'Bids will appear here once they are uploaded.';
        }
        canvas.style.display = 'none';
        bidsChartNeedsUpdate = false;
        return;
    }

    if (emptyState) {
        emptyState.style.display = 'none';
        emptyState.textContent = 'Bids will appear here once they are uploaded.';
    }

    canvas.style.display = 'block';

    const flattenedBids = [];

    packagesWithBids.forEach((pkg, pkgIndex) => {
        const numericBids = [...pkg.bids]
            .map(bid => ({
                ...bid,
                bid_amount: bid && bid.bid_amount != null ? Number(bid.bid_amount) : null
            }))
            .filter(bid => bid && bid.bid_amount != null && Number.isFinite(bid.bid_amount))
            .sort((a, b) => a.bid_amount - b.bid_amount);

        if (!numericBids.length) {
            return;
        }

        const baseColor = PACKAGE_COLOR_PALETTE[pkgIndex % PACKAGE_COLOR_PALETTE.length];
        const packageCode = pkg.package_code || '—';
        const packageLabel = pkg.package_name ? `${packageCode} – ${pkg.package_name}` : packageCode;

        numericBids.forEach((bid, bidIndex) => {
            const rankPosition = bidIndex + 1;
            const totalBids = numericBids.length;
            const isSelected = bid.was_selected || (pkg.selected_bidder_id && bid.bidder_id === pkg.selected_bidder_id);
            const lightenFactor = totalBids === 1
                ? 0.25
                : Math.min(0.85, 0.18 + (bidIndex / Math.max(totalBids - 1, 1)) * 0.55);
            const backgroundColor = lightenColor(baseColor, lightenFactor);
            const borderColor = isSelected ? '#2c3e50' : lightenColor(baseColor, 0.08);

            flattenedBids.push({
                label: `${packageCode} – ${bid.bidder_name || 'Unknown Bidder'}`,
                packageLabel,
                packageCode,
                bidderName: bid.bidder_name || 'Unknown Bidder',
                bidAmount: bid.bid_amount,
                isSelected,
                rankPosition,
                totalBids,
                backgroundColor,
                borderColor,
                borderWidth: isSelected ? 2 : 1
            });
        });
    });

    if (!flattenedBids.length) {
        if (emptyState) {
            emptyState.style.display = 'flex';
            emptyState.textContent = 'Bids with amounts will appear here once they are uploaded.';
        }
        canvas.style.display = 'none';
        bidsChartNeedsUpdate = false;
        return;
    }

    const labels = flattenedBids.map(entry => entry.label);
    const data = flattenedBids.map(entry => entry.bidAmount);
    const backgroundColors = flattenedBids.map(entry => entry.backgroundColor);
    const borderColors = flattenedBids.map(entry => entry.borderColor);
    const borderWidths = flattenedBids.map(entry => entry.borderWidth);

    projectBidsChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Bid Amount',
                data,
                backgroundColor: backgroundColors,
                borderColor: borderColors,
                borderWidth: borderWidths,
                hoverBackgroundColor: backgroundColors,
                hoverBorderColor: '#2c3e50',
                borderRadius: 6,
                maxBarThickness: 28,
                bidMeta: flattenedBids
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: {
                    left: 4,
                    right: 12,
                    bottom: 16
                }
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        title: (items) => {
                            if (!items.length) return '';
                            const meta = items[0].dataset.bidMeta?.[items[0].dataIndex];
                            return meta ? meta.packageLabel : '';
                        },
                        label: (context) => {
                            const meta = context.dataset.bidMeta?.[context.dataIndex];
                            if (!meta) {
                                return formatCurrency(context.parsed.y);
                            }

                            const selectedNote = meta.isSelected ? ' (Selected)' : '';
                            return `${meta.bidderName}: ${formatCurrency(meta.bidAmount)}${selectedNote}`;
                        },
                        afterLabel: (context) => {
                            const meta = context.dataset.bidMeta?.[context.dataIndex];
                            if (!meta) return '';
                            return `Rank ${meta.rankPosition} of ${meta.totalBids}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        color: '#34495e',
                        autoSkip: false,
                        maxRotation: 60,
                        minRotation: 40,
                        callback(value) {
                            const label = this.getLabelForValue(value);
                            return label.length > 32 ? `${label.slice(0, 32)}…` : label;
                        }
                    },
                    grid: {
                        display: false
                    },
                    title: {
                        display: true,
                        text: 'Bid packages (ordered by package, low → high bidder)',
                        color: '#34495e',
                        font: {
                            weight: '600'
                        }
                    }
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: '#34495e',
                        callback: (value) => formatCompactCurrency(value)
                    },
                    title: {
                        display: true,
                        text: 'Bid amount',
                        color: '#34495e',
                        font: {
                            weight: '600'
                        }
                    }
                }
            }
        }
    });

    bidsChartNeedsUpdate = false;
}

// Upload bid tab
document.getElementById('uploadBidTabBtn').onclick = () => {
    document.getElementById('uploadModal').style.display = 'block';
};

function closeUploadModal() {
    document.getElementById('uploadModal').style.display = 'none';
    document.getElementById('uploadForm').reset();
    document.getElementById('uploadProgress').style.display = 'none';
    document.getElementById('uploadResult').style.display = 'none';
}

document.getElementById('uploadForm').onsubmit = async (e) => {
    e.preventDefault();
    
    const fileInput = document.getElementById('bidTabFile');
    const file = fileInput.files[0];
    
    if (!file) {
        alert('Please select a file');
        return;
    }
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('project_id', projectId);
    
    const uploadBtn = document.getElementById('uploadBtn');
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Uploading...';
    document.getElementById('uploadProgress').style.display = 'block';
    
    try {
        const response = await fetch(`${API_BASE}/upload-bid-tab`, {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (result.success) {
            document.getElementById('uploadProgress').style.display = 'none';
            document.getElementById('uploadResult').innerHTML = `
                <div style="color: #155724; background-color: #d4edda; padding: 1rem; border-radius: 4px;">
                    <strong>Success!</strong> Processed ${result.packages_added} package(s).
                    ${result.building_sf ? `<br>Building SF: ${formatNumber(result.building_sf)}` : ''}
                    ${result.project_date ? `<br>Project Bid Date: ${formatDate(result.project_date)}` : ''}
                </div>
            `;
            document.getElementById('uploadResult').style.display = 'block';
            
            // Reload project data
            setTimeout(() => {
                closeUploadModal();
                loadProject();
            }, 2000);
        } else {
            throw new Error('Upload failed');
        }
    } catch (error) {
        console.error('Error uploading bid tab:', error);
        document.getElementById('uploadProgress').style.display = 'none';
        document.getElementById('uploadResult').innerHTML = `
            <div style="color: #721c24; background-color: #f8d7da; padding: 1rem; border-radius: 4px;">
                <strong>Error:</strong> ${error.message}
            </div>
        `;
        document.getElementById('uploadResult').style.display = 'block';
    } finally {
        uploadBtn.disabled = false;
        uploadBtn.textContent = 'Upload';
    }
};

// Add package
document.getElementById('addPackageBtn').onclick = () => {
    document.getElementById('addPackageModal').style.display = 'block';
};

function closeAddPackageModal() {
    document.getElementById('addPackageModal').style.display = 'none';
    document.getElementById('addPackageForm').reset();
}

document.getElementById('addPackageForm').onsubmit = async (e) => {
    e.preventDefault();
    
    const package_code = document.getElementById('packageCode').value;
    const package_name = document.getElementById('packageName').value;
    const selected_amount = parseFloat(document.getElementById('estimatedAmount').value);
    
    try {
        await fetch(`${API_BASE}/packages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                project_id: projectId,
                package_code,
                package_name,
                selected_amount
            })
        });
        
        closeAddPackageModal();
        loadProject();
    } catch (error) {
        console.error('Error adding package:', error);
        alert('Error adding package');
    }
};

// Edit package
function editPackage(packageId) {
    const pkg = currentProject.packages.find(p => p.id === packageId);
    if (!pkg) return;
    
    document.getElementById('editPackageId').value = pkg.id;
    document.getElementById('editPackageCode').value = pkg.package_code;
    document.getElementById('editPackageName').value = pkg.package_name;
    document.getElementById('editSelectedAmount').value = pkg.selected_amount || '';
    document.getElementById('editLowBid').value = pkg.low_bid || '';
    document.getElementById('editMedianBid').value = pkg.median_bid || '';
    document.getElementById('editHighBid').value = pkg.high_bid || '';
    document.getElementById('editBidder').value = pkg.bidder_name || '';
    document.getElementById('editStatus').value = pkg.status;
    document.getElementById('editNotes').value = pkg.notes || '';
    
    document.getElementById('editPackageModal').style.display = 'block';
}

function closeEditPackageModal() {
    document.getElementById('editPackageModal').style.display = 'none';
    document.getElementById('editPackageForm').reset();
}

document.getElementById('editPackageForm').onsubmit = async (e) => {
    e.preventDefault();
    
    const packageId = document.getElementById('editPackageId').value;
    const package_code = document.getElementById('editPackageCode').value;
    const package_name = document.getElementById('editPackageName').value;
    const selected_amount = parseFloat(document.getElementById('editSelectedAmount').value);
    const low_bid = document.getElementById('editLowBid').value ? parseFloat(document.getElementById('editLowBid').value) : null;
    const median_bid = document.getElementById('editMedianBid').value ? parseFloat(document.getElementById('editMedianBid').value) : null;
    const high_bid = document.getElementById('editHighBid').value ? parseFloat(document.getElementById('editHighBid').value) : null;
    const bidder_name = document.getElementById('editBidder').value;
    const status = document.getElementById('editStatus').value;
    const notes = document.getElementById('editNotes').value;
    
    try {
        await fetch(`${API_BASE}/packages/${packageId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                package_code,
                package_name,
                selected_amount,
                low_bid,
                median_bid,
                high_bid,
                bidder_name: bidder_name || null,
                status,
                notes
            })
        });
        
        closeEditPackageModal();
        loadProject();
    } catch (error) {
        console.error('Error updating package:', error);
        alert('Error updating package');
    }
};

// Delete package
async function deletePackage(packageId, packageCode) {
    if (!confirm(`Are you sure you want to delete package ${packageCode}?`)) {
        return;
    }
    
    try {
        await fetch(`${API_BASE}/packages/${packageId}`, {
            method: 'DELETE'
        });
        
        loadProject();
    } catch (error) {
        console.error('Error deleting package:', error);
        alert('Error deleting package');
    }
}

// View bids for a package
async function viewBids(packageId) {
    try {
        const response = await fetch(`${API_BASE}/packages/${packageId}/bids`);
        const bids = await response.json();
        
        if (bids.length === 0) {
            alert('No bids found for this package');
            return;
        }
        
        const pkg = currentProject.packages.find(p => p.id === packageId);
        let message = `Bids for ${pkg.package_code} - ${pkg.package_name}\n\n`;
        
        bids.forEach(bid => {
            message += `${bid.bidder_name}: ${formatCurrency(bid.bid_amount)}${bid.was_selected ? ' ✓ (Selected)' : ''}\n`;
        });
        
        alert(message);
    } catch (error) {
        console.error('Error loading bids:', error);
        alert('Error loading bids');
    }
}

function toFiniteNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

function isValidPercentBase(value) {
    const num = Number(value);
    return Number.isFinite(num) && Math.abs(num) > 0.0001;
}

function formatDeltaCurrency(value) {
    if (value == null || Number.isNaN(value)) {
        return '—';
    }

    const abs = Math.abs(value);
    if (abs < 0.005) {
        return '$0.00';
    }

    const formatted = formatCurrency(abs);
    if (value > 0) {
        return `+${formatted}`;
    }

    if (value < 0) {
        return `-${formatted}`;
    }

    return '$0.00';
}

function formatPercentageDelta(value) {
    if (value == null || Number.isNaN(value)) {
        return '—';
    }

    const abs = Math.abs(value);
    if (abs < 0.05) {
        return '0.0%';
    }

    const precision = abs >= 100 ? 0 : 1;
    const formatted = abs.toFixed(precision);

    if (value > 0) {
        return `+${formatted}%`;
    }

    if (value < 0) {
        return `-${formatted}%`;
    }

    return '0.0%';
}

function getBudgetDeltaClass(value) {
    if (value == null || Math.abs(value) < 0.005) {
        return 'delta-neutral';
    }

    return value > 0 ? 'delta-negative' : 'delta-positive';
}

function getSpreadDeltaClass(value) {
    if (value == null || Math.abs(value) < 0.005) {
        return 'delta-neutral';
    }

    return value >= 0 ? 'delta-positive' : 'delta-negative';
}

function hasChartSeriesData(data) {
    if (!data) return false;
    const { lowVsGmp = [], medianVsGmp = [], medianVsLow = [] } = data;
    return [...lowVsGmp, ...medianVsGmp, ...medianVsLow].some(value => value != null);
}

// Utility functions
function formatNumber(num) {
    return new Intl.NumberFormat().format(num);
}

function formatCurrency(num) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(num);
}

function formatCompactCurrency(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return value;
    }

    if (value >= 1_000_000) {
        return `$${(value / 1_000_000).toFixed(1)}M`;
    }

    if (value >= 1_000) {
        return `$${(value / 1_000).toFixed(0)}K`;
    }

    return `$${Math.round(value)}`;
}

function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString();
}

function formatDateTime(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) {
        return dateString;
    }
    return date.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
    });
}

function formatValidationCostLine(costPerSf, total) {
    const hasCost = costPerSf != null && Number.isFinite(Number(costPerSf));
    const hasTotal = total != null && Number.isFinite(Number(total));

    if (!hasCost && !hasTotal) {
        return 'N/A';
    }

    const pieces = [];

    if (hasCost) {
        pieces.push(`${formatCurrency(Number(costPerSf))} /SF`);
    }

    if (hasTotal) {
        pieces.push(`${formatCurrency(Number(total))} total`);
    }

    return pieces.join(' · ');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function lightenColor(hex, amount) {
    if (!hex) return '#95a5a6';
    const sanitized = hex.replace('#', '');

    if (sanitized.length !== 6) {
        return hex;
    }

    const num = parseInt(sanitized, 16);
    const r = num >> 16;
    const g = (num >> 8) & 0xff;
    const b = num & 0xff;

    const clamp = (channel) => {
        const factor = Math.min(Math.max(amount, 0), 1);
        return Math.round(channel + (255 - channel) * factor);
    };

    const newR = clamp(r);
    const newG = clamp(g);
    const newB = clamp(b);

    return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
}

// Display charts
function displayCharts() {
    const packages = currentProject.packages || [];
    
    if (packages.length === 0) return;
    
    // Register Chart.js plugin
    if (typeof Chart !== 'undefined' && typeof ChartDataLabels !== 'undefined') {
        Chart.register(ChartDataLabels);
    }
    
    // Destroy existing charts before creating new ones
    const categoryCanvas = document.getElementById('categoryChart');
    const comparisonCanvas = document.getElementById('packageComparisonChart');
    
    if (categoryCanvas) {
        const existingCategoryChart = Chart.getChart(categoryCanvas);
        if (existingCategoryChart) {
            existingCategoryChart.destroy();
        }
    }
    
    if (comparisonCanvas) {
        const existingComparisonChart = Chart.getChart(comparisonCanvas);
        if (existingComparisonChart) {
            existingComparisonChart.destroy();
        }
    }
    
    // Category pie chart
    displayCategoryChart();
    
    // Package comparison chart
    displayPackageComparisonChart();
    
    // Add event listener for pie chart data source selector
    const selector = document.getElementById('pieChartDataSource');
    if (selector && !selector.hasAttribute('data-listener-attached')) {
        selector.setAttribute('data-listener-attached', 'true');
        selector.addEventListener('change', (e) => {
            window.pieChartDataSource = e.target.value;
            // Destroy and recreate the chart
            const canvas = document.getElementById('categoryChart');
            const existingChart = Chart.getChart(canvas);
            if (existingChart) {
                existingChart.destroy();
            }
            displayCategoryChart();
        });
    }
}

function displayCategoryChart() {
    const packages = currentProject.packages || [];
    
    // Group packages by CSI division
    const divisionMap = {};
    
    packages.forEach(pkg => {
        if (!pkg.csi_division) return;
        
        const div = pkg.csi_division;
        if (!divisionMap[div]) {
            divisionMap[div] = {
                division: div,
                selectedCost: 0,
                lowCost: 0,
                medianCost: 0,
                highCost: 0,
                packages: []
            };
        }
        
        divisionMap[div].selectedCost += (pkg.selected_amount || 0);
        divisionMap[div].lowCost += (pkg.low_bid || pkg.selected_amount || 0);
        divisionMap[div].medianCost += (pkg.median_bid || pkg.selected_amount || 0);
        divisionMap[div].highCost += (pkg.high_bid || pkg.selected_amount || 0);
        divisionMap[div].packages.push(pkg.package_code);
    });
    
    // Convert to array and sort by division number
    const divisionData = Object.values(divisionMap)
        .filter(d => d.selectedCost > 0)
        .sort((a, b) => parseInt(a.division) - parseInt(b.division));
    
    if (divisionData.length === 0) return;
    
    // Assign colors - same color for same division, and sitework (31-33) all same color
    const divisionColors = {
        '03': '#2c3e50', '04': '#3498db', '05': '#e74c3c',
        '06': '#f39c12', '07': '#16a085', '08': '#9b59b6',
        '09': '#34495e', '10': '#1abc9c', '11': '#e67e22',
        '12': '#d35400', '13': '#c0392b', '14': '#8e44ad',
        '21': '#2980b9', '22': '#27ae60', '23': '#8e44ad',
        '26': '#c0392b', '27': '#16a085', '28': '#e67e22',
        '31': '#7f8c8d', '32': '#7f8c8d', '33': '#7f8c8d' // All sitework same color
    };
    
    const colors = divisionData.map(d => divisionColors[d.division] || '#95a5a6');
    
    const ctx = document.getElementById('categoryChart');
    if (!ctx) return;
    
    // Get selected data source (default to median)
    const dataSource = window.pieChartDataSource || 'median';
    const dataKey = dataSource === 'low' ? 'lowCost' : 
                    dataSource === 'high' ? 'highCost' : 
                    dataSource === 'selected' ? 'selectedCost' : 'medianCost';
    
    const chartTitle = dataSource === 'low' ? 'Cost Distribution by CSI Division (Low Bids)' :
                       dataSource === 'high' ? 'Cost Distribution by CSI Division (High Bids)' :
                       dataSource === 'selected' ? 'Cost Distribution by CSI Division (Selected Bids)' :
                       'Cost Distribution by CSI Division (Median Bids)';
    
    new Chart(ctx, {
        type: 'pie',
        data: {
            labels: divisionData.map(d => `Div ${d.division}`),
            datasets: [{
                data: divisionData.map(d => d[dataKey]),
                backgroundColor: colors,
                borderColor: '#fff',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: chartTitle,
                    font: { size: 16, weight: 'bold' }
                },
                legend: {
                    position: 'right',
                    labels: {
                        generateLabels: function(chart) {
                            const data = chart.data;
                            return data.labels.map((label, i) => {
                                const division = divisionData[i];
                                return {
                                    text: `${label} (${division.packages.join(', ')})`,
                                    fillStyle: data.datasets[0].backgroundColor[i],
                                    hidden: false,
                                    index: i
                                };
                            });
                        }
                    }
                },
                datalabels: {
                    color: '#fff',
                    font: { weight: 'bold', size: 12 },
                    formatter: (value, context) => {
                        const total = context.dataset.data.reduce((a, b) => a + b, 0);
                        const percentage = ((value / total) * 100).toFixed(1);
                        return percentage + '%';
                    }
                },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const division = divisionData[context.dataIndex];
                            return [
                                `Division ${division.division}`,
                                `Packages: ${division.packages.join(', ')}`,
                                `Cost: ${formatCurrency(context.raw)}`
                            ];
                        }
                    }
                }
            }
        }
    });
}

function displayPackageComparisonChart() {
    const packages = currentProject.packages || [];
    const bidPackages = packages.filter(p => p.status !== 'estimated');
    
    if (bidPackages.length === 0) return;
    
    const ctx = document.getElementById('packageComparisonChart');
    if (!ctx) return;
    
    const blueColors = [
        'rgba(0, 48, 143, 0.7)',
        'rgba(32, 84, 184, 0.7)',
        'rgba(75, 119, 190, 0.7)',
        'rgba(116, 159, 212, 0.7)'
    ];
    
    // Sort packages by code
    bidPackages.sort((a, b) => a.package_code.localeCompare(b.package_code));
    
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: bidPackages.map(p => p.package_code),
            datasets: [
                {
                    label: 'Selected Bid',
                    data: bidPackages.map(p => p.selected_amount),
                    backgroundColor: blueColors[0],
                    borderColor: blueColors[0].replace('0.7', '1'),
                    borderWidth: 1
                },
                {
                    label: 'Median Bid',
                    data: bidPackages.map(p => p.median_bid || 0),
                    backgroundColor: blueColors[1],
                    borderColor: blueColors[1].replace('0.7', '1'),
                    borderWidth: 1
                },
                {
                    label: 'Low Bid',
                    data: bidPackages.map(p => p.low_bid || 0),
                    backgroundColor: blueColors[2],
                    borderColor: blueColors[2].replace('0.7', '1'),
                    borderWidth: 1
                },
                {
                    label: 'High Bid',
                    data: bidPackages.map(p => p.high_bid || 0),
                    backgroundColor: blueColors[3],
                    borderColor: blueColors[3].replace('0.7', '1'),
                    borderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: 'Package-by-Package Bid Comparison',
                    font: { size: 16, weight: 'bold' }
                },
                datalabels: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            return context.dataset.label + ': ' + formatCurrency(context.raw);
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: (value) => '$' + (value / 1000000).toFixed(1) + 'M'
                    }
                }
            }
        }
    });
}

const validateBtn = document.getElementById('validateProjectBtn');
if (validateBtn) {
    validateBtn.addEventListener('click', openValidateModal);
}

const validationHistoryBtn = document.getElementById('validationHistoryBtn');
if (validationHistoryBtn) {
    validationHistoryBtn.addEventListener('click', openValidationHistoryModal);
}

const preconNotesBtn = document.getElementById('preconNotesBtn');
if (preconNotesBtn) {
    preconNotesBtn.addEventListener('click', openPreconNotesModal);
}

const preconNotesForm = document.getElementById('preconNotesForm');
if (preconNotesForm) {
    preconNotesForm.addEventListener('submit', handlePreconNotesSubmit);
}

const validateProjectForm = document.getElementById('validateProjectForm');
if (validateProjectForm) {
    validateProjectForm.addEventListener('submit', handleValidationSubmit);
}

// Edit project
document.getElementById('editProjectBtn').onclick = () => {
    document.getElementById('editProjectName').value = currentProject.name;
    document.getElementById('editBuildingSF').value = currentProject.building_sf || '';
    document.getElementById('editProjectDate').value = currentProject.project_date || '';
    document.getElementById('editProjectModal').style.display = 'block';
};

function closeEditProjectModal() {
    document.getElementById('editProjectModal').style.display = 'none';
}

document.getElementById('editProjectForm').onsubmit = async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('editProjectName').value;
    const building_sf = document.getElementById('editBuildingSF').value;
    const project_date = document.getElementById('editProjectDate').value;
    
    try {
        await fetch(`${API_BASE}/projects/${projectId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name,
                building_sf: building_sf ? parseFloat(building_sf) : null,
                project_date: project_date || null
            })
        });
        
        closeEditProjectModal();
        loadProject();
    } catch (error) {
        console.error('Error updating project:', error);
        alert('Error updating project');
    }
};

// Load project on page load
setupViewTabs();
loadProject();
