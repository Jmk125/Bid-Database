const API_BASE = '/api';
const projectSelector = document.getElementById('projectSelector');
const compareMetricSelect = document.getElementById('compareMetric');
const pieDatasetSelect = document.getElementById('pieDataset');
const pieGroupingSelect = document.getElementById('pieGrouping');
const comparisonResults = document.getElementById('comparisonResults');
const chartTitleEl = document.getElementById('compareChartTitle');
const chartSubtitleEl = document.getElementById('compareChartSubtitle');
const metricDescriptionEl = document.getElementById('metricDescription');
let comparisonChart = null;
const projectPieCharts = new Map();
let currentProjects = [];

const CATEGORY_DEFINITIONS = [
    { key: 'structure', name: 'Structure', divisions: ['03', '04', '05'], color: '#2c3e50' },
    { key: 'finishes', name: 'Finishes', divisions: ['09'], color: '#3498db' },
    { key: 'equipment', name: 'Equipment', divisions: ['11'], color: '#e74c3c' },
    { key: 'furnishings', name: 'Furnishings', divisions: ['12'], color: '#f39c12' },
    { key: 'mepts', name: 'MEPTS', divisions: ['21', '22', '23', '26', '27', '28'], color: '#16a085' },
    { key: 'sitework', name: 'Sitework', divisions: ['31', '32', '33'], color: '#95a5a6' }
];

const REMAINING_CATEGORY_COLOR = '#bdc3c7';

const DIVISION_COLORS = {
    '03': '#2c3e50', '04': '#3498db', '05': '#e74c3c',
    '06': '#f39c12', '07': '#16a085', '08': '#9b59b6',
    '09': '#34495e', '10': '#1abc9c', '11': '#e67e22',
    '12': '#d35400', '13': '#c0392b', '14': '#8e44ad',
    '21': '#2980b9', '22': '#27ae60', '23': '#8e44ad',
    '26': '#c0392b', '27': '#16a085', '28': '#e67e22',
    '31': '#7f8c8d', '32': '#7f8c8d', '33': '#7f8c8d'
};

const METRIC_OPTIONS = {
    selected_total: {
        label: 'Selected Total',
        description: 'Total value of the selected bidders.',
        format: formatCurrency,
        getValue: (metrics) => metrics?.selected_total ?? 0
    },
    selected_cost_per_sf: {
        label: 'Selected Cost / SF',
        description: 'Cost per square foot for the selected bidders.',
        format: formatCurrency,
        getValue: (metrics) => metrics?.selected_cost_per_sf ?? 0
    },
    median_cost_per_sf: {
        label: 'Median Cost / SF',
        description: 'Median bid cost per square foot.',
        format: formatCurrency,
        getValue: (metrics) => metrics?.median_bid_cost_per_sf ?? metrics?.median_cost_per_sf ?? 0
    },
    low_bid_cost_per_sf: {
        label: 'Low Bid Cost / SF',
        description: 'Lowest bid cost per square foot for each project.',
        format: formatCurrency,
        getValue: (metrics) => metrics?.low_bid_cost_per_sf ?? 0
    }
};

const PIE_DATA_OPTIONS = {
    median: {
        label: 'Median bids',
        getValue: (pkg) => pkg.median_bid ?? pkg.selected_amount ?? 0
    },
    selected: {
        label: 'Selected bids',
        getValue: (pkg) => pkg.selected_amount ?? 0
    },
    low: {
        label: 'Low bids',
        getValue: (pkg) => pkg.low_bid ?? pkg.selected_amount ?? 0
    }
};

registerChartPlugins();
initComparisonPage();

function registerChartPlugins() {
    if (typeof Chart !== 'undefined' && typeof ChartDataLabels !== 'undefined') {
        Chart.register(ChartDataLabels);
    }
}

function initComparisonPage() {
    loadProjects();
    projectSelector.addEventListener('change', () => fetchComparison());
    compareMetricSelect.addEventListener('change', () => {
        if (currentProjects.length) {
            renderComparison(currentProjects);
        }
    });
    pieDatasetSelect.addEventListener('change', () => {
        if (currentProjects.length) {
            renderComparison(currentProjects);
        }
    });
    pieGroupingSelect.addEventListener('change', () => {
        if (currentProjects.length) {
            renderComparison(currentProjects);
        }
    });
}

async function loadProjects() {
    try {
        projectSelector.innerHTML = '<option disabled>Loading projects...</option>';
        const response = await apiFetch(`${API_BASE}/projects`);
        const projects = await response.json();

        if (!projects.length) {
            projectSelector.innerHTML = '<option disabled>No projects found</option>';
            return;
        }

        projectSelector.innerHTML = projects
            .map((project) => `<option value="${project.id}">${escapeHtml(project.name)}</option>`)
            .join('');
    } catch (error) {
        console.error('Failed to load project list', error);
        projectSelector.innerHTML = '<option disabled>Error loading projects</option>';
    }
}

async function fetchComparison() {
    const ids = Array.from(projectSelector.selectedOptions).map((option) => option.value);

    if (ids.length < 2) {
        currentProjects = [];
        resetCharts();
        comparisonResults.innerHTML = `
            <div class="empty-state">
                <h3>Select more projects</h3>
                <p>Pick at least two projects to see side-by-side metrics.</p>
            </div>`;
        return;
    }

    comparisonResults.innerHTML = '<div class="loading">Comparing projects...</div>';

    try {
        const response = await apiFetch(`${API_BASE}/projects/compare?ids=${ids.join(',')}`);
        const projects = await response.json();
        currentProjects = projects;
        renderComparison(projects);
    } catch (error) {
        console.error('Failed to compare projects', error);
        comparisonResults.innerHTML = `
            <div class="empty-state">
                <h3>Unable to compare projects</h3>
                <p>${escapeHtml(error.message || 'Server error')}</p>
            </div>`;
    }
}

function renderComparison(projects) {
    if (!projects || !projects.length) {
        comparisonResults.innerHTML = `
            <div class="empty-state">
                <h3>No data available</h3>
                <p>Try selecting different projects.</p>
            </div>`;
        resetCharts();
        return;
    }

    const metricKey = compareMetricSelect.value;
    const metricConfig = METRIC_OPTIONS[metricKey] || METRIC_OPTIONS.selected_total;
    const labels = projects.map((project) => project.name);
    const values = projects.map((project) => metricConfig.getValue(project.metrics));

    chartTitleEl.textContent = metricConfig.label;
    chartSubtitleEl.textContent = metricConfig.description;
    metricDescriptionEl.textContent = metricConfig.description;

    if (comparisonChart) {
        comparisonChart.destroy();
    }

    const ctx = document.getElementById('compareMetricChart');
    comparisonChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: metricConfig.label,
                    data: values,
                    borderRadius: 6,
                    backgroundColor: '#3498db'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (context) => metricConfig.format(context.parsed.y)
                    }
                }
            },
            scales: {
                y: {
                    ticks: {
                        callback: (value) => metricConfig.format(value)
                    },
                    beginAtZero: true
                }
            }
        }
    });

    comparisonResults.innerHTML = projects.map(createProjectCard).join('');
    renderProjectPieCharts(projects);
}

function renderProjectPieCharts(projects) {
    projectPieCharts.forEach((chart) => chart.destroy());
    projectPieCharts.clear();

    const datasetKey = pieDatasetSelect.value;
    const datasetConfig = PIE_DATA_OPTIONS[datasetKey] || PIE_DATA_OPTIONS.median;
    const grouping = pieGroupingSelect.value || 'division';

    projects.forEach((project) => {
        const canvas = document.getElementById(`comparisonPie-${project.id}`);
        if (!canvas) return;
        const entries = buildPieEntries(project.packages || [], grouping, datasetConfig);
        const hasData = entries.length > 0;
        const chartEntries = hasData
            ? entries
            : [{ label: 'No bid data', legendLabel: 'No bid data', color: '#d5d8dc', value: 1 }];
        const totalValue = chartEntries.reduce((sum, entry) => sum + entry.value, 0);

        const chart = new Chart(canvas, {
            type: 'pie',
            data: {
                labels: chartEntries.map((entry) => entry.legendLabel),
                datasets: [
                    {
                        label: datasetConfig.label,
                        data: chartEntries.map((entry) => Number(entry.value.toFixed(2))),
                        backgroundColor: chartEntries.map((entry) => entry.color || REMAINING_CATEGORY_COLOR),
                        borderColor: '#ffffff',
                        borderWidth: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            usePointStyle: true,
                            pointStyle: 'circle',
                            boxWidth: 12
                        }
                    },
                    datalabels: hasData
                        ? {
                              color: '#ffffff',
                              font: { weight: 'bold', size: 11 },
                              formatter: (value) => {
                                  if (!totalValue) return '';
                                  return `${((value / totalValue) * 100).toFixed(1)}%`;
                              },
                              display: (context) => context.raw > 0
                          }
                        : {
                              display: false
                          },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                if (!hasData || !totalValue) {
                                    return context.label;
                                }
                                const percentage = ((context.raw / totalValue) * 100).toFixed(1);
                                return `${context.label}: ${formatCurrency(context.raw)} (${percentage}%)`;
                            }
                        }
                    }
                }
            }
        });

        projectPieCharts.set(project.id, chart);
    });
}

function buildPieEntries(packages, grouping, datasetConfig) {
    if (!packages || !packages.length) {
        return [];
    }

    const getValue = datasetConfig.getValue;
    if (grouping === 'category') {
        return buildCategoryEntries(packages, getValue);
    }
    return buildDivisionEntries(packages, getValue);
}

function buildCategoryEntries(packages, getValue) {
    const divisionToCategory = {};
    CATEGORY_DEFINITIONS.forEach((cat) => {
        cat.divisions.forEach((div) => {
            divisionToCategory[div] = cat.key;
        });
    });

    const categoryEntries = CATEGORY_DEFINITIONS.map((cat) => ({
        key: cat.key,
        label: cat.name,
        legendLabel: cat.name,
        color: cat.color,
        divisions: cat.divisions.join(', '),
        value: 0
    }));
    const categoryMap = new Map(categoryEntries.map((entry) => [entry.key, entry]));
    const remainderEntry = {
        key: 'remaining',
        label: 'Remaining Packages',
        legendLabel: 'Remaining Packages',
        color: REMAINING_CATEGORY_COLOR,
        divisions: 'Other',
        value: 0,
        packages: []
    };

    packages.forEach((pkg) => {
        const rawValue = getValue(pkg);
        const value = toFiniteNumber(rawValue);
        if (value == null || value <= 0) {
            return;
        }

        const division = formatDivisionKey(pkg.csi_division);
        const targetKey = division ? divisionToCategory[division] : null;
        const entry = targetKey ? categoryMap.get(targetKey) : remainderEntry;
        entry.value += value;
    });

    return [...categoryEntries, remainderEntry]
        .filter((entry) => entry.value > 0)
        .map((entry) => ({
            key: entry.key,
            label: entry.label,
            legendLabel: entry.legendLabel,
            color: entry.color,
            value: entry.value,
            divisions: entry.divisions
        }));
}

function buildDivisionEntries(packages, getValue) {
    const divisionMap = new Map();

    packages.forEach((pkg) => {
        const rawValue = getValue(pkg);
        const value = toFiniteNumber(rawValue);
        if (value == null || value <= 0) {
            return;
        }

        const division = formatDivisionKey(pkg.csi_division);
        if (!division) {
            return;
        }

        if (!divisionMap.has(division)) {
            divisionMap.set(division, {
                key: division,
                label: `Div ${division}`,
                legendLabel: `Div ${division}`,
                color: DIVISION_COLORS[division] || '#95a5a6',
                value: 0
            });
        }

        const entry = divisionMap.get(division);
        entry.value += value;
    });

    return Array.from(divisionMap.values()).sort((a, b) => {
        const aVal = parseInt(a.key, 10);
        const bVal = parseInt(b.key, 10);
        if (Number.isNaN(aVal) || Number.isNaN(bVal)) {
            return a.key.localeCompare(b.key);
        }
        return aVal - bVal;
    });
}

function formatDivisionKey(value) {
    if (value == null) {
        return null;
    }
    const str = String(value).trim();
    if (!str) {
        return null;
    }
    if (/^\d+$/.test(str)) {
        return str.padStart(2, '0');
    }
    return str;
}

function toFiniteNumber(value) {
    if (value == null) {
        return null;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function createProjectCard(project) {
    const metrics = project.metrics || {};
    const selectedTotal = formatCurrency(metrics.selected_total);
    const selectedPerSf = formatCurrency(metrics.selected_cost_per_sf);
    const medianPerSf = formatCurrency(metrics.median_bid_cost_per_sf ?? metrics.median_cost_per_sf);
    const lowPerSf = formatCurrency(metrics.low_bid_cost_per_sf);

    return `
        <article class="comparison-card">
            <header>
                <h4>${escapeHtml(project.name)}</h4>
                <p class="card-subtitle">${project.project_date ? formatDate(project.project_date) : 'No bid date'} · ${project.building_sf ? formatNumber(project.building_sf) + ' SF' : 'SF unknown'}</p>
            </header>
            <dl class="comparison-metrics">
                <div>
                    <dt>Packages</dt>
                    <dd>${project.package_count ?? 0}</dd>
                </div>
                <div>
                    <dt>Selected Total</dt>
                    <dd>${selectedTotal}</dd>
                </div>
                <div>
                    <dt>Selected $/SF</dt>
                    <dd>${selectedPerSf}</dd>
                </div>
                <div>
                    <dt>Median $/SF</dt>
                    <dd>${medianPerSf}</dd>
                </div>
                <div>
                    <dt>Low $/SF</dt>
                    <dd>${lowPerSf}</dd>
                </div>
            </dl>
            <div class="comparison-pie">
                <canvas id="comparisonPie-${project.id}" role="img" aria-label="Bid mix for ${escapeHtml(project.name)}"></canvas>
            </div>
        </article>
    `;
}

function resetCharts() {
    if (comparisonChart) {
        comparisonChart.destroy();
        comparisonChart = null;
    }
    projectPieCharts.forEach((chart) => chart.destroy());
    projectPieCharts.clear();
}

function formatCurrency(value) {
    if (!Number.isFinite(value)) {
        return '—';
    }
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

function formatNumber(value) {
    if (!Number.isFinite(value)) {
        return '—';
    }
    return new Intl.NumberFormat().format(value);
}

function formatDate(value) {
    if (!value) {
        return 'Date unknown';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return date.toLocaleDateString();
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
