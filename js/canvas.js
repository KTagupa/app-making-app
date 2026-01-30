/**
 * Infinite Canvas Module
 * Handles canvas rendering, zoom, pan, and drag-and-drop
 */

import {
    findPhase, findFeature, addPhase, addFeature, addSubtask,
    deletePhase, deleteFeature, deleteSubtaskFromProject,
    autoSave, getCurrentProject
} from './storage.js';
import { generateId, throttle, showNotification, confirmDialog, promptDialog, calculateProgress, sanitizeHTML } from './utils.js';

let canvas = null;
let canvasContent = null;
let svgOverlay = null;
let scale = 1;
let translateX = 0;
let translateY = 0;
let isDragging = false;
let isPanning = false;
let startX = 0;
let startY = 0;
let draggedElement = null;
let draggedType = null;
let draggedId = null;

// Zoom constraints
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.1;

// Export for external access
export function getCanvasState() {
    return { zoom_level: scale, pan_x: translateX, pan_y: translateY };
}

export function setCanvasState(state) {
    if (state) {
        scale = state.zoom_level || 1;
        translateX = state.pan_x || 0;
        translateY = state.pan_y || 0;
        applyTransform();
    }
}

// Initialize canvas
export function initCanvas() {
    canvas = document.getElementById('canvas');
    canvasContent = document.getElementById('canvas-content');
    svgOverlay = document.getElementById('dependency-lines');

    if (!canvas || !canvasContent) {
        console.error('Canvas elements not found');
        return;
    }

    setupEventListeners();
    updateZoomDisplay();
}

// Setup event listeners
function setupEventListeners() {
    // Mouse wheel zoom
    canvas.addEventListener('wheel', handleWheel, { passive: false });

    // Mouse pan
    canvas.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    // Touch events for mobile/trackpad
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd);

    // Prevent context menu on canvas for right-click actions
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboard);
}

// Handle mouse wheel (zoom)
function handleWheel(e) {
    e.preventDefault();

    // Check for pinch gesture (Ctrl key is pressed during pinch on trackpad)
    if (e.ctrlKey || e.metaKey) {
        // Pinch zoom
        const delta = -e.deltaY * 0.01;
        zoomAtPoint(e.clientX, e.clientY, delta);
    } else {
        // Regular scroll = pan
        translateX -= e.deltaX;
        translateY -= e.deltaY;
        applyTransform();
        saveCanvasState();
    }
}

// Zoom at specific point (mouse cursor)
function zoomAtPoint(clientX, clientY, delta) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    // Calculate point in content space
    const contentX = (x - translateX) / scale;
    const contentY = (y - translateY) / scale;

    // Apply zoom
    const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale + delta));

    if (newScale !== scale) {
        // Adjust translation to keep point under mouse
        translateX = x - contentX * newScale;
        translateY = y - contentY * newScale;
        scale = newScale;

        applyTransform();
        updateZoomDisplay();
        saveCanvasState();
    }
}

// Handle mouse down
function handleMouseDown(e) {
    if (e.target === canvas || e.target === canvasContent) {
        // Start panning
        isPanning = true;
        startX = e.clientX - translateX;
        startY = e.clientY - translateY;
        canvas.style.cursor = 'grabbing';
        e.preventDefault();
    }
}

// Handle mouse move
function handleMouseMove(e) {
    if (isPanning) {
        translateX = e.clientX - startX;
        translateY = e.clientY - startY;
        applyTransform();
    } else if (isDragging && draggedElement) {
        // Move dragged element
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left - translateX) / scale;
        const y = (e.clientY - rect.top - translateY) / scale;

        draggedElement.style.left = `${x - draggedElement.offsetWidth / 2}px`;
        draggedElement.style.top = `${y - draggedElement.offsetHeight / 2}px`;

        // Highlight drop zones
        highlightDropZones(e.clientX, e.clientY);
    }
}

// Handle mouse up
function handleMouseUp(e) {
    if (isPanning) {
        isPanning = false;
        canvas.style.cursor = 'grab';
        saveCanvasState();
    } else if (isDragging && draggedElement) {
        // Handle drop
        handleDrop(e.clientX, e.clientY);
        isDragging = false;
        draggedElement.classList.remove('dragging');
        draggedElement = null;
        draggedType = null;
        draggedId = null;
        clearDropZones();
    }
}

// Touch handling for mobile/trackpad
let touchStartDistance = 0;
let touchStartScale = 1;
let lastTouchX = 0;
let lastTouchY = 0;

function handleTouchStart(e) {
    if (e.touches.length === 2) {
        // Pinch gesture start
        e.preventDefault();
        touchStartDistance = getTouchDistance(e.touches);
        touchStartScale = scale;
    } else if (e.touches.length === 1 && e.target === canvas) {
        // Pan start
        lastTouchX = e.touches[0].clientX;
        lastTouchY = e.touches[0].clientY;
    }
}

function handleTouchMove(e) {
    if (e.touches.length === 2) {
        // Pinch zoom
        e.preventDefault();
        const distance = getTouchDistance(e.touches);
        const scaleChange = distance / touchStartDistance;
        const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, touchStartScale * scaleChange));

        // Get center point of pinch
        const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

        const rect = canvas.getBoundingClientRect();
        const contentX = (centerX - rect.left - translateX) / scale;
        const contentY = (centerY - rect.top - translateY) / scale;

        translateX = centerX - rect.left - contentX * newScale;
        translateY = centerY - rect.top - contentY * newScale;
        scale = newScale;

        applyTransform();
        updateZoomDisplay();
    } else if (e.touches.length === 1 && !isDragging) {
        // Pan
        const deltaX = e.touches[0].clientX - lastTouchX;
        const deltaY = e.touches[0].clientY - lastTouchY;

        translateX += deltaX;
        translateY += deltaY;

        lastTouchX = e.touches[0].clientX;
        lastTouchY = e.touches[0].clientY;

        applyTransform();
    }
}

function handleTouchEnd() {
    saveCanvasState();
}

function getTouchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

// Keyboard shortcuts
function handleKeyboard(e) {
    // Zoom shortcuts
    if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        zoomIn();
    } else if ((e.metaKey || e.ctrlKey) && e.key === '-') {
        e.preventDefault();
        zoomOut();
    } else if ((e.metaKey || e.ctrlKey) && e.key === '0') {
        e.preventDefault();
        resetZoom();
    }
}

// Apply transform to canvas content
function applyTransform() {
    if (canvasContent) {
        canvasContent.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    }
    if (svgOverlay) {
        svgOverlay.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    }
}

// Update zoom display
function updateZoomDisplay() {
    const zoomDisplay = document.getElementById('zoom-level');
    if (zoomDisplay) {
        zoomDisplay.textContent = `${Math.round(scale * 100)}%`;
    }
}

// Save canvas state to project
const saveCanvasState = throttle(() => {
    const project = getCurrentProject();
    if (project) {
        project.canvas_state = { zoom_level: scale, pan_x: translateX, pan_y: translateY };
        autoSave();
    }
}, 500);

// Zoom controls
export function zoomIn() {
    const rect = canvas.getBoundingClientRect();
    zoomAtPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, ZOOM_STEP);
}

export function zoomOut() {
    const rect = canvas.getBoundingClientRect();
    zoomAtPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, -ZOOM_STEP);
}

export function resetZoom() {
    scale = 1;
    translateX = 40;
    translateY = 40;
    applyTransform();
    updateZoomDisplay();
    saveCanvasState();
}

// ==================== Rendering ====================

// Render entire project
export function renderProject(project) {
    if (!canvasContent) return;

    // Clear existing content
    canvasContent.innerHTML = '';

    if (!project || !project.phases || project.phases.length === 0) {
        // Show empty state
        canvasContent.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📋</div>
                <h3>No phases yet</h3>
                <p>Add a phase to get started, or use AI to generate a project plan.</p>
                <button class="btn btn-primary" onclick="window.app.addNewPhase()">+ Add Phase</button>
            </div>
        `;
        return;
    }

    // Render phases
    project.phases.forEach((phase, index) => {
        const phaseElement = createPhaseElement(phase, index);
        canvasContent.appendChild(phaseElement);
    });

    // Add "Add Phase" button at the end
    const addButton = document.createElement('button');
    addButton.className = 'add-phase-btn';
    addButton.innerHTML = '+ Add Phase';
    addButton.style.left = `${project.phases.length * 320 + 40}px`;
    addButton.style.top = '100px';
    addButton.onclick = () => window.app.addNewPhase();
    canvasContent.appendChild(addButton);
}

// Create phase element
function createPhaseElement(phase, index) {
    const div = document.createElement('div');
    div.className = 'phase-container' + (phase.collapsed ? ' collapsed' : '');
    div.id = `phase-${phase.id}`;
    div.dataset.phaseId = phase.id;

    // Position
    div.style.left = `${phase.position?.x || (index * 320 + 40)}px`;
    div.style.top = `${phase.position?.y || 100}px`;

    // Calculate progress
    const totalFeatures = phase.features.length;
    const completedFeatures = phase.features.filter(f => f.status === 'complete').length;

    div.innerHTML = `
        <div class="phase-header" data-phase-id="${phase.id}">
            <span class="collapse-icon">${phase.collapsed ? '►' : '▼'}</span>
            <span class="phase-name" contenteditable="false">${sanitizeHTML(phase.name)}</span>
            <span class="phase-progress">${completedFeatures}/${totalFeatures} ✓</span>
            <button class="phase-menu-btn" title="Options">⋮</button>
        </div>
        ${!phase.collapsed ? `
            <div class="phase-description" contenteditable="false">${sanitizeHTML(phase.description || 'Click to add description')}</div>
            <div class="phase-features" data-phase-id="${phase.id}">
                ${phase.features.map(f => createFeatureHTML(f)).join('')}
            </div>
            <button class="add-feature-btn" data-phase-id="${phase.id}">+ Add Feature</button>
        ` : ''}
    `;

    // Event listeners
    setupPhaseEventListeners(div, phase);

    return div;
}

// Create feature HTML
function createFeatureHTML(feature) {
    const statusClass = `status-${feature.status.replace('_', '-')}`;
    const markedClass = feature.marked_as !== 'none' ? `marked-${feature.marked_as}` : '';
    const progress = calculateProgress(feature.subtasks, 'completed');

    return `
        <div class="feature-card ${statusClass} ${markedClass}${feature.collapsed ? ' collapsed' : ''}" 
             id="feature-${feature.id}" 
             data-feature-id="${feature.id}"
             draggable="true">
            <div class="feature-header">
                <input type="checkbox" 
                       class="feature-checkbox" 
                       ${feature.status === 'complete' ? 'checked' : ''} 
                       data-feature-id="${feature.id}">
                <span class="feature-name" contenteditable="false">${sanitizeHTML(feature.name)}</span>
                <span class="collapse-icon">${feature.collapsed ? '►' : '▼'}</span>
                ${feature.ai_generated ? '<span class="ai-badge" title="AI Generated">🤖</span>' : ''}
            </div>
            
            ${!feature.collapsed ? `
                <div class="feature-actions">
                    <button class="btn-small ${feature.marked_as === 'keep' ? 'active' : ''}" 
                            data-action="keep" data-feature-id="${feature.id}">Keep</button>
                    <button class="btn-small ${feature.marked_as === 'discard' ? 'active' : ''}" 
                            data-action="discard" data-feature-id="${feature.id}">Discard</button>
                    <button class="btn-small" data-action="dependencies" data-feature-id="${feature.id}">🔗</button>
                    <button class="btn-small danger" data-action="delete" data-feature-id="${feature.id}">×</button>
                </div>
                
                <div class="feature-description" contenteditable="false">
                    ${sanitizeHTML(feature.description || 'Click to add description')}
                </div>
                
                <div class="feature-subtasks" data-feature-id="${feature.id}">
                    ${feature.subtasks.map(s => `
                        <div class="subtask-item" data-subtask-id="${s.id}">
                            <input type="checkbox" 
                                   class="subtask-checkbox" 
                                   ${s.completed ? 'checked' : ''} 
                                   data-subtask-id="${s.id}">
                            <span class="subtask-text" contenteditable="false">${sanitizeHTML(s.description)}</span>
                            ${s.ai_generated ? '<span class="ai-badge small">🤖</span>' : ''}
                            <button class="subtask-delete" data-subtask-id="${s.id}">×</button>
                        </div>
                    `).join('')}
                </div>
                
                <button class="add-subtask-btn" data-feature-id="${feature.id}">+ Add Subtask</button>
                
                <div class="feature-meta">
                    <span class="status-badge">${feature.status.replace('_', ' ')}</span>
                    <span class="subtask-count">${progress.completed}/${progress.total} subtasks</span>
                </div>
            ` : ''}
        </div>
    `;
}

// Setup phase event listeners
function setupPhaseEventListeners(phaseElement, phase) {
    // Collapse/expand
    const header = phaseElement.querySelector('.phase-header');
    header.addEventListener('click', (e) => {
        if (e.target.classList.contains('phase-menu-btn')) return;
        if (e.target.classList.contains('phase-name') && e.target.isContentEditable) return;

        togglePhaseCollapse(phase.id);
    });

    // Double-click to edit name
    const nameEl = phaseElement.querySelector('.phase-name');
    nameEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        nameEl.contentEditable = true;
        nameEl.focus();
        selectAllText(nameEl);
    });

    nameEl.addEventListener('blur', () => {
        nameEl.contentEditable = false;
        updatePhaseName(phase.id, nameEl.textContent.trim());
    });

    nameEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            nameEl.blur();
        }
    });

    // Description editing
    const descEl = phaseElement.querySelector('.phase-description');
    if (descEl) {
        descEl.addEventListener('dblclick', () => {
            descEl.contentEditable = true;
            descEl.focus();
        });

        descEl.addEventListener('blur', () => {
            descEl.contentEditable = false;
            updatePhaseDescription(phase.id, descEl.textContent.trim());
        });
    }

    // Menu button
    const menuBtn = phaseElement.querySelector('.phase-menu-btn');
    menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showPhaseMenu(phase.id, e.clientX, e.clientY);
    });

    // Add feature button
    const addFeatureBtn = phaseElement.querySelector('.add-feature-btn');
    if (addFeatureBtn) {
        addFeatureBtn.addEventListener('click', () => addNewFeature(phase.id));
    }

    // Feature events
    setupFeatureEventListeners(phaseElement);
}

// Setup feature event listeners
function setupFeatureEventListeners(container) {
    // Feature checkbox
    container.querySelectorAll('.feature-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
            e.stopPropagation();
            toggleFeatureStatus(e.target.dataset.featureId);
        });
    });

    // Feature collapse
    container.querySelectorAll('.feature-card .collapse-icon').forEach(icon => {
        icon.addEventListener('click', (e) => {
            e.stopPropagation();
            const featureId = icon.closest('.feature-card').dataset.featureId;
            toggleFeatureCollapse(featureId);
        });
    });

    // Feature name editing
    container.querySelectorAll('.feature-name').forEach(nameEl => {
        nameEl.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            nameEl.contentEditable = true;
            nameEl.focus();
            selectAllText(nameEl);
        });

        nameEl.addEventListener('blur', () => {
            nameEl.contentEditable = false;
            const featureId = nameEl.closest('.feature-card').dataset.featureId;
            updateFeatureName(featureId, nameEl.textContent.trim());
        });

        nameEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                nameEl.blur();
            }
        });
    });

    // Feature description editing
    container.querySelectorAll('.feature-description').forEach(descEl => {
        descEl.addEventListener('dblclick', () => {
            descEl.contentEditable = true;
            descEl.focus();
        });

        descEl.addEventListener('blur', () => {
            descEl.contentEditable = false;
            const featureId = descEl.closest('.feature-card').dataset.featureId;
            updateFeatureDescription(featureId, descEl.textContent.trim());
        });
    });

    // Feature actions
    container.querySelectorAll('.feature-actions button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;
            const featureId = btn.dataset.featureId;
            handleFeatureAction(action, featureId);
        });
    });

    // Add subtask
    container.querySelectorAll('.add-subtask-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            addNewSubtask(btn.dataset.featureId);
        });
    });

    // Subtask checkboxes
    container.querySelectorAll('.subtask-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
            e.stopPropagation();
            toggleSubtaskStatus(e.target.dataset.subtaskId);
        });
    });

    // Subtask text editing
    container.querySelectorAll('.subtask-text').forEach(textEl => {
        textEl.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            textEl.contentEditable = true;
            textEl.focus();
        });

        textEl.addEventListener('blur', () => {
            textEl.contentEditable = false;
            const subtaskId = textEl.closest('.subtask-item').dataset.subtaskId;
            updateSubtaskText(subtaskId, textEl.textContent.trim());
        });

        textEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                textEl.blur();
            }
        });
    });

    // Subtask delete
    container.querySelectorAll('.subtask-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteSubtask(btn.dataset.subtaskId);
        });
    });

    // Drag and drop for features
    container.querySelectorAll('.feature-card[draggable="true"]').forEach(card => {
        card.addEventListener('dragstart', handleDragStart);
        card.addEventListener('dragend', handleDragEnd);
    });
}

// ==================== Actions ====================

function togglePhaseCollapse(phaseId) {
    const project = getCurrentProject();
    if (!project) return;

    const phase = findPhase(project, phaseId);
    if (phase) {
        phase.collapsed = !phase.collapsed;
        renderProject(project);
        autoSave();
    }
}

function toggleFeatureCollapse(featureId) {
    const project = getCurrentProject();
    if (!project) return;

    const result = findFeature(project, featureId);
    if (result) {
        result.feature.collapsed = !result.feature.collapsed;
        renderProject(project);
        autoSave();
    }
}

function toggleFeatureStatus(featureId) {
    const project = getCurrentProject();
    if (!project) return;

    const result = findFeature(project, featureId);
    if (result) {
        const feature = result.feature;
        feature.status = feature.status === 'complete' ? 'not_started' : 'complete';
        renderProject(project);
        autoSave();
    }
}

function toggleSubtaskStatus(subtaskId) {
    const project = getCurrentProject();
    if (!project) return;

    for (const phase of project.phases) {
        for (const feature of phase.features) {
            const subtask = feature.subtasks.find(s => s.id === subtaskId);
            if (subtask) {
                subtask.completed = !subtask.completed;

                // Update feature status based on subtasks
                const allComplete = feature.subtasks.every(s => s.completed);
                const anyComplete = feature.subtasks.some(s => s.completed);

                if (allComplete && feature.subtasks.length > 0) {
                    feature.status = 'complete';
                } else if (anyComplete) {
                    feature.status = 'in_progress';
                }

                renderProject(project);
                autoSave();
                return;
            }
        }
    }
}

function updatePhaseName(phaseId, name) {
    const project = getCurrentProject();
    if (!project) return;

    const phase = findPhase(project, phaseId);
    if (phase && name) {
        phase.name = name;
        autoSave();
    }
}

function updatePhaseDescription(phaseId, description) {
    const project = getCurrentProject();
    if (!project) return;

    const phase = findPhase(project, phaseId);
    if (phase) {
        phase.description = description;
        autoSave();
    }
}

function updateFeatureName(featureId, name) {
    const project = getCurrentProject();
    if (!project) return;

    const result = findFeature(project, featureId);
    if (result && name) {
        result.feature.name = name;
        autoSave();
    }
}

function updateFeatureDescription(featureId, description) {
    const project = getCurrentProject();
    if (!project) return;

    const result = findFeature(project, featureId);
    if (result) {
        result.feature.description = description;
        autoSave();
    }
}

function updateSubtaskText(subtaskId, text) {
    const project = getCurrentProject();
    if (!project) return;

    for (const phase of project.phases) {
        for (const feature of phase.features) {
            const subtask = feature.subtasks.find(s => s.id === subtaskId);
            if (subtask && text) {
                subtask.description = text;
                autoSave();
                return;
            }
        }
    }
}

function handleFeatureAction(action, featureId) {
    const project = getCurrentProject();
    if (!project) return;

    const result = findFeature(project, featureId);
    if (!result) return;

    switch (action) {
        case 'keep':
            result.feature.marked_as = result.feature.marked_as === 'keep' ? 'none' : 'keep';
            break;
        case 'discard':
            result.feature.marked_as = result.feature.marked_as === 'discard' ? 'none' : 'discard';
            break;
        case 'dependencies':
            showDependencies(featureId);
            break;
        case 'delete':
            deleteFeatureWithConfirm(featureId);
            return;
    }

    renderProject(project);
    autoSave();
}

async function deleteFeatureWithConfirm(featureId) {
    const confirmed = await confirmDialog('Delete this feature and all its subtasks?', 'Delete Feature');
    if (confirmed) {
        const project = getCurrentProject();
        if (project) {
            deleteFeature(project, featureId);
            renderProject(project);
            autoSave();
            showNotification({ type: 'success', message: 'Feature deleted' });
        }
    }
}

async function deleteSubtask(subtaskId) {
    const project = getCurrentProject();
    if (project) {
        deleteSubtaskFromProject(project, subtaskId);
        renderProject(project);
        autoSave();
    }
}

// Add new phase
export async function addNewPhase() {
    const name = await promptDialog('Enter phase name:', '', 'New Phase');
    if (name) {
        const project = getCurrentProject();
        if (project) {
            addPhase(project, name);
            renderProject(project);
            autoSave();
            showNotification({ type: 'success', message: 'Phase added' });
        }
    }
}

// Add new feature
async function addNewFeature(phaseId) {
    const name = await promptDialog('Enter feature name:', '', 'New Feature');
    if (name) {
        const project = getCurrentProject();
        if (project) {
            const phase = findPhase(project, phaseId);
            if (phase) {
                addFeature(phase, name);
                renderProject(project);
                autoSave();
                showNotification({ type: 'success', message: 'Feature added' });
            }
        }
    }
}

// Add new subtask
async function addNewSubtask(featureId) {
    const description = await promptDialog('Enter subtask description:', '', 'New Subtask');
    if (description) {
        const project = getCurrentProject();
        if (project) {
            const result = findFeature(project, featureId);
            if (result) {
                addSubtask(result.feature, description);
                renderProject(project);
                autoSave();
            }
        }
    }
}

// Show phase context menu
function showPhaseMenu(phaseId, x, y) {
    // Remove existing menu
    const existing = document.querySelector('.context-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.innerHTML = `
        <button data-action="edit">Edit Phase</button>
        <button data-action="delete" class="danger">Delete Phase</button>
    `;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    document.body.appendChild(menu);

    menu.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', async () => {
            const action = btn.dataset.action;
            menu.remove();

            if (action === 'delete') {
                const confirmed = await confirmDialog('Delete this phase and all its features?', 'Delete Phase');
                if (confirmed) {
                    const project = getCurrentProject();
                    if (project) {
                        deletePhase(project, phaseId);
                        renderProject(project);
                        autoSave();
                        showNotification({ type: 'success', message: 'Phase deleted' });
                    }
                }
            } else if (action === 'edit') {
                const project = getCurrentProject();
                const phase = findPhase(project, phaseId);
                if (phase) {
                    const newName = await promptDialog('Phase name:', phase.name, 'Edit Phase');
                    if (newName) {
                        phase.name = newName;
                        renderProject(project);
                        autoSave();
                    }
                }
            }
        });
    });

    // Close on click outside
    setTimeout(() => {
        document.addEventListener('click', function closeMenu(e) {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        });
    }, 10);
}

// ==================== Dependencies ====================

let activeDependencyFeatureId = null;

function showDependencies(featureId) {
    const project = getCurrentProject();
    if (!project) return;

    // Toggle off if same feature
    if (activeDependencyFeatureId === featureId) {
        clearDependencyLines();
        activeDependencyFeatureId = null;
        return;
    }

    activeDependencyFeatureId = featureId;
    const result = findFeature(project, featureId);
    if (!result) return;

    const feature = result.feature;

    // Clear existing lines
    clearDependencyLines();

    // Get source element position
    const sourceEl = document.getElementById(`feature-${featureId}`);
    if (!sourceEl) return;

    const sourceRect = sourceEl.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();

    // Draw lines to dependencies
    feature.dependencies.forEach(depId => {
        const depEl = document.getElementById(`feature-${depId}`);
        if (depEl) {
            const depRect = depEl.getBoundingClientRect();
            drawDependencyLine(
                (sourceRect.left + sourceRect.width / 2 - canvasRect.left - translateX) / scale,
                (sourceRect.top + sourceRect.height / 2 - canvasRect.top - translateY) / scale,
                (depRect.left + depRect.width / 2 - canvasRect.left - translateX) / scale,
                (depRect.top + depRect.height / 2 - canvasRect.top - translateY) / scale,
                'direct'
            );

            // Draw indirect dependencies (level 2)
            const depResult = findFeature(project, depId);
            if (depResult) {
                depResult.feature.dependencies.forEach(indirectDepId => {
                    const indirectEl = document.getElementById(`feature-${indirectDepId}`);
                    if (indirectEl) {
                        const indirectRect = indirectEl.getBoundingClientRect();
                        drawDependencyLine(
                            (depRect.left + depRect.width / 2 - canvasRect.left - translateX) / scale,
                            (depRect.top + depRect.height / 2 - canvasRect.top - translateY) / scale,
                            (indirectRect.left + indirectRect.width / 2 - canvasRect.left - translateX) / scale,
                            (indirectRect.top + indirectRect.height / 2 - canvasRect.top - translateY) / scale,
                            'indirect'
                        );
                    }
                });
            }
        }
    });
}

function drawDependencyLine(x1, y1, x2, y2, type) {
    if (!svgOverlay) return;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('class', `dependency-line ${type}`);
    svgOverlay.appendChild(line);
}

function clearDependencyLines() {
    if (svgOverlay) {
        svgOverlay.innerHTML = '';
    }
}

// ==================== Drag and Drop ====================

function handleDragStart(e) {
    isDragging = true;
    draggedElement = e.target;
    draggedType = 'feature';
    draggedId = e.target.dataset.featureId;
    e.target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedId);
}

function handleDragEnd(e) {
    isDragging = false;
    if (draggedElement) {
        draggedElement.classList.remove('dragging');
    }
    draggedElement = null;
    draggedType = null;
    draggedId = null;
    clearDropZones();
}

function highlightDropZones(clientX, clientY) {
    // Highlight phase containers as drop zones
    document.querySelectorAll('.phase-features').forEach(zone => {
        const rect = zone.getBoundingClientRect();
        if (clientX >= rect.left && clientX <= rect.right &&
            clientY >= rect.top && clientY <= rect.bottom) {
            zone.classList.add('drop-highlight');
        } else {
            zone.classList.remove('drop-highlight');
        }
    });
}

function clearDropZones() {
    document.querySelectorAll('.drop-highlight').forEach(el => {
        el.classList.remove('drop-highlight');
    });
}

function handleDrop(clientX, clientY) {
    if (!draggedId || draggedType !== 'feature') return;

    const project = getCurrentProject();
    if (!project) return;

    // Find target phase
    let targetPhaseId = null;
    document.querySelectorAll('.phase-features').forEach(zone => {
        const rect = zone.getBoundingClientRect();
        if (clientX >= rect.left && clientX <= rect.right &&
            clientY >= rect.top && clientY <= rect.bottom) {
            targetPhaseId = zone.dataset.phaseId;
        }
    });

    if (targetPhaseId) {
        const result = findFeature(project, draggedId);
        if (result) {
            const feature = result.feature;
            const sourcePhase = result.phase;
            const targetPhase = findPhase(project, targetPhaseId);

            if (targetPhase && sourcePhase.id !== targetPhase.id) {
                // Remove from source
                const index = sourcePhase.features.findIndex(f => f.id === draggedId);
                if (index !== -1) {
                    sourcePhase.features.splice(index, 1);
                }

                // Add to target
                feature.phase_id = targetPhase.id;
                targetPhase.features.push(feature);

                renderProject(project);
                autoSave();
                showNotification({ type: 'success', message: 'Feature moved' });
            }
        }
    }
}

// Helper function
function selectAllText(element) {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
}
