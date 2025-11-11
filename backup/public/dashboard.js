const API_BASE = '/api';

// Load all dashboard data
async function loadDashboard() {
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
        const projectsResponse = await fetch(`${API_BASE}/projects`);
        const projects = await projectsResponse.json();
        
        // Get all bidders
        const biddersResponse = await fetch(`${API_BASE}/bidders`);
        const bidders = await biddersResponse.json();
        
        // Calculate totals
        let totalPackages = 0;
        let totalBids = 0;
        
        for (const project of projects) {
            const projectResponse = await fetch(`${API_BASE}/projects/${project.id}`);
            const projectData = await projectResponse.json();
            totalPackages += projectData.packages?.length || 0;
            
            // Count bids for each package
            for (const pkg of projectData.packages || []) {
                if (pkg.status !== 'estimated') {
                    const bidsResponse = await fetch(`${API_BASE}/packages/${pkg.id}/bids`);
                    const bids = await bidsResponse.json();
                    totalBids += bids.length;
                }
            }
        }
        
        document.getElementById('totalProjects').textContent = projects.length;
        document.getElementById('totalPackages').textContent = totalPackages;
        document.getElementById('totalBidders').textContent = bidders.length;
        document.getElementById('totalBids').textContent = totalBids;
    } catch (error) {
        console.error('Error loading summary metrics:', error);
    }
}

// Load division metrics
async function loadDivisionMetrics() {
    const tbody = document.getElementById('divisionsBody');
    
    try {
        const response = await fetch(`${API_BASE}/aggregate/divisions`);
        const divisions = await response.json();
        
        if (divisions.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No division data available</td></tr>';
            return;
        }
        
        // Sort by CSI division number
        divisions.sort((a, b) => {
            const aNum = parseInt(a.csi_division);
            const bNum = parseInt(b.csi_division);
            return aNum - bNum;
        });
        
        tbody.innerHTML = divisions.map(div => `
            <tr>
                <td><strong>${escapeHtml(div.csi_division)}</strong></td>
                <td>${div.package_count}</td>
                <td>${div.median_cost_per_sf ? formatCurrency(div.median_cost_per_sf) : '—'}</td>
                <td>${div.avg_cost_per_sf ? formatCurrency(div.avg_cost_per_sf) : '—'}</td>
                <td>${div.min_cost_per_sf ? formatCurrency(div.min_cost_per_sf) : '—'}</td>
                <td>${div.max_cost_per_sf ? formatCurrency(div.max_cost_per_sf) : '—'}</td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error loading division metrics:', error);
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Error loading division data</td></tr>';
    }
}

// Load bidder metrics
async function loadBidderMetrics() {
    const tbody = document.getElementById('biddersBody');
    
    try {
        const response = await fetch(`${API_BASE}/aggregate/bidders`);
        let bidders = await response.json();
        
        if (bidders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No bidder data available</td></tr>';
            return;
        }
        
        // Sort by bid count (most active first)
        bidders.sort((a, b) => b.bid_count - a.bid_count);
        
        // Show top 20
        bidders = bidders.slice(0, 20);
        
        tbody.innerHTML = bidders.map(bidder => `
            <tr>
                <td><strong>${escapeHtml(bidder.bidder_name)}</strong></td>
                <td>${bidder.bid_count}</td>
                <td>${bidder.wins}</td>
                <td>${bidder.win_rate}%</td>
                <td>${bidder.avg_bid_amount ? formatCurrency(bidder.avg_bid_amount) : '—'}</td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error loading bidder metrics:', error);
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Error loading bidder data</td></tr>';
    }
}

// Load projects overview
async function loadProjectsOverview() {
    const tbody = document.getElementById('projectsBody');
    
    try {
        const response = await fetch(`${API_BASE}/projects`);
        const projects = await response.json();
        
        if (projects.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No projects available</td></tr>';
            return;
        }
        
        // Get detailed info for each project
        const projectDetails = await Promise.all(
            projects.map(async (project) => {
                const detailResponse = await fetch(`${API_BASE}/projects/${project.id}`);
                return await detailResponse.json();
            })
        );
        
        // Sort by date (most recent first)
        projectDetails.sort((a, b) => {
            if (!a.project_date) return 1;
            if (!b.project_date) return -1;
            return new Date(b.project_date) - new Date(a.project_date);
        });
        
        tbody.innerHTML = projectDetails.map(project => {
            const totalCost = (project.packages || []).reduce((sum, pkg) => sum + (pkg.selected_amount || 0), 0);
            const costPerSF = project.building_sf ? totalCost / project.building_sf : 0;
            const packageCount = project.packages?.length || 0;
            
            return `
                <tr onclick="window.location.href='project.html?id=${project.id}'" style="cursor: pointer;">
                    <td><strong>${escapeHtml(project.name)}</strong></td>
                    <td>${project.building_sf ? formatNumber(project.building_sf) : '—'}</td>
                    <td>${formatCurrency(totalCost)}</td>
                    <td>${project.building_sf ? formatCurrency(costPerSF) : '—'}</td>
                    <td>${packageCount}</td>
                    <td>${project.project_date ? formatDate(project.project_date) : '—'}</td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading projects overview:', error);
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Error loading projects</td></tr>';
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

// Load dashboard on page load
loadDashboard();
