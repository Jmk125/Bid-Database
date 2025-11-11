const API_BASE = '/api';

// Get project ID from URL
const urlParams = new URLSearchParams(window.location.search);
const projectId = urlParams.get('id');

if (!projectId) {
    window.location.href = 'index.html';
}

let currentProject = null;

// Load project data
async function loadProject() {
    try {
        const response = await fetch(`${API_BASE}/projects/${projectId}`);
        currentProject = await response.json();
        
        // Update page title
        document.getElementById('projectName').textContent = currentProject.name;
        document.title = `${currentProject.name} - Bid Database`;
        
        // Display metrics
        displayMetrics();
        
        // Display packages
        displayPackages();
    } catch (error) {
        console.error('Error loading project:', error);
        alert('Error loading project');
    }
}

function displayMetrics() {
    const container = document.getElementById('projectMetrics');
    
    const packages = currentProject.packages || [];
    const totalCost = packages.reduce((sum, pkg) => sum + (pkg.selected_amount || 0), 0);
    const totalLowBid = packages.reduce((sum, pkg) => sum + (pkg.low_bid || pkg.selected_amount || 0), 0);
    const totalMedianBid = packages.reduce((sum, pkg) => sum + (pkg.median_bid || pkg.selected_amount || 0), 0);
    
    const avgCostPerSF = currentProject.building_sf ? totalCost / currentProject.building_sf : 0;
    const lowBidCostPerSF = currentProject.building_sf ? totalLowBid / currentProject.building_sf : 0;
    const medianBidCostPerSF = currentProject.building_sf ? totalMedianBid / currentProject.building_sf : 0;
    
    const bidCount = packages.filter(p => p.status !== 'estimated').length;
    const estimatedCount = packages.filter(p => p.status === 'estimated').length;
    
    // Helper function to add responsive class based on value length
    const getValueClass = (value) => {
        const str = String(value);
        if (str.length > 15) return 'very-long-value';
        if (str.length > 12) return 'long-value';
        return '';
    };
    
    container.innerHTML = `
        <div class="metric-card">
            <h4>Building Size</h4>
            <div class="value">${currentProject.building_sf ? formatNumber(currentProject.building_sf) : 'N/A'} <span style="font-size: 1rem;">SF</span></div>
        </div>
        <div class="metric-card">
            <h4>Selected Cost/SF</h4>
            <div class="value">${currentProject.building_sf ? formatCurrency(avgCostPerSF) : 'N/A'}</div>
            <div style="font-size: 0.875rem; margin-top: 0.5rem; color: #7f8c8d;">
                Total: ${formatCurrency(totalCost)}
            </div>
        </div>
        <div class="metric-card">
            <h4>Low Bid Cost/SF</h4>
            <div class="value">${currentProject.building_sf ? formatCurrency(lowBidCostPerSF) : 'N/A'}</div>
            <div style="font-size: 0.875rem; margin-top: 0.5rem; color: #7f8c8d;">
                Total: ${formatCurrency(totalLowBid)}
            </div>
        </div>
        <div class="metric-card">
            <h4>Median Bid Cost/SF</h4>
            <div class="value">${currentProject.building_sf ? formatCurrency(medianBidCostPerSF) : 'N/A'}</div>
            <div style="font-size: 0.875rem; margin-top: 0.5rem; color: #7f8c8d;">
                Total: ${formatCurrency(totalMedianBid)}
            </div>
        </div>
        <div class="metric-card">
            <h4>Packages</h4>
            <div class="value">${packages.length}</div>
            <div style="font-size: 0.875rem; margin-top: 0.5rem; color: #7f8c8d;">
                ${bidCount} bid, ${estimatedCount} estimated
            </div>
        </div>
        ${currentProject.project_date ? `
        <div class="metric-card">
            <h4>Project Bid Date</h4>
            <div class="value" style="font-size: 1.5rem;">${formatDate(currentProject.project_date)}</div>
        </div>
        ` : ''}
    `;
    
    // Display category breakdown
    displayCategoryBreakdown();
    
    // Display charts
    displayCharts();
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
loadProject();
