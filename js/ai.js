/**
 * Multi-Model AI Integration
 * Supports Claude, ChatGPT, and Gemini
 */

import { getAPIKey, hasAPIKey } from './storage.js';
import { showNotification } from './utils.js';

// AI Model Configurations
const AI_CONFIGS = {
    gemini: {
        name: 'Gemini',
        endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
        headers: () => ({
            'Content-Type': 'application/json'
        }),
        modelName: 'gemini-2.5-flash',
        getUrl: (apiKey) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`
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
    if (model !== 'gemini') {
        throw new Error(`Unsupported model: ${model}`);
    }

    console.log('[AI] Parsing response from Gemini...');
    console.log('[AI] Raw response data:', JSON.stringify(data, null, 2));

    // Check if the response has the expected structure
    if (!data) {
        console.error('[AI] Response data is null or undefined');
        return {
            success: false,
            error: 'No response received from Gemini API',
            rawResponse: null
        };
    }

    // Check for API errors in the response
    if (data.error) {
        console.error('[AI] API returned error:', data.error);
        return {
            success: false,
            error: `Gemini API error: ${data.error.message || JSON.stringify(data.error)}`,
            rawResponse: data
        };
    }

    // Check for blocked content
    if (data.promptFeedback?.blockReason) {
        console.error('[AI] Content was blocked:', data.promptFeedback.blockReason);
        return {
            success: false,
            error: `Content blocked: ${data.promptFeedback.blockReason}`,
            rawResponse: data
        };
    }

    // Check for candidates array
    if (!data.candidates || !Array.isArray(data.candidates) || data.candidates.length === 0) {
        console.error('[AI] No candidates in response');
        return {
            success: false,
            error: 'Gemini returned no candidates. The request may have been filtered or failed.',
            rawResponse: data
        };
    }

    const candidate = data.candidates[0];

    // Check candidate finish reason
    if (candidate.finishReason && candidate.finishReason !== 'STOP') {
        console.warn('[AI] Candidate finish reason:', candidate.finishReason);
        if (candidate.finishReason === 'SAFETY') {
            return {
                success: false,
                error: 'Response was blocked due to safety filters',
                rawResponse: data
            };
        }
    }

    // Check for content
    if (!candidate.content) {
        console.error('[AI] Candidate has no content');
        return {
            success: false,
            error: 'Gemini response has no content',
            rawResponse: data
        };
    }

    // Check for parts
    if (!candidate.content.parts || candidate.content.parts.length === 0) {
        console.error('[AI] Content has no parts');
        return {
            success: false,
            error: 'Gemini response content is empty',
            rawResponse: data
        };
    }

    const aiText = candidate.content.parts[0].text;

    if (!aiText || typeof aiText !== 'string') {
        console.error('[AI] No text in response parts');
        return {
            success: false,
            error: 'Gemini returned no text content',
            rawResponse: data
        };
    }

    console.log('[AI] Extracted text:', aiText.substring(0, 500) + '...');

    // Remove markdown code fences if present
    const cleaned = aiText.replace(/```json\n?|```\n?/g, '').trim();

    try {
        const parsed = JSON.parse(cleaned);
        console.log('[AI] Successfully parsed JSON response');
        console.log('[AI] Parsed phases count:', parsed.phases?.length || 0);

        // Validate the parsed structure
        if (!parsed.phases || !Array.isArray(parsed.phases)) {
            return {
                success: false,
                error: 'AI response does not contain a valid "phases" array',
                rawResponse: aiText
            };
        }

        return {
            success: true,
            data: parsed,
            model: model
        };
    } catch (error) {
        console.error('[AI] JSON parse error:', error);
        console.error('[AI] Raw text that failed to parse:', cleaned.substring(0, 1000));
        return {
            success: false,
            error: `Failed to parse JSON from ${model}: ${error.message}`,
            rawResponse: aiText
        };
    }
}

// Main AI call function
export async function callAI(model, userPrompt, context) {
    console.log('[AI] Starting AI call...');
    console.log('[AI] Model:', model);
    console.log('[AI] User prompt:', userPrompt);

    if (model !== 'gemini') {
        throw new Error(`Only Gemini is supported now. Selected: ${model}`);
    }

    const apiKey = await getAPIKey(model);
    console.log('[AI] API key retrieved:', apiKey ? 'Yes (length: ' + apiKey.length + ')' : 'No');

    if (!apiKey) {
        throw new Error(`API key not set for ${AI_CONFIGS[model].name}. Please add your API key in Settings.`);
    }

    const config = AI_CONFIGS[model];
    const prompt = constructPrompt(userPrompt, context);
    console.log('[AI] Full prompt constructed (first 500 chars):', prompt.substring(0, 500));

    const endpoint = config.getUrl(apiKey);
    console.log('[AI] Endpoint:', endpoint.replace(apiKey, 'API_KEY_HIDDEN'));

    const requestBody = {
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

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        console.error('[AI] Request timed out after 60 seconds');
        controller.abort();
    }, 60000); // 60 second timeout

    try {
        console.log('[AI] Making fetch request...');
        const startTime = Date.now();

        // Make API call with timeout
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: config.headers(apiKey),
            body: JSON.stringify(requestBody),
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;
        console.log(`[AI] Response received in ${duration}ms`);
        console.log('[AI] Response status:', response.status, response.statusText);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('[AI] API Error Response:', errorData);
            throw new Error(`${config.name} API error (${response.status}): ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        console.log('[AI] Response JSON received, parsing...');

        return parseAIResponse(model, data);

    } catch (error) {
        clearTimeout(timeoutId);

        if (error.name === 'AbortError') {
            throw new Error('AI request timed out after 60 seconds. Please try again.');
        }

        console.error('[AI] Fetch error:', error);
        throw error;
    }
}

// Validate API key by making a test request
export async function validateAPIKey(model, apiKey) {
    if (model !== 'gemini') {
        return false;
    }

    try {
        const config = AI_CONFIGS[model];
        const testPrompt = "Respond with just the word 'success'";

        console.log(`Validating ${model} API key...`);

        const endpoint = config.getUrl(apiKey);
        const requestBody = {
            contents: [{ parts: [{ text: testPrompt }] }],
            generationConfig: { maxOutputTokens: 10 }
        };

        console.log('Request endpoint:', endpoint);
        console.log('Request body:', JSON.stringify(requestBody, null, 2));

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: config.headers(apiKey),
            body: JSON.stringify(requestBody)
        });

        console.log('Response status:', response.status, response.statusText);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error(`${config.name} API validation error:`, errorData);
            console.error('Full error details:', {
                status: response.status,
                statusText: response.statusText,
                errorData
            });
        }

        return response.ok;

    } catch (error) {
        console.error('API key validation failed:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack
        });
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
