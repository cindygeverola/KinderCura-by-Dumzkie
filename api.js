// api.js — shared helpers for KinderCura
// Important:
// - keeps login/session helpers in one place
// - keeps parent/pedia notification bell behavior consistent on every page
// - keeps parent child/assessment context in sync across dashboard, results, and recommendations
// - refreshes the saved user from /auth/me so the latest profile picture appears after signup/profile updates

const API = 'http://localhost:3001/api';

// Shared local-storage helper used across parent, pediatrician, and admin pages
const KC = {
    token:        () => localStorage.getItem('kc_token'),
    user:         () => { try { return JSON.parse(localStorage.getItem('kc_user')); } catch { return null; } },
    childId:      () => localStorage.getItem('kc_childId'),
    assessmentId: () => localStorage.getItem('kc_assessmentId'),
    set: (token, user, childId) => {
        localStorage.setItem('kc_token', token);
        localStorage.setItem('kc_user', JSON.stringify(user));
        if (childId) localStorage.setItem('kc_childId', childId);
    },
    clear: () => {
        ['kc_token','kc_user','kc_childId','kc_assessmentId','kc_viewChildId']
            .forEach((k) => localStorage.removeItem(k));
    }
};

// Shared fetch helper that automatically sends the JWT token
async function apiFetch(endpoint, options = {}) {
    const res = await fetch(`${API}${endpoint}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(KC.token() ? { Authorization: `Bearer ${KC.token()}` } : {}),
            ...options.headers
        }
    });

    let data = {};
    try {
        data = await res.json();
    } catch {
        data = {};
    }

    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
}

function requireAuth() {
    if (!KC.token()) {
        window.location.href = '/login.html';
        return false;
    }
    return true;
}

function logout() {
    KC.clear();
    window.location.href = '/login.html';
}

function fmtDate(d) {
    if (!d) return 'N/A';
    return new Date(d).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
    });
}

function fmtTime(t) {
    if (!t) return '';
    const s = String(t);
    if (s.includes('T') || s.includes('Z') || s.length > 8) {
        const d = new Date(s);
        if (!isNaN(d.getTime())) {
            return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        }
    }
    const parts = s.split(':');
    const h = parseInt(parts[0], 10);
    const m = parts[1] || '00';
    if (isNaN(h)) return s;
    return `${h % 12 || 12}:${m} ${h >= 12 ? 'PM' : 'AM'}`;
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[ch]));
}

function formatDateTime(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString('en-US', {
        year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
}

// Parent pages use one selected child at a time.
// These helpers keep dashboard/results/recommendations in sync.
function setParentContext(childId, assessmentId = null) {
    if (childId) localStorage.setItem('kc_childId', childId);
    if (assessmentId) localStorage.setItem('kc_assessmentId', assessmentId);
    else localStorage.removeItem('kc_assessmentId');
}

async function fetchParentChildren() {
    const data = await apiFetch('/children');
    return Array.isArray(data.children) ? data.children : [];
}

function getRequestedChildId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('childId') || KC.childId();
}

function getRequestedAssessmentId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('assessmentId') || KC.assessmentId();
}

async function getLatestCompletedAssessment(childId) {
    if (!childId) return null;
    const hist = await apiFetch(`/assessments/${childId}/history`);
    const completed = (hist.assessments || [])
        .filter((a) => (a.status === 'complete' || a.status === 'completed') && a.overallScore != null)
        .sort((a, b) => new Date(b.completedAt || b.startedAt || 0) - new Date(a.completedAt || a.startedAt || 0));
    return completed[0] || null;
}

function calcAgeDisplay(dob) {
    if (!dob) return '—';
    const d = new Date(dob);
    const now = new Date();
    let y = now.getFullYear() - d.getFullYear();
    let m = now.getMonth() - d.getMonth();
    if (m < 0) { y--; m += 12; }
    return y > 0 ? `${y} year${y > 1 ? 's' : ''} ${m} month${m !== 1 ? 's' : ''}` : `${m} month${m !== 1 ? 's' : ''}`;
}

// Decide where a notification should send the current user
function notificationDestination(n) {
    const role = String(KC.user()?.role || '').toLowerCase();
    const title = String(n?.title || '').toLowerCase();
    const type = String(n?.type || '').toLowerCase();
    const msg = String(n?.message || '').toLowerCase();

    if (role === 'pediatrician') {
        if (type === 'chat' || title.includes('message') || msg.includes('message from')) return '/pedia/pedia-chat.html';
        if (type === 'appointment' || title.includes('appointment') || msg.includes('appointment')) return '/pedia/pediatrician-appointments.html';
        if (title.includes('custom question') || title.includes('assessment question') || title.includes('question answered') || type === 'assessment') return '/pedia/pedia-questions.html';
        if (title.includes('diagnosis') || title.includes('review') || title.includes('recommendation')) return '/pedia/pediatrician-patients.html';
        return '/pedia/pediatrician-dashboard.html';
    }

    if (title.includes('review completed') || title.includes('diagnosis') || msg.includes('diagnosis') || msg.includes('open results')) {
        return '/parent/results.html';
    }
    if (title.includes('recommendation') || msg.includes('recommendation')) {
        return '/parent/recommendations.html';
    }
    if (type === 'appointment' || title.includes('appointment') || msg.includes('appointment')) {
        return '/parent/appointments.html';
    }
    if (type === 'chat' || title.includes('message') || msg.includes('message from')) {
        return '/parent/chat.html';
    }
    if (type === 'assessment' || title.includes('assessment question') || title.includes('custom question') || title.includes('new assessment question') || title.includes('question assigned') || msg.includes('assigned a new custom question')) {
        return '/parent/custom-questions.html';
    }
    return '/parent/dashboard.html';
}

// Applies one user object to all shared nav/profile UI.
function applyNavUser(user) {
    if (!user) return;

    const welcomeEl = document.getElementById('welcomeName') || document.getElementById('navWelcome') || document.querySelector('.menu-header p');
    if (welcomeEl) {
        welcomeEl.textContent = user.role === 'pediatrician'
            ? `Welcome, Dr. ${user.firstName || 'User'}`
            : `Welcome, ${user.firstName || 'User'}`;
    }

    const profileSrc = (user.profileIcon && String(user.profileIcon).startsWith('/uploads/'))
        ? user.profileIcon
        : '/icons/profile.png';

    document.querySelectorAll('.profile-icon').forEach((img) => {
        img.src = profileSrc;
        img.style.borderRadius = '50%';
        img.style.objectFit = 'cover';
    });
}

// Refreshes the saved user so the latest profile icon appears immediately
// after registration, profile edit, or redirects back to dashboard/results pages.
async function refreshCurrentUser() {
    if (!KC.token()) return KC.user();

    try {
        const data = await apiFetch('/auth/me');
        if (data && data.user) {
            const mergedUser = { ...(KC.user() || {}), ...data.user };
            localStorage.setItem('kc_user', JSON.stringify(mergedUser));
            return mergedUser;
        }
    } catch {
        // Keep cached user when the refresh endpoint is temporarily unavailable.
    }

    return KC.user();
}

async function initNav() {
    const cachedUser = KC.user();
    if (cachedUser) applyNavUser(cachedUser);

    const freshUser = await refreshCurrentUser();
    if (freshUser) applyNavUser(freshUser);

    loadNotificationCount();
}

// Keep the bell badge updated everywhere
async function loadNotificationCount() {
    const badge = document.querySelector('.notification-badge');
    if (!badge) return;

    try {
        const data = await apiFetch('/notifications/count');
        const unread = data.unread || 0;
        badge.textContent = unread;
        badge.style.display = unread > 0 ? 'flex' : 'none';
    } catch {
        badge.textContent = '0';
        badge.style.display = 'none';
    }
}

async function markNotificationRead(id) {
    try {
        await apiFetch(`/notifications/${id}/read`, { method: 'PUT' });
        await loadNotificationCount();
    } catch {}
}

async function deleteNotification(id) {
    if (!confirm('Remove this notification?')) return;
    try {
        await apiFetch(`/notifications/${id}`, { method: 'DELETE' });
        await openNotifications();
        await loadNotificationCount();
    } catch (err) {
        alert('Could not remove notification: ' + err.message);
    }
}

async function clearAllNotifications() {
    if (!confirm('Clear all notifications?')) return;
    try {
        await apiFetch('/notifications/clear-all', { method: 'DELETE' });
        await openNotifications();
        await loadNotificationCount();
    } catch (err) {
        alert('Could not clear notifications: ' + err.message);
    }
}

async function markAllNotificationsRead() {
    try {
        await apiFetch('/notifications/read-all', { method: 'PUT' });
        await openNotifications();
        await loadNotificationCount();
    } catch (err) {
        alert('Could not mark notifications as read: ' + err.message);
    }
}

// Mark read first, then move to the related page
async function goToNotificationTarget(id, target) {
    await markNotificationRead(id);
    window.location.href = target;
}

// Shared notification modal renderer used by parent and pediatrician pages
async function openNotifications() {
    const modal = document.getElementById('notificationsModal');
    const listEl = modal ? modal.querySelector('.notifications-list') : null;
    if (!modal || !listEl) return;

    modal.style.display = 'flex';
    listEl.innerHTML = '<p style="text-align:center;color:#888;padding:1rem;">Loading...</p>';

    try {
        const data = await apiFetch('/notifications');
        const notifications = Array.isArray(data.notifications) ? data.notifications : [];

        if (!notifications.length) {
            listEl.innerHTML = '<p style="text-align:center;color:#888;padding:1.5rem;">No notifications yet.</p>';
            return;
        }

        const hasUnread = notifications.some((n) => !n.isRead);
        const tools = `
            <div style="display:flex;justify-content:flex-end;gap:.6rem;padding:.8rem 1rem;border-bottom:1px solid var(--border);background:white;position:sticky;top:0;z-index:1;">
                ${hasUnread ? '<button onclick="markAllNotificationsRead()" style="border:1px solid var(--border);background:white;color:var(--primary);padding:.45rem .8rem;border-radius:8px;cursor:pointer;font-size:.8rem;font-weight:600;">Mark all read</button>' : ''}
                <button onclick="clearAllNotifications()" style="border:1px solid #e6b0b0;background:white;color:#c0392b;padding:.45rem .8rem;border-radius:8px;cursor:pointer;font-size:.8rem;font-weight:600;">Clear all</button>
            </div>`;

        const items = notifications.map((n) => {
            const dest = notificationDestination(n);
            const unreadStyle = n.isRead ? '' : 'background:#f0f7f0;border-left:3px solid var(--primary);';
            return `
                <div class="notification-item" style="display:flex;gap:.75rem;align-items:flex-start;justify-content:space-between;padding:1rem;border-bottom:1px solid var(--border);${unreadStyle}">
                    <div onclick="${dest ? `goToNotificationTarget(${n.id}, '${dest}')` : `markNotificationRead(${n.id})`}" style="flex:1;cursor:pointer;min-width:0;">
                        <p style="font-weight:${n.isRead ? '400' : '700'};font-size:.9rem;margin:0 0 .2rem;color:var(--text-dark);">${escapeHtml(n.title || '')}</p>
                        <p style="font-size:.82rem;color:#555;margin:0 0 .25rem;line-height:1.45;">${escapeHtml(n.message || '')}</p>
                        <p style="font-size:.75rem;color:#aaa;margin:0;">${formatDateTime(n.createdAt)}</p>
                        ${dest ? '<p style="font-size:.72rem;color:var(--primary);margin:.35rem 0 0;">Open related page →</p>' : ''}
                    </div>
                    <button onclick="event.stopPropagation();deleteNotification(${n.id})" title="Remove notification" style="border:none;background:none;color:#c0392b;cursor:pointer;font-size:1rem;line-height:1;padding:.15rem .25rem;">✕</button>
                </div>`;
        }).join('');

        listEl.innerHTML = tools + items;
    } catch {
        listEl.innerHTML = '<p style="text-align:center;color:#888;padding:1rem;">Could not load notifications.</p>';
    }
}

function closeNotifications() {
    const modal = document.getElementById('notificationsModal');
    if (modal) modal.style.display = 'none';
}

function toggleProfileMenu() {
    const menu = document.getElementById('profileMenu');
    if (menu) menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

async function downloadWithAuth(endpoint, filename = 'export.json') {
    const res = await fetch(`${API}${endpoint}`, {
        headers: { Authorization: `Bearer ${KC.token()}` }
    });

    if (!res.ok) {
        let msg = `Error ${res.status}`;
        try {
            const data = await res.json();
            msg = data.error || msg;
        } catch {}
        throw new Error(msg);
    }

    const data = await res.json();
    const blob = new Blob([JSON.stringify(data.data ?? data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('.profile-btn')) {
        const menu = document.getElementById('profileMenu');
        if (menu) menu.style.display = 'none';
    }
});

document.addEventListener('DOMContentLoaded', () => {
    initNav();
    document.querySelectorAll('a.logout').forEach((a) => {
        a.addEventListener('click', (e) => {
            e.preventDefault();
            logout();
        });
    });
});
