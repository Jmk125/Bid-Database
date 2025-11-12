const API_BASE = '/api';

// Modal handling
const modal = document.getElementById('addProjectModal');
const addBtn = document.getElementById('addProjectBtn');
const closeBtn = document.querySelector('.close');
const cancelBtn = document.getElementById('cancelAddProject');

if (addBtn) {
    addBtn.onclick = () => modal.style.display = 'block';
}

if (closeBtn) {
    closeBtn.onclick = () => modal.style.display = 'none';
}

if (cancelBtn) {
    cancelBtn.onclick = () => modal.style.display = 'none';
}

window.onclick = (event) => {
    if (event.target == modal) {
        modal.style.display = 'none';
    }
};

// Load projects
async function loadProjects(sortBy = 'date-desc') {
    const container = document.getElementById('projectsList');
    container.innerHTML = '<div class="loading">Loading projects...</div>';
    
    try {
        const response = await fetch(`${API_BASE}/projects`);
        let projects = await response.json();
        
        if (projects.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <h3>No projects yet</h3>
                    <p>Click "Add Project" to get started</p>
                </div>
            `;
            return;
        }
        
        // Fetch detailed data for each project to calculate median cost/SF
        const projectsWithDetails = await Promise.all(
            projects.map(async (project) => {
                try {
                    const detailResponse = await fetch(`${API_BASE}/projects/${project.id}`);
                    const details = await detailResponse.json();

                    // Calculate median cost total
                    const medianTotal = (details.packages || []).reduce((sum, pkg) =>
                        sum + (pkg.median_bid || pkg.selected_amount || 0), 0);
                    const medianCostPerSF = details.building_sf ? medianTotal / details.building_sf : null;

                    const estimatedPackageCount = (details.packages || []).filter(pkg => pkg.status === 'estimated').length;

                    return {
                        ...project,
                        medianCostPerSF,
                        validation: details.validation || null,
                        estimatedPackageCount
                    };
                } catch (error) {
                    return { ...project, medianCostPerSF: null, validation: null, estimatedPackageCount: 0 };
                }
            })
        );
        
        // Sort projects
        projectsWithDetails.sort((a, b) => {
            switch(sortBy) {
                case 'date-desc':
                    if (!a.project_date) return 1;
                    if (!b.project_date) return -1;
                    return new Date(b.project_date) - new Date(a.project_date);
                case 'date-asc':
                    if (!a.project_date) return 1;
                    if (!b.project_date) return -1;
                    return new Date(a.project_date) - new Date(b.project_date);
                case 'sf-desc':
                    return (b.building_sf || 0) - (a.building_sf || 0);
                case 'sf-asc':
                    return (a.building_sf || 0) - (b.building_sf || 0);
                case 'name':
                    return a.name.localeCompare(b.name);
                default:
                    return 0;
            }
        });
        
        container.innerHTML = projectsWithDetails.map(project => {
            const validationIndicator = getProjectValidationIndicator(project.validation);
            const estimatedIndicator = project.medianCostPerSF && project.estimatedPackageCount > 0
                ? `<span class="estimate-indicator" title="Includes ${project.estimatedPackageCount} estimated package${project.estimatedPackageCount === 1 ? '' : 's'}">
                        <span class="symbol">!</span>
                        <span>${project.estimatedPackageCount} est.</span>
                   </span>`
                : '';
            return `
            <div class="project-card" onclick="viewProject(${project.id})">
                <div class="project-card-header">
                    <h3>${escapeHtml(project.name)}</h3>
                    ${validationIndicator}
                </div>
                <div class="meta">
                    ${project.building_sf ? `<div>📐 ${formatNumber(project.building_sf)} SF</div>` : ''}
                    ${project.project_date ? `<div>📅 ${formatDate(project.project_date)}</div>` : ''}
                    <div>🕒 Created ${formatDate(project.created_at)}</div>
                    ${project.medianCostPerSF ? `<div style="margin-top: 0.5rem; display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
                        <strong style="font-size: 1.1rem; color: #2c3e50;">${formatCurrency(project.medianCostPerSF)}/SF</strong>
                        <span style="color: #7f8c8d; font-size: 0.875rem;">(median)</span>
                        ${estimatedIndicator}
                    </div>` : ''}
                </div>
                <div class="actions" onclick="event.stopPropagation()">
                    <button class="btn btn-tiny btn-danger" onclick="deleteProject(${project.id}, '${escapeHtml(project.name)}')">Delete</button>
                </div>
            </div>
        `;
        }).join('');
    } catch (error) {
        console.error('Error loading projects:', error);
        container.innerHTML = '<div class="empty-state"><h3>Error loading projects</h3></div>';
    }
}

// Add sort event listener
const sortSelector = document.getElementById('sortProjects');
if (sortSelector) {
    sortSelector.addEventListener('change', (e) => {
        loadProjects(e.target.value);
    });
}

// Add project form
const addProjectForm = document.getElementById('addProjectForm');
if (addProjectForm) {
    addProjectForm.onsubmit = async (e) => {
        e.preventDefault();
        
        const name = document.getElementById('projectName').value;
        const building_sf = document.getElementById('buildingSF').value;
        const project_date = document.getElementById('projectDate').value;
        
        try {
            const response = await fetch(`${API_BASE}/projects`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    building_sf: building_sf ? parseFloat(building_sf) : null,
                    project_date: project_date || null
                })
            });
            
            const project = await response.json();
            
            modal.style.display = 'none';
            addProjectForm.reset();
            
            // Redirect to project detail page
            window.location.href = `project.html?id=${project.id}`;
        } catch (error) {
            console.error('Error creating project:', error);
            alert('Error creating project');
        }
    };
}

// Delete project
async function deleteProject(id, name) {
    if (!confirm(`Are you sure you want to delete "${name}"? This will delete all associated bid data.`)) {
        return;
    }
    
    try {
        await fetch(`${API_BASE}/projects/${id}`, {
            method: 'DELETE'
        });
        
        loadProjects();
    } catch (error) {
        console.error('Error deleting project:', error);
        alert('Error deleting project');
    }
}

// View project
function viewProject(id) {
    window.location.href = `project.html?id=${id}`;
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

function getProjectValidationIndicator(validation) {
    const hasLatest = validation && validation.latest;
    const isValid = Boolean(validation && validation.is_valid && hasLatest);
    const statusClass = isValid ? 'is-valid' : 'needs-validation';
    const icon = isValid ? '✔️' : '⚠️';
    const initialsRaw = hasLatest ? (validation.latest.validator_initials || '') : 'Review';
    const validatedAt = hasLatest && validation.latest.created_at ? new Date(validation.latest.created_at) : null;

    let titleText = 'Not yet validated';
    if (isValid) {
        titleText = `Validated by ${initialsRaw}${validatedAt ? ` on ${validatedAt.toLocaleDateString()}` : ''}`;
    } else if (hasLatest) {
        titleText = `Last validated by ${initialsRaw}${validatedAt ? ` on ${validatedAt.toLocaleDateString()}` : ''}. Needs review.`;
    }

    return `
        <span class="project-validation-indicator ${statusClass}" title="${escapeHtml(titleText)}">
            <span>${icon}</span>
            <span class="initials">${escapeHtml(initialsRaw)}</span>
        </span>
    `;
}

// Load data on page load
if (document.getElementById('projectsList')) {
    loadProjects();
}
