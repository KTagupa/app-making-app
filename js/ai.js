/**
 * Multi-Model AI Integration
 * Supports Claude, ChatGPT, and Gemini
 */

import { getAPIKey, hasAPIKey } from './storage.js';
import { showNotification } from './utils.js';

// AI Model Configurations
const AI_CONFIGS = {
    claude: {
        name: 'Claude',
        endpoint: 'https://api.anthropic.com/v1/messages',
        headers: (apiKey) => ({
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
        }),
        modelName: 'claude-sonnet-4-20250514'
    },

    chatgpt: {
        name: 'ChatGPT',
        endpoint: 'https://api.openai.com/v1/chat/completions',
        headers: (apiKey) => ({
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        }),
        modelName: 'gpt-4o'
    },

    gemini: {
        name: 'Gemini',
        endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent',
        headers: () => ({
            'Content-Type': 'application/json'
        }),
        modelName: 'gemini-2.0-flash-exp',
        getUrl: (apiKey) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`
    }
};

// Get system prompt for AI
function getSystemPrompt() {
    return `You are an expert project planner helping to structure HTML app development.
Given a project goal and optional existing structure, generate a detailed plan.

Return ONLY valid JSON in this exact format:
{
  "phases": [
    {
      "name": "Phase 1: Setup",
      "description": "Brief description",
      "features": [
        {
          "name": "Feature name",
          "description": "What this feature does",
          "suggested_subtasks": ["Task 1", "Task 2"],
          "dependencies": []
        }
      ]
    }
  ]
}

Rules:
- Create 3-6 phases for a complete project
- Each phase should have 3-8 features
- Features should be specific and actionable
- Suggest 2-5 subtasks per feature
- Respect constraints (keep/discard items)
- Return ONLY the JSON, no other text before or after`;
}

// Construct the prompt for AI
function constructPrompt(userInput, context) {
    let prompt = `Project Goal: ${context.projectGoal}\n\n`;

    if (context.mode === 'full_project' && context.currentStructure) {
        prompt += `Current Structure:\n${JSON.stringify(context.currentStructure, null, 2)}\n\n`;
    } else if (context.mode === 'phase_level' && context.selectedPhase) {
        prompt += `Working on Phase: ${context.selectedPhase.name}\n`;
        prompt += `Current Features:\n${JSON.stringify(context.selectedPhase.features, null, 2)}\n\n`;
    } else if (context.mode === 'feature_level' && context.selectedFeature) {
        prompt += `Refining Feature: ${context.selectedFeature.name}\n`;
        prompt += `Current Subtasks:\n${JSON.stringify(context.selectedFeature.subtasks, null, 2)}\n\n`;
    }

    if (context.constraints?.keepItems?.length > 0) {
        prompt += `IMPORTANT: These items MUST be preserved:\n`;
        prompt += context.constraints.keepItems.map(item => `- ${item.name}`).join('\n');
        prompt += `\n\n`;
    }

    if (context.constraints?.discardItems?.length > 0) {
        prompt += `These items can be removed:\n`;
        prompt += context.constraints.discardItems.map(item => `- ${item.name}`).join('\n');
        prompt += `\n\n`;
    }

    prompt += `User Request: ${userInput}\n\n`;
    prompt += `Generate an updated project plan following the JSON format.`;

    return prompt;
}

// Parse AI response based on model
function parseAIResponse(model, data) {
    let aiText;

    switch (model) {
        case 'claude':
            aiText = data.content[0].text;
            break;

        case 'chatgpt':
            aiText = data.choices[0].message.content;
            break;

        case 'gemini':
            aiText = data.candidates[0].content.parts[0].text;
            break;

        default:
            throw new Error(`Unknown model: ${model}`);
    }

    // Remove markdown code fences if present
    const cleaned = aiText.replace(/```json\n?|```\n?/g, '').trim();

    try {
        const parsed = JSON.parse(cleaned);
        return {
            success: true,
            data: parsed,
            model: model
        };
    } catch (error) {
        return {
            success: false,
            error: `Failed to parse JSON from ${model}: ${error.message}`,
            rawResponse: aiText
        };
    }
}

// Main AI call function
export async function callAI(model, userPrompt, context) {
    const apiKey = await getAPIKey(model);

    if (!apiKey) {
        throw new Error(`API key not set for ${AI_CONFIGS[model].name}`);
    }

    const config = AI_CONFIGS[model];
    const prompt = constructPrompt(userPrompt, context);

    let requestBody;
    let endpoint = config.endpoint;

    switch (model) {
        case 'claude':
            requestBody = {
                model: config.modelName,
                max_tokens: 4096,
                messages: [{
                    role: 'user',
                    content: prompt
                }],
                system: getSystemPrompt()
            };
            break;

        case 'chatgpt':
            requestBody = {
                model: config.modelName,
                messages: [
                    { role: 'system', content: getSystemPrompt() },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.7
            };
            break;

        case 'gemini':
            endpoint = config.getUrl(apiKey);
            requestBody = {
                contents: [{
                    parts: [{
                        text: getSystemPrompt() + '\n\n' + prompt
                    }]
                }],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 4096
                }
            };
            break;
    }

    // Make API call
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: config.headers(apiKey),
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`${config.name} API error: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return parseAIResponse(model, data);
}

// Validate API key by making a test request
export async function validateAPIKey(model, apiKey) {
    try {
        const config = AI_CONFIGS[model];
        const testPrompt = "Respond with just the word 'success'";

        let requestBody;
        let endpoint = config.endpoint;

        switch (model) {
            case 'claude':
                requestBody = {
                    model: config.modelName,
                    max_tokens: 10,
                    messages: [{ role: 'user', content: testPrompt }]
                };
                break;

            case 'chatgpt':
                requestBody = {
                    model: config.modelName,
                    max_tokens: 10,
                    messages: [{ role: 'user', content: testPrompt }]
                };
                break;

            case 'gemini':
                endpoint = config.getUrl(apiKey);
                requestBody = {
                    contents: [{ parts: [{ text: testPrompt }] }],
                    generationConfig: { maxOutputTokens: 10 }
                };
                break;
        }

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: config.headers(apiKey),
            body: JSON.stringify(requestBody)
        });

        return response.ok;

    } catch (error) {
        console.error('API key validation failed:', error);
        return false;
    }
}

// Switch AI model for a project
export async function switchAIModel(project, newModel) {
    const hasKey = await hasAPIKey(newModel);

    if (!hasKey) {
        showNotification({
            type: 'warning',
            message: `API key required for ${AI_CONFIGS[newModel].name}`,
            action: {
                label: 'Add Key',
                callback: () => document.getElementById('settings-modal').classList.add('show')
            }
        });
        return false;
    }

    project.ai_model = newModel;

    showNotification({
        type: 'success',
        message: `Switched to ${AI_CONFIGS[newModel].name}`
    });

    return true;
}

// Get available models
export function getAvailableModels() {
    return Object.entries(AI_CONFIGS).map(([key, config]) => ({
        id: key,
        name: config.name
    }));
}

// Merge AI response with existing project structure
export function mergeAIResponse(aiResponse, project, constraints = {}) {
    const newPhases = aiResponse.phases || [];

    // If no constraints, return new structure directly
    if (!constraints.keepItems?.length && !constraints.discardItems?.length) {
        return newPhases;
    }

    // Preserve "keep" items
    if (constraints.keepItems?.length > 0) {
        for (const keepItem of constraints.keepItems) {
            // Find matching phase in new structure
            let found = false;
            for (const phase of newPhases) {
                const existingFeature = phase.features.find(f =>
                    f.name.toLowerCase() === keepItem.name.toLowerCase()
                );
                if (existingFeature) {
                    // Merge but preserve original properties
                    Object.assign(existingFeature, keepItem);
                    found = true;
                    break;
                }
            }

            // If not found in any phase, add to first phase
            if (!found && newPhases.length > 0) {
                newPhases[0].features.push(keepItem);
            }
        }
    }

    // Remove "discard" items
    if (constraints.discardItems?.length > 0) {
        for (const phase of newPhases) {
            phase.features = phase.features.filter(f =>
                !constraints.discardItems.some(d =>
                    d.name.toLowerCase() === f.name.toLowerCase()
                )
            );
        }
    }

    return newPhases;
}

// Build context for AI from project
export function buildAIContext(project, mode = 'full_project', selectedItem = null) {
    const context = {
        projectGoal: project.goal || project.name,
        mode,
        currentStructure: null,
        selectedPhase: null,
        selectedFeature: null,
        constraints: {
            keepItems: [],
            discardItems: []
        }
    };

    // Build current structure summary
    if (mode === 'full_project') {
        context.currentStructure = project.phases.map(p => ({
            name: p.name,
            description: p.description,
            features: p.features.map(f => ({
                name: f.name,
                description: f.description,
                status: f.status,
                marked_as: f.marked_as
            }))
        }));
    } else if (mode === 'phase_level' && selectedItem) {
        context.selectedPhase = selectedItem;
    } else if (mode === 'feature_level' && selectedItem) {
        context.selectedFeature = selectedItem;
    }

    // Collect keep/discard items
    for (const phase of project.phases) {
        for (const feature of phase.features) {
            if (feature.marked_as === 'keep') {
                context.constraints.keepItems.push(feature);
            } else if (feature.marked_as === 'discard') {
                context.constraints.discardItems.push(feature);
            }
        }
    }

    return context;
}
