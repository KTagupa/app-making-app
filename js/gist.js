/**
 * GitHub Gist Sync Module
 */

import { getSetting, setSetting } from './storage.js';
import { showNotification } from './utils.js';

// Get stored GitHub token
export async function getGithubToken() {
    return await getSetting('github_token');
}

// Save GitHub token
export async function saveGithubToken(token) {
    await setSetting('github_token', btoa(token));
}

// Check if GitHub token exists
export async function hasGithubToken() {
    const token = await getSetting('github_token');
    return !!token;
}

// Get decoded token
async function getDecodedToken() {
    const encoded = await getSetting('github_token');
    if (!encoded) return null;
    return atob(encoded);
}

// Create a new Gist
export async function createGist(project) {
    const token = await getDecodedToken();

    if (!token) {
        throw new Error('GitHub token not set');
    }

    const content = JSON.stringify({
        version: '1.0',
        exported: Date.now(),
        project: {
            ...project,
            gist_id: null,
            last_synced: null
        }
    }, null, 2);

    const response = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `token ${token}`
        },
        body: JSON.stringify({
            description: `App Dev Manager: ${project.name}`,
            public: false,
            files: {
                [`${sanitizeFilename(project.name)}.json`]: {
                    content: content
                }
            }
        })
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(`Failed to create Gist: ${error.message || response.statusText}`);
    }

    const gist = await response.json();

    return {
        gist_id: gist.id,
        gist_url: gist.html_url,
        last_synced: Date.now()
    };
}

// Update an existing Gist
export async function updateGist(project) {
    const token = await getDecodedToken();

    if (!token) {
        throw new Error('GitHub token not set');
    }

    if (!project.gist_id) {
        throw new Error('Project has no associated Gist');
    }

    const content = JSON.stringify({
        version: '1.0',
        exported: Date.now(),
        project: {
            ...project,
            gist_id: project.gist_id,
            gist_url: project.gist_url,
            last_synced: Date.now()
        }
    }, null, 2);

    const response = await fetch(`https://api.github.com/gists/${project.gist_id}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `token ${token}`
        },
        body: JSON.stringify({
            description: `App Dev Manager: ${project.name}`,
            files: {
                [`${sanitizeFilename(project.name)}.json`]: {
                    content: content
                }
            }
        })
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(`Failed to update Gist: ${error.message || response.statusText}`);
    }

    return {
        last_synced: Date.now()
    };
}

// Fetch a Gist by ID
export async function fetchGist(gistId) {
    const token = await getDecodedToken();

    const headers = {
        'Content-Type': 'application/json'
    };

    if (token) {
        headers['Authorization'] = `token ${token}`;
    }

    const response = await fetch(`https://api.github.com/gists/${gistId}`, {
        method: 'GET',
        headers
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(`Failed to fetch Gist: ${error.message || response.statusText}`);
    }

    const gist = await response.json();

    // Find the project JSON file
    const files = Object.values(gist.files);
    const projectFile = files.find(f => f.filename.endsWith('.json'));

    if (!projectFile) {
        throw new Error('No project file found in Gist');
    }

    // Parse the content
    const data = JSON.parse(projectFile.content);

    return {
        project: data.project,
        gist_id: gist.id,
        gist_url: gist.html_url
    };
}

// Sync project to Gist (create or update)
export async function syncToGist(project) {
    try {
        let result;

        if (project.gist_id) {
            // Update existing Gist
            result = await updateGist(project);
            showNotification({
                type: 'success',
                message: 'Synced to Gist successfully'
            });
        } else {
            // Create new Gist
            result = await createGist(project);
            showNotification({
                type: 'success',
                message: 'Created new Gist',
                action: {
                    label: 'View',
                    callback: () => window.open(result.gist_url, '_blank')
                }
            });
        }

        return result;

    } catch (error) {
        showNotification({
            type: 'error',
            message: error.message
        });
        throw error;
    }
}

// Validate GitHub token
export async function validateGithubToken(token) {
    try {
        const response = await fetch('https://api.github.com/user', {
            headers: {
                'Authorization': `token ${token}`
            }
        });

        return response.ok;
    } catch (error) {
        return false;
    }
}

// Sanitize filename
function sanitizeFilename(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}
