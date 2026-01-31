/**
 * Main Application Logic
 * App Development Manager
 */

import {
    initDatabase,
    createProject,
    getProject,
    getAllProjects,
    updateProject,
    deleteProject,
    getSetting,
    setSetting,
    saveAPIKey,
    getAPIKey,
    hasAPIKey,
    deleteAPIKey,
    exportProject,
    importProject,
    setCurrentProject,
    getCurrentProject,
    autoSave,
    addPhase,
    findPhase,
    findFeature
} from './storage.js';

import {
    initCanvas,
    renderProject,
    setCanvasState,
    getCanvasState,
    zoomIn,
    zoomOut,
    resetZoom,
    addNewPhase
} from './canvas.js';

import {
    callAI,
    validateAPIKey,
    getAvailableModels,
    buildAIContext,
    mergeAIResponse,
    switchAIModel
} from './ai.js';

import {
    syncToGist,
    fetchGist,
    hasGithubToken,
    saveGithubToken,
    validateGithubToken
} from './gist.js';

import {
    showNotification,
    confirmDialog,
    promptDialog,
    formatDate,
    formatDateForFile,
    generateId
} from './utils.js';

// App state
let isLoading = false;

// Initialize the application
async function init() {
    try {
        showLoadingOverlay(true);

        // Initialize database
        await initDatabase();

        // Initialize canvas
        initCanvas();

        // Load projects
        await loadProjects();

        // Load last project or create default
        const lastProjectId = await getSetting('last_project_id');
        if (lastProjectId) {
            await openProject(lastProjectId);
        } else {
            // Check if any projects exist
            const projects = await getAllProjects();
            if (projects.length > 0) {
                await openProject(projects[0].id);
            }
        }

        // Setup UI
        setupEventListeners();
        setupAIPanel();
        await updateAPIKeyStatus();

        showLoadingOverlay(false);

    } catch (error) {
        console.error('Failed to initialize app:', error);
        showNotification({ type: 'error', message: 'Failed to initialize application' });
        showLoadingOverlay(false);
    }
}

// Setup event listeners
function setupEventListeners() {
    // New project
    document.getElementById('new-project-btn').addEventListener('click', handleNewProject);

    // Export
    document.getElementById('export-btn').addEventListener('click', handleExport);

    // Import
    document.getElementById('import-btn').addEventListener('click', handleImport);
    document.getElementById('import-file-input').addEventListener('change', handleImportFile);

    // Sync to Gist
    document.getElementById('sync-gist-btn').addEventListener('click', handleSyncGist);

    // Settings
    document.getElementById('settings-btn').addEventListener('click', openSettings);
    document.getElementById('close-settings-btn').addEventListener('click', closeSettings);
    document.getElementById('save-settings-btn').addEventListener('click', saveSettings);

    // Zoom controls
    document.getElementById('zoom-in-btn').addEventListener('click', zoomIn);
    document.getElementById('zoom-out-btn').addEventListener('click', zoomOut);
    document.getElementById('zoom-reset-btn').addEventListener('click', resetZoom);

    // Project dropdown
    document.getElementById('project-dropdown').addEventListener('change', handleProjectChange);

    // AI Panel
    document.getElementById('ai-generate-btn').addEventListener('click', handleAIGenerate);
    document.getElementById('ai-prompt-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleAIGenerate();
        }
    });

    // AI Mode selection
    document.querySelectorAll('.ai-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.ai-mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // AI Model selector
    document.getElementById('ai-model-selector').addEventListener('change', handleModelChange);

    // API Key management in settings
    document.querySelectorAll('.add-api-key-btn').forEach(btn => {
        btn.addEventListener('click', () => addAPIKey(btn.dataset.model));
    });

    // GitHub token
    document.getElementById('add-github-token-btn').addEventListener('click', addGithubToken);

    // Modal close on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.classList.remove('show');
            }
        });
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboardShortcuts);
}

// Handle keyboard shortcuts
function handleKeyboardShortcuts(e) {
    // Cmd/Ctrl + N = New project
    if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        handleNewProject();
    }

    // Cmd/Ctrl + S = Save (force save)
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        forceSave();
    }

    // Cmd/Ctrl + E = Export
    if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
        e.preventDefault();
        handleExport();
    }

    // Escape = Close modals
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.show').forEach(modal => {
            modal.classList.remove('show');
        });
    }
}

// ==================== Project Management ====================

async function loadProjects() {
    const projects = await getAllProjects();
    const dropdown = document.getElementById('project-dropdown');

    dropdown.innerHTML = projects.length > 0
        ? projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('')
        : '<option value="">No projects</option>';
}

async function openProject(projectId) {
    try {
        const project = await getProject(projectId);
        if (!project) {
            showNotification({ type: 'error', message: 'Project not found' });
            return;
        }

        setCurrentProject(project);

        // Update dropdown selection
        const dropdown = document.getElementById('project-dropdown');
        dropdown.value = projectId;

        // Restore canvas state
        setCanvasState(project.canvas_state);

        // Update AI model selector
        document.getElementById('ai-model-selector').value = project.ai_model || 'gemini';

        // Render project
        renderProject(project);

        // Update project goal display
        document.getElementById('project-goal-display').textContent = project.goal || 'No goal set';

        // Save as last opened project
        await setSetting('last_project_id', projectId);

    } catch (error) {
        console.error('Failed to open project:', error);
        showNotification({ type: 'error', message: 'Failed to open project' });
    }
}

async function handleNewProject() {
    const name = await promptDialog('Enter project name:', '', 'New Project');
    if (!name) return;

    const goal = await promptDialog(
        'Describe your app idea (optional, but helps AI planning):',
        '',
        'Project Goal'
    );

    try {
        const project = await createProject(name, goal || '');
        await loadProjects();
        await openProject(project.id);
        showNotification({ type: 'success', message: 'Project created' });

        // Focus AI prompt
        document.getElementById('ai-prompt-input').focus();

    } catch (error) {
        console.error('Failed to create project:', error);
        showNotification({ type: 'error', message: 'Failed to create project' });
    }
}

async function handleProjectChange(e) {
    const projectId = e.target.value;
    if (projectId) {
        await openProject(projectId);
    }
}

async function forceSave() {
    const project = getCurrentProject();
    if (project) {
        try {
            await updateProject(project);
            showNotification({ type: 'success', message: 'Project saved', duration: 1500 });
        } catch (error) {
            showNotification({ type: 'error', message: 'Failed to save project' });
        }
    }
}

// ==================== Export/Import ====================

function handleExport() {
    const project = getCurrentProject();
    if (!project) {
        showNotification({ type: 'warning', message: 'No project to export' });
        return;
    }

    const json = exportProject(project);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.toLowerCase().replace(/\s+/g, '-')}_${formatDateForFile(Date.now())}.json`;
    a.click();

    URL.revokeObjectURL(url);
    showNotification({ type: 'success', message: 'Project exported' });
}

function handleImport() {
    document.getElementById('import-file-input').click();
}

async function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
        const text = await file.text();
        const project = await importProject(text);
        await loadProjects();
        await openProject(project.id);
        showNotification({ type: 'success', message: 'Project imported' });
    } catch (error) {
        console.error('Import failed:', error);
        showNotification({ type: 'error', message: error.message });
    }

    // Reset file input
    e.target.value = '';
}

// ==================== GitHub Gist ====================

async function handleSyncGist() {
    const project = getCurrentProject();
    if (!project) {
        showNotification({ type: 'warning', message: 'No project to sync' });
        return;
    }

    const hasToken = await hasGithubToken();
    if (!hasToken) {
        showNotification({
            type: 'warning',
            message: 'GitHub token required',
            action: {
                label: 'Add Token',
                callback: () => openSettings()
            }
        });
        return;
    }

    try {
        showLoadingOverlay(true);
        const result = await syncToGist(project);

        // Update project with Gist info
        if (result.gist_id) {
            project.gist_id = result.gist_id;
            project.gist_url = result.gist_url;
        }
        project.last_synced = result.last_synced;
        await updateProject(project);

    } catch (error) {
        console.error('Sync failed:', error);
    } finally {
        showLoadingOverlay(false);
    }
}

// ==================== Settings ====================

function openSettings() {
    document.getElementById('settings-modal').classList.add('show');
}

function closeSettings() {
    document.getElementById('settings-modal').classList.remove('show');
}

async function saveSettings() {
    // Settings are saved individually when changed
    closeSettings();
    showNotification({ type: 'success', message: 'Settings saved' });
}

async function updateAPIKeyStatus() {
    const models = getAvailableModels();

    for (const model of models) {
        const hasKey = await hasAPIKey(model.id);
        const statusEl = document.getElementById(`${model.id}-status`);
        const btnEl = document.querySelector(`.add-api-key-btn[data-model="${model.id}"]`);

        if (statusEl) {
            statusEl.textContent = hasKey ? '✓ Connected' : 'Not set';
            statusEl.className = `api-key-status ${hasKey ? 'connected' : 'not-set'}`;
        }

        if (btnEl) {
            btnEl.textContent = hasKey ? 'Change' : 'Add';
        }
    }

    // GitHub token status
    const hasGithub = await hasGithubToken();
    const githubStatus = document.getElementById('github-status');
    const githubBtn = document.getElementById('add-github-token-btn');

    if (githubStatus) {
        githubStatus.textContent = hasGithub ? '✓ Connected' : 'Not set';
        githubStatus.className = `api-key-status ${hasGithub ? 'connected' : 'not-set'}`;
    }

    if (githubBtn) {
        githubBtn.textContent = hasGithub ? 'Change' : 'Add';
    }
}

async function addAPIKey(model) {
    const modelName = model.charAt(0).toUpperCase() + model.slice(1);
    const key = await promptDialog(
        `Enter your ${modelName} API key:`,
        '',
        `${modelName} API Key`
    );

    if (!key) return;

    // Trim whitespace from the key
    const trimmedKey = key.trim();

    if (!trimmedKey) {
        showNotification({ type: 'warning', message: 'API key cannot be empty' });
        return;
    }

    try {
        showLoadingOverlay(true);

        console.log(`Testing ${modelName} API key...`);

        // Validate the key
        const isValid = await validateAPIKey(model, trimmedKey);

        if (isValid) {
            await saveAPIKey(model, trimmedKey);
            await updateAPIKeyStatus();
            showNotification({ type: 'success', message: `${modelName} API key saved successfully!` });
        } else {
            console.error(`${modelName} API key validation failed`);
            showNotification({
                type: 'error',
                message: `Invalid ${modelName} API key. Please check the browser console for details.`,
                duration: 5000
            });
        }

    } catch (error) {
        console.error(`Error validating ${modelName} API key:`, error);
        showNotification({
            type: 'error',
            message: `Failed to validate API key: ${error.message}. Check console for details.`,
            duration: 5000
        });
    } finally {
        showLoadingOverlay(false);
    }
}

async function addGithubToken() {
    const token = await promptDialog(
        'Enter your GitHub Personal Access Token:\n(Needs "gist" scope)',
        '',
        'GitHub Token'
    );

    if (!token) return;

    try {
        showLoadingOverlay(true);

        const isValid = await validateGithubToken(token);

        if (isValid) {
            await saveGithubToken(token);
            await updateAPIKeyStatus();
            showNotification({ type: 'success', message: 'GitHub token saved' });
        } else {
            showNotification({ type: 'error', message: 'Invalid GitHub token' });
        }

    } catch (error) {
        showNotification({ type: 'error', message: 'Failed to validate GitHub token' });
    } finally {
        showLoadingOverlay(false);
    }
}

// ==================== AI Integration ====================

function setupAIPanel() {
    const models = getAvailableModels();
    const selector = document.getElementById('ai-model-selector');

    selector.innerHTML = models.map(m =>
        `<option value="${m.id}">${m.name}</option>`
    ).join('');
}

async function handleModelChange(e) {
    const model = e.target.value;
    const project = getCurrentProject();

    if (project) {
        const success = await switchAIModel(project, model);
        if (success) {
            await updateProject(project);
        } else {
            // Revert selection
            e.target.value = project.ai_model;
        }
    }
}

async function handleAIGenerate() {
    console.log('[App] handleAIGenerate called');

    const project = getCurrentProject();
    if (!project) {
        console.warn('[App] No current project');
        showNotification({ type: 'warning', message: 'Create a project first' });
        return;
    }
    console.log('[App] Current project:', project.name, project.id);

    const prompt = document.getElementById('ai-prompt-input').value.trim();
    if (!prompt) {
        console.warn('[App] Empty prompt');
        showNotification({ type: 'warning', message: 'Enter a prompt' });
        return;
    }
    console.log('[App] User prompt:', prompt);

    const model = document.getElementById('ai-model-selector').value;
    console.log('[App] Selected model:', model);

    const hasKey = await hasAPIKey(model);
    console.log('[App] Has API key:', hasKey);

    if (!hasKey) {
        showNotification({
            type: 'warning',
            message: `API key required for ${model}. Please add it in Settings.`,
            action: {
                label: 'Add Key',
                callback: () => openSettings()
            }
        });
        return;
    }

    // Get selected mode
    const modeBtn = document.querySelector('.ai-mode-btn.active');
    const mode = modeBtn ? modeBtn.dataset.mode : 'full_project';
    console.log('[App] AI Mode:', mode);

    try {
        console.log('[App] Starting AI generation...');
        showLoadingOverlay(true);
        document.getElementById('ai-generate-btn').disabled = true;
        document.getElementById('ai-generate-btn').textContent = 'Generating...';

        // Build context
        const context = buildAIContext(project, mode);
        console.log('[App] AI Context built:', {
            mode: context.mode,
            projectGoal: context.projectGoal,
            phasesCount: context.currentStructure?.length || 0,
            keepItems: context.constraints.keepItems.length,
            discardItems: context.constraints.discardItems.length
        });

        // Call AI
        console.log('[App] Calling AI...');
        const result = await callAI(model, prompt, context);
        console.log('[App] AI Response received:', {
            success: result.success,
            error: result.error || null,
            phasesCount: result.data?.phases?.length || 0
        });

        if (result.success) {
            // Validate the response has content
            if (!result.data.phases || result.data.phases.length === 0) {
                console.warn('[App] AI returned empty phases array');
                showNotification({
                    type: 'warning',
                    message: 'AI returned an empty plan. Try being more specific in your prompt.'
                });
                return;
            }

            // Merge AI response with project
            console.log('[App] Merging AI response...');
            const newPhases = mergeAIResponse(result.data, project, context.constraints);
            console.log('[App] Merged phases count:', newPhases.length);

            // Apply to project
            console.log('[App] Applying AI response to project...');
            applyAIResponse(project, newPhases);
            console.log('[App] Project now has', project.phases.length, 'phases');

            // Re-render
            console.log('[App] Rendering project...');
            renderProject(project);
            autoSave();

            // Clear prompt
            document.getElementById('ai-prompt-input').value = '';

            showNotification({
                type: 'success',
                message: `Plan generated successfully! Created ${project.phases.length} phases.`
            });

        } else {
            console.error('[App] AI generation failed:', result.error);
            showNotification({
                type: 'error',
                message: result.error || 'AI generation failed. Check console for details.',
                duration: 6000
            });
        }

    } catch (error) {
        console.error('[App] AI generation error:', error);
        console.error('[App] Error stack:', error.stack);
        showNotification({
            type: 'error',
            message: `AI Error: ${error.message}`,
            duration: 6000
        });
    } finally {
        showLoadingOverlay(false);
        document.getElementById('ai-generate-btn').disabled = false;
        document.getElementById('ai-generate-btn').textContent = 'Generate';
        console.log('[App] AI generation process completed');
    }
}

function applyAIResponse(project, newPhases) {
    // For full regeneration, replace all phases
    // But preserve manually added items that aren't marked as discard

    const preservedFeatures = [];

    // Collect features to preserve
    for (const phase of project.phases) {
        for (const feature of phase.features) {
            if (feature.marked_as === 'keep') {
                preservedFeatures.push({
                    ...feature,
                    originalPhase: phase.name
                });
            }
        }
    }

    // Create new phases from AI response
    project.phases = newPhases.map((phaseData, index) => {
        const phase = {
            id: generateId(),
            project_id: project.id,
            name: phaseData.name,
            description: phaseData.description || '',
            order: index,
            collapsed: false,
            position: { x: index * 320 + 40, y: 100 },
            features: (phaseData.features || []).map(featureData => ({
                id: generateId(),
                phase_id: null, // Will be set after
                name: featureData.name,
                description: featureData.description || '',
                status: 'not_started',
                ai_generated: true,
                marked_as: 'none',
                collapsed: true,
                position: { x: 0, y: 0 },
                dependencies: [],
                subtasks: (featureData.suggested_subtasks || []).map(desc => ({
                    id: generateId(),
                    feature_id: null,
                    description: desc,
                    completed: false,
                    ai_generated: true
                }))
            }))
        };

        // Set phase_id for features and feature_id for subtasks
        phase.features.forEach(f => {
            f.phase_id = phase.id;
            f.subtasks.forEach(s => s.feature_id = f.id);
        });

        return phase;
    });

    // Re-insert preserved features
    for (const feature of preservedFeatures) {
        // Find matching phase or first phase
        let targetPhase = project.phases.find(p =>
            p.name.toLowerCase().includes(feature.originalPhase.toLowerCase().split(':')[0])
        ) || project.phases[0];

        if (targetPhase) {
            // Remove ai_generated from preserved feature
            feature.ai_generated = false;
            delete feature.originalPhase;
            feature.phase_id = targetPhase.id;
            targetPhase.features.unshift(feature);
        }
    }
}

// ==================== UI Helpers ====================

function showLoadingOverlay(show) {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.classList.toggle('show', show);
    }
}

// ==================== Global API ====================

// Expose functions for inline event handlers
window.app = {
    addNewPhase,
    openProject,
    handleNewProject
};

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', init);
