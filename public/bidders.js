const API_BASE = '/api';

const STATE_FIPS_BY_CODE = {
    AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09', DE: '10', FL: '12', GA: '13',
    HI: '15', ID: '16', IL: '17', IN: '18', IA: '19', KS: '20', KY: '21', LA: '22', ME: '23', MD: '24',
    MA: '25', MI: '26', MN: '27', MS: '28', MO: '29', MT: '30', NE: '31', NV: '32', NH: '33', NJ: '34',
    NM: '35', NY: '36', NC: '37', ND: '38', OH: '39', OK: '40', OR: '41', PA: '42', RI: '44', SC: '45',
    SD: '46', TN: '47', TX: '48', UT: '49', VT: '50', VA: '51', WA: '53', WV: '54', WI: '55', WY: '56',
    DC: '11', PR: '72'
};

const STATE_CODE_BY_FIPS = Object.fromEntries(Object.entries(STATE_FIPS_BY_CODE).map(([code, fips]) => [fips, code]));

function parseIdList(value) {
    if (!value) return [];
    if (Array.isArray(value)) {
        return value
            .map(Number)
            .filter(Number.isFinite);
    }
    return String(value)
        .split(',')
        .map(part => Number(part))
        .filter(Number.isFinite);
}

let allBidders = [];
let selectedBidders = new Set();
let currentBidderHistory = [];
let bidderHistorySort = { field: 'project_date', direction: 'desc' };
let activeBidderId = null;
let activeBidderName = '';
let activeBiddersTab = 'list';
let bidderListSort = { field: 'name', direction: 'asc' };
let bidderActivityData = [];
let bidderActivityLoaded = false;
let bidderActivitySort = { key: 'awarded_amount', direction: 'desc' };
let activityStartDate = '';
let activityEndDate = '';
let bidderActivityPackageFilter = '';
let countyMapInitialized = false;
let countyMapPromise = null;
let countyPathSelection = null;
let stateBorderSelection = null;
let mapTooltip = null;
let mapContainerElement = null;
let countyLookup = new Map();
let countyMetadata = new Map();
let countyActivityCache = new Map();
let activeCountyData = new Map();
let selectedMapBidderIds = new Set();
let packageSelectionBidderIds = new Set();
let packageBidderLookup = new Map();
let selectedCountyFips = new Set();
let activeCountyFocus = null;
let countyBidderCache = new Map();

function getSelectedCountyMetas() {
    return Array.from(selectedCountyFips)
        .map(fips => countyMetadata.get(fips))
        .filter(Boolean);
}

function getSelectionSignature(fipsSet = selectedCountyFips) {
    return Array.from(fipsSet).sort().join('|');
}

// Load all bidders
async function loadBidders() {
    try {
        // Show loading message
        document.getElementById('biddersBody').innerHTML =
            '<tr><td colspan="7" class="loading">Loading bidders and packages (this may take a moment)...</td></tr>';

        const response = await apiFetch(`${API_BASE}/bidders`);
        const bidders = await response.json();

        allBidders = bidders.map(bidder => ({
            ...bidder,
            bid_count: Number(bidder.bid_count) || 0,
            aliases: Array.isArray(bidder.aliases) ? bidder.aliases : [],
            packages: Array.isArray(bidder.packages) ? bidder.packages : [],
            project_counties: Array.isArray(bidder.project_counties) ? bidder.project_counties : []
        }));

        const validIds = new Set(allBidders.map(b => String(b.id)));
        selectedMapBidderIds = new Set(Array.from(selectedMapBidderIds).filter(id => validIds.has(String(id))));
        packageSelectionBidderIds = new Set(Array.from(packageSelectionBidderIds).filter(id => validIds.has(String(id))));

        populateMapBidderSelect();
        populateMapPackageSelect();
        // NOW display the bidders after everything is loaded
        displayBidders();
    } catch (error) {
        console.error('Error loading bidders:', error);
        document.getElementById('biddersBody').innerHTML =
            '<tr><td colspan="7" class="empty-state">Error loading bidders</td></tr>';
    }
}

function getPrimaryCountyLabel(bidder) {
    if (!bidder.project_counties || bidder.project_counties.length === 0) {
        return '';
    }

    const sorted = bidder.project_counties.slice().sort((a, b) => {
        const nameDiff = (a.name || '').localeCompare(b.name || '');
        if (nameDiff !== 0) return nameDiff;
        return (a.state || '').localeCompare(b.state || '');
    });

    return formatCountyLabel(sorted[0]);
}

function formatCountyLabel(entry) {
    if (!entry || !entry.name) {
        return '';
    }
    return entry.state ? `${entry.name}, ${entry.state}` : entry.name;
}

// Display bidders in table
function displayBidders(filter = '', packageFilter = '', countyFilter = '') {
    const tbody = document.getElementById('biddersBody');
    
    // Check if allBidders is populated
    if (!allBidders || allBidders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="loading">Loading bidders...</td></tr>';
        return;
    }
    
    let filteredBidders = allBidders;
    
    // Apply bidder name filter
    if (filter) {
        const lowerFilter = filter.toLowerCase();
        filteredBidders = filteredBidders.filter(bidder => 
            bidder.canonical_name.toLowerCase().includes(lowerFilter) ||
            bidder.aliases.some(alias => alias.toLowerCase().includes(lowerFilter))
        );
    }
    
    // Apply package filter
    if (packageFilter) {
        const lowerPackageFilter = packageFilter.toLowerCase();
        filteredBidders = filteredBidders.filter(bidder =>
            bidder.packages && bidder.packages.some(pkg => pkg.toLowerCase().includes(lowerPackageFilter))
        );
    }

    if (countyFilter) {
        const lowerCountyFilter = countyFilter.toLowerCase();
        filteredBidders = filteredBidders.filter(bidder =>
            bidder.project_counties && bidder.project_counties.some(entry =>
                formatCountyLabel(entry).toLowerCase().includes(lowerCountyFilter) ||
                (entry.state && entry.state.toLowerCase().includes(lowerCountyFilter))
            )
        );
    }

    if (filteredBidders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No bidders found</td></tr>';
        return;
    }

    const sortedBidders = filteredBidders.slice().sort((a, b) => {
        const direction = bidderListSort.direction === 'asc' ? 1 : -1;

        if (bidderListSort.field === 'county') {
            const countyA = getPrimaryCountyLabel(a).toLowerCase();
            const countyB = getPrimaryCountyLabel(b).toLowerCase();
            return countyA.localeCompare(countyB) * direction;
        }

        if (bidderListSort.field === 'bids') {
            const bidsA = Number(a.bid_count) || 0;
            const bidsB = Number(b.bid_count) || 0;
            if (bidsA !== bidsB) {
                return (bidsA - bidsB) * direction;
            }
        }

        return a.canonical_name.localeCompare(b.canonical_name) * direction;
    });

    tbody.innerHTML = sortedBidders.map(bidder => `
        <tr>
            <td>
                <input type="checkbox"
                       class="bidder-checkbox" 
                       data-bidder-id="${bidder.id}"
                       data-bidder-name="${escapeHtml(bidder.canonical_name)}"
                       ${selectedBidders.has(bidder.id) ? 'checked' : ''}>
            </td>
            <td>
                <strong>${escapeHtml(bidder.canonical_name)}</strong>
            </td>
            <td>
                ${bidder.packages && bidder.packages.length > 0
                    ? `<span style="color: #2c3e50; font-size: 0.875rem;">${escapeHtml(bidder.packages.join(', '))}</span>`
                    : '—'}
            </td>
            <td>
                ${bidder.aliases.length > 0
                    ? `<span style="color: #7f8c8d; font-size: 0.875rem;">${escapeHtml(bidder.aliases.join(', '))}</span>`
                    : '—'}
            </td>
            <td>
                ${bidder.project_counties && bidder.project_counties.length > 0
                    ? `<span style="color: #2c3e50; font-size: 0.875rem;">${escapeHtml(bidder.project_counties.map(formatCountyLabel).filter(Boolean).join(', '))}</span>`
                    : '—'}
            </td>
            <td>${bidder.bid_count || 0}</td>
            <td class="bidder-actions-cell">
                <button class="btn btn-small btn-secondary" onclick="viewBidderDetail(${bidder.id}, '${escapeHtml(bidder.canonical_name)}')">
                    View Details
                </button>
                <button type="button" class="bidder-delete-btn" data-bidder-id="${bidder.id}" data-bidder-name="${escapeHtml(bidder.canonical_name)}" aria-label="Delete ${escapeHtml(bidder.canonical_name)}">×</button>
            </td>
        </tr>
    `).join('');
    
    // Attach checkbox event listeners
    document.querySelectorAll('.bidder-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', handleCheckboxChange);
    });

    document.querySelectorAll('.bidder-delete-btn').forEach(button => {
        button.addEventListener('click', (event) => {
            const bidderId = Number(event.currentTarget.dataset.bidderId);
            const bidderName = event.currentTarget.dataset.bidderName || 'this bidder';
            deleteBidder(bidderId, bidderName);
        });
    });

    updateBidderListSortIndicators();
}

function setBidderListSort(field) {
    if (!field) {
        return;
    }

    if (bidderListSort.field === field) {
        bidderListSort.direction = bidderListSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        bidderListSort = {
            field,
            direction: field === 'bids' ? 'desc' : 'asc'
        };
    }

    const bidderFilter = document.getElementById('searchBidders').value;
    const packageFilter = document.getElementById('filterPackages').value;
    const countyFilter = document.getElementById('filterCounties').value;
    displayBidders(bidderFilter, packageFilter, countyFilter);
}

function updateBidderListSortIndicators() {
    document.querySelectorAll('.bidder-list-sort').forEach(button => {
        const indicator = button.querySelector('.sort-indicator');
        if (!indicator) return;

        if (button.dataset.listSort === bidderListSort.field) {
            indicator.textContent = bidderListSort.direction === 'asc' ? '▲' : '▼';
        } else {
            indicator.textContent = '';
        }
    });
}

async function deleteBidder(bidderId, bidderName) {
    if (!Number.isFinite(bidderId)) {
        return;
    }

    const confirmation = confirm(
        `Delete "${bidderName}" and remove their bids from the database?\n\n` +
        'This will clear any selections, aliases, and bids tied to this bidder.'
    );

    if (!confirmation) {
        return;
    }

    try {
        const response = await apiFetch(`${API_BASE}/bidders/${bidderId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error('Delete request was not successful');
        }

        alert(`Deleted ${bidderName}.`);
        selectedBidders.delete(bidderId);
        if (activeBidderId === bidderId) {
            closeBidderDetail();
        }
        loadBidders();
    } catch (error) {
        console.error('Failed to delete bidder:', error);
        alert('Unable to delete this bidder right now. Please try again.');
    }
}

// Handle checkbox selection
function handleCheckboxChange(e) {
    const bidderId = parseInt(e.target.dataset.bidderId);
    
    if (e.target.checked) {
        selectedBidders.add(bidderId);
    } else {
        selectedBidders.delete(bidderId);
    }
    
    updateMergeSection();
}

// Update merge section visibility and options
function updateMergeSection() {
    const mergeSection = document.getElementById('mergeSection');
    const keepBidderSelect = document.getElementById('keepBidder');
    const mergeBtn = document.getElementById('mergeBtn');
    
    if (selectedBidders.size >= 2) {
        mergeSection.style.display = 'block';
        
        // Populate the keep bidder dropdown
        keepBidderSelect.innerHTML = '<option value="">-- Select Primary Bidder --</option>';
        selectedBidders.forEach(id => {
            const bidder = allBidders.find(b => b.id === id);
            if (bidder) {
                const option = document.createElement('option');
                option.value = id;
                option.textContent = bidder.canonical_name;
                keepBidderSelect.appendChild(option);
            }
        });
        
        mergeBtn.disabled = false;
    } else {
        mergeSection.style.display = 'none';
        mergeBtn.disabled = true;
    }
}

// View bidder detail
async function viewBidderDetail(bidderId, bidderName) {
    document.getElementById('bidderDetailName').textContent = `${bidderName} - Bid History`;
    document.getElementById('bidderDetail').style.display = 'block';
    activeBidderId = bidderId;
    activeBidderName = bidderName;

    const mapButton = document.getElementById('bidderMapButton');
    if (mapButton) {
        mapButton.style.display = 'inline-flex';
        mapButton.disabled = false;
    }

    // Scroll to the details section
    setTimeout(() => {
        document.getElementById('bidderDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
    
    const tbody = document.getElementById('bidderBidsBody');
    tbody.innerHTML = '<tr><td colspan="6" class="loading">Loading bid history...</td></tr>';

    try {
        const response = await apiFetch(`${API_BASE}/bidders/${bidderId}/history`);
        const bidHistory = await response.json();
        currentBidderHistory = Array.isArray(bidHistory) ? bidHistory : [];
        bidderHistorySort = { field: 'project_date', direction: 'desc' };

        renderBidderHistoryTable();
        updateBidderMetrics();
        updateBidderSortIndicators();
    } catch (error) {
        console.error('Error loading bidder detail:', error);
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Error loading bid history</td></tr>';
        currentBidderHistory = [];
        const metrics = document.getElementById('bidderMetrics');
        if (metrics) {
            metrics.style.display = 'none';
        }
        const mapButton = document.getElementById('bidderMapButton');
        if (mapButton) {
            mapButton.style.display = 'none';
        }
    }
}

function closeBidderDetail() {
    document.getElementById('bidderDetail').style.display = 'none';
    currentBidderHistory = [];
    activeBidderId = null;
    activeBidderName = '';
    const metrics = document.getElementById('bidderMetrics');
    if (metrics) {
        metrics.style.display = 'none';
    }
    const mapButton = document.getElementById('bidderMapButton');
    if (mapButton) {
        mapButton.style.display = 'none';
    }
}

// Utility functions
function formatCurrency(num) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(num);
}

function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatPercentDifference(value) {
    if (value == null || Number.isNaN(Number(value))) {
        return '—';
    }

    const numeric = Number(value);
    const abs = Math.abs(numeric);
    const precision = abs >= 100 ? 0 : 1;
    const formatted = abs.toFixed(precision);

    if (numeric > 0) {
        return `+${formatted}%`;
    }

    if (numeric < 0) {
        return `-${formatted}%`;
    }

    return precision === 0 ? '0%' : '0.0%';
}

function renderPlacementCell(bid) {
    const rank = Number(bid.placement_rank);
    const total = Number(bid.placement_total);
    const percentValue = bid.percent_from_selected != null ? Number(bid.percent_from_selected) : null;

    const hasRank = Number.isFinite(rank) && Number.isFinite(total) && total > 0;
    const hasPercent = percentValue != null && !Number.isNaN(percentValue);

    if (!hasRank && !hasPercent) {
        return '—';
    }

    const pieces = ['<div class="placement-indicator">'];

    if (hasRank) {
        pieces.push(`<span class="placement-rank">${rank}/${total}</span>`);
    }

    if (hasPercent) {
        const diffClass = percentValue > 0 ? 'is-higher' : percentValue < 0 ? 'is-lower' : 'is-even';
        pieces.push(`<span class="placement-diff ${diffClass}">${formatPercentDifference(percentValue)}</span>`);
    }

    pieces.push('</div>');
    return pieces.join('');
}

function renderBidderHistoryTable() {
    const tbody = document.getElementById('bidderBidsBody');

    if (!currentBidderHistory || currentBidderHistory.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No bids found for this bidder</td></tr>';
        return;
    }

    const sortedHistory = currentBidderHistory.slice().sort((a, b) =>
        compareBidderHistoryEntries(a, b, bidderHistorySort.field, bidderHistorySort.direction)
    );

    tbody.innerHTML = sortedHistory.map(bid => `
        <tr>
            <td>${escapeHtml(bid.project_name)}</td>
            <td>${bid.project_date ? formatDate(bid.project_date) : '—'}</td>
            <td><strong>${escapeHtml(bid.package_code)}</strong> ${escapeHtml(bid.package_name)}</td>
            <td>
                <div class="amount-with-sf">
                    <div class="amount">${bid.bid_amount != null ? formatCurrency(bid.bid_amount) : '—'}</div>
                    ${bid.cost_per_sf !== null ? `<div class="sf-cost">${formatCurrency(bid.cost_per_sf)}/SF</div>` : ''}
                </div>
            </td>
            <td>
                ${bid.was_selected
                    ? '<span class="status-badge status-bid">Selected</span>'
                    : '<span class="status-badge status-estimated">Not Selected</span>'}
            </td>
            <td>${renderPlacementCell(bid)}</td>
        </tr>
    `).join('');
}

function compareBidderHistoryEntries(a, b, field, direction) {
    const dir = direction === 'asc' ? 1 : -1;
    let valueA = null;
    let valueB = null;

    switch (field) {
        case 'bid_amount':
            valueA = a.bid_amount != null ? Number(a.bid_amount) : null;
            valueB = b.bid_amount != null ? Number(b.bid_amount) : null;
            break;
        case 'status':
            valueA = a.was_selected ? 1 : 0;
            valueB = b.was_selected ? 1 : 0;
            break;
        case 'project_date':
        default:
            valueA = a.project_date ? new Date(a.project_date).getTime() : null;
            valueB = b.project_date ? new Date(b.project_date).getTime() : null;
            break;
    }

    if (valueA == null && valueB == null) {
        return 0;
    }

    if (valueA == null) {
        return 1;
    }

    if (valueB == null) {
        return -1;
    }

    if (valueA < valueB) {
        return -1 * dir;
    }

    if (valueA > valueB) {
        return 1 * dir;
    }

    return 0;
}

function setBidderHistorySort(field) {
    if (!field) {
        return;
    }

    if (bidderHistorySort.field === field) {
        bidderHistorySort.direction = bidderHistorySort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        bidderHistorySort = {
            field,
            direction: field === 'project_date' ? 'desc' : 'asc'
        };
    }

    renderBidderHistoryTable();
    updateBidderSortIndicators();
}

function updateBidderSortIndicators() {
    document.querySelectorAll('#bidderBidsTable .sortable-header').forEach(button => {
        const indicator = button.querySelector('.sort-indicator');
        if (!indicator) {
            return;
        }

        if (button.dataset.sortField === bidderHistorySort.field && currentBidderHistory.length > 0) {
            indicator.textContent = bidderHistorySort.direction === 'asc' ? '▲' : '▼';
        } else {
            indicator.textContent = '';
        }
    });
}

function updateBidderMetrics() {
    const metricsContainer = document.getElementById('bidderMetrics');
    if (!metricsContainer) {
        return;
    }

    const total = currentBidderHistory.length;
    const wins = currentBidderHistory.filter(bid => bid.was_selected).length;
    const winRate = total > 0 ? (wins / total) * 100 : null;
    const rankValues = currentBidderHistory
        .map(bid => Number(bid.placement_rank))
        .filter(value => Number.isFinite(value));

    const avgRank = rankValues.length > 0
        ? rankValues.reduce((sum, value) => sum + value, 0) / rankValues.length
        : null;

    metricsContainer.style.display = 'grid';
    document.getElementById('bidderMetricTotal').textContent = total;
    document.getElementById('bidderMetricWins').textContent = wins;
    document.getElementById('bidderMetricWinRate').textContent = winRate != null
        ? `${winRate.toFixed(winRate >= 100 ? 0 : 1)}%`
        : '—';
    document.getElementById('bidderMetricAvgRank').textContent = avgRank != null
        ? avgRank.toFixed(1)
        : '—';
}

function formatWinRate(value) {
    if (value == null || Number.isNaN(Number(value))) {
        return '—';
    }

    const numeric = Number(value);
    const precision = numeric >= 100 ? 0 : 1;
    return `${numeric.toFixed(precision)}%`;
}

function normalizeActivityPackages(packages) {
    if (!packages) {
        return [];
    }

    const uniquePackages = pkgList => {
        const seen = new Set();

        return pkgList.filter(pkg => {
            const code = (pkg.code || '').trim();
            const name = (pkg.name || '').trim();

            if (!(code || name)) {
                return false;
            }

            const key = (code || name).toLowerCase();
            if (seen.has(key)) {
                return false;
            }

            seen.add(key);
            pkg.code = code;
            pkg.name = name;
            return true;
        });
    };

    if (Array.isArray(packages)) {
        return uniquePackages(packages
            .map(pkg => ({
                code: pkg.code || pkg.package_code || '',
                name: pkg.name || pkg.package_name || ''
            })));
    }

    const raw = String(packages);
    const separator = raw.includes('||') ? '||' : ',';

    return uniquePackages(raw
        .split(separator)
        .map(part => {
            const [code = '', name = ''] = part.split('|');
            return { code, name };
        }));
}

function formatActivityPackages(packages) {
    if (!packages || !packages.length) {
        return '—';
    }

    const labels = packages
        .map(pkg => escapeHtml(pkg.code || pkg.name || ''))
        .filter(Boolean);

    return labels.length ? labels.join(', ') : '—';
}

function getActivitySortValue(row, key) {
    const value = row?.[key];
    if (value == null) {
        return null;
    }

    if (typeof value === 'string') {
        return value.toLowerCase();
    }

    const numeric = Number(value);
    return Number.isNaN(numeric) ? value : numeric;
}

function sortBidderActivity(data) {
    const direction = bidderActivitySort.direction === 'asc' ? 1 : -1;

    return data.slice().sort((a, b) => {
        const aVal = getActivitySortValue(a, bidderActivitySort.key);
        const bVal = getActivitySortValue(b, bidderActivitySort.key);

        if (aVal === null && bVal === null) return 0;
        if (aVal === null) return 1;
        if (bVal === null) return -1;

        if (typeof aVal === 'string' && typeof bVal === 'string') {
            return aVal.localeCompare(bVal) * direction;
        }

        if (aVal < bVal) return -1 * direction;
        if (aVal > bVal) return 1 * direction;
        return 0;
    });
}

function updateActivitySortIndicators() {
    document.querySelectorAll('[data-activity-sort]').forEach(button => {
        const indicator = button.querySelector('.sort-indicator');
        if (!indicator) return;

        if (button.dataset.activitySort === bidderActivitySort.key) {
            indicator.textContent = bidderActivitySort.direction === 'asc' ? '▲' : '▼';
        } else {
            indicator.textContent = '↕';
        }
    });
}

function renderBidderActivityTable() {
    const tbody = document.getElementById('bidderActivityBody');
    if (!tbody) {
        return;
    }

    const packageFilter = bidderActivityPackageFilter.trim().toLowerCase();
    const filtered = packageFilter
        ? bidderActivityData.filter(bidder => bidder.package_search_text.includes(packageFilter))
        : bidderActivityData;

    if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No bidder activity available</td></tr>';
        updateActivitySortIndicators();
        return;
    }

    const sorted = sortBidderActivity(filtered);
    tbody.innerHTML = sorted.map(bidder => `
        <tr>
            <td><strong>${escapeHtml(bidder.bidder_name || '')}</strong></td>
            <td>${formatActivityPackages(bidder.packages)}</td>
            <td>${bidder.bid_count ?? 0}</td>
            <td>${bidder.wins ?? 0}</td>
            <td>${formatWinRate(bidder.win_rate)}</td>
            <td>${bidder.avg_bid_amount != null ? formatCurrency(bidder.avg_bid_amount) : '—'}</td>
            <td>${bidder.awarded_amount != null ? formatCurrency(bidder.awarded_amount) : '—'}</td>
        </tr>
    `).join('');

    updateActivitySortIndicators();
}

function setBidderActivityMetric(metric) {
    if (!metric) {
        return;
    }

    bidderActivitySort = {
        key: metric,
        direction: metric === 'bidder_name' ? 'asc' : 'desc'
    };

    const metricSelect = document.getElementById('activityMetric');
    if (metricSelect && metricSelect.value !== metric && metricSelect.querySelector(`option[value="${metric}"]`)) {
        metricSelect.value = metric;
    }

    renderBidderActivityTable();
}

function setBidderActivityPackageFilter(value) {
    bidderActivityPackageFilter = value || '';
    renderBidderActivityTable();
}

function setBidderActivitySort(key) {
    if (!key) {
        return;
    }

    if (bidderActivitySort.key === key) {
        bidderActivitySort.direction = bidderActivitySort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        bidderActivitySort = {
            key,
            direction: key === 'bidder_name' ? 'asc' : 'desc'
        };
    }

    const metricSelect = document.getElementById('activityMetric');
    if (metricSelect && metricSelect.querySelector(`option[value="${key}"]`)) {
        metricSelect.value = key;
    }

    renderBidderActivityTable();
}

function appendActivityFilterParams(url) {
    const params = new URLSearchParams();

    if (activityStartDate) {
        params.set('startDate', activityStartDate);
    }

    if (activityEndDate) {
        params.set('endDate', activityEndDate);
    }

    const query = params.toString();
    if (!query) {
        return url;
    }

    return `${url}?${query}`;
}

function updateActivityFilterStatus() {
    const statusEl = document.getElementById('activityDateStatus');
    if (!statusEl) {
        return;
    }

    const parts = [];

    if (activityStartDate) {
        parts.push(`from ${formatDate(activityStartDate)}`);
    }

    if (activityEndDate) {
        parts.push(`through ${formatDate(activityEndDate)}`);
    }

    statusEl.textContent = parts.length === 0
        ? 'Showing all project history.'
        : `Filtering projects ${parts.join(' ')}`;
}

function applyActivityDateFilters() {
    const startInput = document.getElementById('activityStartDate');
    const endInput = document.getElementById('activityEndDate');

    if (!startInput || !endInput) {
        return;
    }

    const nextStart = startInput.value;
    const nextEnd = endInput.value;

    if (nextStart && nextEnd && new Date(nextStart) > new Date(nextEnd)) {
        alert('The start date must be before the end date.');
        return;
    }

    activityStartDate = nextStart;
    activityEndDate = nextEnd;
    bidderActivityLoaded = false;
    updateActivityFilterStatus();
    loadBidderActivity();
}

function clearActivityDateFilters() {
    const startInput = document.getElementById('activityStartDate');
    const endInput = document.getElementById('activityEndDate');

    if (startInput) startInput.value = '';
    if (endInput) endInput.value = '';

    activityStartDate = '';
    activityEndDate = '';
    bidderActivityLoaded = false;
    updateActivityFilterStatus();
    loadBidderActivity();
}

async function loadBidderActivity() {
    const tbody = document.getElementById('bidderActivityBody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="7" class="loading">Loading bidder activity…</td></tr>';
    }

    try {
        const response = await apiFetch(appendActivityFilterParams(`${API_BASE}/aggregate/bidders`));
        const payload = await response.json();

        bidderActivityData = Array.isArray(payload)
            ? payload.map(entry => {
                const bidCount = Number(entry.bid_count) || 0;
                const wins = Number(entry.wins) || 0;
                const winRateFromPayload = entry.win_rate != null ? Number(entry.win_rate) : null;
                const packages = normalizeActivityPackages(entry.packages);
                const packageSearchText = packages
                    .map(pkg => (pkg.code || pkg.name || '').toLowerCase())
                    .filter(Boolean)
                    .join(' ');

                return {
                    ...entry,
                    bidder_name: entry.bidder_name || '',
                    bid_count: bidCount,
                    wins,
                    win_rate: winRateFromPayload != null
                        ? winRateFromPayload
                        : (bidCount > 0 ? (wins / bidCount) * 100 : null),
                    avg_bid_amount: entry.avg_bid_amount != null ? Number(entry.avg_bid_amount) : null,
                    awarded_amount: entry.awarded_amount != null ? Number(entry.awarded_amount) : null,
                    packages,
                    package_search_text: packageSearchText
                };
            })
            : [];

        bidderActivityLoaded = true;
        renderBidderActivityTable();
    } catch (error) {
        console.error('Error loading bidder activity:', error);
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Error loading bidder activity</td></tr>';
        }
    }
}

async function ensureBidderActivityLoaded() {
    if (bidderActivityLoaded) {
        renderBidderActivityTable();
        return;
    }

    await loadBidderActivity();
}

function setupBiddersTabs() {
    const tabButtons = document.querySelectorAll('[data-bidders-tab]');
    if (tabButtons.length === 0) {
        return;
    }

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tab = button.dataset.biddersTab;
            setBiddersTab(tab);
        });
    });
}

function setBiddersTab(tab) {
    if (!tab || tab === activeBiddersTab) {
        return;
    }
    activeBiddersTab = tab;

    document.querySelectorAll('[data-bidders-tab]').forEach(button => {
        const isActive = button.dataset.biddersTab === tab;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    document.querySelectorAll('[data-tab-panel]').forEach(panel => {
        const isActive = panel.dataset.tabPanel === tab;
        panel.classList.toggle('is-active', isActive);
        panel.setAttribute('aria-hidden', isActive ? 'false' : 'true');
    });

    if (tab === 'map') {
        initializeMapView();
        const mapSelect = document.getElementById('mapBidderSelect');
        if (mapSelect) {
            const combined = getCombinedMapBidderIds();
            if (combined.length) {
                renderSelectedBiddersCountyActivity(combined);
            }
        }
    } else if (tab === 'activity') {
        ensureBidderActivityLoaded();
    }
}

async function focusBidderOnMap(bidderId) {
    if (!bidderId) {
        return;
    }

    selectedMapBidderIds = new Set([String(bidderId)]);
    packageSelectionBidderIds = new Set();
    populateMapBidderSelect();
    populateMapPackageSelect();
    setBiddersTab('map');

    const combined = getCombinedMapBidderIds();
    syncMapBidderSelect(combined);

    try {
        await initializeMapView();
        renderSelectedBiddersCountyActivity(combined);
    } catch (error) {
        console.error('Unable to show bidder on map:', error);
    }
}

function populateMapBidderSelect() {
    const select = document.getElementById('mapBidderSelect');
    if (!select || !Array.isArray(allBidders) || allBidders.length === 0) {
        return;
    }

    const previousSelection = new Set(Array.from(select.selectedOptions).map(opt => opt.value));
    select.innerHTML = '<option value="">-- Choose bidder --</option>';
    const sorted = allBidders.slice().sort((a, b) => a.canonical_name.localeCompare(b.canonical_name));
    sorted.forEach(bidder => {
        const option = document.createElement('option');
        option.value = bidder.id;
        option.textContent = bidder.canonical_name;
        if (previousSelection.has(String(bidder.id)) || selectedMapBidderIds.has(String(bidder.id))) {
            option.selected = true;
        }
        select.appendChild(option);
    });
}

function populateMapPackageSelect() {
    const container = document.getElementById('mapPackageSelect');
    if (!container) {
        return;
    }

    const packageMap = new Map();
    allBidders.forEach(bidder => {
        (bidder.packages || []).forEach(pkg => {
            if (!packageMap.has(pkg)) {
                packageMap.set(pkg, new Set());
            }
            packageMap.get(pkg).add(bidder.id);
        });
    });

    packageBidderLookup = packageMap;

    const sorted = Array.from(packageMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    container.innerHTML = sorted.map(([pkg, bidderSet]) => {
        const isChecked = Array.from(packageSelectionBidderIds).some(id => bidderSet.has(Number(id))); // preserve state
        return `
            <div class="package-option">
                <label>
                    <input type="checkbox" value="${escapeHtml(pkg)}" ${isChecked ? 'checked' : ''}>
                    <strong>${escapeHtml(pkg)}</strong>
                </label>
                <span class="package-badge">${bidderSet.size} bidder${bidderSet.size === 1 ? '' : 's'}</span>
            </div>
        `;
    }).join('');

    container.querySelectorAll('input[type="checkbox"]').forEach(box => {
        box.addEventListener('change', handlePackageSelectionChange);
    });
}

function getCombinedMapBidderIds() {
    const combined = new Set([
        ...Array.from(selectedMapBidderIds).map(String),
        ...Array.from(packageSelectionBidderIds).map(String)
    ]);
    return Array.from(combined).filter(Boolean);
}

function syncMapBidderSelect(combinedIds) {
    const select = document.getElementById('mapBidderSelect');
    if (!select) {
        return;
    }

    Array.from(select.options).forEach(option => {
        if (!option.value) return;
        option.selected = combinedIds.includes(option.value);
    });
}

function handleMapBidderSelectChange(event) {
    const newSelection = Array.from(event.target.selectedOptions)
        .map(option => option.value)
        .filter(Boolean);
    selectedMapBidderIds = new Set(newSelection);
    renderSelectedBiddersCountyActivity(getCombinedMapBidderIds());
}

function handlePackageSelectionChange() {
    const checkboxes = document.querySelectorAll('#mapPackageSelect input[type="checkbox"]');
    const selectedPackages = Array.from(checkboxes)
        .filter(box => box.checked)
        .map(box => box.value);

    packageSelectionBidderIds = new Set();
    selectedPackages.forEach(pkg => {
        const biddersForPackage = packageBidderLookup.get(pkg);
        if (biddersForPackage) {
            biddersForPackage.forEach(id => packageSelectionBidderIds.add(String(id)));
        }
    });

    const combinedIds = getCombinedMapBidderIds();
    syncMapBidderSelect(combinedIds);
    renderSelectedBiddersCountyActivity(combinedIds);
}

async function initializeMapView() {
    if (countyMapInitialized) {
        return;
    }

    countyMapInitialized = true;
    mapTooltip = document.getElementById('mapTooltip');

    if (typeof d3 === 'undefined' || typeof topojson === 'undefined') {
        const unavailable = document.getElementById('mapUnavailableMessage');
        if (unavailable) {
            unavailable.style.display = 'block';
        }
        const loading = document.getElementById('mapLoading');
        if (loading) {
            loading.style.display = 'none';
        }
        return;
    }

    try {
        await buildCountyMap();
    } catch (error) {
        console.error('Error loading county map:', error);
        const unavailable = document.getElementById('mapUnavailableMessage');
        if (unavailable) {
            unavailable.style.display = 'block';
        }
    } finally {
        const loading = document.getElementById('mapLoading');
        if (loading) {
            loading.style.display = 'none';
        }
    }
}

async function buildCountyMap() {
    if (!countyMapPromise) {
        countyMapPromise = fetch('https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json')
            .then(response => response.json())
            .then(data => {
                const container = document.getElementById('bidderMap');
                if (!container) {
                    return;
                }

                mapContainerElement = container.closest('.map-view') || container;

                const width = container.clientWidth || 960;
                const height = 600;
                const svg = d3.select(container)
                    .append('svg')
                    .attr('viewBox', `0 0 ${width} ${height}`)
                    .attr('preserveAspectRatio', 'xMidYMid meet');

                const states = topojson.feature(data, data.objects.states).features;
                const counties = topojson.feature(data, data.objects.counties).features;
                const ohioFips = STATE_FIPS_BY_CODE.OH || '39';
                const ohioCounties = counties.filter(feature => String(feature.id).padStart(5, '0').startsWith(ohioFips));

                let projection;
                let renderedCountyFeatures = counties;

                if (ohioCounties.length) {
                    projection = d3.geoAlbers()
                        .scale(1)
                        .translate([0, 0]);
                    projection.fitSize([width, height], { type: 'FeatureCollection', features: ohioCounties });
                    renderedCountyFeatures = ohioCounties;
                } else {
                    projection = d3.geoAlbersUsa()
                        .translate([width / 2, height / 2])
                        .scale(width * 1.25);
                }

                const path = d3.geoPath(projection);

                countyPathSelection = svg.append('g')
                    .selectAll('path')
                    .data(renderedCountyFeatures)
                    .join('path')
                    .attr('class', 'county-path')
                    .style('fill', '#eef2f7')
                    .attr('d', path)
                    .on('mousemove', (event, feature) => handleCountyHover(event, feature))
                    .on('mouseleave', hideMapTooltip)
                    .on('click', (event, feature) => toggleCountySelection(feature));

                const ohioStateFeature = states.find(feature => String(feature.id).padStart(2, '0') === ohioFips);
                const stateBorderData = ohioStateFeature
                    ? ohioStateFeature
                    : topojson.mesh(data, data.objects.states, (a, b) => a !== b);

                stateBorderSelection = svg.append('path')
                    .datum(stateBorderData)
                    .attr('class', 'state-borders')
                    .attr('d', path);

                counties.forEach(feature => {
                    const countyName = feature.properties?.name;
                    const fips = String(feature.id).padStart(5, '0');
                    const stateFips = fips.slice(0, 2);
                    const stateCode = STATE_CODE_BY_FIPS[stateFips];
                    const key = normalizeCountyKey(countyName, stateCode);
                    if (countyName && stateCode) {
                        countyMetadata.set(fips, { county_name: countyName, state_code: stateCode });
                    }
                    if (!key) {
                        return;
                    }
                    if (!countyLookup.has(key)) {
                        countyLookup.set(key, []);
                    }
                    countyLookup.get(key).push(fips);
                });

                applyCountySelections();
            });
    }

    return countyMapPromise;
}

async function renderSelectedBiddersCountyActivity(bidderIds) {
    const summary = document.getElementById('mapBidderSummary');
    const emptyState = document.getElementById('mapEmptyState');
    const legend = document.getElementById('mapLegend');
    const mapMessage = document.getElementById('mapUnavailableMessage');

    const normalizedIds = Array.from(new Set((bidderIds || []).filter(Boolean).map(String)));

    if (!normalizedIds.length) {
        if (summary) {
            summary.innerHTML = '<p>Select one or more bidders or packages to see coverage.</p>';
        }
        if (legend) {
            legend.setAttribute('aria-hidden', 'true');
            legend.innerHTML = '';
        }
        if (emptyState) {
            emptyState.style.display = 'none';
        }
        resetMapColors();
        return;
    }

    if (mapMessage && mapMessage.style.display === 'block') {
        return;
    }

    try {
        if (countyMapPromise) {
            await countyMapPromise;
        }

        const data = await combineBidderCountyData(normalizedIds);
        updateMapBidderSummary(normalizedIds, data);

        if (!data.length) {
            resetMapColors();
            if (emptyState) {
                emptyState.style.display = 'block';
            }
            if (legend) {
                legend.setAttribute('aria-hidden', 'true');
                legend.innerHTML = '';
            }
            updateMapCountyList(data, []);
            return;
        }

        if (emptyState) {
            emptyState.style.display = 'none';
        }

        paintCountyData(data);
    } catch (error) {
        console.error('Error loading bidder county data:', error);
    }
}

async function loadBidderCountyActivity(bidderId) {
    const cacheKey = String(bidderId);
    if (countyActivityCache.has(cacheKey)) {
        return countyActivityCache.get(cacheKey);
    }

    const response = await apiFetch(`${API_BASE}/bidders/${bidderId}/counties`);
    const payload = await response.json();
    const sanitized = Array.isArray(payload)
        ? payload.filter(item => item?.county_name && item?.state_code)
            .map(item => ({
                ...item,
                package_ids: parseIdList(item.package_ids),
                project_ids: parseIdList(item.project_ids)
            }))
        : [];

    countyActivityCache.set(cacheKey, sanitized);
    return sanitized;
}

function paintCountyData(data) {
    if (!countyPathSelection) {
        return;
    }

    const maxPackages = data.reduce((max, entry) => Math.max(max, Number(entry.package_count) || 0), 0);
    const unmatched = [];
    activeCountyData = new Map();

    data.forEach(entry => {
        const key = normalizeCountyKey(entry.county_name, entry.state_code);
        if (!key) {
            return;
        }
        const fipsList = countyLookup.get(key);
        if (!fipsList || fipsList.length === 0) {
            unmatched.push(entry);
            return;
        }

        fipsList.forEach(fips => {
            activeCountyData.set(fips, entry);
        });
    });

    countyPathSelection
        .style('fill', feature => {
            const entry = activeCountyData.get(String(feature.id).padStart(5, '0'));
            if (!entry || !maxPackages) {
                return '#eef2f7';
            }
            return getChoroplethColor(entry.package_count, maxPackages);
        })
        .classed('has-data', feature => activeCountyData.has(String(feature.id).padStart(5, '0')));

    updateMapLegend(maxPackages);
    updateMapCountyList(data, unmatched);
    applyCountySelections();
}

async function combineBidderCountyData(bidderIds) {
    const aggregated = new Map();

    for (const bidderId of bidderIds) {
        const bidderData = await loadBidderCountyActivity(bidderId);
        bidderData.forEach(entry => {
            const key = normalizeCountyKey(entry.county_name, entry.state_code);
            if (!key) {
                return;
            }

            const packageIds = parseIdList(entry.package_ids);
            const projectIds = parseIdList(entry.project_ids);

            if (!aggregated.has(key)) {
                aggregated.set(key, {
                    county_name: entry.county_name,
                    state_code: entry.state_code,
                    package_ids: new Set(),
                    project_ids: new Set(),
                    bid_submissions: 0,
                    latest_project_date: entry.latest_project_date,
                    bidders: new Set()
                });
            }

            const agg = aggregated.get(key);
            packageIds.forEach(id => agg.package_ids.add(id));
            projectIds.forEach(id => agg.project_ids.add(id));
            agg.bid_submissions += Number(entry.bid_submissions) || 0;
            agg.latest_project_date = latestDate(agg.latest_project_date, entry.latest_project_date);
            agg.bidders.add(String(bidderId));
        });
    }

    return Array.from(aggregated.values()).map(entry => ({
        county_name: entry.county_name,
        state_code: entry.state_code,
        package_count: entry.package_ids.size || 0,
        project_count: entry.project_ids.size || 0,
        bid_submissions: entry.bid_submissions,
        latest_project_date: entry.latest_project_date,
        bidders: entry.bidders,
        bidder_count: entry.bidders.size
    }));
}

function resetMapColors() {
    if (countyPathSelection) {
        countyPathSelection
            .style('fill', '#eef2f7')
            .classed('has-data', false);
    }
    activeCountyData.clear();
    hideMapTooltip();
    applyCountySelections();
}

function updateMapBidderSummary(bidderIds, data) {
    const summary = document.getElementById('mapBidderSummary');
    if (!summary) {
        return;
    }

    if (!data.length) {
        const bidderNames = bidderIds
            .map(id => allBidders.find(b => String(b.id) === String(id))?.canonical_name)
            .filter(Boolean)
            .join(', ');
        summary.innerHTML = `<h4>${escapeHtml(bidderNames || 'Selected bidders')}</h4><p>No county-level bids recorded yet.</p>`;
        return;
    }

    const totalPackages = data.reduce((sum, entry) => sum + (Number(entry.package_count) || 0), 0);
    const totalProjects = data.reduce((sum, entry) => sum + (Number(entry.project_count) || 0), 0);
    const uniqueBidders = bidderIds.length;
    summary.innerHTML = `
        <h4>${uniqueBidders === 1 ? '1 bidder selected' : `${uniqueBidders} bidders selected`}</h4>
        <p>${totalPackages} package${totalPackages === 1 ? '' : 's'} across ${data.length} count${data.length === 1 ? 'y' : 'ies'}
        (${totalProjects} project${totalProjects === 1 ? '' : 's'}).</p>
    `;
}

function updateMapLegend(maxPackages) {
    const legend = document.getElementById('mapLegend');
    if (!legend) {
        return;
    }

    if (!maxPackages) {
        legend.setAttribute('aria-hidden', 'true');
        legend.innerHTML = '';
        return;
    }

    const minColor = getChoroplethColor(1, maxPackages);
    const maxColor = getChoroplethColor(maxPackages, maxPackages);
    legend.setAttribute('aria-hidden', 'false');
    legend.innerHTML = `
        <span style="font-weight: 600; color: #2c3e50;">Coverage</span>
        <div class="legend-scale" style="background: linear-gradient(90deg, ${minColor}, ${maxColor});"></div>
        <div class="legend-labels">
            <span>Few</span>
            <span>More</span>
        </div>
    `;
}

function updateMapCountyList(data, unmatched) {
    const container = document.getElementById('mapCountyList');
    if (!container) {
        return;
    }

    if (!data.length) {
        container.innerHTML = '';
        return;
    }

    const sorted = data.slice().sort((a, b) => {
        const diff = (Number(b.package_count) || 0) - (Number(a.package_count) || 0);
        if (diff !== 0) {
            return diff;
        }
        return `${a.county_name}${a.state_code}`.localeCompare(`${b.county_name}${b.state_code}`);
    });

    const rows = sorted.map(entry => {
        const pkgCount = Number(entry.package_count) || 0;
        const projectCount = Number(entry.project_count) || 0;
        const bidderCount = Number(entry.bidder_count || entry.bidders?.size || 0);
        const latestDate = entry.latest_project_date ? formatDate(entry.latest_project_date) : '—';
        return `
            <tr>
                <td><strong>${escapeHtml(entry.county_name)}</strong>, ${escapeHtml(entry.state_code)}</td>
                <td>${bidderCount}</td>
                <td>${pkgCount}</td>
                <td>${projectCount}</td>
                <td>${latestDate}</td>
            </tr>
        `;
    }).join('');

    const unmatchedMessage = unmatched.length
        ? `<div style="padding: 0.75rem 1rem; font-size: 0.85rem; color: #a94442; background: #fff6f6;">
                ${unmatched.length} location${unmatched.length === 1 ? '' : 's'} could not be mapped. Check county + state spelling.
           </div>`
        : '';

    container.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>County</th>
                    <th>Bidders</th>
                    <th>Packages</th>
                    <th>Projects</th>
                    <th>Last Bid</th>
                </tr>
            </thead>
            <tbody>
                ${rows}
            </tbody>
        </table>
        ${unmatchedMessage}
    `;
}

function handleCountyHover(event, feature) {
    if (!mapTooltip || !mapContainerElement) {
        return;
    }

    const fips = String(feature.id).padStart(5, '0');
    const entry = activeCountyData.get(fips);
    const meta = countyMetadata.get(fips);
    if (!meta) {
        hideMapTooltip();
        return;
    }

    const [x, y] = d3.pointer(event, mapContainerElement);
    const hasActiveCountyData = activeCountyData.size > 0;

    if (!hasActiveCountyData) {
        mapTooltip.innerHTML = `<strong>${escapeHtml(meta.county_name)}</strong>, ${escapeHtml(meta.state_code)}`;
    } else {
        const pkgCount = entry ? Number(entry.package_count) || 0 : 0;
        const projectCount = entry ? Number(entry.project_count) || 0 : 0;
        const bidderCount = entry ? Number(entry.bidder_count || entry.bidders?.size || 0) : 0;
        const bidderText = bidderCount
            ? ` • ${bidderCount} bidder${bidderCount === 1 ? '' : 's'}`
            : ' • No bids recorded';

        mapTooltip.innerHTML = `
            <strong>${escapeHtml(meta.county_name)}</strong>, ${escapeHtml(meta.state_code)}<br>
            ${pkgCount} package${pkgCount === 1 ? '' : 's'} • ${projectCount} project${projectCount === 1 ? '' : 's'}${bidderText}
        `;
    }
    mapTooltip.style.left = `${x}px`;
    mapTooltip.style.top = `${y}px`;
    mapTooltip.style.opacity = 1;
    mapTooltip.setAttribute('aria-hidden', 'false');
}

function hideMapTooltip() {
    if (mapTooltip) {
        mapTooltip.style.opacity = 0;
        mapTooltip.setAttribute('aria-hidden', 'true');
    }
}

function applyCountySelections() {
    if (!countyPathSelection) {
        return;
    }

    countyPathSelection.classed('is-selected', feature => selectedCountyFips.has(String(feature.id).padStart(5, '0')));
}

function toggleCountySelection(feature) {
    const fips = String(feature.id).padStart(5, '0');
    if (selectedCountyFips.has(fips)) {
        selectedCountyFips.delete(fips);
        if (activeCountyFocus === fips) {
            activeCountyFocus = selectedCountyFips.size ? Array.from(selectedCountyFips)[selectedCountyFips.size - 1] : null;
        }
    } else {
        selectedCountyFips.add(fips);
        activeCountyFocus = fips;
    }

    applyCountySelections();
    renderCountyDetailPanel();
}

function renderCountyDetailPanel() {
    const emptyMessage = document.getElementById('countyDetailEmpty');
    const table = document.getElementById('countyBidderTable');
    const title = document.getElementById('countyDetailTitle');

    const selectedMetas = getSelectedCountyMetas();
    const selectionSignature = getSelectionSignature();

    if (!activeCountyFocus || selectedCountyFips.size === 0 || selectedMetas.length === 0) {
        if (title) title.textContent = 'Select a county';
        if (emptyMessage) emptyMessage.style.display = 'block';
        if (table) table.hidden = true;
        return;
    }

    if (title) {
        if (selectedMetas.length === 1) {
            const [meta] = selectedMetas;
            title.textContent = meta ? `${meta.county_name}, ${meta.state_code}` : 'Select a county';
        } else {
            title.textContent = `${selectedMetas.length} counties selected`;
        }
    }
    if (emptyMessage) emptyMessage.style.display = 'none';
    renderCountySelectionDetail(selectedMetas, selectionSignature);
}

async function renderCountySelectionDetail(selectedMetas, selectionSignature) {
    const table = document.getElementById('countyBidderTable');
    const tbody = document.getElementById('countyBidderTableBody');
    const summary = document.getElementById('countyBidderSummary');

    if (!Array.isArray(selectedMetas) || selectedMetas.length === 0 || !tbody || !table || !summary) {
        return;
    }

    tbody.innerHTML = '<tr><td colspan="2" class="loading">Loading bidders…</td></tr>';
    table.hidden = false;

    try {
        const bidders = await aggregateSelectedCountyBidders(selectedMetas, selectionSignature);
        if (!bidders) return; // selection changed while loading

        if (!Array.isArray(bidders) || bidders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="2">No bids recorded in these counties yet.</td></tr>';
            summary.textContent = `0 bidders across ${selectedMetas.length} county${selectedMetas.length === 1 ? '' : 'ies'}`;
            return;
        }

        const sorted = bidders.slice().sort((a, b) => {
            const diff = (Number(b.bid_count) || 0) - (Number(a.bid_count) || 0);
            if (diff !== 0) return diff;
            return (a.canonical_name || '').localeCompare(b.canonical_name || '');
        });

        const top = sorted.slice(0, 10);
        tbody.innerHTML = top.map(entry => `
            <tr>
                <td>${escapeHtml(entry.canonical_name)}</td>
                <td style="text-align: right;">${entry.bid_count}</td>
            </tr>
        `).join('');

        const total = sorted.length;
        summary.textContent = `${total} bidder${total === 1 ? '' : 's'} across ${selectedMetas.length} county${selectedMetas.length === 1 ? '' : 'ies'} • showing top ${top.length}`;
    } catch (error) {
        console.error('Error loading county bidders:', error);
        tbody.innerHTML = '<tr><td colspan="2">Failed to load bidders for these counties.</td></tr>';
    }
}

async function aggregateSelectedCountyBidders(selectedMetas, expectedSignature) {
    if (!Array.isArray(selectedMetas) || selectedMetas.length === 0) {
        return [];
    }

    const results = await Promise.all(selectedMetas.map(meta =>
        loadCountyBidderLeaderboard(meta.county_name, meta.state_code)
    ));

    if (expectedSignature && expectedSignature !== getSelectionSignature()) {
        return null;
    }

    const biddersById = new Map();
    results.forEach(list => {
        list.forEach(entry => {
            const existing = biddersById.get(entry.bidder_id) || {
                bidder_id: entry.bidder_id,
                canonical_name: entry.canonical_name,
                bid_count: 0,
                package_count: 0
            };
            existing.bid_count += Number(entry.bid_count) || 0;
            existing.package_count += Number(entry.package_count) || 0;
            biddersById.set(entry.bidder_id, existing);
        });
    });

    return Array.from(biddersById.values());
}

async function loadCountyBidderLeaderboard(countyName, stateCode) {
    if (!countyName || !stateCode) {
        return [];
    }
    const cacheKey = `${countyName}|${stateCode}`;
    if (countyBidderCache.has(cacheKey)) {
        return countyBidderCache.get(cacheKey);
    }

    const params = new URLSearchParams({ county_name: countyName, state_code: stateCode });
    const response = await apiFetch(`${API_BASE}/counties/bidders?${params.toString()}`);
    const payload = await response.json();
    const sanitized = Array.isArray(payload)
        ? payload.map(entry => ({
            bidder_id: entry.bidder_id,
            canonical_name: entry.canonical_name,
            bid_count: Number(entry.bid_count) || 0,
            package_count: Number(entry.package_count) || 0
        }))
        : [];

    countyBidderCache.set(cacheKey, sanitized);
    return sanitized;
}

async function openFullCountyList() {
    const selectedMetas = getSelectedCountyMetas();
    if (selectedMetas.length === 0) return;

    const selectionSignature = getSelectionSignature();
    const bidders = await aggregateSelectedCountyBidders(selectedMetas, selectionSignature);
    if (!bidders) return;

    const sorted = bidders.slice().sort((a, b) => (Number(b.bid_count) || 0) - (Number(a.bid_count) || 0));
    const popup = window.open('', '_blank');
    if (!popup) {
        alert('Popup blocked. Allow popups to view the full list.');
        return;
    }

    const countyTitle = selectedMetas.length === 1
        ? `${selectedMetas[0].county_name}, ${selectedMetas[0].state_code}`
        : `${selectedMetas.length} counties selected`;

    const countyList = selectedMetas.length > 1
        ? `<p><strong>Counties:</strong> ${selectedMetas.map(meta => `${escapeHtml(meta.county_name)}, ${escapeHtml(meta.state_code)}`).join('; ')}</p>`
        : '';

    popup.document.write(`
        <html><head><title>${countyTitle} bidders</title>
        <style>
            body { font-family: Arial, sans-serif; padding: 1rem; }
            table { border-collapse: collapse; width: 100%; }
            th, td { padding: 8px 10px; border-bottom: 1px solid #ddd; text-align: left; }
            th:last-child, td:last-child { text-align: right; }
        </style>
        </head><body>
        <h2>${escapeHtml(countyTitle)}</h2>
        ${countyList}
        <p>${sorted.length} bidder${sorted.length === 1 ? '' : 's'} in these counties.</p>
        <table>
            <thead><tr><th>Bidder</th><th style="text-align:right;">Bids</th></tr></thead>
            <tbody>
                ${sorted.map(entry => `<tr><td>${escapeHtml(entry.canonical_name)}</td><td style="text-align:right;">${entry.bid_count}</td></tr>`).join('')}
            </tbody>
        </table>
        </body></html>
    `);
    popup.document.close();
}
function getChoroplethColor(value, max) {
    if (!value || !max) {
        return '#eef2f7';
    }
    const ratio = Math.min(1, value / max);
    const start = [221, 235, 247];
    const end = [31, 120, 180];
    const channels = start.map((channel, index) => {
        const delta = end[index] - channel;
        return Math.round(channel + delta * ratio);
    });
    return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
}

function latestDate(dateA, dateB) {
    if (!dateA) return dateB;
    if (!dateB) return dateA;
    return dateA > dateB ? dateA : dateB;
}

const COUNTY_SUFFIXES = [
    'city and borough',
    'census area',
    'municipality',
    'borough',
    'parish',
    'county',
    'city'
];

function normalizeCountyKey(countyName, stateCode) {
    if (!countyName || !stateCode) {
        return null;
    }

    let cleanedName = countyName
        .toString()
        .trim()
        .toLowerCase();

    cleanedName = cleanedName
        .replace(/&/g, ' and ')
        .replace(/\bco\.?(?=\s|$)/g, ' county')
        .replace(/\bcnty(?=\s|$)/g, ' county')
        .replace(/\bcty(?=\s|$)/g, ' county')
        .replace(/\bst\.?(?=\s)/g, 'saint ');

    cleanedName = cleanedName
        .replace(/[^a-z\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    for (const suffix of COUNTY_SUFFIXES) {
        if (cleanedName.endsWith(` ${suffix}`)) {
            cleanedName = cleanedName.slice(0, -suffix.length).trim();
            break;
        }
        if (cleanedName === suffix) {
            cleanedName = '';
            break;
        }
    }

    if (!cleanedName) {
        return null;
    }

    const normalizedState = stateCode.toString().trim().toUpperCase();
    if (!normalizedState) {
        return null;
    }

    return `${cleanedName}|${normalizedState}`;
}

// Initialize page - attach event listeners AFTER DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    setupBiddersTabs();

    const bidderSearch = document.getElementById('searchBidders');
    const packageInput = document.getElementById('filterPackages');
    const countyInput = document.getElementById('filterCounties');

    // Add package filter event listener
    packageInput.addEventListener('input', (e) => {
        displayBidders(bidderSearch.value, e.target.value, countyInput.value);
    });

    // Search functionality
    bidderSearch.addEventListener('input', (e) => {
        displayBidders(e.target.value, packageInput.value, countyInput.value);
    });

    countyInput.addEventListener('input', (e) => {
        displayBidders(bidderSearch.value, packageInput.value, e.target.value);
    });

    // Handle select all checkbox
    document.getElementById('selectAll').addEventListener('change', (e) => {
        const checkboxes = document.querySelectorAll('.bidder-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.checked = e.target.checked;
            const bidderId = parseInt(checkbox.dataset.bidderId);
            if (e.target.checked) {
                selectedBidders.add(bidderId);
            } else {
                selectedBidders.delete(bidderId);
            }
        });
        updateMergeSection();
    });

    document.querySelectorAll('#bidderBidsTable .sortable-header').forEach(button => {
        button.addEventListener('click', () => setBidderHistorySort(button.dataset.sortField));
    });

    document.querySelectorAll('.bidder-list-sort').forEach(button => {
        button.addEventListener('click', () => setBidderListSort(button.dataset.listSort));
    });

    const bidderMapButton = document.getElementById('bidderMapButton');
    if (bidderMapButton) {
        bidderMapButton.addEventListener('click', () => {
            if (activeBidderId) {
                focusBidderOnMap(activeBidderId);
            }
        });
    }

    const mapSelect = document.getElementById('mapBidderSelect');
    if (mapSelect) {
        mapSelect.addEventListener('change', handleMapBidderSelectChange);
    }

    const clearCountySelectionBtn = document.getElementById('clearCountySelection');
    clearCountySelectionBtn?.addEventListener('click', () => {
        selectedCountyFips.clear();
        activeCountyFocus = null;
        applyCountySelections();
        renderCountyDetailPanel();
    });

    const openFullCountyListBtn = document.getElementById('openFullCountyList');
    openFullCountyListBtn?.addEventListener('click', openFullCountyList);

    const activityStartInput = document.getElementById('activityStartDate');
    const activityEndInput = document.getElementById('activityEndDate');
    const clearActivityDateBtn = document.getElementById('clearActivityDateFilter');
    activityStartInput?.addEventListener('change', applyActivityDateFilters);
    activityEndInput?.addEventListener('change', applyActivityDateFilters);
    clearActivityDateBtn?.addEventListener('click', clearActivityDateFilters);
    updateActivityFilterStatus();

    const activityMetric = document.getElementById('activityMetric');
    if (activityMetric) {
        activityMetric.addEventListener('change', event => setBidderActivityMetric(event.target.value));
        activityMetric.value = bidderActivitySort.key;
    }

    const activityPackageFilter = document.getElementById('activityPackageFilter');
    if (activityPackageFilter) {
        activityPackageFilter.addEventListener('input', event => setBidderActivityPackageFilter(event.target.value));
    }

    document.querySelectorAll('[data-activity-sort]').forEach(button => {
        button.addEventListener('click', () => setBidderActivitySort(button.dataset.activitySort));
    });

    // Merge bidders button
    document.getElementById('mergeBtn').addEventListener('click', async () => {
        const keepId = parseInt(document.getElementById('keepBidder').value);
        
        if (!keepId) {
            alert('Please select which bidder to keep');
            return;
        }
        
        const keepBidder = allBidders.find(b => b.id === keepId);
        const mergeBidders = Array.from(selectedBidders)
            .filter(id => id !== keepId)
            .map(id => allBidders.find(b => b.id === id));
        
        const confirmMessage = `Are you sure you want to merge these bidders into "${keepBidder.canonical_name}"?\n\n` +
            `Bidders to merge:\n${mergeBidders.map(b => '• ' + b.canonical_name).join('\n')}\n\n` +
            `This action cannot be undone.`;
        
        if (!confirm(confirmMessage)) {
            return;
        }
        
        try {
            // Merge each selected bidder into the keep bidder
            for (const mergeId of selectedBidders) {
                if (mergeId === keepId) continue;
                
                await apiFetch(`${API_BASE}/bidders/merge`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        keep_id: keepId,
                        merge_id: mergeId
                    })
                });
            }
            
            alert('Bidders merged successfully!');
            
            // Reset selection and reload
            selectedBidders.clear();
            document.getElementById('selectAll').checked = false;
            updateMergeSection();
            loadBidders();
        } catch (error) {
            console.error('Error merging bidders:', error);
            alert('Error merging bidders');
        }
    });

    // Load bidders on page load
    loadBidders();
    ensureBidderActivityLoaded();
});
