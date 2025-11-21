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

let allBidders = [];
let selectedBidders = new Set();
let currentBidderHistory = [];
let bidderHistorySort = { field: 'project_date', direction: 'desc' };
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
let countyActivityCache = new Map();
let activeCountyData = new Map();
let selectedMapBidderId = null;

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
            aliases: Array.isArray(bidder.aliases) ? bidder.aliases : [],
            packages: Array.isArray(bidder.packages) ? bidder.packages : [],
            project_counties: Array.isArray(bidder.project_counties) ? bidder.project_counties : []
        }));

        populateMapBidderSelect();
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
            <td>
                <button class="btn btn-small btn-secondary" onclick="viewBidderDetail(${bidder.id}, '${escapeHtml(bidder.canonical_name)}')">
                    View Details
                </button>
            </td>
        </tr>
    `).join('');
    
    // Attach checkbox event listeners
    document.querySelectorAll('.bidder-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', handleCheckboxChange);
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
            direction: 'asc'
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
    }
}

function closeBidderDetail() {
    document.getElementById('bidderDetail').style.display = 'none';
    currentBidderHistory = [];
    const metrics = document.getElementById('bidderMetrics');
    if (metrics) {
        metrics.style.display = 'none';
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
            renderBidderCountyActivity(mapSelect.value);
        }
    } else if (tab === 'activity') {
        ensureBidderActivityLoaded();
    }
}

function populateMapBidderSelect() {
    const select = document.getElementById('mapBidderSelect');
    if (!select || !Array.isArray(allBidders) || allBidders.length === 0) {
        return;
    }

    const previousValue = select.value;
    select.innerHTML = '<option value="">-- Choose bidder --</option>';
    const sorted = allBidders.slice().sort((a, b) => a.canonical_name.localeCompare(b.canonical_name));
    sorted.forEach(bidder => {
        const option = document.createElement('option');
        option.value = bidder.id;
        option.textContent = bidder.canonical_name;
        select.appendChild(option);
    });

    if (previousValue && select.querySelector(`option[value="${previousValue}"]`)) {
        select.value = previousValue;
    }
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
                    .on('mouseleave', hideMapTooltip);

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
                    if (!key) {
                        return;
                    }
                    if (!countyLookup.has(key)) {
                        countyLookup.set(key, []);
                    }
                    countyLookup.get(key).push(fips);
                });
            });
    }

    return countyMapPromise;
}

async function renderBidderCountyActivity(bidderId) {
    const summary = document.getElementById('mapBidderSummary');
    const emptyState = document.getElementById('mapEmptyState');
    const legend = document.getElementById('mapLegend');
    const mapMessage = document.getElementById('mapUnavailableMessage');

    if (!bidderId) {
        if (summary) {
            summary.innerHTML = '<p>Select a bidder to see their coverage.</p>';
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

    const bidder = allBidders.find(b => String(b.id) === String(bidderId));
    if (!bidder) {
        return;
    }

    if (mapMessage && mapMessage.style.display === 'block') {
        return;
    }

    try {
        if (countyMapPromise) {
            await countyMapPromise;
        }
        const data = await loadBidderCountyActivity(bidderId);
        selectedMapBidderId = bidderId;
        updateMapBidderSummary(bidder, data);

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
}

function resetMapColors() {
    if (countyPathSelection) {
        countyPathSelection
            .style('fill', '#eef2f7')
            .classed('has-data', false);
    }
    activeCountyData.clear();
    hideMapTooltip();
}

function updateMapBidderSummary(bidder, data) {
    const summary = document.getElementById('mapBidderSummary');
    if (!summary) {
        return;
    }

    if (!data.length) {
        summary.innerHTML = `<h4>${escapeHtml(bidder.canonical_name)}</h4><p>No county-level bids recorded yet.</p>`;
        return;
    }

    const totalPackages = data.reduce((sum, entry) => sum + (Number(entry.package_count) || 0), 0);
    const totalProjects = data.reduce((sum, entry) => sum + (Number(entry.project_count) || 0), 0);
    summary.innerHTML = `
        <h4>${escapeHtml(bidder.canonical_name)}</h4>
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
        const latestDate = entry.latest_project_date ? formatDate(entry.latest_project_date) : '—';
        return `
            <tr>
                <td><strong>${escapeHtml(entry.county_name)}</strong>, ${escapeHtml(entry.state_code)}</td>
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
    if (!entry) {
        hideMapTooltip();
        return;
    }

    const [x, y] = d3.pointer(event, mapContainerElement);
    const pkgCount = Number(entry.package_count) || 0;
    const projectCount = Number(entry.project_count) || 0;
    mapTooltip.innerHTML = `
        <strong>${escapeHtml(entry.county_name)}</strong>, ${escapeHtml(entry.state_code)}<br>
        ${pkgCount} package${pkgCount === 1 ? '' : 's'} • ${projectCount} project${projectCount === 1 ? '' : 's'}
    `;
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

    const mapSelect = document.getElementById('mapBidderSelect');
    if (mapSelect) {
        mapSelect.addEventListener('change', (event) => {
            renderBidderCountyActivity(event.target.value);
        });
    }

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
