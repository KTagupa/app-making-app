/**
 * Utility functions for the App Development Manager
 */

// Generate unique ID
export function generateId() {
    return 'id_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

// Format date for display
export function formatDate(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Format date for filenames
export function formatDateForFile(timestamp) {
    const date = new Date(timestamp);
    return date.toISOString().split('T')[0];
}

// Debounce function
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Throttle function
export function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// Deep clone object
export function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

// Show notification toast
export function showNotification(options) {
    const { type = 'info', message, duration = 3000, action = null } = options;
    
    // Remove existing notification
    const existing = document.querySelector('.notification-toast');
    if (existing) existing.remove();
    
    // Create notification element
    const toast = document.createElement('div');
    toast.className = `notification-toast notification-${type}`;
    
    const icons = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ'
    };
    
    toast.innerHTML = `
        <span class="notification-icon">${icons[type]}</span>
        <span class="notification-message">${message}</span>
        ${action ? `<button class="notification-action">${action.label}</button>` : ''}
        <button class="notification-close">×</button>
    `;
    
    document.body.appendChild(toast);
    
    // Trigger animation
    requestAnimationFrame(() => toast.classList.add('show'));
    
    // Handle action button
    if (action) {
        toast.querySelector('.notification-action').addEventListener('click', () => {
            action.callback();
            toast.remove();
        });
    }
    
    // Handle close button
    toast.querySelector('.notification-close').addEventListener('click', () => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    });
    
    // Auto-dismiss
    if (duration > 0) {
        setTimeout(() => {
            if (toast.parentNode) {
                toast.classList.remove('show');
                setTimeout(() => toast.remove(), 300);
            }
        }, duration);
    }
}

// Confirm dialog
export function confirmDialog(message, title = 'Confirm') {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal confirm-modal">
                <div class="modal-header">
                    <h3>${title}</h3>
                </div>
                <div class="modal-body">
                    <p>${message}</p>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" data-action="cancel">Cancel</button>
                    <button class="btn btn-danger" data-action="confirm">Confirm</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('show'));
        
        const handleAction = (confirmed) => {
            overlay.classList.remove('show');
            setTimeout(() => overlay.remove(), 300);
            resolve(confirmed);
        };
        
        overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => handleAction(false));
        overlay.querySelector('[data-action="confirm"]').addEventListener('click', () => handleAction(true));
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) handleAction(false);
        });
    });
}

// Prompt dialog
export function promptDialog(message, defaultValue = '', title = 'Input') {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal prompt-modal">
                <div class="modal-header">
                    <h3>${title}</h3>
                </div>
                <div class="modal-body">
                    <p>${message}</p>
                    <input type="text" class="form-input" value="${defaultValue}" />
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" data-action="cancel">Cancel</button>
                    <button class="btn btn-primary" data-action="submit">OK</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(overlay);
        requestAnimationFrame(() => {
            overlay.classList.add('show');
            overlay.querySelector('.form-input').focus();
        });
        
        const input = overlay.querySelector('.form-input');
        
        const handleAction = (submitted) => {
            overlay.classList.remove('show');
            setTimeout(() => overlay.remove(), 300);
            resolve(submitted ? input.value : null);
        };
        
        overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => handleAction(false));
        overlay.querySelector('[data-action="submit"]').addEventListener('click', () => handleAction(true));
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleAction(true);
        });
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) handleAction(false);
        });
    });
}

// Calculate progress percentage
export function calculateProgress(items, completedField = 'completed') {
    if (!items || items.length === 0) return { completed: 0, total: 0, percentage: 0 };
    const completed = items.filter(item => item[completedField]).length;
    return {
        completed,
        total: items.length,
        percentage: Math.round((completed / items.length) * 100)
    };
}

// Sanitize HTML to prevent XSS
export function sanitizeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Get contrasting text color for a background
export function getContrastColor(hexColor) {
    const r = parseInt(hexColor.slice(1, 3), 16);
    const g = parseInt(hexColor.slice(3, 5), 16);
    const b = parseInt(hexColor.slice(5, 7), 16);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness > 128 ? '#000000' : '#ffffff';
}
