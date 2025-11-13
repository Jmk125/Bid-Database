const API_BASE = '/api';
const projectSelector = document.getElementById('projectSelector');
const compareMetricSelect = document.getElementById('compareMetric');
const pieDatasetSelect = document.getElementById('pieDataset');
const comparisonResults = document.getElementById('comparisonResults');
const chartTitleEl = document.getElementById('compareChartTitle');
const chartSubtitleEl = document.getElementById('compareChartSubtitle');
const metricDescriptionEl = document.getElementById('metricDescription');
let comparisonChart = null;
const projectPieCharts = new Map();
let currentProjects = [];

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

const PIE_COLORS = ['#1abc9c', '#2ecc71', '#3498db', '#9b59b6', '#f1c40f', '#e67e22', '#e74c3c', '#34495e'];

initComparisonPage();

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

    projects.forEach((project) => {
        const canvas = document.getElementById(`comparisonPie-${project.id}`);
        if (!canvas) return;
        const datasetKey = pieDatasetSelect.value;
        const datasetConfig = PIE_DATA_OPTIONS[datasetKey] || PIE_DATA_OPTIONS.median;
        const totals = new Map();

        (project.packages || []).forEach((pkg) => {
            const value = datasetConfig.getValue(pkg);
            if (!Number.isFinite(value) || value <= 0) {
                return;
            }

            const division = pkg.csi_division ? String(pkg.csi_division) : 'Uncoded';
            totals.set(division, (totals.get(division) || 0) + value);
        });

        let entries = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
        if (entries.length > 7) {
            const top = entries.slice(0, 7);
            const remainder = entries.slice(7).reduce((sum, [, value]) => sum + value, 0);
            entries = [...top, ['Other', remainder]];
        }

        if (entries.length === 0) {
            entries = [['No bid data', 1]];
        }

        const labels = entries.map(([label]) => label);
        const data = entries.map(([, value]) => Number(value.toFixed(2)));
        const colors = labels.map((_, index) => PIE_COLORS[index % PIE_COLORS.length]);

        const chart = new Chart(canvas, {
            type: 'pie',
            data: {
                labels,
                datasets: [
                    {
                        label: datasetConfig.label,
                        data,
                        backgroundColor: colors,
                        borderColor: '#ffffff',
                        borderWidth: 1
                    }
                ]
            },
            options: {
                plugins: {
                    legend: {
                        position: 'bottom'
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => `${context.label}: ${formatCurrency(context.parsed)}`
                        }
                    }
                }
            }
        });

        projectPieCharts.set(project.id, chart);
    });
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
