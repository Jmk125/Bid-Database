const API_BASE = '/api';
let currentStartDate = '';
let currentEndDate = '';
let currentCounty = '';
let currentSizeRange = { min: '', max: '' };
let divisionBasis = 'median';
let filteredProjects = [];
let excludedProjectIds = new Set();
let divisionTotals = null;

const sortState = {
    divisions: { key: 'csi_division', direction: 'asc' },
    projects: { key: 'project_date', direction: 'desc' }
};

let divisionData = [];
let projectOverviewData = [];
let divisionTimeSeries = { basis: divisionBasis, series: [], overall: [] };
const chartState = new Map();

function getSelectedProjectIds() {
    if (!filteredProjects.length) return [];
    return filteredProjects
        .map(project => project.id)
        .filter(id => !excludedProjectIds.has(id));
}

function appendFilterParams(url, { includeCounty = true, includeSize = true, includeProjects = true } = {}) {
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

    if (includeProjects) {
        const selectedProjectIds = getSelectedProjectIds();
        if (selectedProjectIds.length) {
            params.set('projectIds', selectedProjectIds.join(','));
        }
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
    document.getElementById('projectsBody').innerHTML = "<tr><td colspan='6' class='loading'>Loading projects...</td></tr>";

    const divisionTrendChart = document.getElementById('divisionTrendChart');
    const medianTrendChart = document.getElementById('medianTrendChart');
    if (divisionTrendChart) divisionTrendChart.textContent = 'Loading trends…';
    if (medianTrendChart) medianTrendChart.textContent = 'Loading medians…';
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

        excludedProjectIds = new Set();
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
        excludedProjectIds = new Set();
        currentStartDate = '';
        currentEndDate = '';
        currentCounty = '';
        currentSizeRange = { min: '', max: '' };
        updateFilterStatus();
        loadDashboard();
        loadCountyOptions();
    }

    startInput?.addEventListener('change', applyFilters);
    endInput?.addEventListener('change', applyFilters);
    countySelect?.addEventListener('change', applyFilters);
    sizeSelect?.addEventListener('change', applyFilters);
    clearBtn?.addEventListener('click', clearFilters);
}

function initializeDivisionBasisControl() {
    const basisSelect = document.getElementById('divisionBasis');
    if (!basisSelect) return;

    basisSelect.value = divisionBasis;
    basisSelect.addEventListener('change', () => {
        divisionBasis = basisSelect.value || 'selected';
        loadDivisionMetrics();
        loadDivisionTimeSeries();
    });
}

function updateFilteredProjects(projects) {
    filteredProjects = projects || [];
    const filteredIds = new Set(filteredProjects.map(project => project.id));
    excludedProjectIds = new Set([...excludedProjectIds].filter(id => filteredIds.has(id)));

    updateProjectFilterButton();
    renderProjectFilterList();
}

function updateProjectFilterButton() {
    const button = document.getElementById('projectFilterButton');
    if (!button) return;

    const selectedCount = getSelectedProjectIds().length;
    const totalCount = filteredProjects.length;
    const label = totalCount ? `${selectedCount} of ${totalCount} projects` : 'No projects';
    button.textContent = `Projects (${label})`;

    const summary = document.getElementById('projectFilterSummary');
    if (summary) {
        summary.textContent = totalCount
            ? `Including ${selectedCount} of ${totalCount} projects. Uncheck a project to exclude it from the dashboard.`
            : 'No projects match the current filters.';
    }
}

function renderProjectFilterList() {
    const list = document.getElementById('projectFilterList');
    const emptyState = document.getElementById('projectFilterEmpty');

    if (!list || !emptyState) return;

    if (!filteredProjects.length) {
        list.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';
    list.innerHTML = '';

    const selectedIds = new Set(getSelectedProjectIds());
    const projects = [...filteredProjects].sort((a, b) => {
        const dateA = a.project_date ? new Date(a.project_date).getTime() : 0;
        const dateB = b.project_date ? new Date(b.project_date).getTime() : 0;

        if (dateA !== dateB) {
            return dateB - dateA;
        }

        return a.name.localeCompare(b.name);
    });

    projects.forEach(project => {
        const wrapper = document.createElement('label');
        wrapper.className = 'project-filter-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = selectedIds.has(project.id);
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                excludedProjectIds.delete(project.id);
            } else {
                excludedProjectIds.add(project.id);
            }

            updateProjectFilterButton();
            loadDashboard();
        });

        const details = document.createElement('div');
        details.className = 'project-filter-details';
        details.innerHTML = `
            <div class="project-filter-name">${escapeHtml(project.name)}</div>
            <div class="project-filter-meta">${project.project_date ? formatDate(project.project_date) : 'No date'} • ${project.building_sf ? `${formatNumber(project.building_sf)} SF` : 'Size unknown'}</div>
        `;

        wrapper.appendChild(checkbox);
        wrapper.appendChild(details);
        list.appendChild(wrapper);
    });
}

function openProjectFilterModal() {
    const modal = document.getElementById('projectFilterModal');
    if (!modal) return;
    modal.style.display = 'block';
    modal.setAttribute('aria-hidden', 'false');
}

function closeProjectFilterModal() {
    const modal = document.getElementById('projectFilterModal');
    if (!modal) return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
}

function initializeProjectFilterControls() {
    const trigger = document.getElementById('projectFilterButton');
    const closeButtons = document.querySelectorAll('[data-close-project-filter]');
    const selectAllBtn = document.getElementById('selectAllProjects');
    const clearSelectionBtn = document.getElementById('clearProjectSelection');

    trigger?.addEventListener('click', openProjectFilterModal);
    closeButtons.forEach(button => button.addEventListener('click', closeProjectFilterModal));

    selectAllBtn?.addEventListener('click', () => {
        excludedProjectIds = new Set();
        updateProjectFilterButton();
        renderProjectFilterList();
        loadDashboard();
    });

    clearSelectionBtn?.addEventListener('click', () => {
        excludedProjectIds = new Set(filteredProjects.map(project => project.id));
        updateProjectFilterButton();
        renderProjectFilterList();
        loadDashboard();
    });
}

async function fetchFilteredProjects() {
    const response = await apiFetch(appendFilterParams(`${API_BASE}/projects`, { includeProjects: false }));
    return await response.json();
}

function renderEmptyDashboardState(message = 'No projects match the current filters or selection.') {
    document.getElementById('totalProjects').textContent = '0';
    document.getElementById('totalPackages').textContent = '0';
    document.getElementById('totalBidders').textContent = '0';
    document.getElementById('totalBids').textContent = '0';
    divisionTotals = null;
    divisionData = [];

    const emptyRow = `<tr><td colspan="6" class="empty-state">${escapeHtml(message)}</td></tr>`;
    const divisionBody = document.getElementById('divisionsBody');
    const projectsBody = document.getElementById('projectsBody');

    if (divisionBody) divisionBody.innerHTML = emptyRow;
    if (projectsBody) projectsBody.innerHTML = emptyRow;

    const divisionTrendChart = document.getElementById('divisionTrendChart');
    const medianTrendChart = document.getElementById('medianTrendChart');
    if (divisionTrendChart) divisionTrendChart.innerHTML = '<div class="chart-empty-state">No data available</div>';
    if (medianTrendChart) medianTrendChart.innerHTML = '<div class="chart-empty-state">No data available</div>';

    updateSortIndicators('divisions');
    updateSortIndicators('projects');
}

// Load all dashboard data
async function loadDashboard() {
    setLoadingStates();
    updateFilterStatus();

    let projects = [];
    try {
        projects = await fetchFilteredProjects();
    } catch (error) {
        console.error('Error loading projects for dashboard:', error);
        renderEmptyDashboardState('Unable to load projects for the dashboard.');
        return;
    }

    updateFilteredProjects(projects);

    const selectedProjectIds = getSelectedProjectIds();
    if (!selectedProjectIds.length) {
        renderEmptyDashboardState(projects.length ? 'All filtered projects are excluded from the selection.' : 'No projects match the current filters.');
        return;
    }

    await Promise.all([
        loadSummaryMetrics(),
        loadDivisionMetrics(),
        loadDivisionTimeSeries(),
        loadProjectsOverview(projects.filter(project => selectedProjectIds.includes(project.id)))
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
        const response = await apiFetch(appendFilterParams(`${API_BASE}/aggregate/divisions?basis=${divisionBasis}`));
        const payload = await response.json();

        if (Array.isArray(payload)) {
            divisionData = payload;
            divisionTotals = null;
        } else {
            divisionData = payload.divisions || [];
            divisionTotals = payload.overall || null;
        }

        renderDivisionTable();
    } catch (error) {
        console.error('Error loading division metrics:', error);
        divisionTotals = null;
        const tbody = document.getElementById('divisionsBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Error loading division data</td></tr>';
        }
    }
}

async function loadDivisionTimeSeries() {
    try {
        const response = await apiFetch(appendFilterParams(`${API_BASE}/aggregate/divisions/timeseries?basis=${divisionBasis}`));
        divisionTimeSeries = await response.json();

        renderDivisionTrendsChart();
        renderMedianTrendChart();
    } catch (error) {
        console.error('Error loading division time series:', error);
        const divisionChart = document.getElementById('divisionTrendChart');
        const medianChart = document.getElementById('medianTrendChart');
        if (divisionChart) divisionChart.innerHTML = '<div class="chart-empty-state">Unable to load trends</div>';
        if (medianChart) medianChart.innerHTML = '<div class="chart-empty-state">Unable to load medians</div>';
    }
}

// Load projects overview
async function loadProjectsOverview(baseProjects) {
    try {
        let projects = baseProjects;
        if (!projects) {
            const response = await apiFetch(appendFilterParams(`${API_BASE}/projects`));
            projects = await response.json();
        }

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
    const rows = sorted.map(div => `
        <tr>
            <td><strong>${escapeHtml(div.csi_division)}</strong></td>
            <td>${div.package_count}</td>
            <td>${div.median_cost_per_sf ? formatCurrency(div.median_cost_per_sf) : '—'}</td>
            <td>${div.avg_cost_per_sf ? formatCurrency(div.avg_cost_per_sf) : '—'}</td>
            <td>${div.min_cost_per_sf ? formatCurrency(div.min_cost_per_sf) : '—'}</td>
            <td>${div.max_cost_per_sf ? formatCurrency(div.max_cost_per_sf) : '—'}</td>
        </tr>
    `);

    if (divisionTotals) {
        rows.push(`
            <tr class="totals-row">
                <td><strong>${escapeHtml(divisionTotals.csi_division || 'Total')}</strong></td>
                <td>${divisionTotals.package_count ?? '—'}</td>
                <td>${divisionTotals.median_cost_per_sf ? formatCurrency(divisionTotals.median_cost_per_sf) : '—'}</td>
                <td>${divisionTotals.avg_cost_per_sf ? formatCurrency(divisionTotals.avg_cost_per_sf) : '—'}</td>
                <td>${divisionTotals.min_cost_per_sf ? formatCurrency(divisionTotals.min_cost_per_sf) : '—'}</td>
                <td>${divisionTotals.max_cost_per_sf ? formatCurrency(divisionTotals.max_cost_per_sf) : '—'}</td>
            </tr>
        `);
    }

    tbody.innerHTML = rows.join('');

    updateSortIndicators('divisions');
}

function renderDivisionTrendsChart() {
    const container = document.getElementById('divisionTrendChart');
    if (!container) return;

    const series = (divisionTimeSeries.series || [])
        .filter(entry => entry.points && entry.points.length)
        .map((entry, index) => ({
            label: entry.csi_division,
            color: getSeriesColor(index),
            points: entry.points
                .filter(point => point.median_cost_per_sf != null)
                .map(point => ({ x: point.period, y: point.median_cost_per_sf }))
        }));

    if (!series.length) {
        container.innerHTML = '<div class="chart-empty-state">No division trend data available</div>';
        return;
    }

    renderLineChart(container, series, { yLabel: 'Median Cost/SF' });
}

function renderMedianTrendChart() {
    const container = document.getElementById('medianTrendChart');
    if (!container) return;

    const points = (divisionTimeSeries.overall || [])
        .filter(point => point.median_cost_per_sf != null)
        .map(point => ({ x: point.period, y: point.median_cost_per_sf }));

    if (!points.length) {
        container.innerHTML = '<div class="chart-empty-state">No median data available</div>';
        return;
    }

    renderLineChart(container, [{ label: 'Median Cost/SF', color: getSeriesColor(0), points }], { yLabel: 'Median Cost/SF' });
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

function renderLineChart(container, series, { yLabel = 'Value' } = {}) {
    if (!series || !series.length) {
        container.innerHTML = '<div class="chart-empty-state">No data available</div>';
        return;
    }

    const chartKey = container.id || container;
    const state = chartState.get(chartKey) || { hidden: new Set(), series, options: { yLabel } };
    state.series = series;
    state.options = { yLabel };
    chartState.set(chartKey, state);

    const visibleSeries = series.filter(s => !state.hidden.has(s.label));

    if (!visibleSeries.length) {
        container.innerHTML = '<div class="chart-empty-state">Select a series from the legend to view data.</div>';
        const legend = document.createElement('div');
        legend.className = 'chart-legend';
        series.forEach(entry => {
            const item = document.createElement('div');
            item.className = 'chart-legend-item';
            if (state.hidden.has(entry.label)) {
                item.classList.add('disabled');
            }
            const swatch = document.createElement('span');
            swatch.className = 'chart-legend-swatch';
            swatch.style.backgroundColor = entry.color;
            const label = document.createElement('span');
            label.textContent = entry.label;
            item.appendChild(swatch);
            item.appendChild(label);
            item.addEventListener('click', () => toggleSeries(container, entry.label));
            legend.appendChild(item);
        });
        container.appendChild(legend);
        return;
    }

    const periods = Array.from(new Set(visibleSeries.flatMap(s => s.points.map(p => p.x)))).sort();
    const values = visibleSeries.flatMap(s => s.points.map(p => p.y)).filter(value => Number.isFinite(value));

    if (!periods.length || !values.length) {
        container.innerHTML = '<div class="chart-empty-state">No data available</div>';
        return;
    }

    const width = Math.max(container.clientWidth || 600, 320);
    const height = Math.max(container.clientHeight || 340, 300);
    const padding = { top: 20, right: 130, bottom: 50, left: 80 };

    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;

    const yMin = Math.min(...values);
    const yMax = Math.max(...values);
    const yRange = yMax - yMin || 1;

    const xScale = (period) => {
        const index = periods.indexOf(period);
        const ratio = periods.length > 1 ? index / (periods.length - 1) : 0.5;
        return padding.left + ratio * innerWidth;
    };

    const yScale = (value) => {
        const ratio = (value - yMin) / yRange;
        return padding.top + innerHeight - ratio * innerHeight;
    };

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);

    const axisGroup = document.createElementNS(svg.namespaceURI, 'g');
    axisGroup.setAttribute('stroke', '#dce1e7');
    axisGroup.setAttribute('fill', 'none');
    svg.appendChild(axisGroup);

    const yTicks = 4;
    for (let i = 0; i <= yTicks; i++) {
        const value = yMin + (i / yTicks) * yRange;
        const y = yScale(value);

        const line = document.createElementNS(svg.namespaceURI, 'line');
        line.setAttribute('x1', padding.left);
        line.setAttribute('x2', width - padding.right);
        line.setAttribute('y1', y);
        line.setAttribute('y2', y);
        line.setAttribute('stroke', '#edf1f5');
        axisGroup.appendChild(line);

        const label = document.createElementNS(svg.namespaceURI, 'text');
        label.setAttribute('x', padding.left - 10);
        label.setAttribute('y', y + 4);
        label.setAttribute('text-anchor', 'end');
        label.setAttribute('fill', '#7f8c8d');
        label.setAttribute('font-size', '11');
        label.textContent = formatCurrency(value);
        svg.appendChild(label);
    }

    periods.forEach((period, index) => {
        const x = xScale(period);
        const label = document.createElementNS(svg.namespaceURI, 'text');
        label.setAttribute('x', x);
        label.setAttribute('y', height - padding.bottom + 18);
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('fill', '#7f8c8d');
        label.setAttribute('font-size', '11');
        label.textContent = formatPeriod(period);
        svg.appendChild(label);

        if (index > 0) {
            const tick = document.createElementNS(svg.namespaceURI, 'line');
            tick.setAttribute('x1', x);
            tick.setAttribute('x2', x);
            tick.setAttribute('y1', height - padding.bottom);
            tick.setAttribute('y2', height - padding.bottom + 6);
            tick.setAttribute('stroke', '#bfc7d0');
            svg.appendChild(tick);
        }
    });

    const xAxis = document.createElementNS(svg.namespaceURI, 'line');
    xAxis.setAttribute('x1', padding.left);
    xAxis.setAttribute('x2', width - padding.right);
    xAxis.setAttribute('y1', height - padding.bottom);
    xAxis.setAttribute('y2', height - padding.bottom);
    xAxis.setAttribute('stroke', '#bfc7d0');
    svg.appendChild(xAxis);

    const yAxis = document.createElementNS(svg.namespaceURI, 'line');
    yAxis.setAttribute('x1', padding.left);
    yAxis.setAttribute('x2', padding.left);
    yAxis.setAttribute('y1', padding.top);
    yAxis.setAttribute('y2', height - padding.bottom);
    yAxis.setAttribute('stroke', '#bfc7d0');
    svg.appendChild(yAxis);

    const yLabelText = document.createElementNS(svg.namespaceURI, 'text');
    yLabelText.setAttribute('x', padding.left);
    yLabelText.setAttribute('y', padding.top - 6);
    yLabelText.setAttribute('fill', '#2c3e50');
    yLabelText.setAttribute('font-size', '12');
    yLabelText.setAttribute('font-weight', '600');
    yLabelText.textContent = yLabel;
    svg.appendChild(yLabelText);

    const tooltip = document.createElement('div');
    tooltip.className = 'chart-tooltip';
    tooltip.style.display = 'none';
    container.innerHTML = '';
    container.appendChild(svg);
    container.appendChild(tooltip);

    visibleSeries.forEach(seriesEntry => {
        const filteredPoints = seriesEntry.points.filter(point => Number.isFinite(point.y));
        if (!filteredPoints.length) return;

        const pathData = filteredPoints
            .map((point, idx) => `${idx === 0 ? 'M' : 'L'} ${xScale(point.x)} ${yScale(point.y)}`)
            .join(' ');

        const path = document.createElementNS(svg.namespaceURI, 'path');
        path.setAttribute('d', pathData);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', seriesEntry.color);
        path.setAttribute('stroke-width', '2');
        svg.appendChild(path);

        filteredPoints.forEach(point => {
            const circle = document.createElementNS(svg.namespaceURI, 'circle');
            circle.setAttribute('cx', xScale(point.x));
            circle.setAttribute('cy', yScale(point.y));
            circle.setAttribute('r', 3);
            circle.setAttribute('fill', '#fff');
            circle.setAttribute('stroke', seriesEntry.color);
            circle.setAttribute('stroke-width', '2');
            circle.addEventListener('mouseenter', (event) => {
                tooltip.style.display = 'block';
                tooltip.innerHTML = `
                    <div style="font-weight: 700; margin-bottom: 0.2rem;">${escapeHtml(seriesEntry.label)}</div>
                    <div>${formatPeriod(point.x)}</div>
                    <div>${formatCurrency(point.y)}</div>
                `;
                tooltip.style.left = `${event.offsetX}px`;
                tooltip.style.top = `${event.offsetY}px`;
            });
            circle.addEventListener('mouseleave', () => {
                tooltip.style.display = 'none';
            });
            circle.addEventListener('mousemove', (event) => {
                tooltip.style.left = `${event.offsetX}px`;
                tooltip.style.top = `${event.offsetY}px`;
            });
            svg.appendChild(circle);
        });
    });

    const legend = document.createElement('div');
    legend.className = 'chart-legend';
    series.forEach(entry => {
        const item = document.createElement('div');
        item.className = 'chart-legend-item';
        if (state.hidden.has(entry.label)) {
            item.classList.add('disabled');
        }
        const swatch = document.createElement('span');
        swatch.className = 'chart-legend-swatch';
        swatch.style.backgroundColor = entry.color;
        const label = document.createElement('span');
        label.textContent = entry.label;
        item.appendChild(swatch);
        item.appendChild(label);
        item.addEventListener('click', () => toggleSeries(container, entry.label));
        legend.appendChild(item);
    });

    container.appendChild(legend);
}

function toggleSeries(container, label) {
    const chartKey = container.id || container;
    const state = chartState.get(chartKey);
    if (!state) return;

    if (state.hidden.has(label)) {
        state.hidden.delete(label);
    } else {
        state.hidden.add(label);
    }

    renderLineChart(container, state.series, state.options);
}

function renderTableFor(table) {
    switch (table) {
        case 'divisions':
            renderDivisionTable();
            break;
        case 'projects':
            renderProjectsTable();
            break;
        default:
            break;
    }
}

function getSeriesColor(index) {
    const palette = ['#3498db', '#e67e22', '#9b59b6', '#1abc9c', '#e74c3c', '#f1c40f', '#34495e', '#2ecc71'];
    return palette[index % palette.length];
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
        const response = await apiFetch(appendFilterParams(`${API_BASE}/projects`, { includeCounty: false, includeSize: false, includeProjects: false }));
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

function formatPeriod(period) {
    if (!period) return '';
    const [year, month] = period.split('-').map(Number);
    const date = new Date(year, (month || 1) - 1, 1);
    return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
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
initializeDivisionBasisControl();
initializeProjectFilterControls();
loadCountyOptions();
loadDashboard();
