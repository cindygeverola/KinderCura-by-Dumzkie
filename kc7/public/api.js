// api.js — KinderCura shared helpers. Include on every page.
const API = 'http://localhost:3001/api';

const KC = {
    token: () => localStorage.getItem('kc_token'),
    user:  () => { try { return JSON.parse(localStorage.getItem('kc_user')); } catch { return null; } },
    childId: () => localStorage.getItem('kc_childId'),
    assessmentId: () => localStorage.getItem('kc_assessmentId'),
    set: (token, user, childId) => {
        localStorage.setItem('kc_token', token);
        localStorage.setItem('kc_user', JSON.stringify(user));
        if (childId) localStorage.setItem('kc_childId', childId);
    },
    clear: () => {
        ['kc_token','kc_user','kc_childId','kc_assessmentId'].forEach(k => localStorage.removeItem(k));
    }
};

// Base fetch with auth header
async function apiFetch(endpoint, options = {}) {
    const res = await fetch(`${API}${endpoint}`, {
        ...options,
        headers: { 'Content-Type':'application/json', ...(KC.token() ? { Authorization:`Bearer ${KC.token()}` } : {}), ...options.headers }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
}

// Redirect to login if not authenticated
function requireAuth() {
    if (!KC.token()) { window.location.href = 'login.html'; return false; }
    return true;
}

// Logout
function logout() {
    KC.clear();
    window.location.href = 'login.html';
}

// Inject logged-in user's name into nav welcome text
function initNav() {
    const user = KC.user();
    if (!user) return;

    // Only set welcome text if page hasn't already set it via id="welcomeName"
    const namedEl = document.getElementById('welcomeName');
    if (namedEl) {
        // Page controls its own welcome text (e.g. pedia uses "Dr. X") — don't overwrite
    } else {
        const w = document.querySelector('.menu-header p');
        if (w) w.textContent = `Welcome, ${user.firstName}`;
    }

    // Set profile picture in nav — use uploaded photo or fall back to default
    const navPics = document.querySelectorAll('.profile-icon');
    if (user.profileIcon && user.profileIcon.startsWith('/uploads/')) {
        navPics.forEach(img => {
            img.src = user.profileIcon;
            img.style.borderRadius = '50%';
            img.style.objectFit = 'cover';
        });
    }

    document.querySelectorAll('.nav-user-name').forEach(el => {
        el.textContent = user.firstName;
    });

    loadNotificationCount();
}

async function loadNotificationCount() {
    // Placeholder — extend if you add a notifications endpoint
}

// Notification badge count from localStorage (set after login)
function toggleProfileMenu() {
    const menu = document.getElementById('profileMenu');
    if (menu) menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}
function openNotifications() {
    const m = document.getElementById('notificationsModal');
    if (m) m.style.display = 'flex';
}
function closeNotifications() {
    const m = document.getElementById('notificationsModal');
    if (m) m.style.display = 'none';
}

// Close profile menu on outside click
document.addEventListener('click', (e) => {
    if (!e.target.closest('.profile-btn')) {
        const m = document.getElementById('profileMenu');
        if (m) m.style.display = 'none';
    }
});

// Wire logout links
document.addEventListener('DOMContentLoaded', () => {
    initNav();
    document.querySelectorAll('a.logout').forEach(a => {
        a.addEventListener('click', e => { e.preventDefault(); logout(); });
    });
});