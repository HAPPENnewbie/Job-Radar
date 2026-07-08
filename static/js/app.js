/* ============================================================
   就业雷达 - 全局前端逻辑
   目标：所有页面共用，但任何页面缺少某个 DOM 时不得中断初始化。
   ============================================================ */

const state = {
    track: (window.JOB_RADAR_SETTINGS && window.JOB_RADAR_SETTINGS.default_track) || 'all',
    filter: '',
    search: '',
    opps: [],
    events: [],
    tlAllEvents: [],
    favorites: [],
};
window.state = state;

const JR_SETTINGS = window.JOB_RADAR_SETTINGS || {};
const DEFAULT_CATEGORY_GROUPS = [
    { track: '体制/准体制', categories: ['公务员', '事业单位', '烟草', '国企/央企', '银行'] },
    { track: '互联网/市场化', categories: ['计算机秋招', '互联网大厂', '中小厂', '远程岗位'] },
];

function splitCategoryItems(value) {
    if (value === null || value === undefined) return [];
    return String(value)
        .replace(/\\n/g, '\n')
        .split(/[，,、;；\n\r/|]+/)
        .map(v => v.trim())
        .filter(Boolean);
}

function normalizeCategoryGroups(raw) {
    const source = Array.isArray(raw) && raw.length ? raw : DEFAULT_CATEGORY_GROUPS;
    const seenTracks = new Set();
    return source.map(group => {
        const track = String(group && group.track || '').trim();
        let categories = group && group.categories ? group.categories : [];
        if (typeof categories === 'string') categories = splitCategoryItems(categories);
        const expanded = [];
        (Array.isArray(categories) ? categories : []).forEach(item => {
            expanded.push(...splitCategoryItems(item));
        });
        const seenCats = new Set();
        categories = expanded.filter(v => {
            if (!v || seenCats.has(v)) return false;
            seenCats.add(v);
            return true;
        });
        return { track, categories };
    }).filter(group => {
        if (!group.track || seenTracks.has(group.track)) return false;
        seenTracks.add(group.track);
        return true;
    });
}

const JR_CATEGORY_GROUPS = normalizeCategoryGroups(JR_SETTINGS.categories);
window.JR_CATEGORY_GROUPS = JR_CATEGORY_GROUPS;
const TL_START = JR_SETTINGS.timeline_start || '2026-07';
const TL_END = JR_SETTINGS.timeline_end || '2027-12';
const AXIS_Y = 140;

function $(id) { return document.getElementById(id); }

const oppList       = $('opp-list');
const tlTrack       = $('tl-track');
const tlTooltip     = $('tl-tooltip');
const tlDetailModal = $('tl-detail-modal');
const tlDetailBody  = $('tl-detail-body');
const tlDetailList  = $('tl-detail_list');
const detailSearch  = $('detail-search');
const oppCount      = $('opp-count');
const eventCount    = $('event-count');
const searchBox     = $('search-input');
const filterSel     = $('filter-select');
const recentEl      = $('recent-events');
const lastUpdEl     = $('last-update');
const modalOpp      = $('modal-opp');
const modalEv       = $('modal-event');
const modalFav      = $('modal-fav');
const confirmDlg    = $('confirm-dialog');
const confirmMsg    = $('confirm-msg');
const fileInput     = $('file-import');
const favList       = $('fav-list');
const favCount      = $('fav-count');
const favSearch     = $('fav-search');
const todoContainer = $('todo-container');

let confirmCallback = null;
let hideTooltipTimer = null;

/* ============================================================
   通用工具
   ============================================================ */
function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function linkHtml(url, label) {
    if (!url) return '';
    return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
}

function statusTag(s) {
    if (!s) return '';
    const cls = {
        '参考往年': 'tag-ref',
        '官方已确定': 'tag-confirmed',
        '待更新': 'tag-pending',
        '已放弃': 'tag-abandoned',
        '已结束': 'tag-abandoned',
    }[s] || 'tag-ref';
    return `<span class="tag ${cls}">${esc(s)}</span>`;
}

function priorityTag(p) {
    if (!p) return '';
    const cls = {
        '重点关注': 'tag-p-high',
        '可以关注': 'tag-p-mid',
        '低频关注': 'tag-p-low',
    }[p] || 'tag-p-mid';
    return `<span class="tag ${cls}">${esc(p)}</span>`;
}

function trackTag(t) {
    if (!t) return '';
    const cls = String(t).includes('体制') ? 'tag-track-sys' : 'tag-track-mkt';
    return `<span class="tag ${cls}">${esc(t)}</span>`;
}

function categoryTracks() {
    return JR_CATEGORY_GROUPS.map(group => group.track);
}

function firstTrackValue() {
    return categoryTracks()[0] || '体制/准体制';
}

function categoriesForTrack(track) {
    const group = JR_CATEGORY_GROUPS.find(g => g.track === track);
    return group ? group.categories : [];
}

function selectHasValue(select, value) {
    if (!select || value === undefined || value === null) return false;
    return Array.from(select.options).some(opt => opt.value === String(value));
}

function setSelectOptions(select, options, selected, placeholder) {
    if (!select) return;
    const current = selected || select.value || '';
    const opts = [];
    if (placeholder !== undefined) opts.push({ value: '', label: placeholder });
    options.forEach(item => {
        if (typeof item === 'string') opts.push({ value: item, label: item });
        else opts.push(item);
    });
    select.innerHTML = opts.map(opt => `<option value="${esc(opt.value)}">${esc(opt.label || opt.value)}</option>`).join('');
    if (current && !selectHasValue(select, current)) {
        const legacy = document.createElement('option');
        legacy.value = current;
        legacy.textContent = `${current}（历史值）`;
        select.appendChild(legacy);
    }
    if (current && selectHasValue(select, current)) select.value = current;
    else if (placeholder !== undefined) select.value = '';
    else if (select.options.length) select.selectedIndex = 0;
}

function populateTrackSelect(selectId, selected, includeAll = false) {
    const select = $(selectId);
    if (!select) return;
    const options = categoryTracks().map(track => ({ value: track, label: track }));
    if (includeAll) options.unshift({ value: 'all', label: '全部' });
    setSelectOptions(select, options, selected || (includeAll ? 'all' : firstTrackValue()));
}

function populateCategorySelect(selectId, track, selected, placeholder = '请选择具体类别') {
    const select = $(selectId);
    if (!select) return;
    const categories = categoriesForTrack(track);
    setSelectOptions(select, categories, selected, categories.length ? placeholder : '当前大类暂无二级分类');
}

function populateOpportunityCategoryControls(selectedTrack, selectedCategory) {
    const track = selectedTrack || firstTrackValue();
    populateTrackSelect('opp-track', track);
    populateCategorySelect('opp-category', track, selectedCategory, '请选择具体类别');
}

function populateEventCategoryControls(selectedTrack, selectedCategory) {
    const track = selectedTrack || firstTrackValue();
    populateTrackSelect('event-track', track);
    populateCategorySelect('event-category', track, selectedCategory, '请选择所属类别');
}

function renderTrackFilterButtons() {
    const trackFilter = $('track-filter');
    if (!trackFilter) return;
    const signature = JSON.stringify(categoryTracks());
    if (trackFilter.dataset.categorySignature === signature) return;
    const active = state.track && state.track !== 'all' ? state.track : '';
    const buttons = [
        { value: '', label: '全部' },
        ...categoryTracks().map(track => ({ value: track, label: track })),
    ];
    trackFilter.innerHTML = buttons.map(btn => `
        <button class="filter-tab ${btn.value === active ? 'active' : ''}" data-value="${esc(btn.value)}">${esc(btn.label)}</button>
    `).join('');
    trackFilter.dataset.categorySignature = signature;
    trackFilter.dataset.bound = '0';
}

function actionTag(a) {
    if (!a) return '';
    return `<span class="tag tag-action">${esc(a)}</span>`;
}

function matchStatusTag(s) {
    if (!s) return '';
    const cls = {
        '可能可报': 'tag-confirmed',
        '需要确认': 'tag-pending',
        '明显不符': 'tag-abandoned',
        '未判断': 'tag-ref',
    }[s] || 'tag-ref';
    return `<span class="tag ${cls}">${esc(s)}</span>`;
}

function safeInvoke(name, fn) {
    try {
        if (typeof fn === 'function') fn();
    } catch (err) {
        console.error(`${name} 执行失败`, err);
    }
}

async function fetchJson(url, options = {}) {
    const resp = await fetch(url, options);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.ok === false) {
        const err = new Error(data.error || `HTTP ${resp.status}`);
        err.response = resp;
        err.data = data;
        throw err;
    }
    return data;
}

function getCurrentMonth() {
    const now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
}

function addMonths(monthStr, offset) {
    const [y, m] = String(monthStr || getCurrentMonth()).split('-').map(Number);
    const d = new Date(y, (m || 1) - 1 + offset, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function monthDiffInclusiveForAxis(start, end) {
    const [sy, sm] = String(start || '2026-07').split('-').map(Number);
    const [ey, em] = String(end || '2027-12').split('-').map(Number);
    const diff = (ey - sy) * 12 + (em - sm) + 1;
    return Number.isFinite(diff) && diff > 0 ? diff : 1;
}

function generateMonthTicks(start = TL_START, end = TL_END) {
    const months = [];
    let cur = start;
    let guard = 0;
    while (cur <= end && guard < 120) {
        months.push(cur);
        cur = addMonths(cur, 1);
        guard += 1;
    }
    return months.length ? months : ['2026-07'];
}

function monthToPercent(month) {
    if (!month) return null;
    const [sy, sm] = TL_START.split('-').map(Number);
    const [y, m] = String(month).split('-').map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(m)) return null;
    const idx = (y - sy) * 12 + (m - sm);
    const total = Math.max(1, monthDiffInclusiveForAxis(TL_START, TL_END) - 1);
    return Math.max(0, Math.min(100, (idx / total) * 100));
}

function pctToLeft(pct) {
    return `calc(40px + (100% - 80px) * ${pct / 100})`;
}

function getEventPercent(ev) {
    if (ev.date || ev.event_date) {
        const raw = ev.event_date || ev.date;
        const month = raw.slice(0, 7);
        return monthToPercent(month);
    }
    return monthToPercent(ev.month);
}

function statusDotClass(s) {
    if (s === '官方已确定') return 's-confirmed';
    if (s === '待更新') return 's-pending';
    if (s === '已放弃' || s === '已结束') return 's-abandoned';
    return 's-reference';
}

function trackDotClass(t) {
    if (t === '体制/准体制') return 't-system';
    if (t === '互联网/市场化') return 't-market';
    return 't-other';
}

function parseTimePartForDisplay(part) {
    const raw = String(part || '').trim();
    const dayMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dayMatch) {
        return {
            raw,
            type: 'day',
            year: Number(dayMatch[1]),
            month: Number(dayMatch[2]),
            day: Number(dayMatch[3]),
        };
    }
    const monthMatch = raw.match(/^(\d{4})-(\d{2})$/);
    if (monthMatch) {
        return {
            raw,
            type: 'month',
            year: Number(monthMatch[1]),
            month: Number(monthMatch[2]),
            day: null,
        };
    }
    return null;
}

function formatSingleTimePartForDisplay(part, compact = false) {
    const parsed = parseTimePartForDisplay(part);
    if (!parsed) return String(part || '').trim();
    if (parsed.type === 'day') {
        return compact
            ? `${parsed.year}.${String(parsed.month).padStart(2, '0')}.${String(parsed.day).padStart(2, '0')}`
            : `${parsed.year}年${parsed.month}月${parsed.day}日`;
    }
    return compact
        ? `${parsed.year}.${String(parsed.month).padStart(2, '0')}`
        : `${parsed.year}年${parsed.month}月`;
}

function formatTimeRangeForDisplay(start, end, compact = false) {
    const a = parseTimePartForDisplay(start);
    const b = parseTimePartForDisplay(end);
    if (!a || !b) {
        return `${formatSingleTimePartForDisplay(start, compact)}-${formatSingleTimePartForDisplay(end, compact)}`;
    }

    if (compact) {
        if (a.type === 'month' && b.type === 'month' && a.year === b.year) {
            return `${a.year}.${String(a.month).padStart(2, '0')}-${String(b.month).padStart(2, '0')}`;
        }
        if (a.type === 'day' && b.type === 'day' && a.year === b.year && a.month === b.month) {
            return `${a.year}.${String(a.month).padStart(2, '0')}.${String(a.day).padStart(2, '0')}-${String(b.day).padStart(2, '0')}`;
        }
        if (a.type === 'day' && b.type === 'day' && a.year === b.year) {
            return `${a.year}.${String(a.month).padStart(2, '0')}.${String(a.day).padStart(2, '0')}-${String(b.month).padStart(2, '0')}.${String(b.day).padStart(2, '0')}`;
        }
        return `${formatSingleTimePartForDisplay(start, true)}-${formatSingleTimePartForDisplay(end, true)}`;
    }

    if (a.type === 'month' && b.type === 'month' && a.year === b.year) {
        return `${a.year}年${a.month}–${b.month}月`;
    }
    if (a.type === 'day' && b.type === 'day' && a.year === b.year && a.month === b.month) {
        return `${a.year}年${a.month}月${a.day}–${b.day}日`;
    }
    if (a.type === 'day' && b.type === 'day' && a.year === b.year) {
        return `${a.year}年${a.month}月${a.day}日–${b.month}月${b.day}日`;
    }
    return `${formatSingleTimePartForDisplay(start, false)} 至 ${formatSingleTimePartForDisplay(end, false)}`;
}

function formatTimeValueSafe(value, options = {}) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const compact = Boolean(options.compact);
    if (raw.includes('~')) {
        const [start, end] = raw.split('~').map(s => s.trim());
        if (!start || !end) return raw;
        return formatTimeRangeForDisplay(start, end, compact);
    }
    return formatSingleTimePartForDisplay(raw, compact);
}


function installWindowFunctions() {
    window.state = state;
    window.renderOpps = renderOpps;
    window.openOppModal = openOppModal;
    window.saveOpp = saveOpp;
    window.editOpp = editOpp;
    window.delOpp = delOpp;
    window.setOppStatus = setOppStatus;
    window.syncTimeline = syncTimeline;
    window.favoriteOpp = favoriteOpp;
    window.unfavoriteOpp = unfavoriteOpp;
    window.openFavModal = openFavModal;
    window.saveFav = saveFav;
    window.editFav = editFav;
    window.delFav = delFav;
    window.renderFavorites = renderFavorites;
    window.loadData = loadData;
    window.loadOpps = loadOpps;
    window.loadTl = loadTl;
    window.loadFavorites = loadFavorites;
}

/* ============================================================
   初始化
   ============================================================ */
document.addEventListener('DOMContentLoaded', init);

function init() {
    installWindowFunctions();
    bindSidebar();
    bindCommonEvents();
    loadData();
}

function bindSidebar() {
    const sidebarToggle = $('sidebar-toggle');
    const sidebar = document.querySelector('.sidebar');
    const mainContent = document.querySelector('.main-content');
    if (sidebarToggle) {
        sidebarToggle.setAttribute('aria-expanded', document.documentElement.classList.contains('sidebar-collapsed') ? 'false' : 'true');
    }
    bindSidebarResize(sidebar);

    if (sidebarToggle && sidebar && !sidebarToggle.dataset.mobileBound) {
        sidebarToggle.dataset.mobileBound = '1';
        sidebarToggle.addEventListener('click', (e) => {
            if (window.innerWidth <= 1024) {
                sidebar.classList.toggle('open');
                return;
            }
            e.preventDefault();
            const root = document.documentElement;
            root.classList.toggle('sidebar-collapsed');
            const collapsed = root.classList.contains('sidebar-collapsed');
            sidebarToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            try {
                localStorage.setItem('jrSidebarCollapsed', collapsed ? '1' : '0');
            } catch (err) {}
        });
    }

    if (mainContent && sidebar && !mainContent.dataset.sidebarCloseBound) {
        mainContent.dataset.sidebarCloseBound = '1';
        mainContent.addEventListener('click', () => {
            if (window.innerWidth <= 1024) sidebar.classList.remove('open');
        });
    }
}


function bindSidebarResize(sidebar) {
    if (!sidebar || sidebar.dataset.resizeReady === '1') return;
    sidebar.dataset.resizeReady = '1';

    const root = document.documentElement;
    const savedWidth = Number(localStorage.getItem('jrSidebarWidth') || 0);
    if (savedWidth >= 220 && savedWidth <= 360 && window.innerWidth > 1024) {
        root.style.setProperty('--sidebar-w', `${savedWidth}px`);
    }

    let handle = sidebar.querySelector('.sidebar-resizer');
    if (!handle) {
        handle = document.createElement('div');
        handle.className = 'sidebar-resizer';
        handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-orientation', 'vertical');
        handle.setAttribute('title', '拖动调整侧边栏宽度');
        sidebar.appendChild(handle);
    }

    let startX = 0;
    let startWidth = 0;
    let dragging = false;

    const clampWidth = (value) => Math.max(220, Math.min(360, value));

    handle.addEventListener('pointerdown', (e) => {
        if (window.innerWidth <= 1024 || root.classList.contains('sidebar-collapsed')) return;
        dragging = true;
        startX = e.clientX;
        startWidth = sidebar.getBoundingClientRect().width;
        handle.setPointerCapture(e.pointerId);
        root.classList.add('sidebar-resizing');
        e.preventDefault();
    });

    handle.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const next = clampWidth(startWidth + e.clientX - startX);
        root.style.setProperty('--sidebar-w', `${next}px`);
        localStorage.setItem('jrSidebarWidth', String(Math.round(next)));
    });

    const stopDrag = (e) => {
        if (!dragging) return;
        dragging = false;
        root.classList.remove('sidebar-resizing');
        try { handle.releasePointerCapture(e.pointerId); } catch (err) {}
    };
    handle.addEventListener('pointerup', stopDrag);
    handle.addEventListener('pointercancel', stopDrag);
}

function bindCommonEvents() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn.dataset.bound === '1') return;
        btn.dataset.bound = '1';
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.track = btn.dataset.track || 'all';
            loadData();
        });
    });

    bindOpportunityFilters();

    if (detailSearch && !detailSearch.dataset.bound) {
        detailSearch.dataset.bound = '1';
        let detailTimer;
        detailSearch.addEventListener('input', () => {
            clearTimeout(detailTimer);
            detailTimer = setTimeout(() => renderDetailList(), 200);
        });
    }

    if (tlTooltip && !tlTooltip.dataset.bound) {
        tlTooltip.dataset.bound = '1';
        tlTooltip.addEventListener('mouseleave', () => { tlTooltip.style.display = 'none'; });
    }

    if (searchBox && !searchBox.dataset.bound) {
        searchBox.dataset.bound = '1';
        let searchTimer;
        searchBox.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                state.search = searchBox.value.trim();
                loadOpps();
            }, 300);
        });
    }

    if (filterSel && !filterSel.dataset.bound) {
        filterSel.dataset.bound = '1';
        filterSel.addEventListener('change', () => {
            state.filter = filterSel.value;
            loadOpps();
        });
    }

    bindClick('btn-add-opp', () => openOppModal(null));
    bindClick('btn-add-event', () => openEvModal(null));
    bindClick('btn-add-fav', () => openFavModal(null));
    bindClick('btn-export', exportData);
    bindClick('btn-export-fav', exportFavorites);
    bindClick('btn-reset', () => showConfirm('确认重置为默认数据？当前数据将被全部清除。', resetData));

    if (fileInput && !fileInput.dataset.bound) {
        fileInput.dataset.bound = '1';
        fileInput.addEventListener('change', handleImport);
    }

    if (favSearch && !favSearch.dataset.bound) {
        favSearch.dataset.bound = '1';
        let favTimer;
        favSearch.addEventListener('input', () => {
            clearTimeout(favTimer);
            favTimer = setTimeout(() => renderFavorites(), 200);
        });
    }

    ['fav-filter-region', 'fav-filter-track', 'fav-filter-match'].forEach(id => {
        const el = $(id);
        if (el && !el.dataset.bound) {
            el.dataset.bound = '1';
            el.addEventListener('change', () => renderFavorites());
        }
    });

    document.querySelectorAll('[data-close]').forEach(btn => {
        if (btn.dataset.closeBound === '1') return;
        btn.dataset.closeBound = '1';
        btn.addEventListener('click', () => {
            const modal = $(btn.dataset.close);
            if (modal) modal.style.display = 'none';
        });
    });

    [modalOpp, modalEv, modalFav, confirmDlg, tlDetailModal].forEach(m => {
        if (m && !m.dataset.maskBound) {
            m.dataset.maskBound = '1';
            m.addEventListener('click', e => { if (e.target === m) m.style.display = 'none'; });
        }
    });

    if (!document.body.dataset.escBound) {
        document.body.dataset.escBound = '1';
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                [modalOpp, modalEv, modalFav, confirmDlg, tlDetailModal].forEach(m => {
                    if (m) m.style.display = 'none';
                });
            }
        });
    }

    bindSubmit('form-opp', window.saveOpp || saveOpp);
    bindSubmit('form-event', window.saveEv || saveEv);
    bindSubmit('form-fav', window.saveFav || saveFav);

    const oppTrack = $('opp-track');
    if (oppTrack && oppTrack.dataset.categoryBound !== '1') {
        oppTrack.dataset.categoryBound = '1';
        oppTrack.addEventListener('change', () => populateCategorySelect('opp-category', oppTrack.value, '', '请选择具体类别'));
    }
    const eventTrack = $('event-track');
    if (eventTrack && eventTrack.dataset.categoryBound !== '1') {
        eventTrack.dataset.categoryBound = '1';
        eventTrack.addEventListener('change', () => populateCategorySelect('event-category', eventTrack.value, '', '请选择所属类别'));
    }
    const eventOppSelect = $('event-opportunity-id');
    if (eventOppSelect && eventOppSelect.dataset.categoryBound !== '1') {
        eventOppSelect.dataset.categoryBound = '1';
        eventOppSelect.addEventListener('change', () => {
            const opp = (state.opps || []).find(o => String(o.id) === String(eventOppSelect.value));
            if (!opp) return;
            populateEventCategoryControls(opp.track || firstTrackValue(), opp.category || '');
            if (!$('event-title')?.value) setValue('event-title', `${opp.name} 时间节点`);
            if (!$('event-link')?.value) setValue('event-link', opp.announcement_url || opp.official_url || '');
        });
    }

    bindConfirmButtons();
}


function bindOpportunityFilters() {
    renderTrackFilterButtons();
    const trackFilter = $('track-filter');
    if (trackFilter && trackFilter.dataset.bound !== '1') {
        trackFilter.dataset.bound = '1';
        trackFilter.querySelectorAll('.filter-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                trackFilter.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                state.track = btn.dataset.value || 'all';
                loadOpps();
            });
        });
    }

    ['filter-priority', 'filter-region', 'filter-status', 'filter-action'].forEach(id => {
        const el = $(id);
        if (!el || el.dataset.bound === '1') return;
        el.dataset.bound = '1';
        el.addEventListener('change', () => loadOpps());
    });

    const clearBtn = $('btn-clear-search');
    if (clearBtn && clearBtn.dataset.bound !== '1') {
        clearBtn.dataset.bound = '1';
        clearBtn.addEventListener('click', () => {
            state.search = '';
            if (searchBox) searchBox.value = '';
            ['filter-priority', 'filter-region', 'filter-status', 'filter-action'].forEach(id => {
                const el = $(id);
                if (el) el.value = '';
            });
            state.track = 'all';
            if (trackFilter) {
                trackFilter.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
                const allBtn = trackFilter.querySelector('.filter-tab[data-value=""]');
                if (allBtn) allBtn.classList.add('active');
            }
            loadOpps();
        });
    }
}

function bindClick(id, handler) {
    const el = $(id);
    if (!el || el.dataset.bound === '1') return;
    el.dataset.bound = '1';
    el.addEventListener('click', handler);
}

function bindSubmit(id, handler) {
    const el = $(id);
    if (!el || el.dataset.submitBound === '1') return;
    el.dataset.submitBound = '1';
    el.addEventListener('submit', handler);
}

function bindConfirmButtons() {
    const yes = $('confirm-yes');
    const no = $('confirm-no');
    if (yes && !yes.dataset.bound) {
        yes.dataset.bound = '1';
        yes.addEventListener('click', () => {
            if (confirmDlg) confirmDlg.style.display = 'none';
            const cb = confirmCallback;
            confirmCallback = null;
            if (cb) cb();
        });
    }
    if (no && !no.dataset.bound) {
        no.dataset.bound = '1';
        no.addEventListener('click', () => {
            if (confirmDlg) confirmDlg.style.display = 'none';
            confirmCallback = null;
        });
    }
}

/* ============================================================
   数据加载
   ============================================================ */
async function loadData() {
    const tasks = [loadOpps(), loadTl(), loadFavorites()];
    const results = await Promise.allSettled(tasks);
    results.forEach((r, idx) => {
        if (r.status === 'rejected') {
            const name = ['机会', '时间线', '岗位收藏'][idx];
            console.error(`加载${name}失败`, r.reason);
        }
    });

    safeInvoke('renderOpps', renderOpps);
    safeInvoke('updateSummary', updateSummary);
    safeInvoke('renderStats', renderStats);
    safeInvoke('renderTodoView', renderTodoView);
    safeInvoke('renderDbInfo', renderDbInfo);
    safeInvoke('renderHomeOverview', renderHomeOverview);
}

async function loadOpps() {
    const params = buildOppParams();
    const resp = await fetch('/api/opportunities?' + params.toString());
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    state.opps = await resp.json();
    safeInvoke('renderOpps', renderOpps);
}

async function loadTl() {
    const resp = await fetch('/api/timeline');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    state.tlAllEvents = await resp.json();
    state.events = state.tlAllEvents;
    safeInvoke('renderTimeline', renderTimeline);
    safeInvoke('renderDetailList', renderDetailList);
}

async function loadFavorites() {
    const resp = await fetch('/api/job-favorites');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    state.favorites = await resp.json();
    safeInvoke('renderFavorites', renderFavorites);
}

function buildOppParams() {
    const params = new URLSearchParams();
    if (state.track && state.track !== 'all') params.set('track', state.track);
    if (state.search) params.set('q', state.search);
    if (state.filter) {
        const [key, val] = state.filter.split(':');
        if (key === 'track')    params.set('track', val);
        if (key === 'priority') params.set('priority', val);
        if (key === 'region')   params.set('region', val);
        if (key === 'fit')      params.set('fit_computer_master', val);
        if (key === 'status')   params.set('status', val);
        if (key === 'action')   params.set('current_action', val);
    }
    ['filter-priority', 'filter-region', 'filter-status', 'filter-action'].forEach(id => {
        const el = $(id);
        if (!el || !el.value) return;
        if (id === 'filter-priority') params.set('priority', el.value);
        if (id === 'filter-region') params.set('region', el.value);
        if (id === 'filter-status') params.set('status', el.value);
        if (id === 'filter-action') params.set('current_action', el.value);
    });
    return params;
}

/* ============================================================
   首页 / 数据管理 / 统计
   ============================================================ */
function updateSummary() {
    if (!recentEl && !lastUpdEl) return;
    const curMonth = getCurrentMonth();
    const upcoming = (state.events || [])
        .filter(e => (e.month || '') >= curMonth)
        .filter(e => e.status !== '已放弃')
        .sort((a, b) => String(a.month || '').localeCompare(String(b.month || '')))
        .slice(0, 3);

    if (recentEl) {
        recentEl.textContent = upcoming.length
            ? upcoming.map(e => `${e.month} ${e.title}`).join(' / ')
            : '暂无近期节点';
    }

    if (lastUpdEl) {
        const all = [...(state.opps || []), ...(state.events || []), ...(state.favorites || [])];
        const times = all.map(x => x.updated_at).filter(Boolean).sort().reverse();
        lastUpdEl.textContent = times.length ? times[0] : '-';
    }
}

function renderDbInfo() {
    const oppCountEl = $('db-opp-count');
    const eventCountEl = $('db-event-count');
    const favCountEl = $('db-fav-count');
    if (!oppCountEl && !eventCountEl && !favCountEl) return;
    if (oppCountEl) oppCountEl.textContent = (state.opps || []).length;
    if (eventCountEl) eventCountEl.textContent = (state.tlAllEvents || []).length;
    if (favCountEl) favCountEl.textContent = (state.favorites || []).length;
}

function renderStats() {
    const statTotal = $('stat-total');
    if (!statTotal) return;
    const opps = state.opps || [];
    const existingOppIds = new Set(opps.map(o => String(o.id)));
    const events = (state.tlAllEvents || []).filter(e => !e.opportunity_id || existingOppIds.has(String(e.opportunity_id)));
    const favs = state.favorites || [];

    setText('stat-total', opps.length);
    setText('stat-priority', opps.filter(o => o.priority === '重点关注').length);
    setText('stat-pending', opps.filter(o => o.status === '待更新').length);
    setText('stat-confirmed', opps.filter(o => o.status === '官方已确定').length);
    setText('stat-favorites', favs.length);

    const curMonth = getCurrentMonth();
    const nextMonth = addMonths(curMonth, 1);
    setText('stat-recent', events.filter(e => e.month >= curMonth && e.month <= nextMonth).length);

    const overdueItems = opps.filter(o =>
        (o.status === '参考往年' || o.status === '待更新') &&
        ['等公告', '等报名', '待投递', '待笔试', '待面试'].includes(o.current_action)
    );
    setText('stat-overdue', overdueItems.length);

    const total = opps.length || 1;
    const confirmed = opps.filter(o => o.status === '官方已确定').length;
    const pending = opps.filter(o => o.status === '待更新').length;
    const reference = opps.filter(o => o.status === '参考往年').length;
    const abandoned = opps.filter(o => o.status === '已放弃').length;
    setWidth('status-confirmed', confirmed / total * 100);
    setWidth('status-pending', pending / total * 100);
    setWidth('status-reference', reference / total * 100);
    setWidth('status-abandoned', abandoned / total * 100);
    setText('legend-confirmed', confirmed);
    setText('legend-pending', pending);
    setText('legend-reference', reference);
    setText('legend-abandoned', abandoned);
}

function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
}

function setWidth(id, pct) {
    const el = $(id);
    if (el) el.style.width = `${pct}%`;
}

function renderHomeOverview() {
    const recentNodesEl = $('recent-nodes');
    const todoSummaryEl = $('todo-summary');
    if (!recentNodesEl && !todoSummaryEl) return;
    const curMonth = getCurrentMonth();
    const events = state.tlAllEvents || [];
    const opps = state.opps || [];

    if (recentNodesEl) {
        const upcoming = events
            .filter(e => (e.month || '') >= curMonth)
            .filter(e => e.status !== '已放弃')
            .sort((a, b) => (a.event_date || a.date || `${a.month}-01`).localeCompare(b.event_date || b.date || `${b.month}-01`))
            .slice(0, 5);
        recentNodesEl.innerHTML = upcoming.length ? upcoming.map(e => `
            <div class="recent-node-item">
                <div class="recent-node-month">${esc(e.event_date || e.date || e.month)}</div>
                <div class="recent-node-content">
                    <div class="recent-node-title">${esc(e.title)}</div>
                    <div class="recent-node-meta">${esc(e.category)} ${statusTag(e.status)}</div>
                </div>
                <button class="btn btn-sm btn-secondary" onclick="showTlDetail(${e.id})">查看</button>
            </div>
        `).join('') : '<p class="placeholder">暂无近期节点</p>';
    }

    if (todoSummaryEl) {
        const noLinkOpps = opps.filter(o => !o.official_url && !o.announcement_url && !o.position_url);
        const overdueItems = opps.filter(o =>
            (o.status === '参考往年' || o.status === '待更新') &&
            ['等公告', '等报名', '待投递', '待笔试', '待面试'].includes(o.current_action)
        );
        const actionItems = opps.filter(o => ['待报名', '待投递', '待笔试', '待面试'].includes(o.current_action));
        todoSummaryEl.innerHTML = `
            <div class="todo-summary-item"><div class="todo-summary-title">过期待更新 <span class="todo-summary-count">${overdueItems.length}</span></div><a href="/todos" class="btn btn-sm btn-secondary">查看全部</a></div>
            <div class="todo-summary-item"><div class="todo-summary-title">待确认链接 <span class="todo-summary-count">${noLinkOpps.length}</span></div><a href="/todos" class="btn btn-sm btn-secondary">查看全部</a></div>
            <div class="todo-summary-item"><div class="todo-summary-title">当前动作待处理 <span class="todo-summary-count">${actionItems.length}</span></div><a href="/todos" class="btn btn-sm btn-secondary">查看全部</a></div>
        `;
    }
}

/* ============================================================
   机会管理
   ============================================================ */
function favoriteForOpp(opp) {
    if (!opp || !Array.isArray(state.favorites)) return null;
    const oppId = String(opp.id || '');
    const oppName = String(opp.name || '').trim();
    return state.favorites.find(f => {
        const favOppId = f.opportunity_id === null || f.opportunity_id === undefined ? '' : String(f.opportunity_id);
        const favOppName = String(f.opportunity_name || '').trim();
        const favJobName = String(f.job_name || '').trim();
        return (favOppId && favOppId === oppId) ||
               (!favOppId && oppName && (favOppName === oppName || favJobName === oppName));
    }) || null;
}

async function favoriteOpp(id) {
    const opp = (state.opps || []).find(o => Number(o.id) === Number(id));
    if (!opp) return;
    const btn = document.querySelector(`[data-fav-opp-id="${id}"]`);
    if (btn) {
        btn.disabled = true;
        btn.textContent = '收藏中...';
    }
    try {
        const result = await fetchJson(`/api/opportunities/${id}/favorite`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ opportunity_id: id }),
        });
        if (result.favorite) {
            state.favorites = (state.favorites || []).filter(f => String(f.opportunity_id || '') !== String(id));
            state.favorites.push(result.favorite);
            renderOpps();
        }
        await loadData();
    } catch (err) {
        console.error(err);
        alert(err.message || '收藏失败');
        if (btn) {
            btn.disabled = false;
            btn.textContent = '收藏';
        }
    }
}

async function unfavoriteOpp(id) {
    const opp = (state.opps || []).find(o => Number(o.id) === Number(id));
    if (!opp) return;
    showConfirm(`确认取消收藏「${opp.name}」？`, async () => {
        const btn = document.querySelector(`[data-fav-opp-id="${id}"]`);
        if (btn) {
            btn.disabled = true;
            btn.textContent = '处理中...';
        }
        try {
            await fetchJson(`/api/opportunities/${id}/favorite`, { method: 'DELETE' });
            await loadData();
        } catch (err) {
            console.error(err);
            alert(err.message || '取消收藏失败');
            if (btn) btn.disabled = false;
        }
    });
}

function renderOpps() {
    if (!oppList || !oppCount) return;
    const opps = state.opps || [];
    oppCount.textContent = opps.length;
    if (opps.length === 0) {
        oppList.innerHTML = '<p class="placeholder">暂无匹配的机会</p>';
        return;
    }

    const events = state.tlAllEvents || [];
    const timelineStats = {};
    events.forEach(ev => {
        if (!ev.opportunity_id) return;
        const key = String(ev.opportunity_id);
        if (!timelineStats[key]) timelineStats[key] = { types: new Set(), total: 0 };
        if (ev.event_type) timelineStats[key].types.add(ev.event_type);
        timelineStats[key].total += 1;
    });
    const coreTypes = ['公告', '报名/投递', '笔试/测评', '面试'];

    oppList.innerHTML = opps.map(o => {
        const stats = timelineStats[String(o.id)] || { types: new Set(), total: 0 };
        const coreCount = coreTypes.filter(t => stats.types.has(t)).length;
        const missingTypes = coreTypes.filter(t => !stats.types.has(t));
        const fav = favoriteForOpp(o);
        const favBtn = fav
            ? `<button class="btn btn-sm btn-favorited" data-fav-opp-id="${o.id}" onclick="unfavoriteOpp(${o.id})">已收藏</button>`
            : `<button class="btn btn-sm btn-primary" data-fav-opp-id="${o.id}" onclick="favoriteOpp(${o.id})">收藏</button>`;
        return `
        <div class="opp-card compact-opp-card" data-id="${o.id}">
            <div class="opp-card-header">
                <h3 class="opp-card-title">${esc(o.name)}</h3>
                <div class="opp-card-badges">${trackTag(o.track)}${statusTag(o.status)}${priorityTag(o.priority)}</div>
            </div>
            <div class="opp-card-meta compact-meta">
                <div><span class="meta-key">类别：</span>${esc(o.category)}</div>
                <div><span class="meta-key">地域：</span>${esc(o.region)}</div>
                <div><span class="meta-key">适合计算机硕：</span>${esc(o.fit_computer_master)}</div>
                <div><span class="meta-key">当前动作：</span>${actionTag(o.current_action)}</div>
                <div><span class="meta-key">公告/启动：</span><span class="meta-time">${esc(formatTimeValueSafe(o.expected_announcement_time, { compact: false }))}</span></div>
                <div><span class="meta-key">报名/投递：</span><span class="meta-time">${esc(formatTimeValueSafe(o.expected_apply_time, { compact: false }))}</span></div>
                <div><span class="meta-key">笔试：</span><span class="meta-time">${esc(formatTimeValueSafe(o.expected_exam_time, { compact: false }))}</span></div>
                <div><span class="meta-key">面试：</span><span class="meta-time">${esc(formatTimeValueSafe(o.expected_interview_time, { compact: false }))}</span></div>
            </div>
            <div class="opp-card-timeline compact-timeline-box">
                <div class="timeline-completeness">
                    <span class="meta-key">时间线：</span><span class="timeline-count">${coreCount}/4</span>
                    ${missingTypes.length > 0 ? `<span class="timeline-missing">缺少：${esc(missingTypes.join('、'))}</span>` : '<span class="timeline-complete">✓ 完整</span>'}
                </div>
                <div class="timeline-actions">
                    <button class="btn btn-sm btn-primary" onclick="syncTimeline(${o.id})">同步时间线</button>
                    <a href="/timeline?opportunity_id=${o.id}" class="btn btn-sm btn-secondary">查看日历</a>
                </div>
            </div>
            <div class="opp-card-links">${linkHtml(o.official_url, '官网')}${linkHtml(o.announcement_url, '公告')}${linkHtml(o.position_url, '岗位表')}${linkHtml(o.apply_url, '报名入口')}</div>
            ${o.note ? `<div class="opp-card-note">${esc(o.note)}</div>` : ''}
            <div class="opp-card-actions compact-actions">
                ${favBtn}
                <button class="btn btn-sm btn-secondary" onclick="editOpp(${o.id})">编辑</button>
                <button class="btn btn-sm btn-success" onclick="setOppStatus(${o.id},'官方已确定')">官方已确定</button>
                <button class="btn btn-sm btn-warning" onclick="setOppStatus(${o.id},'待更新')">待更新</button>
                <button class="btn btn-sm btn-danger" onclick="delOpp(${o.id})">删除</button>
            </div>
        </div>`;
    }).join('');
}

function openOppModal(opp) {
    if (!modalOpp) return;
    setValue('modal-opp-title', opp ? '编辑机会' : '新增机会', 'text');
    setValue('opp-id', opp ? opp.id : '');
    setValue('opp-name', opp ? opp.name : '');
    populateOpportunityCategoryControls(opp ? opp.track : firstTrackValue(), opp ? opp.category : '');
    setValue('opp-priority', opp ? opp.priority : '可以关注');
    setValue('opp-region', opp ? opp.region : '全国');
    setValue('opp-fit', opp ? opp.fit_computer_master : '待确认');
    if (typeof window.setupTimePicker === 'function') {
        window.setupTimePicker('opp-ann-time', opp ? opp.expected_announcement_time : '');
        window.setupTimePicker('opp-app-time', opp ? opp.expected_apply_time : '');
        window.setupTimePicker('opp-exam-time', opp ? opp.expected_exam_time : '');
        window.setupTimePicker('opp-int-time', opp ? opp.expected_interview_time : '');
    } else {
        setValue('opp-ann-time', opp ? opp.expected_announcement_time : '');
        setValue('opp-app-time', opp ? opp.expected_apply_time : '');
        setValue('opp-exam-time', opp ? opp.expected_exam_time : '');
        setValue('opp-int-time', opp ? opp.expected_interview_time : '');
    }
    setValue('opp-url', opp ? opp.official_url : '');
    setValue('opp-ann-url', opp ? opp.announcement_url : '');
    setValue('opp-pos-url', opp ? opp.position_url : '');
    setValue('opp-apply-url', opp ? opp.apply_url : '');
    setValue('opp-status', opp ? opp.status : '待更新');
    setValue('opp-action', opp ? opp.current_action : '持续关注');
    setValue('opp-note', opp ? opp.note : '');
    modalOpp.style.display = 'flex';
}

function setValue(id, value, mode = 'value') {
    const el = $(id);
    if (!el) return;
    if (mode === 'text') el.textContent = value;
    else el.value = value || '';
}

async function saveOpp(e) {
    e.preventDefault();
    const id = $('opp-id') ? $('opp-id').value : '';
    const data = {
        track: valueOf('opp-track'),
        name: valueOf('opp-name').trim(),
        category: valueOf('opp-category').trim(),
        priority: valueOf('opp-priority'),
        region: valueOf('opp-region'),
        fit_computer_master: valueOf('opp-fit'),
        expected_announcement_time: typeof window.readTimePicker === 'function' ? window.readTimePicker('opp-ann-time') : valueOf('opp-ann-time').trim(),
        expected_apply_time: typeof window.readTimePicker === 'function' ? window.readTimePicker('opp-app-time') : valueOf('opp-app-time').trim(),
        expected_exam_time: typeof window.readTimePicker === 'function' ? window.readTimePicker('opp-exam-time') : valueOf('opp-exam-time').trim(),
        expected_interview_time: typeof window.readTimePicker === 'function' ? window.readTimePicker('opp-int-time') : valueOf('opp-int-time').trim(),
        official_url: valueOf('opp-url').trim(),
        announcement_url: valueOf('opp-ann-url').trim(),
        position_url: valueOf('opp-pos-url').trim(),
        apply_url: valueOf('opp-apply-url').trim(),
        status: valueOf('opp-status'),
        current_action: valueOf('opp-action'),
        note: valueOf('opp-note').trim(),
    };
    if (!data.name || !data.category) {
        alert('请填写机会名称和具体类别');
        return;
    }
    try {
        await fetchJson(id ? `/api/opportunities/${id}` : '/api/opportunities', {
            method: id ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (modalOpp) modalOpp.style.display = 'none';
        await loadData();
    } catch (err) {
        console.error(err);
        alert(err.message || '保存失败');
    }
}

function valueOf(id) {
    const el = $(id);
    return el ? (el.value || '') : '';
}

function editOpp(id) {
    const opp = state.opps.find(o => Number(o.id) === Number(id));
    if (opp) openOppModal(opp);
}

function delOpp(id) {
    const opp = state.opps.find(o => Number(o.id) === Number(id));
    if (!opp) return;
    showConfirm(`确认删除「${opp.name}」？相关时间线节点和岗位收藏也会同步删除。`, async () => {
        try {
            await fetchJson(`/api/opportunities/${id}`, { method: 'DELETE' });
            await loadData();
        } catch (err) {
            console.error(err);
            alert(err.message || '删除失败');
        }
    });
}

async function setOppStatus(id, status) {
    try {
        await fetchJson(`/api/opportunities/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
        });
        await loadData();
    } catch (err) {
        console.error(err);
        alert(err.message || '更新失败');
    }
}

async function syncTimeline(id) {
    try {
        const result = await fetchJson(`/api/opportunities/${id}/sync-timeline`, { method: 'POST' });
        let msg = `同步完成：\n创建 ${result.created || 0} 个节点\n更新 ${result.updated || 0} 个节点`;
        if (result.skipped && result.skipped.length) {
            msg += `\n跳过 ${result.skipped.length} 个字段`;
        }
        alert(msg);
        await loadData();
        if (typeof window.reloadCalendarData === 'function') await window.reloadCalendarData();
    } catch (err) {
        console.error(err);
        alert(err.message || '同步失败');
    }
}

/* ============================================================
   时间线
   ============================================================ */
function renderTimeline() {
    if (!tlTrack) return;
    const events = state.tlAllEvents || [];
    if (eventCount) eventCount.textContent = events.length;
    const months = generateMonthTicks();
    const curMonth = getCurrentMonth();
    let html = '<div class="tl-axis"></div>';

    months.forEach(m => {
        const pct = monthToPercent(m);
        const cls = m === curMonth ? 'current' : (m < curMonth ? 'past' : '');
        const showYear = m.endsWith('-01') || m === TL_START;
        const labelText = showYear ? m.replace('-', '.') : m.slice(5);
        html += `<div class="tl-tick ${cls}" style="left: ${pctToLeft(pct)};"><div class="tl-tick-line"></div><div class="tl-tick-label">${labelText}</div></div>`;
    });

    const positionMap = new Map();
    events.forEach(ev => {
        const pct = getEventPercent(ev);
        if (pct === null) return;
        const key = Math.round(pct * 10) / 10;
        if (!positionMap.has(key)) positionMap.set(key, []);
        positionMap.get(key).push(ev);
    });

    positionMap.forEach((posEvents, pct) => {
        posEvents.sort((a, b) => (a.date || `${a.month}-01`).localeCompare(b.date || `${b.month}-01`));
        posEvents.forEach((ev, idx) => {
            const row = Math.min(idx, 2);
            const direction = row % 2 === 0 ? -1 : 1;
            const distance = Math.floor(row / 2) + 1;
            const topOffset = AXIS_Y + (direction * distance * 32);
            const dotCls = `${statusDotClass(ev.status)} ${trackDotClass(ev.track)} ${ev.month === curMonth ? 'current-month' : ''}`;
            html += `<div class="tl-dot ${dotCls}" style="left: ${pctToLeft(pct)}; top: ${topOffset}px;" data-id="${ev.id}" data-month="${esc(ev.month)}" data-date="${esc(ev.date || ev.event_date || '')}" data-title="${esc(ev.title)}" data-track="${esc(ev.track)}" data-category="${esc(ev.category)}" data-status="${esc(ev.status)}" data-link="${esc(ev.link)}" data-note="${esc(ev.note)}" onmouseenter="showTlTooltip(this, event)" onmouseleave="scheduleHideTooltip()" onclick="showTlDetail(${ev.id})"></div>`;
            if (idx === 3 && posEvents.length > 3) {
                html += `<div class="tl-more-hint" style="left:${pctToLeft(pct)};top:${AXIS_Y + 80}px;position:absolute;font-size:11px;color:var(--c-text-3);">+${posEvents.length - 3}个</div>`;
            }
        });
    });

    tlTrack.innerHTML = html;
}

function showTlTooltip(dotEl) {
    if (!tlTooltip || !dotEl) return;
    clearTimeout(hideTooltipTimer);
    const title = dotEl.dataset.title || '';
    const date = dotEl.dataset.date || '';
    const month = dotEl.dataset.month || '';
    const category = dotEl.dataset.category || '';
    const track = dotEl.dataset.track || '';
    const status = dotEl.dataset.status || '';
    const link = dotEl.dataset.link || '';
    const note = dotEl.dataset.note || '';
    let html = `<div class="tl-tooltip-title">${esc(title)}</div>`;
    html += `<div class="tl-tooltip-row"><span class="tl-tooltip-key">${date ? '日期' : '月份'}</span><span>${esc(date || month)}</span></div>`;
    html += `<div class="tl-tooltip-row"><span class="tl-tooltip-key">类别</span><span>${esc(category)}</span></div>`;
    html += `<div class="tl-tooltip-row"><span class="tl-tooltip-key">大类</span><span>${esc(track)}</span></div>`;
    html += `<div class="tl-tooltip-row"><span class="tl-tooltip-key">状态</span><span>${statusTag(status)}</span></div>`;
    if (link) html += `<div class="tl-tooltip-row"><span class="tl-tooltip-key">链接</span><span>${linkHtml(link, '查看')}</span></div>`;
    if (note) html += `<div class="tl-tooltip-note">${esc(note)}</div>`;
    tlTooltip.innerHTML = html;
    tlTooltip.style.display = 'block';

    const dotRect = dotEl.getBoundingClientRect();
    const tipW = 260;
    let left = dotRect.left + dotRect.width / 2 - tipW / 2;
    let top = dotRect.top - tlTooltip.offsetHeight - 10;
    if (left < 8) left = 8;
    if (left + tipW > window.innerWidth - 8) left = window.innerWidth - tipW - 8;
    if (top < 8) top = dotRect.bottom + 10;
    tlTooltip.style.left = `${left}px`;
    tlTooltip.style.top = `${top}px`;
    tlTooltip.style.position = 'fixed';
}

function scheduleHideTooltip() {
    hideTooltipTimer = setTimeout(() => {
        if (tlTooltip) tlTooltip.style.display = 'none';
    }, 200);
}

function showTlDetail(id) {
    if (tlTooltip) tlTooltip.style.display = 'none';
    const ev = (state.tlAllEvents || []).find(e => Number(e.id) === Number(id));
    if (!ev || !tlDetailModal || !tlDetailBody || !$('tl-detail-title')) return;

    const mainDate = ev.event_date || ev.date || ev.month || '';
    const dateLabel = (ev.date || ev.event_date) ? '日期' : '月份';
    const subtitleParts = [mainDate, ev.event_type || '其他', ev.category].filter(Boolean);
    $('tl-detail-title').textContent = ev.title || '节点详情';

    const rows = [
        { label: dateLabel, value: mainDate || '-', tone: 'primary' },
        ev.end_date ? { label: '结束时间', value: ev.end_date, tone: 'primary' } : null,
        { label: '节点类型', value: ev.event_type || '其他' },
        ev.opportunity_name ? { label: '关联机会', value: ev.opportunity_name } : null,
        { label: '具体类别', value: ev.category || '-' },
        { label: '机会大类', value: trackTag(ev.track) || '-' },
        { label: '当前状态', value: statusTag(ev.status) || '-' },
        ev.current_action ? { label: '当前动作', value: actionTag(ev.current_action) } : null,
        ev.link ? { label: '官网链接', value: linkHtml(ev.link, '打开链接'), wide: true } : null,
    ].filter(Boolean);

    const gridHtml = rows.map((row) => {
        const safeValue = typeof row.value === 'string' && row.value.includes('<') ? row.value : esc(row.value);
        return `
            <div class="detail-row ${row.wide ? 'detail-row-wide' : ''} ${row.tone ? `detail-row-${row.tone}` : ''}">
                <div class="detail-label">${esc(row.label)}</div>
                <div class="detail-value">${safeValue}</div>
            </div>
        `;
    }).join('');

    tlDetailBody.innerHTML = `
        <div class="detail-hero">
            <div class="detail-hero-main">
                <div class="detail-eyebrow">时间节点详情</div>
                <h4 class="detail-title">${esc(ev.title || '未命名节点')}</h4>
                <div class="detail-subtitle">${esc(subtitleParts.join(' · '))}</div>
            </div>
            <div class="detail-hero-tags">
                ${ev.status ? statusTag(ev.status) : ''}
                ${ev.track ? trackTag(ev.track) : ''}
            </div>
        </div>
        <div class="detail-grid">${gridHtml}</div>
        ${ev.note ? `<div class="detail-note"><div class="detail-label">备注</div><div>${esc(ev.note)}</div></div>` : ''}
        <div class="detail-actions">
            <button class="btn btn-sm btn-secondary" onclick="editEv(${ev.id})">编辑</button>
            <button class="btn btn-sm btn-success" onclick="setEvStatus(${ev.id},'官方已确定')">官方已确定</button>
            <button class="btn btn-sm btn-warning" onclick="setEvStatus(${ev.id},'待更新')">待更新</button>
            <button class="btn btn-sm btn-danger" onclick="delEvFromDetail(${ev.id})">删除</button>
        </div>
    `;
    tlDetailModal.style.display = 'flex';
}

function delEvFromDetail(id) {
    if (tlDetailModal) tlDetailModal.style.display = 'none';
    delEv(id);
}

function renderDetailList() {
    if (!tlDetailList) return;
    const q = (detailSearch ? detailSearch.value : '').trim().toLowerCase();
    let events = (state.tlAllEvents || []).slice().sort((a, b) => (a.date || `${a.month}-01`).localeCompare(b.date || `${b.month}-01`));
    if (q) {
        events = events.filter(e =>
            String(e.title || '').toLowerCase().includes(q) ||
            String(e.category || '').toLowerCase().includes(q) ||
            String(e.track || '').toLowerCase().includes(q) ||
            String(e.note || '').toLowerCase().includes(q)
        );
    }
    if (!events.length) {
        tlDetailList.innerHTML = '<p class="placeholder">无匹配节点</p>';
        return;
    }
    tlDetailList.innerHTML = events.map(e => `
        <div class="detail-item" onclick="showTlDetail(${e.id})">
            <span class="detail-item-month">${esc(e.event_date || e.date || e.month)}</span>
            <span class="detail-item-main">
                <span class="detail-item-title">${esc(e.title)}</span>
                <span class="detail-item-meta">
                    ${esc(e.event_type || '其他')} · ${esc(e.category || '-')} · ${esc(e.track || '-')} ${e.opportunity_name ? '· ' + esc(e.opportunity_name) : ''}
                </span>
            </span>
            <span class="detail-item-badges">${statusTag(e.status)}</span>
        </div>
    `).join('');
}

function openEvModal(ev) {
    if (!modalEv) return;
    setValue('modal-event-title', ev ? '编辑时间节点' : '新增时间节点', 'text');
    setValue('event-id', ev ? ev.id : '');
    setValue('event-month', ev ? ev.month : '');
    setValue('event-date', ev ? (ev.date || ev.event_date || '') : '');
    setValue('event-title', ev ? ev.title : '');
    populateEventCategoryControls(ev ? ev.track : firstTrackValue(), ev ? ev.category : '');
    setValue('event-status', ev ? ev.status : '待更新');
    setValue('event-link', ev ? ev.link : '');
    setValue('event-note', ev ? ev.note : '');
    setValue('event-date-precision', ev ? (ev.date_precision || 'month') : 'month');
    setValue('event-end-date', ev ? (ev.end_date || '') : '');
    setValue('event-current-action', ev ? (ev.current_action || '') : '');
    setValue('event-type', ev ? (ev.event_type || '其他') : '其他');
    populateOpportunitySelect('event-opportunity-id', ev ? ev.opportunity_id : null);
    setValue('event-opportunity-id', ev ? (ev.opportunity_id || '') : '');
    modalEv.style.display = 'flex';
}

function populateOpportunitySelect(selectId, selectedId) {
    const select = $(selectId);
    if (!select) return;
    const disabled = select.disabled;
    select.innerHTML = '<option value="">不关联</option>';
    (state.opps || []).forEach(opp => {
        const option = document.createElement('option');
        option.value = opp.id;
        option.textContent = `${opp.name} (${opp.category})`;
        if (selectedId && String(opp.id) === String(selectedId)) option.selected = true;
        select.appendChild(option);
    });
    select.disabled = disabled;
}

async function saveEv(e) {
    e.preventDefault();
    const id = valueOf('event-id');
    let month = valueOf('event-month');
    const date = valueOf('event-date');
    const datePrecision = valueOf('event-date-precision') || 'month';
    const endDate = valueOf('event-end-date');
    if (datePrecision === 'day' && date) month = date.slice(0, 7);
    if (endDate && date && endDate < date) {
        alert('结束日期不能早于开始日期');
        return;
    }
    const data = {
        month,
        date,
        title: valueOf('event-title').trim(),
        track: valueOf('event-track'),
        category: valueOf('event-category').trim(),
        status: valueOf('event-status'),
        link: valueOf('event-link').trim(),
        note: valueOf('event-note').trim(),
        event_date: date,
        date_precision: datePrecision,
        end_date: endDate,
        current_action: valueOf('event-current-action'),
        event_type: valueOf('event-type') || '其他',
        opportunity_id: valueOf('event-opportunity-id') || null,
    };
    if (!data.month || !data.title) {
        alert('请填写月份和标题');
        return;
    }
    try {
        await fetchJson(id ? `/api/timeline/${id}` : '/api/timeline', {
            method: id ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (modalEv) modalEv.style.display = 'none';
        await loadData();
        if (typeof window.reloadCalendarData === 'function') await window.reloadCalendarData();
    } catch (err) {
        console.error(err);
        alert(err.message || '保存失败');
    }
}

function editEv(id) {
    const ev = (state.tlAllEvents || []).find(e => Number(e.id) === Number(id));
    if (ev) openEvModal(ev);
}

function delEv(id) {
    const ev = (state.tlAllEvents || []).find(e => Number(e.id) === Number(id));
    if (!ev) return;
    showConfirm(`确认删除「${ev.title}」？`, async () => {
        try {
            await fetchJson(`/api/timeline/${id}`, { method: 'DELETE' });
            await loadData();
            if (typeof window.reloadCalendarData === 'function') await window.reloadCalendarData();
        } catch (err) {
            console.error(err);
            alert(err.message || '删除失败');
        }
    });
}

async function setEvStatus(id, status) {
    try {
        await fetchJson(`/api/timeline/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
        });
        await loadData();
        if (typeof window.reloadCalendarData === 'function') await window.reloadCalendarData();
    } catch (err) {
        console.error(err);
        alert(err.message || '更新失败');
    }
}

/* ============================================================
   导入 / 导出 / 重置
   ============================================================ */
async function exportData() {
    try {
        const data = await fetchJson('/api/export');
        downloadJson(data, `opp-backup-${new Date().toISOString().slice(0, 10)}.json`);
    } catch (err) {
        console.error(err);
        alert(err.message || '导出失败');
    }
}

function handleImport() {
    if (!fileInput || !fileInput.files || !fileInput.files[0]) return;
    showConfirm('导入将覆盖当前所有数据，确认继续？', async () => {
        try {
            const form = new FormData();
            form.append('file', fileInput.files[0]);
            form.append('overwrite', 'true');
            const result = await fetchJson('/api/import', { method: 'POST', body: form });
            alert(`导入成功：${result.opp_count || 0} 条机会，${result.event_count || 0} 条时间节点`);
            await loadData();
        } catch (err) {
            console.error(err);
            alert(err.message || '导入失败');
        } finally {
            if (fileInput) fileInput.value = '';
        }
    });
}

async function resetData() {
    try {
        await fetchJson('/api/reset', { method: 'POST' });
        alert('已重置为默认数据');
        await loadData();
    } catch (err) {
        console.error(err);
        alert(err.message || '重置失败');
    }
}

function downloadJson(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function ensureConfirmLayout() {
    if (!confirmDlg || !confirmMsg) return;
    const card = confirmDlg.querySelector('.modal-content');
    if (!card || card.dataset.confirmEnhanced === '1') return;
    card.dataset.confirmEnhanced = '1';
    card.classList.add('confirm-card');

    const header = document.createElement('div');
    header.className = 'confirm-header';
    header.textContent = '确认操作';
    card.insertBefore(header, card.firstChild);

    const body = document.createElement('div');
    body.className = 'confirm-body';
    confirmMsg.parentNode.insertBefore(body, confirmMsg);
    body.appendChild(confirmMsg);
    confirmMsg.classList.add('confirm-message-text');

    const actions = card.querySelector('.form-actions');
    if (actions) actions.classList.add('confirm-actions');
}

function showConfirm(msg, cb) {
    if (!confirmDlg || !confirmMsg) {
        if (window.confirm(msg)) cb && cb();
        return;
    }
    ensureConfirmLayout();
    confirmMsg.textContent = msg;
    confirmCallback = cb;
    confirmDlg.style.display = 'flex';
}

/* ============================================================
   岗位收藏
   ============================================================ */
function renderFavorites() {
    if (!favList) return;
    const q = (favSearch ? favSearch.value : '').trim().toLowerCase();
    let favs = (state.favorites || []).slice();
    if (q) {
        favs = favs.filter(f =>
            String(f.job_name || '').toLowerCase().includes(q) ||
            String(f.organization || '').toLowerCase().includes(q) ||
            String(f.major_requirement || '').toLowerCase().includes(q) ||
            String(f.education_requirement || '').toLowerCase().includes(q) ||
            String(f.note || '').toLowerCase().includes(q) ||
            String(f.opportunity_name || '').toLowerCase().includes(q)
        );
    }
    const regionFilter = $('fav-filter-region');
    const trackFilter = $('fav-filter-track');
    const matchFilter = $('fav-filter-match');
    if (regionFilter && regionFilter.value) favs = favs.filter(f => f.region === regionFilter.value);
    if (trackFilter && trackFilter.value) favs = favs.filter(f => f.track === trackFilter.value);
    if (matchFilter && matchFilter.value) favs = favs.filter(f => f.match_status === matchFilter.value);
    if (favCount) favCount.textContent = (state.favorites || []).length;
    if (!favs.length) {
        favList.innerHTML = '<p class="placeholder">暂无收藏。请前往“机会管理”页面点击“收藏”按钮添加。</p>';
        return;
    }
    favList.innerHTML = favs.map(f => `
        <div class="fav-card">
            <div class="fav-card-header">
                <h3 class="fav-card-title">${esc(f.job_name)}</h3>
                <div class="opp-card-badges">${trackTag(f.track)}${matchStatusTag(f.match_status)}${priorityTag(f.priority)}</div>
            </div>
            <div class="fav-card-meta">
                <div><span class="meta-key">所属机会：</span>${esc(f.opportunity_name)}</div>
                <div><span class="meta-key">单位：</span>${esc(f.organization)}</div>
                <div><span class="meta-key">地区：</span>${esc(f.region)}</div>
                <div><span class="meta-key">专业要求：</span>${esc(f.major_requirement)}</div>
                <div><span class="meta-key">学历要求：</span>${esc(f.education_requirement)}</div>
                <div><span class="meta-key">当前动作：</span>${actionTag(f.current_action)}</div>
                <div><span class="meta-key">报名时间：</span><span class="meta-time">${esc(formatTimeValueSafe(f.apply_time, { compact: false }))}</span></div>
                <div><span class="meta-key">笔试时间：</span><span class="meta-time">${esc(formatTimeValueSafe(f.exam_time, { compact: false }))}</span></div>
                <div><span class="meta-key">面试时间：</span><span class="meta-time">${esc(formatTimeValueSafe(f.interview_time, { compact: false }))}</span></div>
            </div>
            <div class="fav-card-links">${linkHtml(f.job_url, '岗位链接')}${linkHtml(f.source_url, '公告链接')}</div>
            ${f.note ? `<div class="fav-card-note">${esc(f.note)}</div>` : ''}
            <div class="fav-card-actions">
                <button class="btn btn-sm btn-secondary" onclick="editFav(${f.id})">编辑</button>
                <button class="btn btn-sm btn-danger" onclick="delFav(${f.id})">取消收藏</button>
            </div>
        </div>
    `).join('');
}

function openFavModal(fav) {
    if (!modalFav) return;
    if (!fav) {
        alert('岗位收藏请从“机会管理”页面点击收藏添加。');
        return;
    }
    setValue('modal-fav-title', '编辑岗位收藏', 'text');
    setValue('fav-id', fav.id || '');
    setValue('fav-job-name', fav.job_name || '');
    setValue('fav-opp-name', fav.opportunity_name || '');
    setValue('fav-track', fav.track || '体制/准体制');
    setValue('fav-organization', fav.organization || '');
    setValue('fav-region', fav.region || '衡阳');
    setValue('fav-major', fav.major_requirement || '');
    setValue('fav-education', fav.education_requirement || '');
    if (typeof window.setupTimePicker === 'function') {
        window.setupTimePicker('fav-apply-time', fav.apply_time || '');
        window.setupTimePicker('fav-exam-time', fav.exam_time || '');
        window.setupTimePicker('fav-interview-time', fav.interview_time || '');
    } else {
        setValue('fav-apply-time', fav.apply_time || '');
        setValue('fav-exam-time', fav.exam_time || '');
        setValue('fav-interview-time', fav.interview_time || '');
    }
    setValue('fav-job-url', fav.job_url || '');
    setValue('fav-source-url', fav.source_url || '');
    setValue('fav-match-status', fav.match_status || '未判断');
    setValue('fav-priority', fav.priority || '可以关注');
    setValue('fav-action', fav.current_action || '待确认');
    setValue('fav-note', fav.note || '');
    populateOpportunitySelect('fav-opportunity-id', fav.opportunity_id || null);
    setValue('fav-opportunity-id', fav.opportunity_id || '');
    modalFav.style.display = 'flex';
}

async function saveFav(e) {
    e.preventDefault();
    const id = valueOf('fav-id');
    if (!id) {
        alert('岗位收藏请从“机会管理”页面点击收藏添加。');
        return;
    }
    const data = {
        job_name: valueOf('fav-job-name').trim(),
        opportunity_name: valueOf('fav-opp-name').trim(),
        track: valueOf('fav-track'),
        organization: valueOf('fav-organization').trim(),
        region: valueOf('fav-region'),
        major_requirement: valueOf('fav-major').trim(),
        education_requirement: valueOf('fav-education').trim(),
        apply_time: typeof window.readTimePicker === 'function' ? window.readTimePicker('fav-apply-time') : valueOf('fav-apply-time').trim(),
        exam_time: typeof window.readTimePicker === 'function' ? window.readTimePicker('fav-exam-time') : valueOf('fav-exam-time').trim(),
        interview_time: typeof window.readTimePicker === 'function' ? window.readTimePicker('fav-interview-time') : valueOf('fav-interview-time').trim(),
        job_url: valueOf('fav-job-url').trim(),
        source_url: valueOf('fav-source-url').trim(),
        match_status: valueOf('fav-match-status'),
        priority: valueOf('fav-priority'),
        current_action: valueOf('fav-action'),
        note: valueOf('fav-note').trim(),
        opportunity_id: valueOf('fav-opportunity-id') || null,
    };
    if (!data.job_name) {
        alert('请填写岗位名称');
        return;
    }
    try {
        await fetchJson(`/api/job-favorites/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (modalFav) modalFav.style.display = 'none';
        await loadData();
    } catch (err) {
        console.error(err);
        alert(err.message || '保存失败');
    }
}

function editFav(id) {
    const fav = (state.favorites || []).find(f => Number(f.id) === Number(id));
    if (fav) openFavModal(fav);
}

function delFav(id) {
    const fav = (state.favorites || []).find(f => Number(f.id) === Number(id));
    if (!fav) return;
    showConfirm(`确认取消收藏「${fav.job_name}」？`, async () => {
        try {
            await fetchJson(`/api/job-favorites/${id}`, { method: 'DELETE' });
            await loadData();
        } catch (err) {
            console.error(err);
            alert(err.message || '删除失败');
        }
    });
}

function exportFavorites() {
    downloadJson({
        job_favorites: state.favorites || [],
        exported_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    }, `job-favorites-${new Date().toISOString().slice(0, 10)}.json`);
}

/* ============================================================
   默认待办渲染：todos.html 会覆盖此函数。
   ============================================================ */
function renderTodoView() {
    if (!todoContainer) return;
    const opps = state.opps || [];
    const events = state.tlAllEvents || [];
    const curMonth = getCurrentMonth();
    const nextMonth = addMonths(curMonth, 1);
    let html = '';

    const monthEvents = events.filter(e => e.month >= curMonth && e.month <= nextMonth);
    html += renderTodoGroup('近期日历节点', monthEvents.map(e => ({ type: 'event', ...e })));

    const actionOpps = opps.filter(o => ['等公告', '等报名', '待报名', '待投递', '待笔试', '待面试'].includes(o.current_action));
    html += renderTodoGroup('机会待处理', actionOpps.map(o => ({ type: 'opp', ...o })));

    todoContainer.innerHTML = html || '<p class="todo-empty">暂无待处理事项</p>';
}

function renderTodoGroup(title, items) {
    if (!items || !items.length) return '';
    let html = `<div class="todo-group"><div class="todo-group-title">${esc(title)} <span class="todo-group-badge">${items.length}</span></div><div class="todo-list">`;
    items.forEach(item => {
        if (item.type === 'event' || item._type === 'event') {
            html += `<div class="todo-item"><div class="todo-item-content"><div class="todo-item-title">${esc(item.title)}</div><div class="todo-item-meta"><span>${esc(item.event_date || item.date || item.month)}</span><span>${esc(item.category)}</span>${statusTag(item.status)}</div></div><div class="todo-item-actions"><button class="btn btn-sm btn-secondary" onclick="showTlDetail(${item.id})">查看</button></div></div>`;
        } else if (item.type === 'fav' || item._type === 'fav') {
            html += `<div class="todo-item"><div class="todo-item-content"><div class="todo-item-title">${esc(item.job_name)}</div><div class="todo-item-meta"><span>${esc(item.opportunity_name)}</span><span>${esc(item.current_action)}</span>${matchStatusTag(item.match_status)}</div></div><div class="todo-item-actions"><button class="btn btn-sm btn-secondary" onclick="editFav(${item.id})">编辑</button></div></div>`;
        } else {
            html += `<div class="todo-item"><div class="todo-item-content"><div class="todo-item-title">${esc(item.name)}</div><div class="todo-item-meta"><span>${esc(item.category)}</span><span>${esc(item.current_action)}</span>${statusTag(item.status)}</div></div><div class="todo-item-actions"><button class="btn btn-sm btn-secondary" onclick="editOpp(${item.id})">编辑</button>${item.official_url ? `<a href="${esc(item.official_url)}" target="_blank" class="btn btn-sm btn-primary">官网</a>` : ''}</div></div>`;
        }
    });
    html += '</div></div>';
    return html;
}

/* 兼容 timeline.html 的命名 */
window.editEvent = editEv;
window.deleteEvent = delEv;
window.setEventStatus = setEvStatus;
window.showEventDetail = showTlDetail;



window.renderOpps = renderOpps;
window.openOppModal = openOppModal;
window.saveOpp = saveOpp;
window.favoriteOpp = favoriteOpp;
window.unfavoriteOpp = unfavoriteOpp;
window.renderFavorites = renderFavorites;
window.openFavModal = openFavModal;
window.saveFav = saveFav;
window.editFav = editFav;
window.delFav = delFav;
window.loadData = loadData;
window.loadFavorites = loadFavorites;
