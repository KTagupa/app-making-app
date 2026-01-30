/**
 * IndexedDB Storage Module
 * Handles all data persistence for the App Development Manager
 */

import { generateId, debounce } from './utils.js';

const DB_NAME = 'app-dev-manager';
const DB_VERSION = 1;

let db = null;

// Initialize the database
export async function initDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            console.error('Failed to open database:', request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            db = request.result;
            console.log('Database initialized successfully');
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const database = event.target.result;

            // Projects store
            if (!database.objectStoreNames.contains('projects')) {
                const projectStore = database.createObjectStore('projects', { keyPath: 'id' });
                projectStore.createIndex('name', 'name', { unique: false });
                projectStore.createIndex('modified', 'modified', { unique: false });
            }

            // App settings store
            if (!database.objectStoreNames.contains('app_settings')) {
                database.createObjectStore('app_settings', { keyPath: 'key' });
            }
        };
    });
}

// ==================== Project Operations ====================

// Create a new project
export async function createProject(name, goal = '') {
    const project = {
        id: generateId(),
        name,
        goal,
        created: Date.now(),
        modified: Date.now(),
        ai_model: 'claude',
        gist_id: null,
        gist_url: null,
        last_synced: null,
        phases: [],
        canvas_state: {
            zoom_level: 1.0,
            pan_x: 0,
            pan_y: 0
        }
    };

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['projects'], 'readwrite');
        const store = transaction.objectStore('projects');
        const request = store.add(project);

        request.onsuccess = () => resolve(project);
        request.onerror = () => reject(request.error);
    });
}

// Get a project by ID
export async function getProject(id) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['projects'], 'readonly');
        const store = transaction.objectStore('projects');
        const request = store.get(id);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// Get all projects
export async function getAllProjects() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['projects'], 'readonly');
        const store = transaction.objectStore('projects');
        const request = store.getAll();

        request.onsuccess = () => {
            // Sort by modified date (most recent first)
            const projects = request.result.sort((a, b) => b.modified - a.modified);
            resolve(projects);
        };
        request.onerror = () => reject(request.error);
    });
}

// Update a project
export async function updateProject(project) {
    project.modified = Date.now();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['projects'], 'readwrite');
        const store = transaction.objectStore('projects');
        const request = store.put(project);

        request.onsuccess = () => resolve(project);
        request.onerror = () => reject(request.error);
    });
}

// Delete a project
export async function deleteProject(id) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['projects'], 'readwrite');
        const store = transaction.objectStore('projects');
        const request = store.delete(id);

        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
    });
}

// ==================== Settings Operations ====================

// Get a setting
export async function getSetting(key) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['app_settings'], 'readonly');
        const store = transaction.objectStore('app_settings');
        const request = store.get(key);

        request.onsuccess = () => resolve(request.result?.value);
        request.onerror = () => reject(request.error);
    });
}

// Set a setting
export async function setSetting(key, value) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['app_settings'], 'readwrite');
        const store = transaction.objectStore('app_settings');
        const request = store.put({ key, value });

        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
    });
}

// ==================== API Key Operations ====================

// Save an API key (base64 encoded for minimal obfuscation)
export async function saveAPIKey(model, apiKey) {
    const apiKeys = await getSetting('api_keys') || {};
    apiKeys[model] = btoa(apiKey);
    await setSetting('api_keys', apiKeys);
}

// Get an API key
export async function getAPIKey(model) {
    const apiKeys = await getSetting('api_keys') || {};
    if (!apiKeys[model]) return null;
    return atob(apiKeys[model]);
}

// Check if API key exists
export async function hasAPIKey(model) {
    const apiKeys = await getSetting('api_keys') || {};
    return !!apiKeys[model];
}

// Delete an API key
export async function deleteAPIKey(model) {
    const apiKeys = await getSetting('api_keys') || {};
    delete apiKeys[model];
    await setSetting('api_keys', apiKeys);
}

// ==================== Phase/Feature/Subtask Operations ====================

// Add a phase to a project
export function addPhase(project, name, description = '') {
    const phase = {
        id: generateId(),
        project_id: project.id,
        name,
        description,
        order: project.phases.length,
        features: [],
        collapsed: false,
        position: {
            x: project.phases.length * 320 + 40,
            y: 100
        }
    };

    project.phases.push(phase);
    return phase;
}

// Add a feature to a phase
export function addFeature(phase, name, description = '') {
    const feature = {
        id: generateId(),
        phase_id: phase.id,
        name,
        description,
        status: 'not_started',
        ai_generated: false,
        marked_as: 'none',
        subtasks: [],
        dependencies: [],
        collapsed: true,
        position: { x: 0, y: 0 }
    };

    phase.features.push(feature);
    return feature;
}

// Add a subtask to a feature
export function addSubtask(feature, description) {
    const subtask = {
        id: generateId(),
        feature_id: feature.id,
        description,
        completed: false,
        ai_generated: false
    };

    feature.subtasks.push(subtask);
    return subtask;
}

// Find a phase by ID
export function findPhase(project, phaseId) {
    return project.phases.find(p => p.id === phaseId);
}

// Find a feature by ID
export function findFeature(project, featureId) {
    for (const phase of project.phases) {
        const feature = phase.features.find(f => f.id === featureId);
        if (feature) return { phase, feature };
    }
    return null;
}

// Find a subtask by ID
export function findSubtask(project, subtaskId) {
    for (const phase of project.phases) {
        for (const feature of phase.features) {
            const subtask = feature.subtasks.find(s => s.id === subtaskId);
            if (subtask) return { phase, feature, subtask };
        }
    }
    return null;
}

// Delete a phase
export function deletePhase(project, phaseId) {
    const index = project.phases.findIndex(p => p.id === phaseId);
    if (index !== -1) {
        project.phases.splice(index, 1);
        // Update order of remaining phases
        project.phases.forEach((p, i) => p.order = i);
        return true;
    }
    return false;
}

// Delete a feature
export function deleteFeature(project, featureId) {
    for (const phase of project.phases) {
        const index = phase.features.findIndex(f => f.id === featureId);
        if (index !== -1) {
            phase.features.splice(index, 1);
            return true;
        }
    }
    return false;
}

// Delete a subtask
export function deleteSubtaskFromProject(project, subtaskId) {
    for (const phase of project.phases) {
        for (const feature of phase.features) {
            const index = feature.subtasks.findIndex(s => s.id === subtaskId);
            if (index !== -1) {
                feature.subtasks.splice(index, 1);
                return true;
            }
        }
    }
    return false;
}

// ==================== Auto-save ====================

let currentProject = null;

export function setCurrentProject(project) {
    currentProject = project;
}

export function getCurrentProject() {
    return currentProject;
}

// Debounced auto-save (2 second delay)
export const autoSave = debounce(async () => {
    if (currentProject) {
        try {
            await updateProject(currentProject);
            console.log('Auto-saved project:', currentProject.name);
        } catch (error) {
            console.error('Auto-save failed:', error);
        }
    }
}, 2000);

// ==================== Export/Import ====================

// Export project to JSON
export function exportProject(project) {
    const exportData = {
        version: '1.0',
        exported: Date.now(),
        project: {
            ...project,
            // Don't export internal state
            gist_id: null,
            last_synced: null
        }
    };
    return JSON.stringify(exportData, null, 2);
}

// Import project from JSON
export async function importProject(jsonString) {
    try {
        const data = JSON.parse(jsonString);

        if (!data.version || !data.project) {
            throw new Error('Invalid project file format');
        }

        // Generate new IDs to avoid conflicts
        const project = data.project;
        project.id = generateId();
        project.created = Date.now();
        project.modified = Date.now();
        project.gist_id = null;
        project.gist_url = null;
        project.last_synced = null;

        // Regenerate IDs for phases, features, subtasks
        const idMap = new Map();

        for (const phase of project.phases) {
            const oldPhaseId = phase.id;
            phase.id = generateId();
            phase.project_id = project.id;
            idMap.set(oldPhaseId, phase.id);

            for (const feature of phase.features) {
                const oldFeatureId = feature.id;
                feature.id = generateId();
                feature.phase_id = phase.id;
                idMap.set(oldFeatureId, feature.id);

                for (const subtask of feature.subtasks) {
                    subtask.id = generateId();
                    subtask.feature_id = feature.id;
                }
            }
        }

        // Update dependency references
        for (const phase of project.phases) {
            for (const feature of phase.features) {
                feature.dependencies = feature.dependencies
                    .map(depId => idMap.get(depId))
                    .filter(id => id); // Remove any unmapped references
            }
        }

        // Save to database
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['projects'], 'readwrite');
            const store = transaction.objectStore('projects');
            const request = store.add(project);

            request.onsuccess = () => resolve(project);
            request.onerror = () => reject(request.error);
        });

    } catch (error) {
        console.error('Import failed:', error);
        throw new Error('Failed to import project: ' + error.message);
    }
}
