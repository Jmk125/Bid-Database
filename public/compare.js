const API_BASE = '/api';
const projectSelector = document.getElementById('projectSelector');
const compareMetricSelect = document.getElementById('compareMetric');
const pieDatasetSelect = document.getElementById('pieDataset');
const pieGroupingSelect = document.getElementById('pieGrouping');
const comparisonResults = document.getElementById('comparisonResults');
const chartTitleEl = document.getElementById('compareChartTitle');
const chartSubtitleEl = document.getElementById('compareChartSubtitle');
const metricDescriptionEl = document.getElementById('metricDescription');
const chartViewSelect = document.getElementById('compareChartView');
const chartViewHintEl = document.getElementById('chartViewHint');
let packageFilterGroup = null;
let packageFilterList = null;
let packageFilterSummary = null;
let packageFilterAllButton = null;
let packageFilterNoneButton = null;
let comparisonChart = null;
const projectPieCharts = new Map();
let currentProjects = [];
let packageFilterEntries = [];
let packageFilterState = new Map();

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

const METRIC_SCOPES = {
    PROJECT: 'project',
    PACKAGE: 'package',
    CATEGORY: 'category'
};

const CHART_VIEW_MODES = {
    PROJECT: 'project',
    MONTH: 'month'
};

const PROJECT_COLORS = ['#3498db', '#e67e22', '#2ecc71', '#9b59b6', '#1abc9c', '#f1c40f', '#e74c3c', '#34495e'];
const GMP_BASE_COLOR = '#95a5a6';
const GMP_OVERAGE_COLOR = '#e74c3c';
const GMP_SAVINGS_COLOR = '#27ae60';

const METRIC_OPTIONS = {
    selected_total: {
        label: 'Selected Total',
        description: 'Total value of the selected bidders.',
        format: formatCurrency,
        getValue: (metrics) => metrics?.selected_total ?? 0,
        monthAggregate: 'sum',
        scope: METRIC_SCOPES.PROJECT
    },
    selected_cost_per_sf: {
        label: 'Selected Cost / SF',
        description: 'Cost per square foot for the selected bidders.',
        format: formatCurrency,
        getValue: (metrics) => metrics?.selected_cost_per_sf ?? 0,
        monthAggregate: 'average',
        scope: METRIC_SCOPES.PROJECT
    },
    gmp_to_selected_total_delta_percentage: {
        label: 'GMP to Selected delta % (total)',
        description: 'Selected total minus GMP total shown as a percentage of the GMP total.',
        format: formatPercentage,
        getValue: (_, project) => {
            const totals = computeProjectBudgetTotals(project);
            if (!totals.hasGmp || totals.gmpTotal === 0 || !totals.hasSelected) {
                return null;
            }
            return (totals.selectedTotal - totals.gmpTotal) / totals.gmpTotal;
        },
        monthAggregate: 'average',
        scope: METRIC_SCOPES.PROJECT
    },
    median_cost_per_sf: {
        label: 'Median Cost / SF',
        description: 'Median bid cost per square foot.',
        format: formatCurrency,
        getValue: (metrics) => metrics?.median_bid_cost_per_sf ?? metrics?.median_cost_per_sf ?? 0,
        monthAggregate: 'average',
        scope: METRIC_SCOPES.PROJECT
    },
    gmp_to_median_total_delta_percentage: {
        label: 'GMP to Median delta % (total)',
        description: 'Median total minus GMP total shown as a percentage of the GMP total.',
        format: formatPercentage,
        getValue: (_, project) => {
            const totals = computeProjectBudgetTotals(project);
            if (!totals.hasGmp || totals.gmpTotal === 0 || !totals.hasMedian) {
                return null;
            }
            return (totals.medianTotal - totals.gmpTotal) / totals.gmpTotal;
        },
        monthAggregate: 'average',
        scope: METRIC_SCOPES.PROJECT
    },
    low_bid_cost_per_sf: {
        label: 'Low Bid Cost / SF',
        description: 'Lowest bid cost per square foot for each project.',
        format: formatCurrency,
        getValue: (metrics) => metrics?.low_bid_cost_per_sf ?? 0,
        monthAggregate: 'average',
        scope: METRIC_SCOPES.PROJECT
    },
    low_to_median_total_delta: {
        label: 'Low to Median delta (total)',
        description: 'Total median bid minus total low bid for each project.',
        format: formatCurrency,
        getValue: (_, project) => {
            const totals = computeProjectBudgetTotals(project);
            if (!totals.hasMedian || !totals.hasLow) {
                return null;
            }
            return totals.medianTotal - totals.lowTotal;
        },
        monthAggregate: 'sum',
        scope: METRIC_SCOPES.PROJECT
    },
    low_to_median_total_delta_percentage: {
        label: 'Low to Median delta % (total)',
        description: 'Total median bid minus total low bid shown as a percentage of the median total.',
        format: formatPercentage,
        getValue: (_, project) => {
            const totals = computeProjectBudgetTotals(project);
            if (!totals.hasMedian || totals.medianTotal === 0 || !totals.hasLow) {
                return null;
            }
            return (totals.medianTotal - totals.lowTotal) / totals.medianTotal;
        },
        monthAggregate: 'average',
        scope: METRIC_SCOPES.PROJECT
    },
    gmp_median_overlay: {
        label: 'GMP Median Overlay',
        description: 'Shows GMP totals with green savings (GMP above median) or red overages (median above GMP).',
        format: formatCurrency,
        scope: METRIC_SCOPES.PROJECT,
        allowMonthlyTimeline: true,
        stacked: true,
        overlayTarget: 'median',
        buildChartData: (projects) => buildGmpOverlayChartData(projects, 'median', 'Median'),
        tooltipFormatter: (context) => buildGmpOverlayTooltip(context, 'median')
    },
    gmp_selected_low_overlay: {
        label: 'GMP Selected Low Overlay',
        description: 'Shows GMP totals with green savings (GMP above selected low) or red overages (selected low above GMP).',
        format: formatCurrency,
        scope: METRIC_SCOPES.PROJECT,
        allowMonthlyTimeline: true,
        stacked: true,
        overlayTarget: 'low',
        buildChartData: (projects) => buildGmpOverlayChartData(projects, 'low', 'Selected low'),
        tooltipFormatter: (context) => buildGmpOverlayTooltip(context, 'low')
    },
    gmp_median_overlay_percentage: {
        label: 'GMP Median Overlay %',
        description: 'Shows GMP versus median totals as stacked percentages, highlighting overages and savings.',
        format: formatPercentage,
        scope: METRIC_SCOPES.PROJECT,
        allowMonthlyTimeline: true,
        stacked: true,
        overlayTarget: 'median',
        buildChartData: (projects) => buildGmpOverlayChartData(projects, 'median', 'Median', true),
        tooltipFormatter: (context) => buildGmpOverlayTooltip(context, 'median', true)
    },
    gmp_selected_low_overlay_percentage: {
        label: 'GMP Selected Low Overlay %',
        description: 'Shows GMP versus selected low totals as stacked percentages, highlighting overages and savings.',
        format: formatPercentage,
        scope: METRIC_SCOPES.PROJECT,
        allowMonthlyTimeline: true,
        stacked: true,
        overlayTarget: 'low',
        buildChartData: (projects) => buildGmpOverlayChartData(projects, 'low', 'Selected low', true),
        tooltipFormatter: (context) => buildGmpOverlayTooltip(context, 'low', true)
    },
    total_bid_count: {
        label: 'Total bids',
        description: 'Total number of bids submitted across all packages.',
        format: formatInteger,
        monthAggregate: 'sum',
        scope: METRIC_SCOPES.PROJECT,
        getValue: (metrics, project) => {
            if (!project) {
                return null;
            }
            const metricCount = toFiniteNumber(metrics?.total_bid_count);
            if (metricCount != null) {
                return metricCount;
            }
            const packages = project.packages || [];
            if (!packages.length) {
                return 0;
            }
            return packages.reduce((sum, pkg) => {
                const count = toFiniteNumber(pkg?.bid_count);
                return sum + (count != null ? count : 0);
            }, 0);
        }
    },
    bids_per_package: {
        label: 'Bids per package',
        description: 'Average number of bids received per package.',
        format: formatAverage,
        monthAggregate: 'average',
        scope: METRIC_SCOPES.PROJECT,
        getValue: (metrics, project) => {
            if (!project) {
                return null;
            }

            const totalBids = (() => {
                const metricCount = toFiniteNumber(metrics?.total_bid_count);
                if (metricCount != null) {
                    return metricCount;
                }
                const packages = project.packages || [];
                if (!packages.length) {
                    return null;
                }
                const aggregated = packages.reduce((sum, pkg) => {
                    const count = toFiniteNumber(pkg?.bid_count);
                    return sum + (count != null ? count : 0);
                }, 0);
                return aggregated;
            })();

            const packageCount = (() => {
                const metricPackages = toFiniteNumber(metrics?.package_count);
                if (metricPackages != null) {
                    return metricPackages;
                }
                if (Number.isFinite(project.package_count)) {
                    return project.package_count;
                }
                return project.packages?.length ?? null;
            })();

            if (packageCount == null || packageCount === 0 || totalBids == null) {
                return null;
            }

            return totalBids / packageCount;
        }
    },
    bid_spread_by_package: {
        label: 'Bid spread by package',
        description: 'Difference between the highest and lowest bid recorded for each package.',
        format: formatCurrency,
        scope: METRIC_SCOPES.PACKAGE,
        getValue: (pkg) => {
            if (!pkg) return null;
            const high = toFiniteNumber(pkg.high_bid);
            const low = toFiniteNumber(pkg.low_bid);
            if (high == null || low == null) {
                return null;
            }
            return high - low;
        }
    },
    bid_spread_percentage_by_package: {
        label: 'Bid spread % by package',
        description: 'Bid spread expressed as a percentage of the median bid for each package.',
        format: formatPercentage,
        scope: METRIC_SCOPES.PACKAGE,
        getValue: (pkg) => {
            if (!pkg) return null;
            const high = toFiniteNumber(pkg.high_bid);
            const low = toFiniteNumber(pkg.low_bid);
            const median = toFiniteNumber(pkg.median_bid);
            if (high == null || low == null || !Number.isFinite(median) || median === 0) {
                return null;
            }
            return (high - low) / median;
        }
    },
    gmp_to_median_delta_by_package: {
        label: 'GMP to Median delta (pkg)',
        description: 'Median bid minus GMP estimate for each package.',
        format: formatCurrency,
        scope: METRIC_SCOPES.PACKAGE,
        getValue: (pkg) => {
            if (!pkg) return null;
            const gmp = toFiniteNumber(pkg.gmp_amount);
            const median = toFiniteNumber(pkg.median_bid);
            if (gmp == null || median == null) {
                return null;
            }
            return median - gmp;
        }
    },
    gmp_to_median_delta_percentage_by_package: {
        label: 'GMP to Median delta % (pkg)',
        description: 'Median bid minus GMP estimate shown as a percentage of the GMP.',
        format: formatPercentage,
        scope: METRIC_SCOPES.PACKAGE,
        getValue: (pkg) => {
            if (!pkg) return null;
            const gmp = toFiniteNumber(pkg.gmp_amount);
            const median = toFiniteNumber(pkg.median_bid);
            if (gmp == null || gmp === 0 || median == null) {
                return null;
            }
            return (median - gmp) / gmp;
        }
    },
    gmp_to_low_bid_delta_by_package: {
        label: 'GMP to Low Bid delta (pkg)',
        description: 'Low bid minus GMP estimate for each package.',
        format: formatCurrency,
        scope: METRIC_SCOPES.PACKAGE,
        getValue: (pkg) => {
            if (!pkg) return null;
            const gmp = toFiniteNumber(pkg.gmp_amount);
            const low = toFiniteNumber(pkg.low_bid);
            if (gmp == null || low == null) {
                return null;
            }
            return low - gmp;
        }
    },
    gmp_to_low_bid_delta_percentage_by_package: {
        label: 'GMP to Low Bid delta % (pkg)',
        description: 'Low bid minus GMP estimate shown as a percentage of the GMP.',
        format: formatPercentage,
        scope: METRIC_SCOPES.PACKAGE,
        getValue: (pkg) => {
            if (!pkg) return null;
            const gmp = toFiniteNumber(pkg.gmp_amount);
            const low = toFiniteNumber(pkg.low_bid);
            if (gmp == null || gmp === 0 || low == null) {
                return null;
            }
            return (low - gmp) / gmp;
        }
    },
    low_to_median_delta_by_package: {
        label: 'Low to Median delta (pkg)',
        description: 'Median bid minus low bid for each package.',
        format: formatCurrency,
        scope: METRIC_SCOPES.PACKAGE,
        getValue: (pkg) => {
            if (!pkg) return null;
            const median = toFiniteNumber(pkg.median_bid);
            const low = toFiniteNumber(pkg.low_bid);
            if (median == null || low == null) {
                return null;
            }
            return median - low;
        }
    },
    low_to_median_delta_percentage_by_package: {
        label: 'Low to Median delta % (pkg)',
        description: 'Median bid minus low bid expressed as a percentage of the median bid.',
        format: formatPercentage,
        scope: METRIC_SCOPES.PACKAGE,
        getValue: (pkg) => {
            if (!pkg) return null;
            const median = toFiniteNumber(pkg.median_bid);
            const low = toFiniteNumber(pkg.low_bid);
            if (median == null || median === 0 || low == null) {
                return null;
            }
            return (median - low) / median;
        }
    },
    bid_count_by_package: {
        label: 'Number of bids by package',
        description: 'Count of bids received for each scope package.',
        format: formatInteger,
        scope: METRIC_SCOPES.PACKAGE,
        getValue: (pkg) => {
            if (!pkg) return null;
            const count = toFiniteNumber(pkg.bid_count);
            return Number.isFinite(count) ? count : null;
        }
    },
    median_cost_per_sf_by_package: {
        label: 'Median $/SF by package',
        description: 'Median bid divided by the project square footage for each package.',
        format: formatCurrency,
        scope: METRIC_SCOPES.PACKAGE,
        getValue: (pkg, project) => {
            if (!pkg || !project || !Number.isFinite(project.building_sf) || project.building_sf <= 0) {
                return null;
            }
            const median = toFiniteNumber(pkg.median_bid);
            if (median == null) {
                return null;
            }
            return median / project.building_sf;
        }
    },
    low_cost_per_sf_by_package: {
        label: 'Low $/SF by package',
        description: 'Low bid divided by the project square footage for each package.',
        format: formatCurrency,
        scope: METRIC_SCOPES.PACKAGE,
        getValue: (pkg, project) => {
            if (!pkg || !project || !Number.isFinite(project.building_sf) || project.building_sf <= 0) {
                return null;
            }
            const low = toFiniteNumber(pkg.low_bid);
            if (low == null) {
                return null;
            }
            return low / project.building_sf;
        }
    },
    category_selected_cost_per_sf: {
        label: 'Category Selected $/SF',
        description: 'Selected bid totals per category divided by project square footage.',
        format: formatCurrency,
        scope: METRIC_SCOPES.CATEGORY,
        getValue: (categoryEntry, project) => {
            if (!categoryEntry || !project || !Number.isFinite(project.building_sf) || project.building_sf <= 0) {
                return null;
            }
            const selectedTotal = toFiniteNumber(categoryEntry.selected_total);
            if (selectedTotal == null) {
                return null;
            }
            return selectedTotal / project.building_sf;
        }
    },
    category_median_cost_per_sf: {
        label: 'Category Median $/SF',
        description: 'Median bid totals per category divided by project square footage.',
        format: formatCurrency,
        scope: METRIC_SCOPES.CATEGORY,
        getValue: (categoryEntry, project) => {
            if (!categoryEntry || !project || !Number.isFinite(project.building_sf) || project.building_sf <= 0) {
                return null;
            }
            const medianTotal = toFiniteNumber(categoryEntry.median_total);
            if (medianTotal == null) {
                return null;
            }
            return medianTotal / project.building_sf;
        }
    },
    category_gmp_to_median_delta: {
        label: 'GMP to Median delta (cat)',
        description: 'Total median bid minus total GMP estimate for each category.',
        format: formatCurrency,
        scope: METRIC_SCOPES.CATEGORY,
        getValue: (categoryEntry) => {
            if (!categoryEntry) return null;
            const gmpTotal = toFiniteNumber(categoryEntry.gmp_total);
            const medianTotal = toFiniteNumber(categoryEntry.median_total);
            if (gmpTotal == null || medianTotal == null) {
                return null;
            }
            return medianTotal - gmpTotal;
        }
    },
    category_gmp_to_median_delta_percentage: {
        label: 'GMP to Median delta % (cat)',
        description: 'Total median bid minus total GMP estimate shown as a percentage of the GMP for each category.',
        format: formatPercentage,
        scope: METRIC_SCOPES.CATEGORY,
        getValue: (categoryEntry) => {
            if (!categoryEntry) return null;
            const gmpTotal = toFiniteNumber(categoryEntry.gmp_total);
            const medianTotal = toFiniteNumber(categoryEntry.median_total);
            if (gmpTotal == null || gmpTotal === 0 || medianTotal == null) {
                return null;
            }
            return (medianTotal - gmpTotal) / gmpTotal;
        }
    },
    category_gmp_to_low_bid_delta: {
        label: 'GMP to Low Bid delta (cat)',
        description: 'Total low bid minus total GMP estimate for each category.',
        format: formatCurrency,
        scope: METRIC_SCOPES.CATEGORY,
        getValue: (categoryEntry) => {
            if (!categoryEntry) return null;
            const gmpTotal = toFiniteNumber(categoryEntry.gmp_total);
            const lowTotal = toFiniteNumber(categoryEntry.low_total);
            if (gmpTotal == null || lowTotal == null) {
                return null;
            }
            return lowTotal - gmpTotal;
        }
    },
    category_gmp_to_low_bid_delta_percentage: {
        label: 'GMP to Low Bid delta % (cat)',
        description: 'Total low bid minus total GMP estimate shown as a percentage of the GMP for each category.',
        format: formatPercentage,
        scope: METRIC_SCOPES.CATEGORY,
        getValue: (categoryEntry) => {
            if (!categoryEntry) return null;
            const gmpTotal = toFiniteNumber(categoryEntry.gmp_total);
            const lowTotal = toFiniteNumber(categoryEntry.low_total);
            if (gmpTotal == null || gmpTotal === 0 || lowTotal == null) {
                return null;
            }
            return (lowTotal - gmpTotal) / gmpTotal;
        }
    },
    category_low_to_median_delta: {
        label: 'Low to Median delta (cat)',
        description: 'Total median bid minus total low bid for each category.',
        format: formatCurrency,
        scope: METRIC_SCOPES.CATEGORY,
        getValue: (categoryEntry) => {
            if (!categoryEntry) return null;
            const medianTotal = toFiniteNumber(categoryEntry.median_total);
            const lowTotal = toFiniteNumber(categoryEntry.low_total);
            if (medianTotal == null || lowTotal == null) {
                return null;
            }
            return medianTotal - lowTotal;
        }
    },
    category_low_to_median_delta_percentage: {
        label: 'Low to Median delta % (cat)',
        description: 'Total median bid minus total low bid expressed as a percentage of the median bid for each category.',
        format: formatPercentage,
        scope: METRIC_SCOPES.CATEGORY,
        getValue: (categoryEntry) => {
            if (!categoryEntry) return null;
            const medianTotal = toFiniteNumber(categoryEntry.median_total);
            const lowTotal = toFiniteNumber(categoryEntry.low_total);
            if (medianTotal == null || medianTotal === 0 || lowTotal == null) {
                return null;
            }
            return (medianTotal - lowTotal) / medianTotal;
        }
    }
};

const METRIC_GROUPS = [
    {
        label: 'Project totals',
        metrics: [
            'selected_total',
            'selected_cost_per_sf',
            'median_cost_per_sf',
            'low_bid_cost_per_sf',
            'low_to_median_total_delta',
            'low_to_median_total_delta_percentage',
            'gmp_median_overlay',
            'gmp_selected_low_overlay',
            'gmp_median_overlay_percentage',
            'gmp_selected_low_overlay_percentage'
        ]
    },
    {
        label: 'GMP totals',
        metrics: ['gmp_to_selected_total_delta_percentage', 'gmp_to_median_total_delta_percentage']
    },
    {
        label: 'Package bid spreads',
        metrics: ['bid_spread_by_package', 'bid_spread_percentage_by_package', 'low_to_median_delta_by_package', 'low_to_median_delta_percentage_by_package']
    },
    {
        label: 'Package GMP deltas',
        metrics: [
            'gmp_to_median_delta_by_package',
            'gmp_to_median_delta_percentage_by_package',
            'gmp_to_low_bid_delta_by_package',
            'gmp_to_low_bid_delta_percentage_by_package'
        ]
    },
    {
        label: 'Bid volume',
        metrics: ['total_bid_count', 'bids_per_package', 'bid_count_by_package']
    },
    {
        label: 'Package $/SF',
        metrics: ['median_cost_per_sf_by_package', 'low_cost_per_sf_by_package']
    },
    {
        label: 'Category metrics',
        metrics: [
            'category_selected_cost_per_sf',
            'category_median_cost_per_sf',
            'category_gmp_to_median_delta',
            'category_gmp_to_median_delta_percentage',
            'category_gmp_to_low_bid_delta',
            'category_gmp_to_low_bid_delta_percentage',
            'category_low_to_median_delta',
            'category_low_to_median_delta_percentage'
        ]
    }
];

function computeProjectBudgetTotals(project) {
    const getSelectedLowBid = (pkg) => {
        const selected = toFiniteNumber(pkg.selected_amount);
        if (selected != null) {
            return selected;
        }
        return toFiniteNumber(pkg.low_bid);
    };

    const totals = {
        gmpTotal: 0,
        selectedTotal: 0,
        medianTotal: 0,
        lowTotal: 0,
        hasGmp: false,
        hasSelected: false,
        hasMedian: false,
        hasLow: false
    };

    (project?.packages || []).forEach((pkg) => {
        const gmp = toFiniteNumber(pkg.gmp_amount);
        const selected = toFiniteNumber(pkg.selected_amount);
        const median = toFiniteNumber(pkg.median_bid);
        const low = getSelectedLowBid(pkg);

        if (gmp != null) {
            totals.gmpTotal += gmp;
            totals.hasGmp = true;
        }

        if (selected != null) {
            totals.selectedTotal += selected;
            totals.hasSelected = true;
        }

        if (median != null) {
            totals.medianTotal += median;
            totals.hasMedian = true;
        }

        if (low != null) {
            totals.lowTotal += low;
            totals.hasLow = true;
        }
    });

    return totals;
}

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
    refreshPackageFilterElements();
    populateMetricDropdown();
    updateMetricMetadata(compareMetricSelect.value);
    loadProjects();
    projectSelector.addEventListener('change', () => fetchComparison());
    compareMetricSelect.addEventListener('change', () => {
        if (currentProjects.length) {
            renderComparison(currentProjects);
        } else {
            updateMetricMetadata(compareMetricSelect.value);
        }
    });
    if (chartViewSelect) {
        chartViewSelect.addEventListener('change', () => {
            if (currentProjects.length) {
                renderComparison(currentProjects);
            } else {
                updateMetricMetadata(compareMetricSelect.value);
            }
        });
    }
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
    if (packageFilterList) {
        packageFilterList.addEventListener('change', (event) => {
            const checkbox = event.target;
            if (!(checkbox instanceof HTMLInputElement) || checkbox.type !== 'checkbox') {
                return;
            }
            const key = checkbox.dataset.packageKey;
            if (!key) {
                return;
            }
            const entry = packageFilterState.get(key);
            if (entry) {
                entry.selected = checkbox.checked;
            }
            updatePackageFilterSummary();
            if (currentProjects.length) {
                renderComparison(currentProjects);
            }
        });
    }
    if (packageFilterAllButton) {
        packageFilterAllButton.addEventListener('click', () => {
            setAllPackageFilters(true);
        });
    }
    if (packageFilterNoneButton) {
        packageFilterNoneButton.addEventListener('click', () => {
            setAllPackageFilters(false);
        });
    }
}

function refreshPackageFilterElements() {
    const groups = Array.from(document.querySelectorAll('#packageFilterGroup'));
    if (groups.length > 1) {
        groups.slice(0, -1).forEach((group) => group.remove());
    }
    const activeGroup = groups[groups.length - 1] || null;
    packageFilterGroup = activeGroup;
    packageFilterList = activeGroup?.querySelector('#packageFilterList') || null;
    packageFilterSummary = activeGroup?.querySelector('#packageFilterSummary') || null;
    packageFilterAllButton = activeGroup?.querySelector('#packageFilterAll') || null;
    packageFilterNoneButton = activeGroup?.querySelector('#packageFilterNone') || null;
}

function populateMetricDropdown() {
    if (!compareMetricSelect) {
        return;
    }

    compareMetricSelect.innerHTML = '';

    METRIC_GROUPS.forEach((group) => {
        const optGroup = document.createElement('optgroup');
        optGroup.label = group.label;

        group.metrics.forEach((metricKey) => {
            const metric = METRIC_OPTIONS[metricKey];
            if (!metric) return;
            const option = document.createElement('option');
            option.value = metricKey;
            option.textContent = metric.label;
            optGroup.appendChild(option);
        });

        if (optGroup.children.length > 0) {
            compareMetricSelect.appendChild(optGroup);
        }
    });

    const firstOption = compareMetricSelect.querySelector('option');
    if (firstOption) {
        compareMetricSelect.value = firstOption.value;
    }
}

function isMonthlyViewAvailable(metricConfig) {
    if (metricConfig.scope !== METRIC_SCOPES.PROJECT) {
        return false;
    }
    if (typeof metricConfig.buildChartData !== 'function') {
        return true;
    }
    return metricConfig.allowMonthlyTimeline === true;
}

function updateChartViewControl(metricKey) {
    const metricConfig = METRIC_OPTIONS[metricKey] || METRIC_OPTIONS.selected_total;
    if (!chartViewSelect) {
        return CHART_VIEW_MODES.PROJECT;
    }

    const monthlyAvailable = isMonthlyViewAvailable(metricConfig);
    chartViewSelect.disabled = !monthlyAvailable;
    if (!monthlyAvailable) {
        chartViewSelect.value = CHART_VIEW_MODES.PROJECT;
    }
    if (chartViewHintEl) {
        chartViewHintEl.textContent = monthlyAvailable
            ? 'Switch between per-project bars and a month-by-month timeline.'
            : 'Monthly view is available for project-level metrics.';
    }
    return chartViewSelect.value || CHART_VIEW_MODES.PROJECT;
}

function updateMetricMetadata(metricKey) {
    const metricConfig = METRIC_OPTIONS[metricKey] || METRIC_OPTIONS.selected_total;
    const viewMode = updateChartViewControl(metricKey);
    chartTitleEl.textContent = metricConfig.label;
    metricDescriptionEl.textContent = metricConfig.description;
    if (viewMode === CHART_VIEW_MODES.MONTH) {
        chartSubtitleEl.textContent = `${metricConfig.description} (Timeline by bid month.)`;
    } else {
        chartSubtitleEl.textContent = metricConfig.description;
    }
    return viewMode;
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

    if (ids.length < 1) {
        currentProjects = [];
        resetCharts();
        if (packageFilterGroup) {
            packageFilterGroup.hidden = true;
        }
        comparisonResults.innerHTML = `
            <div class="empty-state">
                <h3>Select a project</h3>
                <p>Pick at least one project to see metrics and bid mix.</p>
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
    const viewMode = updateMetricMetadata(metricKey);
    const chartProjects = sortProjectsByDate(projects);
    const usesPackageScope = metricConfig.scope === METRIC_SCOPES.PACKAGE;
    updatePackageFilterVisibility(usesPackageScope, chartProjects);
    let chartData;
    if (typeof metricConfig.buildChartData === 'function') {
        chartData = metricConfig.buildChartData(chartProjects);
    } else {
        switch (metricConfig.scope) {
            case METRIC_SCOPES.PACKAGE:
                chartData = buildPackageMetricData(chartProjects, metricConfig, getSelectedPackageKeys());
                break;
            case METRIC_SCOPES.CATEGORY:
                chartData = buildCategoryMetricData(chartProjects, metricConfig);
                break;
            case METRIC_SCOPES.PROJECT:
            default:
                if (viewMode === CHART_VIEW_MODES.MONTH && isMonthlyViewAvailable(metricConfig)) {
                    chartData = buildMonthlyMetricData(chartProjects, metricConfig);
                } else {
                    chartData = buildProjectMetricData(chartProjects, metricConfig);
                }
                break;
        }
    }

    if (comparisonChart) {
        comparisonChart.destroy();
    }

    const ctx = document.getElementById('compareMetricChart');
    if (!ctx) {
        return;
    }

    const parentContainer = ctx.closest('.compare-chart');
    if (parentContainer) {
        const { clientWidth, clientHeight } = parentContainer;
        if (clientWidth > 0) {
            ctx.width = clientWidth;
        }
        if (clientHeight > 0) {
            ctx.height = clientHeight;
        }
    }

    comparisonChart = new Chart(ctx, {
        type: 'bar',
        data: chartData,
        options: buildComparisonChartOptions(metricConfig, viewMode)
    });

    comparisonResults.innerHTML = projects.map(createProjectCard).join('');
    renderProjectPieCharts(projects);
}

function buildProjectMetricData(projects, metricConfig) {
    return {
        labels: projects.map((project) => project.name),
        datasets: [
            {
                label: metricConfig.label,
                data: projects.map((project) => metricConfig.getValue(project.metrics || {}, project)),
                borderRadius: 6,
                backgroundColor: '#3498db'
            }
        ]
    };
}

function sortProjectsByDate(projects) {
    return [...projects].sort((a, b) => {
        const dateA = getProjectDateValue(a);
        const dateB = getProjectDateValue(b);
        if (dateA && dateB) {
            return dateB - dateA;
        }
        if (dateA) {
            return -1;
        }
        if (dateB) {
            return 1;
        }
        return (a.name || '').localeCompare(b.name || '');
    });
}

function buildMonthlyMetricData(projects, metricConfig) {
    const datedProjects = projects
        .map((project) => ({ project, date: getProjectDateValue(project) }))
        .filter((entry) => entry.date);

    if (!datedProjects.length) {
        return buildProjectMetricData(projects, metricConfig);
    }

    const timelineEntries = buildMonthlyTimelineEntries(datedProjects);

    if (typeof metricConfig.buildChartData === 'function') {
        const projectsInTimeline = timelineEntries.filter((entry) => entry.project).map((entry) => entry.project);
        const chartData = metricConfig.buildChartData(projectsInTimeline);
        return expandTimelineDatasets(chartData, timelineEntries, metricConfig);
    }

    const labels = timelineEntries.map((entry) => entry.monthLabel);
    const projectNames = timelineEntries.map((entry) => entry.projectName || '');
    const data = timelineEntries.map((entry) => {
        if (!entry.project) {
            return null;
        }
        const rawValue = metricConfig.getValue(entry.project.metrics || {}, entry.project);
        const numericValue = toFiniteNumber(rawValue);
        return numericValue == null ? null : numericValue;
    });

    return {
        labels,
        datasets: [
            {
                label: metricConfig.label,
                data,
                borderRadius: 6,
                backgroundColor: '#3498db',
                projectNames
            }
        ]
    };
}

function buildMonthlyTimelineEntries(datedProjects) {
    const monthMap = new Map();
    datedProjects.forEach(({ project, date }) => {
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (!monthMap.has(monthKey)) {
            monthMap.set(monthKey, {
                date: new Date(date.getFullYear(), date.getMonth(), 1),
                projects: []
            });
        }
        monthMap.get(monthKey).projects.push({ project, date });
    });

    const monthDates = Array.from(monthMap.values())
        .map((entry) => entry.date)
        .sort((a, b) => b - a);
    const newestMonth = monthDates[0];
    const oldestMonth = monthDates[monthDates.length - 1];

    const timelineEntries = [];
    const cursor = new Date(newestMonth.getFullYear(), newestMonth.getMonth(), 1);
    while (cursor >= oldestMonth) {
        const monthKey = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
        const monthLabel = formatMonthLabel(cursor);
        const monthEntry = monthMap.get(monthKey);
        if (monthEntry && monthEntry.projects.length) {
            monthEntry.projects
                .sort((a, b) => b.date - a.date)
                .forEach((entry) => {
                    const projectName = entry.project.name || 'Untitled project';
                    timelineEntries.push({
                        monthKey,
                        monthLabel,
                        project: entry.project,
                        projectName
                    });
                });
        } else {
            timelineEntries.push({
                monthKey,
                monthLabel,
                project: null,
                projectName: ''
            });
        }
        cursor.setMonth(cursor.getMonth() - 1);
    }
    return timelineEntries;
}

function expandTimelineDatasets(chartData, timelineEntries, metricConfig) {
    if (!chartData?.datasets?.length) {
        return chartData;
    }

    const labels = timelineEntries.map((entry) => entry.monthLabel);
    const projectsInTimeline = timelineEntries.filter((entry) => entry.project);

    const expandedDatasets = chartData.datasets.map((dataset) => {
        const expandedData = [];
        const expandedTotals = dataset.projectTotals ? [] : null;
        const expandedProjectNames = [];
        let timelineIndex = 0;
        timelineEntries.forEach((entry) => {
            if (!entry.project) {
                expandedData.push(null);
                if (expandedTotals) {
                    expandedTotals.push(null);
                }
                expandedProjectNames.push('');
                return;
            }
            const value = dataset.data?.[timelineIndex] ?? null;
            const numericValue = toFiniteNumber(value);
            expandedData.push(numericValue == null ? null : numericValue);
            if (expandedTotals) {
                expandedTotals.push(dataset.projectTotals?.[timelineIndex] ?? null);
            }
            expandedProjectNames.push(entry.projectName || '');
            timelineIndex += 1;
        });

        return {
            ...dataset,
            data: expandedData,
            projectTotals: expandedTotals || dataset.projectTotals,
            projectNames: expandedProjectNames
        };
    });

    return {
        ...chartData,
        labels,
        datasets: expandedDatasets
    };
}

function buildGmpOverlayChartData(projects, targetKey, targetLabel, asPercentage = false) {
    const targetAccessor = {
        median: (totals) => (totals.hasMedian ? totals.medianTotal : null),
        low: (totals) => (totals.hasLow ? totals.lowTotal : null)
    }[targetKey];

    const totalsByProject = projects.map((project) => computeProjectBudgetTotals(project));

    const mapValue = (projectIndex, mapper) => {
        const totals = totalsByProject[projectIndex];
        const targetTotal = targetAccessor ? targetAccessor(totals) : null;
        if (!totals.hasGmp || targetTotal == null) {
            return null;
        }
        if (asPercentage) {
            if (totals.gmpTotal === 0) {
                return null;
            }
            return mapper(totals, targetTotal, targetTotal / totals.gmpTotal);
        }
        return mapper(totals, targetTotal, targetTotal);
    };

    return {
        labels: projects.map((project) => project.name),
        datasets: [
            {
                label: 'GMP total',
                data: projects.map((_, index) =>
                    mapValue(index, (totals, targetTotal, targetRatio) => {
                        if (asPercentage) {
                            return Math.min(1, targetRatio);
                        }
                        return Math.min(totals.gmpTotal, targetTotal);
                    })
                ),
                borderRadius: 6,
                backgroundColor: GMP_BASE_COLOR,
                stack: 'gmpOverlay',
                projectTotals: totalsByProject
            },
            {
                label: `${targetLabel} under GMP`,
                data: projects.map((_, index) =>
                    mapValue(index, (totals, targetTotal, targetRatio) => {
                        const diff = asPercentage ? 1 - targetRatio : totals.gmpTotal - targetTotal;
                        return diff > 0 ? diff : 0;
                    })
                ),
                borderRadius: 6,
                backgroundColor: GMP_SAVINGS_COLOR,
                stack: 'gmpOverlay',
                projectTotals: totalsByProject
            },
            {
                label: `${targetLabel} over GMP`,
                data: projects.map((_, index) =>
                    mapValue(index, (totals, targetTotal, targetRatio) => {
                        const diff = asPercentage ? targetRatio - 1 : targetTotal - totals.gmpTotal;
                        return diff > 0 ? diff : 0;
                    })
                ),
                borderRadius: 6,
                backgroundColor: GMP_OVERAGE_COLOR,
                stack: 'gmpOverlay',
                projectTotals: totalsByProject
            }
        ]
    };
}

function buildGmpOverlayTooltip(context, targetKey, asPercentage = false) {
    if (!context) {
        return null;
    }

    const targetAccessor = {
        median: (totals) => (totals.hasMedian ? totals.medianTotal : null),
        low: (totals) => (totals.hasLow ? totals.lowTotal : null)
    }[targetKey];

    const projectTotals = context.dataset?.projectTotals;
    const totals = Array.isArray(projectTotals) ? projectTotals[context.dataIndex] : null;
    if (!totals || !totals.hasGmp) {
        return null;
    }

    const targetTotal = targetAccessor ? targetAccessor(totals) : null;
    if (targetTotal == null) {
        return null;
    }

    const formatter = asPercentage ? formatPercentage : formatCurrency;
    const gmpValue = asPercentage
        ? totals.gmpTotal === 0
            ? null
            : 1
        : totals.gmpTotal;
    const targetValue = asPercentage
        ? totals.gmpTotal === 0
            ? null
            : targetTotal / totals.gmpTotal
        : targetTotal;
    const deltaValue = asPercentage
        ? totals.gmpTotal === 0
            ? null
            : (targetTotal - totals.gmpTotal) / totals.gmpTotal
        : targetTotal - totals.gmpTotal;

    const targetLabel = targetKey === 'low' ? 'Selected low' : 'Median';
    const lines = [];

    if (gmpValue != null) {
        lines.push(`GMP total: ${formatter(gmpValue)}`);
    }
    if (targetValue != null) {
        lines.push(`${targetLabel} total: ${formatter(targetValue)}`);
    }
    if (deltaValue != null && Number.isFinite(deltaValue)) {
        lines.push(`Delta: ${formatter(deltaValue)}`);
    }

    return lines.length ? lines : null;
}

function buildPackageMetricData(projects, metricConfig, selectedKeys) {
    const packageEntries = collectPackageEntries(projects);
    const filteredEntries = selectedKeys && selectedKeys.size
        ? packageEntries.filter((entry) => selectedKeys.has(entry.key))
        : packageEntries;
    const labels = filteredEntries.map((entry) => entry.label);

    const datasets = projects.map((project, index) => {
        const pkgMap = new Map();
        (project.packages || []).forEach((pkg) => {
            const key = buildPackageKey(pkg);
            if (key) {
                pkgMap.set(key, pkg);
            }
        });
        const normalizedProject = {
            ...project,
            building_sf: toFiniteNumber(project.building_sf)
        };
        return {
            label: project.name,
            borderRadius: 4,
            backgroundColor: getProjectColor(index),
            data: filteredEntries.map((entry) => {
                const pkg = pkgMap.get(entry.key);
                const rawValue = metricConfig.getValue(pkg, normalizedProject);
                const numeric = toFiniteNumber(rawValue);
                return numeric == null ? null : numeric;
            })
        };
    });

    return { labels, datasets };
}

function updatePackageFilterVisibility(isPackageScope, projects) {
    if (!packageFilterGroup) {
        return;
    }
    if (!isPackageScope) {
        packageFilterGroup.hidden = true;
        return;
    }

    const entries = collectPackageEntries(projects || []);
    syncPackageFilterState(entries);
    renderPackageFilterList();
    updatePackageFilterSummary();
    packageFilterGroup.hidden = false;
}

function syncPackageFilterState(entries) {
    packageFilterEntries = entries;
    const nextState = new Map();
    entries.forEach((entry) => {
        const previous = packageFilterState.get(entry.key);
        nextState.set(entry.key, {
            label: entry.label,
            selected: previous ? previous.selected : true
        });
    });
    packageFilterState = nextState;
}

function renderPackageFilterList() {
    if (!packageFilterList) {
        return;
    }
    if (!packageFilterEntries.length) {
        packageFilterList.innerHTML = '<p class="form-hint">No bid packages available for the selected projects.</p>';
        return;
    }
    packageFilterList.innerHTML = packageFilterEntries
        .map((entry) => {
            const state = packageFilterState.get(entry.key);
            const isChecked = state?.selected ? 'checked' : '';
            return `
                <label class="package-filter-item">
                    <input type="checkbox" data-package-key="${escapeHtml(entry.key)}" ${isChecked}>
                    <span>${escapeHtml(entry.label)}</span>
                </label>
            `;
        })
        .join('');
}

function updatePackageFilterSummary() {
    if (!packageFilterSummary) {
        return;
    }
    const total = packageFilterEntries.length;
    const selected = getSelectedPackageKeys().size;
    packageFilterSummary.textContent = `Showing ${selected} of ${total} packages`;
}

function getSelectedPackageKeys() {
    const selectedKeys = new Set();
    packageFilterState.forEach((entry, key) => {
        if (entry.selected) {
            selectedKeys.add(key);
        }
    });
    return selectedKeys;
}

function setAllPackageFilters(isSelected) {
    if (!packageFilterEntries.length) {
        return;
    }
    packageFilterState.forEach((entry) => {
        entry.selected = isSelected;
    });
    renderPackageFilterList();
    updatePackageFilterSummary();
    if (currentProjects.length) {
        renderComparison(currentProjects);
    }
}

function buildCategoryMetricData(projects, metricConfig) {
    const categories = CATEGORY_DEFINITIONS.map((category) => ({ key: category.key, label: category.name }));
    const labels = categories.map((category) => category.label);

    const datasets = projects.map((project, index) => {
        const categoryMap = aggregateCategoriesByProject(project.packages || []);
        const normalizedProject = { ...project, building_sf: toFiniteNumber(project.building_sf) };

        return {
            label: project.name,
            borderRadius: 4,
            backgroundColor: getProjectColor(index),
            data: categories.map((category) => {
                const entry = categoryMap.get(category.key) || null;
                const rawValue = metricConfig.getValue(entry, normalizedProject);
                const numeric = toFiniteNumber(rawValue);
                return numeric == null ? null : numeric;
            })
        };
    });

    return { labels, datasets };
}

function collectPackageEntries(projects) {
    const entryMap = new Map();

    projects.forEach((project) => {
        (project.packages || []).forEach((pkg) => {
            const key = buildPackageKey(pkg);
            if (!key || entryMap.has(key)) {
                return;
            }
            entryMap.set(key, {
                key,
                label: buildPackageLabel(pkg)
            });
        });
    });

    return Array.from(entryMap.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function aggregateCategoriesByProject(packages) {
    const categoryMap = new Map(
        CATEGORY_DEFINITIONS.map((category) => [
            category.key,
            {
                key: category.key,
                label: category.name,
                color: category.color,
                selected_total: 0,
                median_total: 0,
                low_total: 0,
                high_total: 0,
                gmp_total: 0
            }
        ])
    );

    (packages || []).forEach((pkg) => {
        const divisionKey = formatDivisionKey(pkg?.csi_division);
        if (!divisionKey) {
            return;
        }

        const category = findCategoryByDivision(divisionKey);
        if (!category) {
            return;
        }

        const totals = categoryMap.get(category.key);
        if (!totals) {
            return;
        }

        const selectedAmount = toFiniteNumber(pkg.selected_amount) || 0;
        const medianBid = toFiniteNumber(pkg.median_bid);
        const lowBid = toFiniteNumber(pkg.low_bid);
        const highBid = toFiniteNumber(pkg.high_bid);
        const gmpAmount = toFiniteNumber(pkg.gmp_amount);

        totals.selected_total += selectedAmount;
        totals.median_total += medianBid != null ? medianBid : selectedAmount;
        totals.low_total += lowBid != null ? lowBid : selectedAmount;
        totals.high_total += highBid != null ? highBid : selectedAmount;
        totals.gmp_total += gmpAmount != null ? gmpAmount : 0;
    });

    return categoryMap;
}

function findCategoryByDivision(divisionKey) {
    if (!divisionKey) {
        return null;
    }
    return CATEGORY_DEFINITIONS.find((category) => category.divisions.includes(divisionKey)) || null;
}

function buildPackageKey(pkg) {
    if (!pkg) {
        return null;
    }
    const code = (pkg.package_code || '').trim();
    if (code) {
        return code.toUpperCase();
    }
    const name = (pkg.package_name || '').trim();
    if (name) {
        return `NAME:${name.toUpperCase()}`;
    }
    return pkg.id ? `ID:${pkg.id}` : null;
}

function buildPackageLabel(pkg) {
    if (!pkg) {
        return 'Package';
    }
    const code = (pkg.package_code || '').trim();
    const name = (pkg.package_name || '').trim();
    if (code && name) {
        return `${code} – ${name}`;
    }
    return code || name || `Package ${pkg.id}`;
}

function getProjectColor(index) {
    if (!PROJECT_COLORS.length) {
        return '#3498db';
    }
    return PROJECT_COLORS[index % PROJECT_COLORS.length];
}

function buildComparisonChartOptions(metricConfig, viewMode = CHART_VIEW_MODES.PROJECT) {
    const scope = metricConfig.scope || METRIC_SCOPES.PROJECT;
    const isMultiEntryScope = scope === METRIC_SCOPES.PACKAGE || scope === METRIC_SCOPES.CATEGORY;
    const xAxisConfig = (() => {
        if (isMultiEntryScope) {
            return { ticks: { autoSkip: false, maxRotation: 60, minRotation: 40 } };
        }
        if (viewMode === CHART_VIEW_MODES.MONTH) {
            return { ticks: { autoSkip: false, maxRotation: 60, minRotation: 40 } };
        }
        return { ticks: { autoSkip: true } };
    })();
    const stacked = metricConfig.stacked === true;
    return {
        responsive: true,
        maintainAspectRatio: false,
        interaction: isMultiEntryScope ? { intersect: false, mode: 'index' } : { intersect: true, mode: 'nearest' },
        plugins: {
            tooltip: {
                callbacks: {
                    label: (context) => {
                        if (typeof metricConfig.tooltipFormatter === 'function') {
                            const custom = metricConfig.tooltipFormatter(context, metricConfig);
                            if (custom) {
                                return custom;
                            }
                        }

                        const value = getNumericValueFromContext(context);
                        const formatted = metricConfig.format(value);
                        const multipleDatasets = (context.chart?.data?.datasets?.length || 0) > 1;
                        if (isMultiEntryScope || multipleDatasets) {
                            const datasetLabel = context.dataset?.label ? `${context.dataset.label}: ` : '';
                            return `${datasetLabel}${formatted}`;
                        }
                        return formatted;
                    }
                }
            },
            datalabels: {
                display: (context) => {
                    if (viewMode !== CHART_VIEW_MODES.MONTH || isMultiEntryScope) {
                        return false;
                    }
                    return context.datasetIndex === 0;
                },
                formatter: (_value, context) => {
                    const projectNames = context.dataset?.projectNames;
                    if (!projectNames) {
                        return '';
                    }
                    return projectNames[context.dataIndex] || '';
                },
                anchor: 'end',
                align: 'end',
                rotation: -90,
                clamp: true,
                offset: 6
            }
        },
        scales: {
            y: {
                ticks: {
                    callback: (value) => metricConfig.format(value)
                },
                beginAtZero: true,
                stacked
            },
            x: stacked ? { ...xAxisConfig, stacked: true } : xAxisConfig
        }
    };
}

function getNumericValueFromContext(context) {
    if (!context) {
        return null;
    }
    const parsedValue = context.parsed;
    if (typeof parsedValue === 'number') {
        return Number.isFinite(parsedValue) ? parsedValue : null;
    }
    if (parsedValue && typeof parsedValue.y === 'number') {
        return Number.isFinite(parsedValue.y) ? parsedValue.y : null;
    }
    return null;
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

function formatPercentage(value) {
    if (!Number.isFinite(value)) {
        return '—';
    }
    return `${(value * 100).toFixed(1)}%`;
}

function formatInteger(value) {
    return formatNumber(value);
}

function formatAverage(value) {
    if (!Number.isFinite(value)) {
        return '—';
    }
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

function formatNumber(value) {
    if (!Number.isFinite(value)) {
        return '—';
    }
    return new Intl.NumberFormat().format(value);
}

function getProjectDateValue(project) {
    if (!project?.project_date) {
        return null;
    }
    const date = new Date(project.project_date);
    if (Number.isNaN(date.getTime())) {
        return null;
    }
    return date;
}

function formatMonthLabel(date) {
    return date.toLocaleString(undefined, { month: 'short', year: 'numeric' });
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
