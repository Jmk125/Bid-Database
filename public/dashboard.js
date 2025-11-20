const API_BASE = '/api';
let currentStartDate = '';
let currentEndDate = '';
let currentCounty = '';
let currentSizeRange = { min: '', max: '' };

const sortState = {
    divisions: { key: 'csi_division', direction: 'asc' },
    bidders: { key: 'bid_count', direction: 'desc' },
    projects: { key: 'project_date', direction: 'desc' }
};

let divisionData = [];
let bidderData = [];
let projectOverviewData = [];

function appendFilterParams(url, { includeCounty = true, includeSize = true } = {}) {
    const params = new URLSearchParams();

    if (currentStartDate) {
        params.set('startDate', currentStartDate);
    }

    if (currentEndDate) {
        params.set('endDate', currentEndDate);
    }

    if (includeCounty && currentCounty) {
        params.set('county', currentCounty);
    }

    if (includeSize && currentSizeRange.min !== '') {
        params.set('minSize', currentSizeRange.min);
    }

    if (includeSize && currentSizeRange.max !== '') {
        params.set('maxSize', currentSizeRange.max);
    }

    const query = params.toString();
    if (!query) {
        return url;
    }

    return `${url}${url.includes('?') ? '&' : '?'}${query}`;
}

function setLoadingStates() {
    document.getElementById('totalProjects').textContent = '…';
    document.getElementById('totalPackages').textContent = '…';
    document.getElementById('totalBidders').textContent = '…';
    document.getElementById('totalBids').textContent = '…';

    document.getElementById('divisionsBody').innerHTML = "<tr><td colspan='6' class='loading'>Loading division data...</td></tr>";
    document.getElementById('biddersBody').innerHTML = "<tr><td colspan='6' class='loading'>Loading bidder data...</td></tr>";
    document.getElementById('projectsBody').innerHTML = "<tr><td colspan='6' class='loading'>Loading projects...</td></tr>";
}

function updateFilterStatus() {
    const statusEl = document.getElementById('dateFilterStatus');
    if (!statusEl) return;

    const parts = [];

    if (currentStartDate) {
        parts.push(`from ${formatDate(currentStartDate)}`);
    }

    if (currentEndDate) {
        parts.push(`through ${formatDate(currentEndDate)}`);
    }

    if (currentCounty) {
        parts.push(`in ${currentCounty}`);
    }

    if (currentSizeRange.min !== '' || currentSizeRange.max !== '') {
        const minLabel = currentSizeRange.min !== '' ? formatNumber(currentSizeRange.min) : '0';
        const maxLabel = currentSizeRange.max !== '' ? formatNumber(currentSizeRange.max) : '400,000';
        parts.push(`${minLabel} - ${maxLabel} SF`);
    }

    if (parts.length === 0) {
        statusEl.textContent = 'Showing all project history.';
        return;
    }

    statusEl.textContent = `Filtering projects ${parts.join(' ')}`;
}

function initializeDateFilters() {
    const startInput = document.getElementById('startDate');
    const endInput = document.getElementById('endDate');
    const countySelect = document.getElementById('countyFilter');
    const sizeSelect = document.getElementById('sizeRange');
    const applyBtn = document.getElementById('applyDateFilter');
    const clearBtn = document.getElementById('clearDateFilter');

    function applyFilters() {
        const nextStart = startInput.value;
        const nextEnd = endInput.value;
        const nextCounty = countySelect?.value || '';
        const nextSizeRange = sizeSelect?.value || '';

        if (nextStart && nextEnd && new Date(nextStart) > new Date(nextEnd)) {
            alert('The start date must be before the end date.');
            return;
        }

        currentStartDate = nextStart;
        currentEndDate = nextEnd;
        currentCounty = nextCounty;
        currentSizeRange = parseSizeRange(nextSizeRange);
        updateFilterStatus();
        loadDashboard();
        loadCountyOptions();
    }

    function clearFilters() {
        startInput.value = '';
        endInput.value = '';
        if (countySelect) countySelect.value = '';
        if (sizeSelect) sizeSelect.value = '';
        currentStartDate = '';
        currentEndDate = '';
        currentCounty = '';
        currentSizeRange = { min: '', max: '' };
        updateFilterStatus();
        loadDashboard();
        loadCountyOptions();
    }

    applyBtn?.addEventListener('click', applyFilters);
    startInput?.addEventListener('change', applyFilters);
    endInput?.addEventListener('change', applyFilters);
    countySelect?.addEventListener('change', applyFilters);
    sizeSelect?.addEventListener('change', applyFilters);
    clearBtn?.addEventListener('click', clearFilters);
}

// Load all dashboard data
async function loadDashboard() {
    setLoadingStates();
    updateFilterStatus();
    await Promise.all([
        loadSummaryMetrics(),
        loadDivisionMetrics(),
        loadBidderMetrics(),
        loadProjectsOverview()
    ]);
}

// Load summary metrics
async function loadSummaryMetrics() {
    try {
        // Get all projects
        const projectsResponse = await apiFetch(appendFilterParams(`${API_BASE}/projects`));
        const projects = await projectsResponse.json();

        // Calculate totals
        let totalPackages = 0;
        let totalBids = 0;
        const bidderIds = new Set();

        for (const project of projects) {
            const projectResponse = await apiFetch(`${API_BASE}/projects/${project.id}`);
            const projectData = await projectResponse.json();
            totalPackages += projectData.packages?.length || 0;
            
            // Count bids for each package
            for (const pkg of projectData.packages || []) {
                if (pkg.status !== 'estimated') {
                    const bidsResponse = await apiFetch(`${API_BASE}/packages/${pkg.id}/bids`);
                    const bids = await bidsResponse.json();
                    totalBids += bids.length;
                    bids.forEach(bid => bidderIds.add(bid.bidder_id));
                }
            }
        }

        document.getElementById('totalProjects').textContent = projects.length;
        document.getElementById('totalPackages').textContent = totalPackages;
        document.getElementById('totalBidders').textContent = bidderIds.size;
        document.getElementById('totalBids').textContent = totalBids;
    } catch (error) {
        console.error('Error loading summary metrics:', error);
    }
}

// Load division metrics
async function loadDivisionMetrics() {
    try {
        const response = await apiFetch(appendFilterParams(`${API_BASE}/aggregate/divisions`));
        divisionData = await response.json();

        renderDivisionTable();
    } catch (error) {
        console.error('Error loading division metrics:', error);
        const tbody = document.getElementById('divisionsBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Error loading division data</td></tr>';
        }
    }
}

// Load bidder metrics
async function loadBidderMetrics() {
    try {
        const response = await apiFetch(appendFilterParams(`${API_BASE}/aggregate/bidders`));
        bidderData = (await response.json()).map(bidder => ({
            ...bidder,
            win_rate: Number(bidder.win_rate)
        })).slice(0, 20);

        renderBidderTable();
    } catch (error) {
        console.error('Error loading bidder metrics:', error);
        const tbody = document.getElementById('biddersBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Error loading bidder data</td></tr>';
        }
    }
}

// Load projects overview
async function loadProjectsOverview() {
    try {
        const response = await apiFetch(appendFilterParams(`${API_BASE}/projects`));
        const projects = await response.json();

        // Get detailed info for each project
        const projectDetails = await Promise.all(
            projects.map(async (project) => {
                const detailResponse = await apiFetch(`${API_BASE}/projects/${project.id}`);
                return await detailResponse.json();
            })
        );

        projectOverviewData = projectDetails.map(project => {
            const totalCost = (project.packages || []).reduce((sum, pkg) => sum + (pkg.selected_amount || 0), 0);
            const costPerSF = project.building_sf ? totalCost / project.building_sf : 0;
            const packageCount = project.packages?.length || 0;

            return {
                ...project,
                total_cost: totalCost,
                cost_per_sf: costPerSF,
                package_count: packageCount
            };
        });

        renderProjectsTable();
    } catch (error) {
        console.error('Error loading projects overview:', error);
        const tbody = document.getElementById('projectsBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Error loading projects</td></tr>';
        }
    }
}

function getSortableValue(value, key) {
    if (value === undefined || value === null) return null;
    if (key.includes('date')) {
        return value ? new Date(value).getTime() : null;
    }

    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
        return Number(value);
    }

    return value;
}

function sortData(data, table) {
    const { key, direction } = sortState[table];
    const multiplier = direction === 'asc' ? 1 : -1;

    return [...data].sort((a, b) => {
        const aVal = getSortableValue(a[key], key);
        const bVal = getSortableValue(b[key], key);

        if (aVal === null && bVal === null) return 0;
        if (aVal === null) return 1;
        if (bVal === null) return -1;

        if (typeof aVal === 'string' && typeof bVal === 'string') {
            return aVal.localeCompare(bVal) * multiplier;
        }

        return (aVal - bVal) * multiplier;
    });
}

function updateSortIndicators(table) {
    document.querySelectorAll(`[data-sort-table="${table}"]`).forEach(button => {
        const indicator = button.querySelector('.sort-indicator');
        if (!indicator) return;

        if (sortState[table].key === button.dataset.sortKey) {
            indicator.textContent = sortState[table].direction === 'asc' ? '↑' : '↓';
        } else {
            indicator.textContent = '↕';
        }
    });
}

function renderDivisionTable() {
    const tbody = document.getElementById('divisionsBody');
    if (!tbody) return;

    if (!divisionData || divisionData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No division data available</td></tr>';
        updateSortIndicators('divisions');
        return;
    }

    const sorted = sortData(divisionData, 'divisions');
    tbody.innerHTML = sorted.map(div => `
        <tr>
            <td><strong>${escapeHtml(div.csi_division)}</strong></td>
            <td>${div.package_count}</td>
            <td>${div.median_cost_per_sf ? formatCurrency(div.median_cost_per_sf) : '—'}</td>
            <td>${div.avg_cost_per_sf ? formatCurrency(div.avg_cost_per_sf) : '—'}</td>
            <td>${div.min_cost_per_sf ? formatCurrency(div.min_cost_per_sf) : '—'}</td>
            <td>${div.max_cost_per_sf ? formatCurrency(div.max_cost_per_sf) : '—'}</td>
        </tr>
    `).join('');

    updateSortIndicators('divisions');
}

function renderBidderTable() {
    const tbody = document.getElementById('biddersBody');
    if (!tbody) return;

    if (!bidderData || bidderData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No bidder data available</td></tr>';
        updateSortIndicators('bidders');
        return;
    }

    const sorted = sortData(bidderData, 'bidders');
    tbody.innerHTML = sorted.map(bidder => `
        <tr>
            <td><strong>${escapeHtml(bidder.bidder_name)}</strong></td>
            <td>${bidder.bid_count}</td>
            <td>${bidder.wins}</td>
            <td>${bidder.win_rate}%</td>
            <td>${bidder.avg_bid_amount ? formatCurrency(bidder.avg_bid_amount) : '—'}</td>
            <td>${bidder.awarded_amount ? formatCurrency(bidder.awarded_amount) : '—'}</td>
        </tr>
    `).join('');

    updateSortIndicators('bidders');
}

function renderProjectsTable() {
    const tbody = document.getElementById('projectsBody');
    if (!tbody) return;

    if (!projectOverviewData || projectOverviewData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No projects available</td></tr>';
        updateSortIndicators('projects');
        return;
    }

    const sorted = sortData(projectOverviewData, 'projects');
    tbody.innerHTML = sorted.map(project => `
        <tr onclick="window.location.href='project.html?id=${project.id}'" style="cursor: pointer;">
            <td><strong>${escapeHtml(project.name)}</strong></td>
            <td>${project.building_sf ? formatNumber(project.building_sf) : '—'}</td>
            <td>${formatCurrency(project.total_cost)}</td>
            <td>${project.building_sf ? formatCurrency(project.cost_per_sf) : '—'}</td>
            <td>${project.package_count}</td>
            <td>${project.project_date ? formatDate(project.project_date) : '—'}</td>
        </tr>
    `).join('');

    updateSortIndicators('projects');
}

function renderTableFor(table) {
    switch (table) {
        case 'divisions':
            renderDivisionTable();
            break;
        case 'bidders':
            renderBidderTable();
            break;
        case 'projects':
            renderProjectsTable();
            break;
        default:
            break;
    }
}

function populateSizeRangeOptions() {
    const sizeSelect = document.getElementById('sizeRange');
    if (!sizeSelect) return;

    const options = ['<option value="">All project sizes</option>'];
    for (let min = 0; min < 400000; min += 50000) {
        const max = min + 50000;
        options.push(`<option value="${min}-${max}">${formatNumber(min)} - ${formatNumber(max)} SF</option>`);
    }

    sizeSelect.innerHTML = options.join('');

    if (currentSizeRange.min !== '' || currentSizeRange.max !== '') {
        sizeSelect.value = `${currentSizeRange.min}-${currentSizeRange.max}`;
    }
}

function parseSizeRange(value) {
    if (!value) return { min: '', max: '' };

    const [minRaw, maxRaw] = value.split('-').map(part => Number(part));
    return {
        min: Number.isFinite(minRaw) ? minRaw : '',
        max: Number.isFinite(maxRaw) ? maxRaw : ''
    };
}

async function loadCountyOptions() {
    const countySelect = document.getElementById('countyFilter');
    if (!countySelect) return;

    try {
        const response = await apiFetch(appendFilterParams(`${API_BASE}/projects`, { includeCounty: false, includeSize: false }));
        const projects = await response.json();

        const counties = new Map();
        projects.forEach(project => {
            if (!project.county_name) return;
            const key = `${project.county_name}||${project.county_state || ''}`;
            const label = project.county_state ? `${project.county_name}, ${project.county_state}` : project.county_name;
            counties.set(key, label);
        });

        const sorted = [...counties.values()].sort((a, b) => a.localeCompare(b));
        countySelect.innerHTML = ['<option value="">All counties</option>', ...sorted.map(county => `<option value="${county}">${county}</option>`)].join('');

        if (currentCounty) {
            countySelect.value = currentCounty;
            if (countySelect.value !== currentCounty) {
                currentCounty = '';
                updateFilterStatus();
            }
        }
    } catch (error) {
        console.error('Error loading county options:', error);
    }
}

function initializeSorting() {
    document.querySelectorAll('.sortable-header').forEach(button => {
        button.addEventListener('click', () => {
            const table = button.dataset.sortTable;
            const key = button.dataset.sortKey;
            if (!table || !key || !sortState[table]) return;

            if (sortState[table].key === key) {
                sortState[table].direction = sortState[table].direction === 'asc' ? 'desc' : 'asc';
            } else {
                sortState[table].key = key;
                sortState[table].direction = key.includes('date') ? 'desc' : 'asc';
            }

            renderTableFor(table);
        });
    });
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

// Load dashboard on page load
populateSizeRangeOptions();
initializeSorting();
initializeDateFilters();
loadCountyOptions();
loadDashboard();
