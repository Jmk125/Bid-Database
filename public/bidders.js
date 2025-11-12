const API_BASE = '/api';

let allBidders = [];
let selectedBidders = new Set();

// Load all bidders
async function loadBidders() {
    try {
        // Show loading message
        document.getElementById('biddersBody').innerHTML =
            '<tr><td colspan="6" class="loading">Loading bidders and packages (this may take a moment)...</td></tr>';

        const response = await fetch(`${API_BASE}/bidders`);
        const bidders = await response.json();

        allBidders = bidders.map(bidder => ({
            ...bidder,
            aliases: Array.isArray(bidder.aliases) ? bidder.aliases : [],
            packages: Array.isArray(bidder.packages) ? bidder.packages : []
        }));

        // NOW display the bidders after everything is loaded
        displayBidders();
    } catch (error) {
        console.error('Error loading bidders:', error);
        document.getElementById('biddersBody').innerHTML =
            '<tr><td colspan="6" class="empty-state">Error loading bidders</td></tr>';
    }
}

// Display bidders in table
function displayBidders(filter = '', packageFilter = '') {
    const tbody = document.getElementById('biddersBody');
    
    // Check if allBidders is populated
    if (!allBidders || allBidders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="loading">Loading bidders...</td></tr>';
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
    
    if (filteredBidders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No bidders found</td></tr>';
        return;
    }
    
    // Sort by name
    filteredBidders.sort((a, b) => a.canonical_name.localeCompare(b.canonical_name));
    
    tbody.innerHTML = filteredBidders.map(bidder => `
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
    tbody.innerHTML = '<tr><td colspan="5" class="loading">Loading bid history...</td></tr>';
    
    try {
        const response = await fetch(`${API_BASE}/bidders/${bidderId}/history`);
        const bidHistory = await response.json();

        if (!bidHistory || bidHistory.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No bids found for this bidder</td></tr>';
            return;
        }

        tbody.innerHTML = bidHistory.map(bid => `
            <tr>
                <td>${escapeHtml(bid.project_name)}</td>
                <td>${bid.project_date ? formatDate(bid.project_date) : '—'}</td>
                <td><strong>${escapeHtml(bid.package_code)}</strong> ${escapeHtml(bid.package_name)}</td>
                <td>
                    <div class="amount-with-sf">
                        <div class="amount">${formatCurrency(bid.bid_amount)}</div>
                        ${bid.cost_per_sf !== null ? `<div class="sf-cost">${formatCurrency(bid.cost_per_sf)}/SF</div>` : ''}
                    </div>
                </td>
                <td>
                    ${bid.was_selected
                        ? '<span class="status-badge status-bid">Selected</span>'
                        : '<span class="status-badge status-estimated">Not Selected</span>'}
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error loading bidder detail:', error);
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Error loading bid history</td></tr>';
    }
}

function closeBidderDetail() {
    document.getElementById('bidderDetail').style.display = 'none';
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

// Initialize page - attach event listeners AFTER DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    // Add package filter event listener
    document.getElementById('filterPackages').addEventListener('input', (e) => {
        const bidderFilter = document.getElementById('searchBidders').value;
        displayBidders(bidderFilter, e.target.value);
    });

    // Search functionality  
    document.getElementById('searchBidders').addEventListener('input', (e) => {
        const packageFilter = document.getElementById('filterPackages').value;
        displayBidders(e.target.value, packageFilter);
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
                
                await fetch(`${API_BASE}/bidders/merge`, {
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
});
