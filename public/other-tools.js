const API_BASE = '/api';

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

const designBudgetInput = document.getElementById('designBudgetInput');
const buildingSfInput = document.getElementById('buildingSfInput');
const singleProjectSelect = document.getElementById('singleProjectSelect');
const multiProjectSelect = document.getElementById('multiProjectSelect');
const singleProjectGroup = document.getElementById('singleProjectGroup');
const multiProjectGroup = document.getElementById('multiProjectGroup');
const generateBreakdownBtn = document.getElementById('generateBreakdownBtn');
const breakdownStatus = document.getElementById('breakdownStatus');
const breakdownMetrics = document.getElementById('breakdownMetrics');
const breakdownOutput = document.getElementById('breakdownOutput');
const divisionBreakdownBody = document.getElementById('divisionBreakdownBody');
const divisionTotalPercent = document.getElementById('divisionTotalPercent');
const divisionTotalAmount = document.getElementById('divisionTotalAmount');
const divisionTotalCostPerSf = document.getElementById('divisionTotalCostPerSf');
const categoryBreakdownBody = document.getElementById('categoryBreakdownBody');
const totalBudgetMetric = document.getElementById('totalBudgetMetric');
const costPerSfMetric = document.getElementById('costPerSfMetric');
const breakdownSourceMetric = document.getElementById('breakdownSourceMetric');

let currentDivisionEntries = [];
let currentBudget = 0;
let currentBuildingSf = 0;
let currentSourceLabel = '';
let categoryChart = null;

function formatCurrency(value) {
    if (!Number.isFinite(value)) {
        return '—';
    }
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0
    }).format(value);
}

function formatCurrencyWithCents(value) {
    if (!Number.isFinite(value)) {
        return '—';
    }
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
}

function formatPercentage(value) {
    if (!Number.isFinite(value)) {
        return '—';
    }
    return `${value.toFixed(1)}%`;
}

function formatPercentInput(value) {
    if (!Number.isFinite(value)) {
        return '';
    }
    return `${value.toFixed(1)}%`;
}

function formatAmountInput(value) {
    if (!Number.isFinite(value)) {
        return '';
    }
    return formatCurrencyWithCents(value);
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

function findCategoryByDivision(divisionKey) {
    if (!divisionKey) {
        return null;
    }
    return CATEGORY_DEFINITIONS.find((category) => category.divisions.includes(divisionKey)) || null;
}

function updateModeVisibility() {
    const selectedMode = document.querySelector('input[name="breakdownMode"]:checked')?.value || 'single';
    const isSingle = selectedMode === 'single';
    singleProjectGroup.hidden = !isSingle;
    multiProjectGroup.hidden = isSingle;
}

async function loadProjects() {
    try {
        breakdownStatus.textContent = 'Loading projects...';
        const response = await apiFetch(`${API_BASE}/projects`);
        const projects = await response.json();
        if (!projects.length) {
            singleProjectSelect.innerHTML = '<option value="">No projects found</option>';
            multiProjectSelect.innerHTML = '<option value="">No projects found</option>';
            breakdownStatus.textContent = 'Add projects to enable the breakdown tool.';
            return;
        }

        const optionsHtml = projects
            .map((project) => `<option value="${project.id}">${escapeHtml(project.name)}</option>`)
            .join('');

        singleProjectSelect.innerHTML = `<option value="">Select a project</option>${optionsHtml}`;
        multiProjectSelect.innerHTML = optionsHtml;
        breakdownStatus.textContent = 'Select a project to begin.';
    } catch (error) {
        console.error('Failed to load projects', error);
        singleProjectSelect.innerHTML = '<option value="">Error loading projects</option>';
        multiProjectSelect.innerHTML = '<option value="">Error loading projects</option>';
        breakdownStatus.textContent = 'Unable to load projects right now.';
    }
}

function escapeHtml(value) {
    if (value == null) {
        return '';
    }
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getPackageValue(pkg) {
    const selected = toFiniteNumber(pkg?.selected_amount);
    if (selected != null) {
        return selected;
    }
    const median = toFiniteNumber(pkg?.median_bid);
    if (median != null) {
        return median;
    }
    const low = toFiniteNumber(pkg?.low_bid);
    if (low != null) {
        return low;
    }
    return 0;
}

function getProjectDivisionTotals(project) {
    const totals = new Map();
    let totalAmount = 0;
    (project.packages || []).forEach((pkg) => {
        const amount = getPackageValue(pkg);
        if (!Number.isFinite(amount) || amount <= 0) {
            return;
        }
        totalAmount += amount;
        const division = formatDivisionKey(pkg.csi_division) || 'other';
        totals.set(division, (totals.get(division) || 0) + amount);
    });
    return { totals, totalAmount };
}

function buildDivisionEntries(divisionPercentages) {
    const entries = Object.entries(divisionPercentages).map(([division, percent]) => {
        const safePercent = Number.isFinite(percent) ? percent : 0;
        const amount = currentBudget * (safePercent / 100);
        return {
            division,
            label: division === 'other' ? 'Other' : `Div ${division}`,
            percent: safePercent,
            amount,
            color: DIVISION_COLORS[division] || '#95a5a6'
        };
    });

    entries.sort((a, b) => {
        if (a.division === 'other') return 1;
        if (b.division === 'other') return -1;
        const aVal = Number(a.division);
        const bVal = Number(b.division);
        if (Number.isFinite(aVal) && Number.isFinite(bVal)) {
            return aVal - bVal;
        }
        return a.division.localeCompare(b.division);
    });
    return entries;
}

function buildAverageDivisionPercentages(projects) {
    const totalsByProject = projects.map((project) => getProjectDivisionTotals(project));
    const validProjects = totalsByProject.filter((entry) => entry.totalAmount > 0);
    if (!validProjects.length) {
        return null;
    }

    const allDivisions = new Set();
    validProjects.forEach((entry) => {
        entry.totals.forEach((_, division) => allDivisions.add(division));
    });

    const averages = {};
    allDivisions.forEach((division) => {
        let percentSum = 0;
        validProjects.forEach((entry) => {
            const divisionTotal = entry.totals.get(division) || 0;
            percentSum += entry.totalAmount > 0 ? (divisionTotal / entry.totalAmount) * 100 : 0;
        });
        averages[division] = percentSum / validProjects.length;
    });

    return averages;
}

function buildSingleDivisionPercentages(project) {
    const { totals, totalAmount } = getProjectDivisionTotals(project);
    if (!totalAmount) {
        return null;
    }
    const percentages = {};
    totals.forEach((amount, division) => {
        percentages[division] = (amount / totalAmount) * 100;
    });
    return percentages;
}

function buildCategoryEntries(divisionEntries) {
    const categoryMap = new Map(
        CATEGORY_DEFINITIONS.map((category) => [
            category.key,
            {
                key: category.key,
                label: category.name,
                amount: 0,
                color: category.color
            }
        ])
    );

    const remaining = {
        key: 'other',
        label: 'Other',
        amount: 0,
        color: REMAINING_CATEGORY_COLOR
    };

    divisionEntries.forEach((entry) => {
        const category = entry.division === 'other' ? null : findCategoryByDivision(entry.division);
        const target = category ? categoryMap.get(category.key) : remaining;
        target.amount += entry.amount;
    });

    const entries = [...categoryMap.values(), remaining]
        .map((entry) => {
            const percent = currentBudget > 0 ? (entry.amount / currentBudget) * 100 : 0;
            const costPerSf = currentBuildingSf > 0 ? entry.amount / currentBuildingSf : null;
            return {
                ...entry,
                percent,
                costPerSf
            };
        })
        .filter((entry) => entry.amount > 0);

    return entries;
}

function updateMetrics() {
    breakdownMetrics.hidden = false;
    totalBudgetMetric.textContent = formatCurrency(currentBudget);
    const costPerSf = currentBuildingSf > 0 ? currentBudget / currentBuildingSf : null;
    costPerSfMetric.textContent = costPerSf != null ? formatCurrencyWithCents(costPerSf) : '—';
    breakdownSourceMetric.textContent = currentSourceLabel || '—';
}

function renderDivisionTable() {
    divisionBreakdownBody.innerHTML = currentDivisionEntries
        .map((entry) => {
            const costPerSf = currentBuildingSf > 0 ? entry.amount / currentBuildingSf : null;
            return `
                <tr>
                    <td>
                        <span class="legend-dot" style="background:${entry.color}"></span>
                        ${escapeHtml(entry.label)}
                    </td>
                    <td>
                        <div class="editable-field">
                            <input type="text" class="editable-input percent-input" data-division="${entry.division}" data-field="percent" value="${formatPercentInput(entry.percent)}" readonly>
                            <button type="button" class="btn btn-secondary btn-small edit-field-button" data-division="${entry.division}" data-field="percent">Edit</button>
                        </div>
                    </td>
                    <td>
                        <div class="editable-field">
                            <input type="text" class="editable-input amount-input" data-division="${entry.division}" data-field="amount" value="${formatAmountInput(entry.amount)}" readonly>
                            <button type="button" class="btn btn-secondary btn-small edit-field-button" data-division="${entry.division}" data-field="amount">Edit</button>
                        </div>
                    </td>
                    <td class="cost-cell" data-division="${entry.division}">${costPerSf != null ? formatCurrencyWithCents(costPerSf) : '—'}</td>
                </tr>
            `;
        })
        .join('');
}

function updateDivisionTotals() {
    const totalPercent = currentDivisionEntries.reduce((sum, entry) => sum + entry.percent, 0);
    const totalAmount = currentDivisionEntries.reduce((sum, entry) => sum + entry.amount, 0);
    divisionTotalPercent.textContent = formatPercentage(totalPercent);
    divisionTotalAmount.textContent = formatCurrencyWithCents(totalAmount);
    divisionTotalCostPerSf.textContent =
        currentBuildingSf > 0 ? formatCurrencyWithCents(totalAmount / currentBuildingSf) : '—';
}

function renderCategoryTable(categoryEntries) {
    if (!categoryEntries.length) {
        categoryBreakdownBody.innerHTML = '<tr><td colspan="4">No category totals yet.</td></tr>';
        return;
    }

    categoryBreakdownBody.innerHTML = categoryEntries
        .map((entry) => `
            <tr>
                <td>
                    <span class="legend-dot" style="background:${entry.color}"></span>
                    ${escapeHtml(entry.label)}
                </td>
                <td>${formatPercentage(entry.percent)}</td>
                <td>${formatCurrencyWithCents(entry.amount)}</td>
                <td>${entry.costPerSf != null ? formatCurrencyWithCents(entry.costPerSf) : '—'}</td>
            </tr>
        `)
        .join('');
}

function updateCategoryChart(categoryEntries) {
    const ctx = document.getElementById('categoryBreakdownChart');
    if (!ctx) {
        return;
    }

    const labels = categoryEntries.map((entry) => entry.label);
    const data = categoryEntries.map((entry) => entry.amount);
    const colors = categoryEntries.map((entry) => entry.color);

    if (categoryChart) {
        categoryChart.data.labels = labels;
        categoryChart.data.datasets[0].data = data;
        categoryChart.data.datasets[0].backgroundColor = colors;
        categoryChart.update();
        return;
    }

    categoryChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels,
            datasets: [
                {
                    data,
                    backgroundColor: colors
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
                        label: (context) => {
                            const value = context.parsed || 0;
                            const total = data.reduce((sum, entry) => sum + entry, 0);
                            const percent = total > 0 ? (value / total) * 100 : 0;
                            return `${context.label}: ${formatCurrency(value)} (${percent.toFixed(1)}%)`;
                        }
                    }
                }
            }
        }
    });
}

function updateOutputs() {
    if (!currentDivisionEntries.length) {
        breakdownOutput.hidden = true;
        return;
    }
    breakdownOutput.hidden = false;
    renderDivisionTable();
    updateMetricsAndCategories();
}

function updateMetricsAndCategories() {
    updateMetrics();
    updateDivisionTotals();
    const categoryEntries = buildCategoryEntries(currentDivisionEntries);
    renderCategoryTable(categoryEntries);
    updateCategoryChart(categoryEntries);
}

async function generateBreakdown() {
    const budgetValue = toFiniteNumber(designBudgetInput.value);
    currentBudget = budgetValue != null ? budgetValue : 0;
    currentBuildingSf = toFiniteNumber(buildingSfInput.value) || 0;

    if (!currentBudget || currentBudget <= 0) {
        breakdownStatus.textContent = 'Enter a design budget to generate a breakdown.';
        breakdownMetrics.hidden = true;
        breakdownOutput.hidden = true;
        return;
    }

    const selectedMode = document.querySelector('input[name="breakdownMode"]:checked')?.value || 'single';
    const isSingle = selectedMode === 'single';
    const ids = isSingle
        ? [singleProjectSelect.value].filter(Boolean)
        : Array.from(multiProjectSelect.selectedOptions).map((option) => option.value);

    if (!ids.length) {
        breakdownStatus.textContent = 'Select at least one project to build the breakdown.';
        breakdownMetrics.hidden = true;
        breakdownOutput.hidden = true;
        return;
    }

    breakdownStatus.textContent = 'Calculating breakdown...';

    try {
        const response = await apiFetch(`${API_BASE}/projects/compare?ids=${ids.join(',')}`);
        const projects = await response.json();
        if (!projects.length) {
            breakdownStatus.textContent = 'No project data returned.';
            breakdownMetrics.hidden = true;
            breakdownOutput.hidden = true;
            return;
        }

        let divisionPercentages = null;
        if (isSingle) {
            divisionPercentages = buildSingleDivisionPercentages(projects[0]);
            currentSourceLabel = projects[0]?.name || 'Single project';
        } else {
            divisionPercentages = buildAverageDivisionPercentages(projects);
            currentSourceLabel = `Average of ${projects.length} projects`;
        }

        if (!divisionPercentages) {
            breakdownStatus.textContent = 'Selected projects do not have bid data to build a breakdown.';
            breakdownMetrics.hidden = true;
            breakdownOutput.hidden = true;
            return;
        }

        currentDivisionEntries = buildDivisionEntries(divisionPercentages);
        updateOutputs();
        breakdownStatus.textContent = 'Breakdown ready. Adjust any values as needed.';
    } catch (error) {
        console.error('Failed to build breakdown', error);
        breakdownStatus.textContent = 'Unable to calculate the breakdown right now.';
        breakdownMetrics.hidden = true;
        breakdownOutput.hidden = true;
    }
}

function parseEditableValue(rawValue) {
    if (!rawValue) {
        return null;
    }
    const cleaned = rawValue.replace(/[%$,]/g, '').trim();
    return toFiniteNumber(cleaned);
}

function syncRowValues(row, entry) {
    const percentInput = row.querySelector('.percent-input');
    const amountInput = row.querySelector('.amount-input');
    const costCell = row.querySelector('.cost-cell');
    if (percentInput) {
        percentInput.value = formatPercentInput(entry.percent);
    }
    if (amountInput) {
        amountInput.value = formatAmountInput(entry.amount);
    }
    if (costCell) {
        const costPerSf = currentBuildingSf > 0 ? entry.amount / currentBuildingSf : null;
        costCell.textContent = costPerSf != null ? formatCurrencyWithCents(costPerSf) : '—';
    }
}

divisionBreakdownBody?.addEventListener('click', (event) => {
    const button = event.target.closest('.edit-field-button');
    if (!button) {
        return;
    }
    const division = button.dataset.division;
    const field = button.dataset.field;
    const row = button.closest('tr');
    if (!division || !field || !row) {
        return;
    }
    const entry = currentDivisionEntries.find((item) => item.division === division);
    if (!entry) {
        return;
    }
    const input = row.querySelector(`.editable-input[data-field="${field}"]`);
    if (!input) {
        return;
    }
    input.readOnly = false;
    input.classList.add('is-editing');
    if (field === 'percent') {
        input.value = Number.isFinite(entry?.percent) ? entry.percent.toFixed(1) : input.value;
    } else if (field === 'amount') {
        input.value = Number.isFinite(entry?.amount) ? entry.amount.toFixed(2) : input.value;
    }
    input.focus();
    input.select();
});

divisionBreakdownBody?.addEventListener(
    'blur',
    (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) {
            return;
        }
        if (!target.classList.contains('editable-input')) {
            return;
        }
        const division = target.dataset.division;
        const field = target.dataset.field;
        if (!division || !field) {
            return;
        }
        const entry = currentDivisionEntries.find((item) => item.division === division);
        if (!entry) {
            return;
        }
        const parsedValue = parseEditableValue(target.value);
        if (field === 'percent') {
            entry.percent = parsedValue != null ? Math.max(parsedValue, 0) : 0;
            entry.amount = currentBudget * (entry.percent / 100);
        } else if (field === 'amount') {
            entry.amount = parsedValue != null ? Math.max(parsedValue, 0) : 0;
            entry.percent = currentBudget > 0 ? (entry.amount / currentBudget) * 100 : 0;
        }
        target.readOnly = true;
        target.classList.remove('is-editing');
        const row = target.closest('tr');
        if (row) {
            syncRowValues(row, entry);
        }
        updateMetricsAndCategories();
    },
    true
);

divisionBreakdownBody?.addEventListener('keydown', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
        return;
    }
    if (!target.classList.contains('editable-input')) {
        return;
    }
    if (event.key === 'Enter') {
        event.preventDefault();
        target.blur();
    }
});

document.querySelectorAll('input[name="breakdownMode"]').forEach((input) => {
    input.addEventListener('change', () => {
        updateModeVisibility();
        breakdownStatus.textContent = 'Select projects and generate a breakdown.';
    });
});

generateBreakdownBtn?.addEventListener('click', generateBreakdown);

updateModeVisibility();
loadProjects();
