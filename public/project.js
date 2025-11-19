const API_BASE = '/api';
const DEFAULT_PROJECT_STATE = 'OH';

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
let gmpChartMode = 'dollar';
let latestComputedMetrics = null;
let validationHistory = [];
let validationHistoryLoaded = false;
let isSavingValidation = false;
let isSavingPreconNotes = false;
let isSavingBidOverrides = false;
const editBidsState = {
    packageId: null,
    deletedBidIds: new Set(),
    tempIdCounter: 0
};
let latestBidEventId = null;
const bidderReviewState = {
    data: null,
    pendingDecisions: new Map(),
    isSaving: false,
    loading: false
};

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

const CATEGORY_DEFINITIONS = [
    { key: 'structure', name: 'Structure', divisions: ['03', '04', '05'], color: '#2c3e50' },
    { key: 'finishes', name: 'Finishes', divisions: ['09'], color: '#3498db' },
    { key: 'equipment', name: 'Equipment', divisions: ['11'], color: '#e74c3c' },
    { key: 'furnishings', name: 'Furnishings', divisions: ['12'], color: '#f39c12' },
    { key: 'mepts', name: 'MEPTS', divisions: ['21', '22', '23', '26', '27', '28'], color: '#16a085' },
    { key: 'sitework', name: 'Sitework', divisions: ['31', '32', '33'], color: '#95a5a6' }
];

const REMAINING_CATEGORY_COLOR = '#bdc3c7';

// Load project data
async function loadProject() {
    try {
        const response = await apiFetch(`${API_BASE}/projects/${projectId}`);
        currentProject = await response.json();
        validationHistoryLoaded = false;
        validationHistory = [];
        latestComputedMetrics = currentProject.metrics || null;

        // Update page title
        document.getElementById('projectName').textContent = currentProject.name;
        document.title = `${currentProject.name} - Bid Database`;

        updatePreconNotesButton();

        const packages = currentProject.packages || [];
        latestBidEventId = packages.reduce((latest, pkg) => {
            if (!pkg.bid_event_id) {
                return latest;
            }
            if (latest == null || Number(pkg.bid_event_id) > Number(latest)) {
                return pkg.bid_event_id;
            }
            return latest;
        }, null);
        updateBidderReviewButtonState();

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
        },
        {
            key: 'project-location',
            title: 'County',
            valueHtml: currentProject.county_name
                ? `<span style="font-size: 1.2rem;">${escapeHtml(currentProject.county_name)}${currentProject.county_state ? `, ${escapeHtml(currentProject.county_state)}` : ''}</span>`
                : '<span style="font-size: 1.2rem; color: #7f8c8d;">Not set</span>',
            showValidation: false
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
    if (!modal) return;

    modal.style.display = 'block';
    await loadValidationHistoryEntries({ showLoading: true });
}

async function loadValidationHistoryEntries({ showLoading = false } = {}) {
    const content = document.getElementById('validationHistoryContent');

    if (!content) {
        return;
    }

    if (showLoading) {
        content.innerHTML = '<div class="loading">Loading history...</div>';
    }

    try {
        const response = await apiFetch(`${API_BASE}/projects/${projectId}/validations`);
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
        validationHistoryLoaded = false;
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

        const response = await apiFetch(`${API_BASE}/projects/${projectId}`, {
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
                    <div class="validation-history-controls">
                        <span class="${statusClass}">${statusLabel}</span>
                        <span class="timestamp">${formatDateTime(entry.created_at)}</span>
                        <button type="button" class="validation-history-delete-btn" data-delete-validation-id="${entry.id}">Delete</button>
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

    attachValidationHistoryEvents();
}

function attachValidationHistoryEvents() {
    const content = document.getElementById('validationHistoryContent');
    if (!content) return;

    const deleteButtons = content.querySelectorAll('[data-delete-validation-id]');
    deleteButtons.forEach(button => {
        button.addEventListener('click', (event) => {
            event.preventDefault();
            const id = Number(button.getAttribute('data-delete-validation-id'));
            if (!id) {
                return;
            }
            deleteValidationEntry(id, button);
        });
    });
}

async function deleteValidationEntry(validationId, triggerButton) {
    if (!validationId) {
        return;
    }

    const confirmed = window.confirm('Delete this validation entry? This action cannot be undone.');
    if (!confirmed) {
        return;
    }

    const originalText = triggerButton ? triggerButton.textContent : '';
    if (triggerButton) {
        triggerButton.disabled = true;
        triggerButton.textContent = 'Deleting...';
    }

    let didDelete = false;

    try {
        const response = await apiFetch(`${API_BASE}/projects/${projectId}/validations/${validationId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error('Failed to delete validation');
        }

        didDelete = true;

        await loadProject();
        await loadValidationHistoryEntries({ showLoading: true });
    } catch (error) {
        console.error('Error deleting validation:', error);
        alert('Unable to delete validation. Please try again.');
    } finally {
        if (!didDelete && triggerButton && document.body.contains(triggerButton)) {
            triggerButton.disabled = false;
            triggerButton.textContent = originalText || 'Delete';
        }
    }
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
        const response = await apiFetch(`${API_BASE}/projects/${projectId}/validations`, {
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
        tbody.innerHTML = '<tr><td colspan="6">Building SF required to calculate cost/SF by category</td></tr>';
        return;
    }

    const categories = CATEGORY_DEFINITIONS;

    const totalSelectedCost = packages.reduce((sum, pkg) => sum + (pkg.selected_amount || 0), 0);
    const totalMedianCost = packages.reduce((sum, pkg) => sum + (pkg.median_bid || pkg.selected_amount || 0), 0);
    const totalHighCost = packages.reduce((sum, pkg) => sum + (pkg.high_bid || pkg.selected_amount || 0), 0);

    const formatCostWithPercentage = (value, percentage, emphasize = false) => {
        const hasValue = Number.isFinite(value);
        const hasPercentage = Number.isFinite(percentage);
        const costHtml = hasValue ? (emphasize ? `<strong>${formatCurrency(value)}</strong>` : formatCurrency(value)) : '—';
        const percentageHtml = hasPercentage ? `<span class="category-percentage">(${percentage.toFixed(1)}%)</span>` : '';
        return percentageHtml ? `${costHtml} ${percentageHtml}` : costHtml;
    };

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

        const selectedPercentage = totalSelectedCost > 0 ? (selectedCost / totalSelectedCost * 100) : 0;
        const medianPercentage = totalMedianCost > 0 ? (medianBidCost / totalMedianCost * 100) : 0;
        const highPercentage = totalHighCost > 0 ? (highBidCost / totalHighCost * 100) : 0;

        return {
            name: cat.name,
            divisions: cat.divisions.join(', '),
            medianCost: medianBidCost,
            selectedCost: selectedCost,
            highCost: highBidCost,
            selectedCostPerSF: selectedCostPerSF,
            medianBidCostPerSF: medianBidCostPerSF,
            highBidCostPerSF: highBidCostPerSF,
            selectedPercentage,
            medianPercentage,
            highPercentage,
            color: cat.color
        };
    });

    // Filter out categories with no cost
    const nonZeroCategories = categoryData.filter(cat => (cat.selectedCost > 0 || cat.medianCost > 0 || cat.highCost > 0));

    if (nonZeroCategories.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6">No packages assigned to standard categories yet</td></tr>';
        return;
    }

    tbody.innerHTML = nonZeroCategories.map(cat => `
        <tr>
            <td><strong style="color: ${cat.color}">${escapeHtml(cat.name)}</strong></td>
            <td>${escapeHtml(cat.divisions)}</td>
            <td>${formatCurrency(cat.medianCost)}</td>
            <td>${formatCostWithPercentage(cat.medianBidCostPerSF, cat.medianPercentage, true)}</td>
            <td>${formatCostWithPercentage(cat.selectedCostPerSF, cat.selectedPercentage)}</td>
            <td>${formatCostWithPercentage(cat.highBidCostPerSF, cat.highPercentage)}</td>
        </tr>
    `).join('');
}

async function displayPackages() {
    const tbody = document.getElementById('packagesBody');
    const packages = currentProject.packages || [];

    if (packages.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" class="empty-state">No packages yet. Upload a bid tab or add a package manually.</td></tr>';
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
                const response = await apiFetch(`${API_BASE}/packages/${pkg.id}/bids`);
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
        
        const bidCount = packageBidCounts[pkg.id] || 0;
        const bidCountCell = pkg.status !== 'estimated' ?
            `<a href="#" onclick="viewBids(${pkg.id}); return false;" style="color: #3498db; text-decoration: underline;">${bidCount}</a>` :
            '—';

        const selectedAmountCell = formatAmountWithSf(pkg.selected_amount, { perSfValue: pkg.cost_per_sf });
        const lowAmountCell = formatAmountWithSf(pkg.low_bid);
        const medianAmountCell = formatAmountWithSf(pkg.median_bid);
        const highAmountCell = formatAmountWithSf(pkg.high_bid);
        const bidSpreadCell = formatBidSpread(pkg.low_bid, pkg.high_bid);

        return `
            <tr>
                <td><strong>${escapeHtml(pkg.package_code)}</strong></td>
                <td>${escapeHtml(pkg.package_name)}</td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                <td>${pkg.bidder_name ? escapeHtml(pkg.bidder_name) : '—'}</td>
                <td>${selectedAmountCell}</td>
                <td>${lowAmountCell}</td>
                <td>${medianAmountCell}</td>
                <td>${highAmountCell}</td>
                <td>${bidSpreadCell}</td>
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
    const lowVsGmpPercent = [];
    const medianVsGmpPercent = [];
    const medianVsLowPercent = [];

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
        lowVsGmpPercent.push(gmpLowPercent != null ? gmpLowPercent : null);
        medianVsGmpPercent.push(gmpMedianPercent != null ? gmpMedianPercent : null);
        medianVsLowPercent.push(medianLowPercent != null ? medianLowPercent : null);

        const gmpLowClass = getBudgetDeltaClass(gmpLowDelta);
        const gmpMedianClass = getBudgetDeltaClass(gmpMedianDelta);
        const medianLowClass = getSpreadDeltaClass(medianLowDelta);

        const gmpCell = formatAmountWithSf(gmp);
        const lowCell = formatAmountWithSf(low);
        const medianCell = formatAmountWithSf(median);
        const gmpLowCell = formatAmountWithSf(gmpLowDelta, { isDelta: true });
        const gmpMedianCell = formatAmountWithSf(gmpMedianDelta, { isDelta: true });
        const medianLowCell = formatAmountWithSf(medianLowDelta, { isDelta: true });

        return `
            <tr>
                <td><strong>${escapeHtml(code)}</strong></td>
                <td>${escapeHtml(name)}</td>
                <td>${gmpCell}</td>
                <td>${lowCell}</td>
                <td class="${gmpLowClass}">${gmpLowCell}</td>
                <td class="${gmpLowClass}">${formatPercentageDelta(gmpLowPercent)}</td>
                <td>${medianCell}</td>
                <td class="${gmpMedianClass}">${gmpMedianCell}</td>
                <td class="${gmpMedianClass}">${formatPercentageDelta(gmpMedianPercent)}</td>
                <td class="${medianLowClass}">${medianLowCell}</td>
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

    const totalGmpCell = totals.gmpCount > 0 ? formatAmountWithSf(totals.gmp) : '—';
    const totalLowCell = totals.lowCount > 0 ? formatAmountWithSf(totals.low) : '—';
    const totalMedianCell = totals.medianCount > 0 ? formatAmountWithSf(totals.median) : '—';
    const totalLowDeltaCell = formatAmountWithSf(totalLowDelta, { isDelta: true });
    const totalMedianDeltaCell = formatAmountWithSf(totalMedianDelta, { isDelta: true });
    const totalMedianLowDeltaCell = formatAmountWithSf(totalMedianLowDelta, { isDelta: true });

    totalsRow.innerHTML = `
        <th scope="row">Totals</th>
        <td>—</td>
        <td>${totalGmpCell}</td>
        <td>${totalLowCell}</td>
        <td class="${totalLowClass}">${totalLowDeltaCell}</td>
        <td class="${totalLowClass}">${formatPercentageDelta(totalLowPercent)}</td>
        <td>${totalMedianCell}</td>
        <td class="${totalMedianClass}">${totalMedianDeltaCell}</td>
        <td class="${totalMedianClass}">${formatPercentageDelta(totalMedianPercent)}</td>
        <td class="${totalMedianLowClass}">${totalMedianLowDeltaCell}</td>
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
        medianVsLow,
        lowVsGmpPercent,
        medianVsGmpPercent,
        medianVsLowPercent
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

    const isPercentMode = gmpChartMode === 'percent';
    const chartDatasets = [
        {
            label: 'Low vs GMP',
            data: isPercentMode ? (chartData.lowVsGmpPercent || []) : (chartData.lowVsGmp || []),
            backgroundColor: 'rgba(192, 57, 43, 0.35)',
            borderColor: '#c0392b',
            borderWidth: 1.5,
            order: 1
        },
        {
            label: 'Median vs GMP',
            data: isPercentMode ? (chartData.medianVsGmpPercent || []) : (chartData.medianVsGmp || []),
            backgroundColor: 'rgba(243, 156, 18, 0.35)',
            borderColor: '#f39c12',
            borderWidth: 1.5,
            order: 2
        },
        {
            label: 'Median vs Low',
            data: isPercentMode ? (chartData.medianVsLowPercent || []) : (chartData.medianVsLow || []),
            backgroundColor: 'rgba(41, 128, 185, 0.35)',
            borderColor: '#2980b9',
            borderWidth: 1.5,
            order: 3
        }
    ];

    const tickFormatter = (value) => {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return String(value ?? '');
        }
        if (isPercentMode) {
            return formatPercentValue(numericValue);
        }
        return formatCompactCurrency(numericValue);
    };

    const tooltipFormatter = (value) => {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return '';
        }
        if (isPercentMode) {
            return formatPercentValue(numericValue);
        }
        return formatDeltaCurrency(numericValue);
    };

    const datalabelFormatter = (value) => {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return '';
        }
        return isPercentMode ? formatPercentValue(numericValue) : formatCompactCurrency(numericValue);
    };

    gmpDeltaChart = new Chart(context, {
        type: 'bar',
        data: {
            labels: chartData.labels,
            datasets: chartDatasets
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
                        callback: tickFormatter
                    },
                    title: {
                        display: true,
                        text: isPercentMode ? 'Delta (%)' : 'Delta ($)'
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
                            const formatted = tooltipFormatter(value);
                            return formatted ? `${context.dataset.label}: ${formatted}` : context.dataset.label;
                        }
                    }
                },
                datalabels: {
                    anchor: 'end',
                    align: 'end',
                    formatter: datalabelFormatter,
                    color: '#34495e',
                    font: {
                        weight: '600'
                    }
                }
            }
        }
    });
}

function setupGmpChartControls() {
    const select = document.getElementById('gmpChartMode');
    if (!select) {
        return;
    }

    select.value = gmpChartMode;
    select.addEventListener('change', (event) => {
        const value = event.target.value === 'percent' ? 'percent' : 'dollar';
        gmpChartMode = value;
        if (currentTab === 'gmp') {
            renderGmpDeltaChart();
        } else {
            gmpChartNeedsUpdate = true;
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
        const response = await apiFetch(`${API_BASE}/projects/${projectId}/bids`);

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
        const editButtonLabel = bidCount > 0 ? 'Edit bids' : 'Add bids';
        const editButton = `<button class="btn btn-small btn-secondary" onclick="openEditBidsModal(${pkg.package_id})">${editButtonLabel}</button>`;

        if (bidCount === 0) {
            return `
                <article class="bid-package-card">
                    <div class="bid-package-header">
                        <div class="bid-package-title">
                            <h4>${displayName}</h4>
                            <span>${headerMeta}</span>
                        </div>
                        ${editButton}
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
                    <div class="bid-package-title">
                        <h4>${displayName}</h4>
                        <span>${headerMeta}</span>
                    </div>
                    ${editButton}
                </div>
                <ul class="bid-entries">
                    ${entries}
                </ul>
            </article>
        `;
    }).join('');

    listEl.innerHTML = sections;
}

function openEditBidsModal(packageId) {
    const modal = document.getElementById('editBidsModal');
    const packageIdInput = document.getElementById('editBidsPackageId');
    const listEl = document.getElementById('editBidsList');
    const titleEl = document.getElementById('editBidsPackageName');
    const saveBtn = document.getElementById('saveEditedBidsBtn');

    if (!modal || !packageIdInput || !listEl || !titleEl || !saveBtn) {
        return;
    }

    setEditBidsSavingState(false);

    const pkg = projectBids.find(item => item.package_id === packageId);
    if (!pkg) {
        alert('Unable to find bids for that package. Please refresh and try again.');
        return;
    }

    packageIdInput.value = packageId;
    editBidsState.packageId = packageId;
    editBidsState.deletedBidIds = new Set();
    editBidsState.tempIdCounter = 0;
    const safeCode = pkg.package_code ? escapeHtml(pkg.package_code) : 'Package';
    const safeName = pkg.package_name ? escapeHtml(pkg.package_name) : '';
    titleEl.textContent = safeName ? `${safeCode} – ${safeName}` : safeCode;

    const bids = Array.isArray(pkg.bids) ? pkg.bids : [];
    const rows = bids.map(bid => {
        const bidderName = bid.bidder_name || 'Unknown Bidder';
        const numericAmount = toFiniteNumber(bid.bid_amount);
        const amountValue = numericAmount != null ? numericAmount.toFixed(2) : '';
        const isSelected = Boolean(bid.was_selected) || (pkg.selected_bidder_id && bid.bidder_id === pkg.selected_bidder_id);

        return createEditBidRowMarkup({
            bidId: bid.id,
            bidderName,
            amountValue,
            isSelected,
            isNew: false
        });
    }).join('');

    const hasSelectedBid = bids.some(bid => Boolean(bid.was_selected) || (pkg.selected_bidder_id && bid.bidder_id === pkg.selected_bidder_id));
    const placeholderRow = rows ? '' : getEditBidsEmptyRowHtml();

    listEl.innerHTML = `
        <table class="edit-bids-table">
            <thead>
                <tr>
                    <th>Bidder</th>
                    <th>Bid Amount</th>
                    <th style="width: 120px; text-align: center;">Selected</th>
                    <th style="width: 120px; text-align: right;">Remove</th>
                </tr>
            </thead>
            <tbody data-edit-bids-body>
                ${rows || placeholderRow}
            </tbody>
        </table>
        <div class="edit-bids-inline-actions">
            <button type="button" class="btn btn-secondary btn-small" data-add-bid-row>+ Add Bid</button>
        </div>
        <label class="edit-bids-selection">
            <input type="radio" name="selectedBid" value="none" ${hasSelectedBid ? '' : 'checked'}>
            <span>No bidder selected</span>
        </label>
        <p class="edit-bids-hint">Saving changes updates the package totals, selected bidder, and bidder history immediately.</p>
    `;

    saveBtn.disabled = false;

    modal.style.display = 'block';
}

function closeEditBidsModal() {
    const modal = document.getElementById('editBidsModal');
    const listEl = document.getElementById('editBidsList');
    const packageIdInput = document.getElementById('editBidsPackageId');

    if (modal) {
        modal.style.display = 'none';
    }

    if (packageIdInput) {
        packageIdInput.value = '';
    }

    if (listEl) {
        listEl.innerHTML = '<div class="empty-state">Select a package to edit its bids.</div>';
    }

    const form = document.getElementById('editBidsForm');
    if (form) {
        form.reset();
    }

    resetEditBidsState();
    setEditBidsSavingState(false);
}

function setEditBidsSavingState(isSaving) {
    const saveBtn = document.getElementById('saveEditedBidsBtn');
    isSavingBidOverrides = isSaving;
    if (!saveBtn) return;
    saveBtn.disabled = isSaving;
    saveBtn.textContent = isSaving ? 'Saving…' : 'Save Changes';
}

function resetEditBidsState() {
    editBidsState.packageId = null;
    editBidsState.deletedBidIds = new Set();
    editBidsState.tempIdCounter = 0;
}

function getEditBidsEmptyRowHtml() {
    return '<tr data-empty-row><td colspan="4" class="edit-bids-empty-cell">No bids recorded yet. Use "Add Bid" to include one.</td></tr>';
}

function createEditBidRowMarkup({ bidId, bidderName, amountValue, isSelected, isNew, tempId }) {
    const safeName = escapeHtml(bidderName || '');
    const rowAttributes = isNew
        ? `data-bid-row data-is-new="true" data-temp-id="${tempId || ''}"`
        : `data-bid-row data-is-new="false" data-bid-id="${bidId}"`;
    const selectionValue = isNew ? `new-${tempId}` : `existing-${bidId}`;
    const ariaLabelName = safeName || 'Manual bidder';
    const bidderCell = isNew
        ? `<input type="text" data-bidder-name-input placeholder="Enter bidder name" value="${safeName}" required>`
        : `<div class="existing-bidder-name" title="${safeName}">${safeName || 'Unknown Bidder'}</div>`;

    return `
        <tr ${rowAttributes}>
            <td>
                ${bidderCell}
            </td>
            <td>
                <input type="number" step="0.01" min="0" inputmode="decimal" required data-bid-amount-input value="${amountValue || ''}">
            </td>
            <td class="edit-bids-radio-cell">
                <input type="radio" name="selectedBid" value="${selectionValue}" ${isSelected ? 'checked' : ''} aria-label="Select ${ariaLabelName}">
            </td>
            <td class="edit-bids-remove-cell">
                <button type="button" class="btn btn-tiny btn-danger" data-remove-bid-row>Remove</button>
            </td>
        </tr>
    `;
}

function handleEditBidsListClick(event) {
    const addButton = event.target.closest('[data-add-bid-row]');
    if (addButton) {
        event.preventDefault();
        addManualBidRow();
        return;
    }

    const removeButton = event.target.closest('[data-remove-bid-row]');
    if (removeButton) {
        event.preventDefault();
        const row = removeButton.closest('[data-bid-row]');
        removeManualBidRow(row);
    }
}

function addManualBidRow() {
    const tbody = document.querySelector('[data-edit-bids-body]');
    if (!tbody) {
        return;
    }

    const emptyRow = tbody.querySelector('[data-empty-row]');
    if (emptyRow) {
        emptyRow.remove();
    }

    editBidsState.tempIdCounter += 1;
    const tempId = `manual-${editBidsState.tempIdCounter}`;
    const rowHtml = createEditBidRowMarkup({
        bidderName: '',
        amountValue: '',
        isSelected: false,
        isNew: true,
        tempId
    });

    tbody.insertAdjacentHTML('beforeend', rowHtml);
}

function removeManualBidRow(row) {
    if (!row) {
        return;
    }

    const radioInput = row.querySelector('input[type="radio"][name="selectedBid"]');
    const selectedRadio = document.querySelector('input[name="selectedBid"]:checked');
    if (radioInput && selectedRadio && radioInput.value === selectedRadio.value) {
        const noneRadio = document.querySelector('input[name="selectedBid"][value="none"]');
        if (noneRadio) {
            noneRadio.checked = true;
        }
    }

    const bidId = row.dataset.bidId ? Number(row.dataset.bidId) : null;
    if (Number.isInteger(bidId)) {
        editBidsState.deletedBidIds.add(bidId);
    }

    row.remove();

    const tbody = document.querySelector('[data-edit-bids-body]');
    if (tbody && !tbody.querySelector('[data-bid-row]')) {
        tbody.innerHTML = getEditBidsEmptyRowHtml();
    }
}

async function handleEditBidsSubmit(event) {
    event.preventDefault();

    if (isSavingBidOverrides) {
        return;
    }

    const packageId = Number(document.getElementById('editBidsPackageId')?.value);
    const bidRows = Array.from(document.querySelectorAll('[data-bid-row]'));

    if (!packageId) {
        alert('Select a package with bids to edit.');
        return;
    }

    const updates = [];
    const additions = [];
    const selectedRadio = document.querySelector('input[name="selectedBid"]:checked');
    const selectedValue = selectedRadio ? selectedRadio.value : 'none';

    if (bidRows.length === 0 && editBidsState.deletedBidIds.size === 0) {
        alert('Add or modify at least one bid before saving.');
        return;
    }

    for (const row of bidRows) {
        const amountInput = row.querySelector('[data-bid-amount-input]');
        if (!amountInput) {
            continue;
        }

        const rawValue = amountInput.value.trim();
        if (!rawValue) {
            amountInput.focus();
            alert('Please enter a bid amount for every bidder.');
            return;
        }

        const numericValue = Number(rawValue);
        if (!Number.isFinite(numericValue)) {
            amountInput.focus();
            alert('Bid amounts must be numeric.');
            return;
        }

        const isNew = row.dataset.isNew === 'true';
        const bidId = row.dataset.bidId ? Number(row.dataset.bidId) : null;
        const tempId = row.dataset.tempId || '';
        const rowSelectionValue = isNew ? `new-${tempId}` : `existing-${bidId}`;
        const isSelected = selectedValue === rowSelectionValue;

        if (isNew) {
            const bidderInput = row.querySelector('[data-bidder-name-input]');
            const bidderName = bidderInput?.value?.trim();
            if (!bidderName) {
                bidderInput?.focus();
                alert('Please provide a bidder name for every new bid.');
                return;
            }

            additions.push({
                bidder_name: bidderName,
                bid_amount: numericValue,
                was_selected: isSelected
            });
        } else if (Number.isInteger(bidId)) {
            updates.push({
                id: bidId,
                bid_amount: numericValue,
                was_selected: isSelected
            });
        }
    }

    const deletions = Array.from(editBidsState.deletedBidIds);

    if (!updates.length && !additions.length && !deletions.length) {
        alert('No bid changes detected.');
        return;
    }

    setEditBidsSavingState(true);

    try {
        const response = await apiFetch(`${API_BASE}/packages/${packageId}/bids`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bids: updates, additions, deletions })
        });

        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.error || 'Failed to update bids.');
        }

        await loadProject();
        setActiveTab('bids');
        closeEditBidsModal();
    } catch (error) {
        console.error('Error saving bids:', error);
        alert(error.message || 'Error saving bids');
    } finally {
        setEditBidsSavingState(false);
    }
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
        const response = await apiFetch(`${API_BASE}/upload-bid-tab`, {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (result.success) {
            document.getElementById('uploadProgress').style.display = 'none';
            const summary = result.review_summary || { total_bids: 0, flagged_bids: 0, new_bidders: 0 };
            latestBidEventId = result.bid_event_id || latestBidEventId;
            updateBidderReviewButtonState();

            const needsReview = summary.flagged_bids > 0;
            const reviewMessage = summary.total_bids
                ? needsReview
                    ? `<div class="upload-review-warning">${summary.flagged_bids} of ${summary.total_bids} bids need confirmation.</div>`
                    : `<div class="upload-review-success">All ${summary.total_bids} bids were matched automatically.</div>`
                : '';

            document.getElementById('uploadResult').innerHTML = `
                <div class="upload-success-card">
                    <strong>Success!</strong> Processed ${result.packages_added} package(s).
                    ${result.building_sf ? `<br>Building SF: ${formatNumber(result.building_sf)}` : ''}
                    ${result.project_date ? `<br>Project Bid Date: ${formatDate(result.project_date)}` : ''}
                </div>
                ${summary.total_bids ? `
                    <div class="upload-review-summary">
                        <div><strong>Total bids:</strong> ${summary.total_bids}</div>
                        <div><strong>Needs review:</strong> ${summary.flagged_bids}</div>
                        <div><strong>New bidders:</strong> ${summary.new_bidders}</div>
                    </div>` : ''}
                ${reviewMessage}
                <div class="upload-review-actions">
                    <button type="button" class="btn btn-secondary" id="uploadReviewLaterBtn">Done</button>
                    <button type="button" class="btn btn-primary" id="uploadReviewNowBtn">Review Bidders${needsReview ? ` (${summary.flagged_bids})` : ''}</button>
                </div>
            `;
            document.getElementById('uploadResult').style.display = 'block';

            const closeBtn = document.getElementById('uploadReviewLaterBtn');
            if (closeBtn) {
                closeBtn.onclick = () => {
                    closeUploadModal();
                };
            }

            const reviewBtn = document.getElementById('uploadReviewNowBtn');
            if (reviewBtn) {
                reviewBtn.onclick = () => {
                    closeUploadModal();
                    if (result.bid_event_id) {
                        openBidderReviewModal(result.bid_event_id);
                    }
                };
            }

            loadProject();
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
        await apiFetch(`${API_BASE}/packages`, {
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
        await apiFetch(`${API_BASE}/packages/${packageId}`, {
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
        await apiFetch(`${API_BASE}/packages/${packageId}`, {
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
        const response = await apiFetch(`${API_BASE}/packages/${packageId}/bids`);
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

function formatAmountWithSf(amount, options = {}) {
    const { isDelta = false, perSfValue = null } = options;
    const buildingSfOverride = options.hasOwnProperty('buildingSf') ? options.buildingSf : currentProject?.building_sf;

    if (amount == null) {
        return '—';
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount)) {
        return '—';
    }

    const baseText = isDelta ? formatDeltaCurrency(numericAmount) : formatCurrency(numericAmount);
    if (baseText === '—') {
        return '—';
    }

    let sfValue = null;
    let shouldShowSf = false;

    if (perSfValue != null && Number.isFinite(Number(perSfValue))) {
        sfValue = Number(perSfValue);
        shouldShowSf = true;
    } else if (buildingSfOverride != null) {
        const numericBuildingSf = Number(buildingSfOverride);
        if (Number.isFinite(numericBuildingSf) && numericBuildingSf > 0) {
            sfValue = numericAmount / numericBuildingSf;
            shouldShowSf = Number.isFinite(sfValue);
        }
    }

    const sfHtml = shouldShowSf
        ? `<div class="sf-cost">${isDelta ? formatDeltaCurrency(sfValue) : formatCurrency(sfValue)}/SF</div>`
        : '';

    return `<div class="amount-with-sf"><div class="amount">${baseText}</div>${sfHtml}</div>`;
}

function formatPercentValue(value, options = {}) {
    if (value == null) {
        return '';
    }

    const { includePlus = true, includeSymbol = true } = options;
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
        return String(value);
    }

    const abs = Math.abs(numericValue);
    const precision = abs >= 100 ? 0 : 1;
    const formatted = abs.toFixed(precision);

    if (numericValue === 0) {
        return `0${includeSymbol ? '%' : ''}`;
    }

    const sign = numericValue > 0
        ? (includePlus ? '+' : '')
        : '-';

    return `${sign}${formatted}${includeSymbol ? '%' : ''}`;
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

function formatBidSpread(lowBid, highBid) {
    const low = toFiniteNumber(lowBid);
    const high = toFiniteNumber(highBid);

    if (low == null || high == null || !Number.isFinite(low) || !Number.isFinite(high) || low <= 0) {
        return '—';
    }

    const spreadPercent = ((high - low) / low) * 100;
    if (!Number.isFinite(spreadPercent) || spreadPercent < 0) {
        return '—';
    }

    if (spreadPercent < 0.05) {
        return '0.0%';
    }

    return formatPercentValue(spreadPercent, { includePlus: false });
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
    const {
        lowVsGmp = [],
        medianVsGmp = [],
        medianVsLow = [],
        lowVsGmpPercent = [],
        medianVsGmpPercent = [],
        medianVsLowPercent = []
    } = data;
    return [
        ...lowVsGmp,
        ...medianVsGmp,
        ...medianVsLow,
        ...lowVsGmpPercent,
        ...medianVsGmpPercent,
        ...medianVsLowPercent
    ].some(value => value != null);
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

    window.pieChartDataSource = window.pieChartDataSource || 'median';
    window.pieChartGrouping = window.pieChartGrouping || 'division';

    // Category pie chart
    displayCategoryChart();

    // Package comparison chart
    displayPackageComparisonChart();

    // Add event listener for pie chart data source selector
    const selector = document.getElementById('pieChartDataSource');
    if (selector) {
        selector.value = window.pieChartDataSource;
    }
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

    const groupingSelector = document.getElementById('pieChartGrouping');
    if (groupingSelector) {
        groupingSelector.value = window.pieChartGrouping;
    }
    if (groupingSelector && !groupingSelector.hasAttribute('data-listener-attached')) {
        groupingSelector.setAttribute('data-listener-attached', 'true');
        groupingSelector.addEventListener('change', (e) => {
            window.pieChartGrouping = e.target.value;
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
    const ctx = document.getElementById('categoryChart');
    if (!ctx) return;

    const grouping = window.pieChartGrouping || 'division';
    const dataSource = window.pieChartDataSource || 'median';

    const dataKey = dataSource === 'low' ? 'low' :
                    dataSource === 'high' ? 'high' :
                    dataSource === 'selected' ? 'selected' : 'median';

    const dataLabel = dataSource === 'low' ? 'Low Bids' :
                      dataSource === 'high' ? 'High Bids' :
                      dataSource === 'selected' ? 'Selected Bids' : 'Median Bids';

    const baseTitle = grouping === 'category'
        ? 'Cost Distribution by Category'
        : 'Cost Distribution by CSI Division';
    const chartTitle = `${baseTitle} (${dataLabel})`;

    let entries = [];

    if (grouping === 'category') {
        const divisionToCategory = {};
        CATEGORY_DEFINITIONS.forEach(cat => {
            cat.divisions.forEach(div => {
                divisionToCategory[div] = cat.key;
            });
        });

        const categoryEntries = CATEGORY_DEFINITIONS.map(cat => ({
            key: cat.key,
            label: cat.name,
            legendLabel: cat.name,
            color: cat.color,
            packages: [],
            divisions: cat.divisions.join(', '),
            metrics: { selected: 0, low: 0, median: 0, high: 0 }
        }));

        const categoryMap = new Map(categoryEntries.map(entry => [entry.key, entry]));
        const remainderEntry = {
            key: 'remaining',
            label: 'Remaining Packages',
            legendLabel: 'Remaining Packages',
            color: REMAINING_CATEGORY_COLOR,
            packages: [],
            divisions: 'Other',
            metrics: { selected: 0, low: 0, median: 0, high: 0 }
        };

        packages.forEach(pkg => {
            const division = pkg.csi_division;
            const targetKey = division ? divisionToCategory[division] : null;
            const target = targetKey ? categoryMap.get(targetKey) : remainderEntry;

            const packageCode = pkg.package_code || '—';
            target.packages.push(packageCode);

            const selectedValue = toFiniteNumber(pkg.selected_amount) || 0;
            const lowValue = toFiniteNumber(pkg.low_bid);
            const medianValue = toFiniteNumber(pkg.median_bid);
            const highValue = toFiniteNumber(pkg.high_bid);

            target.metrics.selected += selectedValue;
            target.metrics.low += lowValue != null ? lowValue : selectedValue;
            target.metrics.median += medianValue != null ? medianValue : selectedValue;
            target.metrics.high += highValue != null ? highValue : selectedValue;
        });

        entries = [...categoryEntries, remainderEntry];
    } else {
        const divisionMap = {};

        packages.forEach(pkg => {
            if (!pkg.csi_division) return;

            const div = pkg.csi_division;
            if (!divisionMap[div]) {
                divisionMap[div] = {
                    key: div,
                    label: `Div ${div}`,
                    legendLabel: `Div ${div}`,
                    color: null,
                    packages: [],
                    divisions: div,
                    metrics: { selected: 0, low: 0, median: 0, high: 0 }
                };
            }

            const entry = divisionMap[div];
            entry.packages.push(pkg.package_code || '—');

            const selectedValue = toFiniteNumber(pkg.selected_amount) || 0;
            const lowValue = toFiniteNumber(pkg.low_bid);
            const medianValue = toFiniteNumber(pkg.median_bid);
            const highValue = toFiniteNumber(pkg.high_bid);

            entry.metrics.selected += selectedValue;
            entry.metrics.low += lowValue != null ? lowValue : selectedValue;
            entry.metrics.median += medianValue != null ? medianValue : selectedValue;
            entry.metrics.high += highValue != null ? highValue : selectedValue;
        });

        const divisionColors = {
            '03': '#2c3e50', '04': '#3498db', '05': '#e74c3c',
            '06': '#f39c12', '07': '#16a085', '08': '#9b59b6',
            '09': '#34495e', '10': '#1abc9c', '11': '#e67e22',
            '12': '#d35400', '13': '#c0392b', '14': '#8e44ad',
            '21': '#2980b9', '22': '#27ae60', '23': '#8e44ad',
            '26': '#c0392b', '27': '#16a085', '28': '#e67e22',
            '31': '#7f8c8d', '32': '#7f8c8d', '33': '#7f8c8d'
        };

        entries = Object.values(divisionMap)
            .map(entry => ({ ...entry, color: divisionColors[entry.key] || '#95a5a6' }))
            .sort((a, b) => parseInt(a.key, 10) - parseInt(b.key, 10));
    }

    const filteredEntries = entries.filter(entry => {
        const value = entry.metrics[dataKey] || 0;
        if (grouping === 'category' && entry.key === 'remaining') {
            return entry.packages.length > 0 || value > 0;
        }
        return value > 0;
    });

    if (filteredEntries.length === 0) {
        return;
    }

    const dataValues = filteredEntries.map(entry => entry.metrics[dataKey]);
    const totalValue = dataValues.reduce((sum, value) => sum + value, 0);

    if (totalValue <= 0) {
        return;
    }

    const colors = filteredEntries.map(entry => entry.color || REMAINING_CATEGORY_COLOR);
    const labels = filteredEntries.map(entry => entry.label);
    const chartEntries = filteredEntries;
    const groupingMode = grouping;

    new Chart(ctx, {
        type: 'pie',
        data: {
            labels,
            datasets: [{
                data: dataValues,
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
                            const dataset = chart.data.datasets[0];
                            return chartEntries.map((entry, i) => {
                                const pkgList = entry.packages.length ? entry.packages.join(', ') : '—';
                                return {
                                    text: `${entry.legendLabel}${pkgList !== '—' ? ` (${pkgList})` : ''}`,
                                    fillStyle: dataset.backgroundColor[i],
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
                    display: (context) => context.raw > 0,
                    formatter: (value) => {
                        const percentage = ((value / totalValue) * 100).toFixed(1);
                        return percentage + '%';
                    }
                },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const entry = chartEntries[context.dataIndex];
                            const pkgList = entry.packages.length ? entry.packages.join(', ') : '—';
                            const percentage = ((context.raw / totalValue) * 100).toFixed(1);

                            const lines = [entry.legendLabel];
                            if (groupingMode === 'category') {
                                lines.push(`Divisions: ${entry.divisions}`);
                            }
                            lines.push(`Packages: ${pkgList}`);
                            lines.push(`Cost: ${formatCurrency(context.raw)} (${percentage}%)`);
                            return lines;
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

// Bidder review helpers
function removeStandaloneReviewBiddersButtons() {
    const allowedContainers = ['editProjectModal', 'uploadModal']
        .map((id) => document.getElementById(id))
        .filter(Boolean);

    document.querySelectorAll('button').forEach((button) => {
        const label = button.textContent ? button.textContent.trim() : '';
        if (!label.includes('Review Bidders')) {
            return;
        }

        const isInsideAllowedContainer = allowedContainers.some((container) => container.contains(button));
        if (!isInsideAllowedContainer) {
            button.remove();
        }
    });
}

function updateBidderReviewButtonState() {
    const buttons = document.querySelectorAll('[data-review-bidders-btn]');
    if (!buttons.length) {
        return;
    }
    buttons.forEach((button) => {
        if (latestBidEventId) {
            button.disabled = false;
            button.title = 'Review bidder matches from the latest upload.';
        } else {
            button.disabled = true;
            button.title = 'Upload a bid tab to review bidder matches.';
        }
    });
}

async function fetchBidderReviewData(bidEventId) {
    const response = await apiFetch(`${API_BASE}/bid-events/${bidEventId}/bidder-review`);
    const payload = await response.json();
    if (!response.ok) {
        throw new Error(payload.error || 'Unable to load bidder review data.');
    }
    return payload;
}

async function openBidderReviewModal(bidEventId) {
    const modal = document.getElementById('bidderReviewModal');
    if (!modal) return;

    if (bidEventId) {
        latestBidEventId = bidEventId;
        updateBidderReviewButtonState();
    }

    modal.style.display = 'block';
    bidderReviewState.loading = true;
    bidderReviewState.data = null;
    bidderReviewState.pendingDecisions.clear();
    renderBidderReviewModal();
    const statusEl = document.getElementById('bidderReviewStatus');
    if (statusEl) {
        statusEl.textContent = 'Loading bidder matches...';
    }

    try {
        const payload = await fetchBidderReviewData(bidEventId);
        bidderReviewState.data = payload;
        bidderReviewState.loading = false;
        bidderReviewState.pendingDecisions.clear();
        renderBidderReviewModal();
        if (statusEl) {
            statusEl.textContent = payload.summary.flagged_bids
                ? `${payload.summary.flagged_bids} bids still need confirmation.`
                : 'All bidders are assigned. Review or close when ready.';
        }
    } catch (error) {
        bidderReviewState.loading = false;
        renderBidderReviewModal();
        if (statusEl) {
            statusEl.textContent = `Error: ${error.message}`;
        }
        console.error('Failed to load bidder review data', error);
    }
}

async function refreshBidderReviewData() {
    if (!bidderReviewState.data) {
        return;
    }
    bidderReviewState.loading = true;
    renderBidderReviewModal();
    try {
        const payload = await fetchBidderReviewData(bidderReviewState.data.bid_event_id);
        bidderReviewState.data = payload;
        bidderReviewState.loading = false;
        bidderReviewState.pendingDecisions.clear();
        renderBidderReviewModal();
    } catch (error) {
        bidderReviewState.loading = false;
        renderBidderReviewModal();
        const statusEl = document.getElementById('bidderReviewStatus');
        if (statusEl) {
            statusEl.textContent = `Error: ${error.message}`;
        }
    }
}

function closeBidderReviewModal() {
    const modal = document.getElementById('bidderReviewModal');
    if (modal) {
        modal.style.display = 'none';
    }
    bidderReviewState.loading = false;
    bidderReviewState.isSaving = false;
    bidderReviewState.pendingDecisions.clear();
    updateBidderReviewActionState();
}

function renderBidderReviewModal() {
    const summaryEl = document.getElementById('bidderReviewSummary');
    const packagesEl = document.getElementById('bidderReviewPackages');
    const subtitleEl = document.getElementById('bidderReviewSubtitle');
    if (!summaryEl || !packagesEl || !subtitleEl) {
        return;
    }

    if (bidderReviewState.loading) {
        summaryEl.innerHTML = '';
        packagesEl.innerHTML = '<div class="loading">Loading bidder matches...</div>';
        subtitleEl.textContent = 'Loading bidder matches...';
        updateBidderReviewActionState();
        return;
    }

    if (!bidderReviewState.data) {
        summaryEl.innerHTML = '';
        packagesEl.innerHTML = '<div class="empty-state">Upload a bid tab to start reviewing bidders.</div>';
        subtitleEl.textContent = 'Select a recent upload to review the bidder assignments.';
        updateBidderReviewActionState();
        return;
    }

    const data = bidderReviewState.data;
    const uploadLabel = [];
    if (data.source_filename) {
        uploadLabel.push(data.source_filename);
    }
    if (data.upload_date) {
        uploadLabel.push(formatDateTime(data.upload_date));
    }
    subtitleEl.textContent = uploadLabel.length ? uploadLabel.join(' · ') : 'Review bidder matches for this upload.';

    summaryEl.innerHTML = `
        <div><strong>Total bids:</strong> ${data.summary.total_bids}</div>
        <div><strong>Needs review:</strong> ${data.summary.flagged_bids}</div>
        <div><strong>New bidders:</strong> ${data.summary.new_bidders}</div>
    `;

    if (!data.packages.length) {
        packagesEl.innerHTML = '<div class="empty-state">No packages were added in this upload.</div>';
    } else {
        packagesEl.innerHTML = data.packages.map(renderBidderReviewPackage).join('');
    }

    updateBidderReviewActionState();
}

function renderBidderReviewPackage(pkg) {
    const needsReviewTag = pkg.needs_review_count
        ? `<span class="bidder-review-tag tag-warning">${pkg.needs_review_count} need review</span>`
        : '<span class="bidder-review-tag">All matched</span>';
    const rows = pkg.bids && pkg.bids.length
        ? pkg.bids.map((bid) => renderBidderReviewRow(pkg, bid)).join('')
        : '<tr><td colspan="2" class="empty-state">No bids captured for this package.</td></tr>';

    return `
        <details class="bidder-review-package" ${pkg.needs_review_count ? 'open' : ''}>
            <summary>
                <div>
                    <div><strong>${escapeHtml(pkg.package_code || 'Package')}</strong></div>
                    <div class="bidder-review-meta">${escapeHtml(pkg.package_name || '')}</div>
                </div>
                <div class="bidder-review-tags">${needsReviewTag}</div>
            </summary>
            <table class="bidder-review-table">
                <thead>
                    <tr>
                        <th>Bidder</th>
                        <th>Suggested Match</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </details>
    `;
}

function renderBidderReviewRow(pkg, bid) {
    const pending = bidderReviewState.pendingDecisions.get(bid.bid_id);
    let selectValue = '__keep__';
    if (pending) {
        if (pending.new_bidder_name) {
            selectValue = '__create__';
        } else if (pending.bidder_id) {
            selectValue = String(pending.bidder_id);
        }
    }
    const encodedRaw = encodeURIComponent(bid.raw_bidder_name || '');
    const originalId = bid.bidder_id != null ? String(bid.bidder_id) : '';
    const showNewInput = selectValue === '__create__';
    const newInputValue = pending?.new_bidder_name || bid.raw_bidder_name || '';

    const uniqueSuggestions = [];
    const seen = new Set();
    (bid.suggestions || []).forEach((suggestion) => {
        if (suggestion && !seen.has(suggestion.bidder_id)) {
            seen.add(suggestion.bidder_id);
            uniqueSuggestions.push(suggestion);
        }
    });

    const allDirectoryBidders = Array.isArray(bidderReviewState.data?.all_bidders)
        ? bidderReviewState.data.all_bidders
        : [];
    const suggestionIds = new Set(uniqueSuggestions.map((s) => s.bidder_id));
    const directoryOptions = allDirectoryBidders.filter((entry) => !suggestionIds.has(entry.bidder_id));

    const options = [];
    const keepLabel = bid.bidder_name ? `Keep ${escapeHtml(bid.bidder_name)}` : 'Leave unassigned';
    options.push(`<option value="__keep__"${selectValue === '__keep__' ? ' selected' : ''}>${keepLabel}</option>`);

    if (uniqueSuggestions.length) {
        const suggestionOptions = uniqueSuggestions.map((suggestion) => {
            const isSelected = selectValue === String(suggestion.bidder_id);
            return `<option value="${suggestion.bidder_id}"${isSelected ? ' selected' : ''}>${escapeHtml(suggestion.name)} (${formatConfidence(suggestion.confidence)})</option>`;
        });
        options.push(`<optgroup label="Suggested Matches">${suggestionOptions.join('')}</optgroup>`);
    }

    if (directoryOptions.length) {
        const otherOptions = directoryOptions.map((entry) => {
            const isSelected = selectValue === String(entry.bidder_id);
            return `<option value="${entry.bidder_id}"${isSelected ? ' selected' : ''}>${escapeHtml(entry.name)}</option>`;
        });
        options.push(`<optgroup label="All Bidders">${otherOptions.join('')}</optgroup>`);
    }

    options.push(`<option value="__create__"${showNewInput ? ' selected' : ''}>➕ Create new bidder...</option>`);

    const amountTag = bid.bid_amount != null
        ? `<span class="bidder-review-tag tag-amount">${formatCurrency(bid.bid_amount)}</span>`
        : '';
    const selectedTag = bid.was_selected
        ? '<span class="bidder-review-tag tag-selected">Selected Bid</span>'
        : '';
    const reviewTag = bid.needs_review ? '<span class="bidder-review-tag tag-warning">Needs review</span>' : '';

    return `
        <tr class="${bid.needs_review ? 'needs-review' : ''}">
            <td>
                <div><strong>${escapeHtml(bid.raw_bidder_name || bid.bidder_name || 'Unknown Bidder')}</strong></div>
                <div class="bidder-review-tags">${selectedTag}${amountTag}${reviewTag}</div>
                <div class="bidder-review-meta">Assigned: ${escapeHtml(bid.bidder_name || 'New Bidder')}</div>
            </td>
            <td>
                <select class="bidder-review-select" data-bid-id="${bid.bid_id}" data-raw-name="${encodedRaw}" data-original-bidder-id="${originalId}">
                    ${options.join('')}
                </select>
                <input type="text" class="bidder-review-new-input ${showNewInput ? 'is-visible' : ''}" data-bid-id="${bid.bid_id}" value="${escapeHtml(newInputValue)}" placeholder="Enter new bidder name">
                <div class="confidence-label">Confidence: ${formatConfidence(bid.match_confidence)}</div>
            </td>
        </tr>
    `;
}

function handleBidderReviewChange(event) {
    const select = event.target.closest('.bidder-review-select');
    if (select) {
        handleBidderSelectChange(select);
    }
}

function handleBidderReviewInput(event) {
    const input = event.target.closest('.bidder-review-new-input');
    if (!input) {
        return;
    }
    const bidId = Number(input.dataset.bidId);
    if (!Number.isFinite(bidId)) {
        return;
    }
    const pending = bidderReviewState.pendingDecisions.get(bidId);
    if (!pending || pending.bidder_id) {
        return;
    }
    pending.new_bidder_name = input.value.trim();
    bidderReviewState.pendingDecisions.set(bidId, pending);
    updateBidderReviewActionState();
}

function handleBidderSelectChange(select) {
    const bidId = Number(select.dataset.bidId);
    if (!Number.isFinite(bidId)) {
        return;
    }
    const value = select.value;
    const rawName = decodeRawNameAttribute(select.dataset.rawName || '');
    const originalId = select.dataset.originalBidderId ? Number(select.dataset.originalBidderId) : null;
    const newInput = document.querySelector(`.bidder-review-new-input[data-bid-id="${bidId}"]`);

    if (value === '__create__') {
        if (newInput) {
            newInput.classList.add('is-visible');
            if (!newInput.value) {
                newInput.value = rawName;
            }
            newInput.focus();
        }
        bidderReviewState.pendingDecisions.set(bidId, {
            bid_id: bidId,
            new_bidder_name: newInput ? newInput.value.trim() || rawName : rawName,
            raw_bidder_name: rawName
        });
    } else if (value === '__keep__') {
        if (newInput) {
            newInput.classList.remove('is-visible');
        }
        bidderReviewState.pendingDecisions.delete(bidId);
    } else {
        if (newInput) {
            newInput.classList.remove('is-visible');
        }
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            bidderReviewState.pendingDecisions.delete(bidId);
        } else if (originalId != null && numericValue === originalId) {
            bidderReviewState.pendingDecisions.delete(bidId);
        } else {
            bidderReviewState.pendingDecisions.set(bidId, {
                bid_id: bidId,
                bidder_id: numericValue,
                raw_bidder_name: rawName
            });
        }
    }

    updateBidderReviewActionState();
}

function decodeRawNameAttribute(value) {
    if (!value) {
        return '';
    }
    try {
        return decodeURIComponent(value);
    } catch (error) {
        return value;
    }
}

async function applyBidderReviewDecisions() {
    if (bidderReviewState.isSaving || !bidderReviewState.data) {
        return;
    }

    const decisions = Array.from(bidderReviewState.pendingDecisions.values()).map((decision) => {
        const payload = {
            bid_id: decision.bid_id,
            raw_bidder_name: decision.raw_bidder_name || ''
        };
        if (decision.new_bidder_name) {
            payload.new_bidder_name = decision.new_bidder_name.trim();
        } else if (decision.bidder_id) {
            payload.bidder_id = decision.bidder_id;
        }
        return payload;
    }).filter((payload) => payload.bidder_id || (payload.new_bidder_name && payload.new_bidder_name.length));

    if (!decisions.length) {
        return;
    }

    bidderReviewState.isSaving = true;
    updateBidderReviewActionState();
    const statusEl = document.getElementById('bidderReviewStatus');
    if (statusEl) {
        statusEl.textContent = 'Saving bidder updates...';
    }

    try {
        const response = await apiFetch(`${API_BASE}/bid-events/${bidderReviewState.data.bid_event_id}/bidder-review`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decisions })
        });
        const payload = await response.json();
        if (!response.ok || !payload.success) {
            throw new Error(payload.error || 'Failed to save bidder updates.');
        }
        bidderReviewState.data = payload.bid_event;
        bidderReviewState.pendingDecisions.clear();
        bidderReviewState.isSaving = false;
        renderBidderReviewModal();
        if (statusEl) {
            statusEl.textContent = 'Bidder assignments updated.';
        }
        await loadProject();
    } catch (error) {
        bidderReviewState.isSaving = false;
        if (statusEl) {
            statusEl.textContent = `Error: ${error.message}`;
        }
        console.error('Failed to save bidder review decisions', error);
    }

    updateBidderReviewActionState();
}

function updateBidderReviewActionState() {
    const saveBtn = document.getElementById('applyBidderReviewBtn');
    if (!saveBtn) {
        return;
    }
    const pendingCount = bidderReviewState.pendingDecisions.size;
    if (bidderReviewState.isSaving) {
        saveBtn.textContent = 'Saving...';
    } else {
        saveBtn.textContent = pendingCount > 0 ? `Save Changes (${pendingCount})` : 'Save Changes';
    }
    saveBtn.disabled = bidderReviewState.isSaving || pendingCount === 0;
}

function formatConfidence(value) {
    if (value == null || Number.isNaN(value)) {
        return '—';
    }
    return `${Math.round(Number(value) * 100)}%`;
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

const editBidsForm = document.getElementById('editBidsForm');
if (editBidsForm) {
    editBidsForm.addEventListener('submit', handleEditBidsSubmit);
}

const editBidsListContainer = document.getElementById('editBidsList');
if (editBidsListContainer) {
    editBidsListContainer.addEventListener('click', handleEditBidsListClick);
}

const validateProjectForm = document.getElementById('validateProjectForm');
if (validateProjectForm) {
    validateProjectForm.addEventListener('submit', handleValidationSubmit);
}

const reviewBidderButtons = document.querySelectorAll('[data-review-bidders-btn]');
if (reviewBidderButtons.length) {
    reviewBidderButtons.forEach((button) => {
        button.addEventListener('click', () => {
            if (!latestBidEventId) {
                alert('Upload a bid tab to review bidder matches.');
                return;
            }
            if (button.dataset.closeEditModal === 'true') {
                closeEditProjectModal();
            }
            openBidderReviewModal(latestBidEventId);
        });
    });
}

const bidderReviewPackagesEl = document.getElementById('bidderReviewPackages');
if (bidderReviewPackagesEl) {
    bidderReviewPackagesEl.addEventListener('change', handleBidderReviewChange);
    bidderReviewPackagesEl.addEventListener('input', handleBidderReviewInput);
}

const applyBidderReviewBtn = document.getElementById('applyBidderReviewBtn');
if (applyBidderReviewBtn) {
    applyBidderReviewBtn.addEventListener('click', applyBidderReviewDecisions);
}

removeStandaloneReviewBiddersButtons();

// Edit project
document.getElementById('editProjectBtn').onclick = () => {
    document.getElementById('editProjectName').value = currentProject.name;
    document.getElementById('editBuildingSF').value = currentProject.building_sf || '';
    document.getElementById('editProjectCounty').value = currentProject.county_name || '';
    document.getElementById('editProjectState').value = currentProject.county_state || DEFAULT_PROJECT_STATE;
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
    const county_name = document.getElementById('editProjectCounty').value;
    const county_state = document.getElementById('editProjectState').value;

    try {
        await apiFetch(`${API_BASE}/projects/${projectId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name,
                building_sf: building_sf ? parseFloat(building_sf) : null,
                project_date: project_date || null,
                county_name: county_name ? county_name.trim() : null,
                county_state: county_state || null
            })
        });
        
        closeEditProjectModal();
        loadProject();
    } catch (error) {
        console.error('Error updating project:', error);
        alert('Error updating project');
    }
};

const editModalUploadBidTabBtn = document.getElementById('editModalUploadBidTabBtn');
if (editModalUploadBidTabBtn) {
    editModalUploadBidTabBtn.addEventListener('click', () => {
        closeEditProjectModal();
        document.getElementById('uploadModal').style.display = 'block';
    });
}

// Load project on page load
updateBidderReviewButtonState();
setupGmpChartControls();
setupViewTabs();
loadProject();
