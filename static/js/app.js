/* ============================================================
   全局状态
   ============================================================ */
const state = {
    track: 'all',
    filter: '',
    search: '',
    priority: '',
    region: '',
    status: '',
    action: '',
    opps: [],
    events: [],
    tlAllEvents: [],
    favorites: [],
};

/* 时间线配置 */
const TL_START = '2026-07';
const TL_END = '2027-12';
const TL_TOTAL = 18;
const AXIS_Y = 140;

/* DOM 引用 */
const $ = (id) => document.getElementById(id);
const oppList      = $('opp-list');
const tlTrack      = $('tl-track');
const tlTooltip    = $('tl-tooltip');
const tlDetailModal = $('tl-detail-modal');
const tlDetailBody = $('tl-detail-body');
const tlDetailList = $('tl-detail_list');
const detailSearch = $('detail-search');
const oppCount     = $('opp-count');
const eventCount   = $('event-count');
const searchBox    = $('search-input');
const filterSel    = $('filter-select');
const recentEl     = $('recent-events');
const lastUpdEl    = $('last-update');
const modalOpp     = $('modal-opp');
const modalEv      = $('modal-event');
const modalFav     = $('modal-fav');
const confirmDlg   = $('confirm-dialog');
const confirmMsg   = $('confirm-msg');
const fileInput    = $('file-import');
const favList      = $('fav-list');
const favCount     = $('fav-count');
const favSearch    = $('fav-search');
const todoContainer = $('todo-container');

let confirmCallback = null;
let hideTooltipTimer = null;

/* ============================================================
   侧边栏切换
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebar = document.querySelector('.sidebar');

    if (sidebarToggle && sidebar) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
        });

        /* 点击主内容区关闭侧边栏（移动端） */
        const mainContent = document.querySelector('.main-content');
        if (mainContent) {
            mainContent.addEventListener('click', () => {
                if (window.innerWidth <= 1024) {
                    sidebar.classList.remove('open');
                }
            });
        }
    }
});

/* ============================================================
   工具函数
   ============================================================ */
function esc(str) {
    if (!str) return '';
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
    const cls = t.includes('体制') ? 'tag-track-sys' : 'tag-track-mkt';
    return `<span class="tag ${cls}">${esc(t)}</span>`;
}

function actionTag(a) {
    if (!a) return '';
    return `<span class="tag tag-action">${esc(a)}</span>`;
}

/* 从当前 filter / search 推导 API 查询参数 */
function buildOppParams() {
    const params = new URLSearchParams();

    if (state.track && state.track !== 'all') params.set('track', state.track);
    if (state.search) params.set('q', state.search);

    /* 兼容旧版单下拉筛选 */
    if (state.filter) {
        const [key, val] = state.filter.split(':');
        if (key === 'track')    params.set('track', val);
        if (key === 'priority') params.set('priority', val);
        if (key === 'region')   params.set('region', val);
        if (key === 'fit')      params.set('fit_computer_master', val);
        if (key === 'status')   params.set('status', val);
        if (key === 'action')   params.set('current_action', val);
    }

    /* 机会管理页面的多条件筛选 */
    if (state.priority) params.set('priority', state.priority);
    if (state.region)   params.set('region', state.region);
    if (state.status)   params.set('status', state.status);
    if (state.action)   params.set('current_action', state.action);

    return params;
}

function initOpportunityFilters() {
    if (!oppList) return;

    const trackFilter = $('track-filter');
    const clearSearchBtn = $('btn-clear-search');
    const filterPriority = $('filter-priority');
    const filterRegion = $('filter-region');
    const filterStatus = $('filter-status');
    const filterAction = $('filter-action');

    if (trackFilter) {
        trackFilter.addEventListener('click', (e) => {
            const btn = e.target.closest('.filter-tab');
            if (!btn) return;
            trackFilter.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.track = btn.dataset.value || 'all';
            loadOpps();
        });
    }

    if (clearSearchBtn && searchBox) {
        clearSearchBtn.addEventListener('click', () => {
            searchBox.value = '';
            state.search = '';
            loadOpps();
        });
    }

    if (filterPriority) filterPriority.addEventListener('change', () => {
        state.priority = filterPriority.value;
        loadOpps();
    });
    if (filterRegion) filterRegion.addEventListener('change', () => {
        state.region = filterRegion.value;
        loadOpps();
    });
    if (filterStatus && oppList) filterStatus.addEventListener('change', () => {
        state.status = filterStatus.value;
        loadOpps();
    });
    if (filterAction) filterAction.addEventListener('change', () => {
        state.action = filterAction.value;
        loadOpps();
    });
}

function renderDbInfo() {
    const oppCountEl = $('db-opp-count');
    const eventCountEl = $('db-event-count');
    const favCountEl = $('db-fav-count');
    if (!oppCountEl || !eventCountEl || !favCountEl) return;

    oppCountEl.textContent = state.opps.length;
    eventCountEl.textContent = state.tlAllEvents.length;
    favCountEl.textContent = state.favorites.length;
}

function getActiveEvents() {
    const existingOppIds = new Set(state.opps.map(o => String(o.id)));
    return state.tlAllEvents.filter(e =>
        !e.opportunity_id || existingOppIds.has(String(e.opportunity_id))
    );
}

function renderHomeOverview() {
    const recentNodesEl = $('recent-nodes');
    const todoSummaryEl = $('todo-summary');
    const lastUpdateEl = $('last-update');
    const statOverdueEl = $('stat-overdue');

    if (!recentNodesEl && !todoSummaryEl && !lastUpdateEl && !statOverdueEl) return;

    const opps = state.opps;
    const events = getActiveEvents();
    const now = new Date();
    const curMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

    if (lastUpdateEl) {
        const all = [...opps, ...events];
        const times = all.map(x => x.updated_at).filter(Boolean).sort().reverse();
        lastUpdateEl.textContent = times.length ? times[0] : '-';
    }

    const overdueItems = opps.filter(o =>
        (o.status === '参考往年' || o.status === '待更新') &&
        (o.current_action === '等公告' || o.current_action === '等报名' ||
         o.current_action === '待投递' || o.current_action === '待笔试' ||
         o.current_action === '待面试')
    );
    if (statOverdueEl) statOverdueEl.textContent = overdueItems.length;

    if (recentNodesEl) {
        const upcoming = events
            .filter(e => e.month >= curMonth)
            .filter(e => e.status !== '已放弃')
            .sort((a, b) => a.month.localeCompare(b.month))
            .slice(0, 5);

        if (upcoming.length === 0) {
            recentNodesEl.innerHTML = '<p class="placeholder">暂无近期节点</p>';
        } else {
            recentNodesEl.innerHTML = upcoming.map(e => `
                <div class="recent-node-item">
                    <div class="recent-node-month">${esc(e.month)}</div>
                    <div class="recent-node-content">
                        <div class="recent-node-title">${esc(e.title)}</div>
                        <div class="recent-node-meta">${esc(e.category)} ${statusTag(e.status)}</div>
                    </div>
                    <button class="btn btn-sm btn-secondary" onclick="showTlDetail(${e.id})">查看</button>
                </div>
            `).join('');
        }
    }

    if (todoSummaryEl) {
        const thisMonthOpps = opps.filter(o =>
            o.current_action === '等公告' || o.current_action === '等报名'
        );
        const noLinkOpps = opps.filter(o =>
            !o.official_url && !o.announcement_url && !o.position_url
        );
        const actionOpps = {
            '待报名': opps.filter(o => o.current_action === '待报名'),
            '待投递': opps.filter(o => o.current_action === '待投递'),
            '待笔试': opps.filter(o => o.current_action === '待笔试'),
            '待面试': opps.filter(o => o.current_action === '待面试'),
        };

        let html = `
            <div class="todo-summary-item">
                <div class="todo-summary-title">本月需关注 <span class="todo-summary-count">${thisMonthOpps.length}</span></div>
                <a href="/todos" class="btn btn-sm btn-secondary">查看全部</a>
            </div>
            <div class="todo-summary-item">
                <div class="todo-summary-title">过期待更新 <span class="todo-summary-count">${overdueItems.length}</span></div>
                <a href="/todos" class="btn btn-sm btn-secondary">查看全部</a>
            </div>
            <div class="todo-summary-item">
                <div class="todo-summary-title">待确认链接 <span class="todo-summary-count">${noLinkOpps.length}</span></div>
                <a href="/todos" class="btn btn-sm btn-secondary">查看全部</a>
            </div>
        `;

        for (const [action, items] of Object.entries(actionOpps)) {
            if (items.length > 0) {
                html += `
                    <div class="todo-summary-item">
                        <div class="todo-summary-title">${action} <span class="todo-summary-count">${items.length}</span></div>
                        <a href="/todos" class="btn btn-sm btn-secondary">查看全部</a>
                    </div>
                `;
            }
        }

        todoSummaryEl.innerHTML = html;
    }
}

/* buildTlParams 已移除：时间线始终加载全部节点，不受筛选影响 */

/* ============================================================
   初始化
   ============================================================ */
document.addEventListener('DOMContentLoaded', init);

function init() {
    /* 标签切换 */
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.track = btn.dataset.track;
            loadData();
        });
    });

    /* 时间线视图切换已移除：时间线始终展示全部节点 */

    /* 节点明细搜索 */
    if (detailSearch) {
        let detailTimer;
        detailSearch.addEventListener('input', () => {
            clearTimeout(detailTimer);
            detailTimer = setTimeout(() => renderDetailList(), 200);
        });
    }

    /* tooltip 隐藏计时器 */
    if (tlTooltip) {
        tlTooltip.addEventListener('mouseleave', () => {
            tlTooltip.style.display = 'none';
        });
    }

    /* 搜索（300ms 防抖） */
    if (searchBox) {
        let searchTimer;
        searchBox.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                state.search = searchBox.value.trim();
                loadOpps();
            }, 300);
        });
    }

    /* 筛选 */
    if (filterSel) {
        filterSel.addEventListener('change', () => {
            state.filter = filterSel.value;
            loadOpps();
        });
    }

    /* 新增 */
    if ($('btn-add-opp')) $('btn-add-opp').addEventListener('click', () => openOppModal(null));
    if ($('btn-add-event')) $('btn-add-event').addEventListener('click', () => openEvModal(null));
    if ($('btn-add-fav')) $('btn-add-fav').addEventListener('click', () => openFavModal(null));

    /* 导入 / 导出 / 重置 */
    if ($('btn-export')) $('btn-export').addEventListener('click', exportData);
    if ($('btn-export-fav')) $('btn-export-fav').addEventListener('click', exportFavorites);
    if (fileInput) fileInput.addEventListener('change', handleImport);
    if ($('btn-reset')) $('btn-reset').addEventListener('click', () => {
        showConfirm('确认重置为默认数据？当前数据将被全部清除。', resetData);
    });

    /* 机会管理页面筛选 */
    initOpportunityFilters();

    /* 岗位收藏搜索和筛选 */
    if (favSearch) {
        let favTimer;
        favSearch.addEventListener('input', () => {
            clearTimeout(favTimer);
            favTimer = setTimeout(() => renderFavorites(), 200);
        });
    }
    ['fav-filter-region', 'fav-filter-track', 'fav-filter-match'].forEach(id => {
        const el = $(id);
        if (el) el.addEventListener('change', () => renderFavorites());
    });

    /* 弹窗关闭 */
    document.querySelectorAll('[data-close]').forEach(btn => {
        btn.addEventListener('click', () => {
            const modal = $(btn.dataset.close);
            if (modal) modal.style.display = 'none';
        });
    });

    /* 点击遮罩关闭 */
    [modalOpp, modalEv, modalFav, confirmDlg, tlDetailModal].forEach(m => {
        if (m) m.addEventListener('click', e => { if (e.target === m) m.style.display = 'none'; });
    });

    /* ESC 关闭弹窗 */
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            [modalOpp, modalEv, modalFav, confirmDlg, tlDetailModal].forEach(m => {
                if (m) m.style.display = 'none';
            });
        }
    });

    /* 表单提交 */
    $('form-opp').addEventListener('submit', saveOpp);
    if ($('form-event')) $('form-event').addEventListener('submit', saveEv);
    if ($('form-fav')) $('form-fav').addEventListener('submit', saveFav);

    /* 初始加载 */
    loadData();
}

/* ============================================================
   数据加载
   ============================================================ */
async function loadData() {
    await Promise.all([loadOpps(), loadTl(), loadFavorites()]);
    updateSummary();
    renderStats();
    renderTodoView();
    renderDbInfo();
    renderHomeOverview();
}

async function loadOpps() {
    try {
        const resp = await fetch('/api/opportunities?' + buildOppParams());
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        state.opps = await resp.json();
        renderOpps();
    } catch (e) {
        console.error('加载机会失败', e);
        if (oppList) {
            oppList.innerHTML = '<p class="placeholder">加载失败，请刷新页面</p>';
        }
    }
}

async function loadTl() {
    try {
        /* 时间线始终加载全部节点，不受 track/filter 影响 */
        const resp = await fetch('/api/timeline');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        state.tlAllEvents = await resp.json();
        state.events = state.tlAllEvents; /* 兼容 updateSummary */
        renderTimeline();
        renderDetailList();
    } catch (e) {
        console.error('加载时间线失败', e);
        state.tlAllEvents = [];
        state.events = [];
        if (tlTrack) tlTrack.innerHTML = '<p class="tl-empty">加载失败，请刷新页面</p>';
        if (todoContainer) todoContainer.innerHTML = '<p class="placeholder">加载时间线失败，请刷新页面</p>';
    }
}

/* ============================================================
   顶部摘要
   ============================================================ */
function updateSummary() {
    if (!recentEl || !lastUpdEl) return;

    const now = new Date();
    const curMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

    const upcoming = state.events
        .filter(e => e.month >= curMonth)
        .filter(e => e.status !== '已放弃')
        .sort((a, b) => a.month.localeCompare(b.month))
        .slice(0, 3);

    if (upcoming.length === 0) {
        recentEl.textContent = '暂无近期节点';
    } else {
        recentEl.textContent = upcoming.map(e => `${e.month} ${e.title}`).join(' / ');
    }

    const all = [...state.opps, ...state.events];
    const times = all.map(x => x.updated_at).filter(Boolean).sort().reverse();
    lastUpdEl.textContent = times.length ? times[0] : '-';
}

/* ============================================================
   渲染：机会卡片
   ============================================================ */
function renderOpps() {
    if (!oppList || !oppCount) return;

    oppCount.textContent = state.opps.length;

    if (state.opps.length === 0) {
        oppList.innerHTML = '<p class="placeholder">暂无匹配的机会</p>';
        return;
    }

    oppList.innerHTML = state.opps.map(o => `
        <div class="opp-card" data-id="${o.id}">
            <div class="opp-card-header">
                <h3 class="opp-card-title">${esc(o.name)}</h3>
                <div class="opp-card-badges">
                    ${trackTag(o.track)}
                    ${statusTag(o.status)}
                    ${priorityTag(o.priority)}
                </div>
            </div>

            <div class="opp-card-meta">
                <div><span class="meta-key">类别：</span>${esc(o.category)}</div>
                <div><span class="meta-key">地域：</span>${esc(o.region)}</div>
                <div><span class="meta-key">适合计算机硕：</span>${esc(o.fit_computer_master)}</div>
                <div><span class="meta-key">当前动作：</span>${actionTag(o.current_action)}</div>
                <div><span class="meta-key">公告/启动：</span>${esc(o.expected_announcement_time)}</div>
                <div><span class="meta-key">报名/投递：</span>${esc(o.expected_apply_time)}</div>
                <div><span class="meta-key">笔试：</span>${esc(o.expected_exam_time)}</div>
                <div><span class="meta-key">面试：</span>${esc(o.expected_interview_time)}</div>
            </div>

            <div class="opp-card-links">
                ${linkHtml(o.official_url, '官网')}
                ${linkHtml(o.announcement_url, '公告')}
                ${linkHtml(o.position_url, '岗位表')}
                ${linkHtml(o.apply_url, '报名入口')}
            </div>

            ${o.note ? `<div class="opp-card-note">${esc(o.note)}</div>` : ''}

            <div class="opp-card-actions">
                <button class="btn btn-sm btn-secondary" onclick="editOpp(${o.id})">编辑</button>
                <button class="btn btn-sm btn-success" onclick="setOppStatus(${o.id},'官方已确定')">官方已确定</button>
                <button class="btn btn-sm btn-warning" onclick="setOppStatus(${o.id},'待更新')">待更新</button>
                <button class="btn btn-sm btn-danger" onclick="delOpp(${o.id})">删除</button>
            </div>
        </div>
    `).join('');
}

/* ============================================================
   渲染：横向时间线
   ============================================================ */

/* 月份 → 百分比位置（0-100） */
function monthToPercent(ym) {
    const [y, m] = ym.split('-').map(Number);
    const [sy, sm] = TL_START.split('-').map(Number);
    const offset = (y - sy) * 12 + (m - sm);
    if (offset < 0 || offset > TL_TOTAL) return null;
    return (offset / TL_TOTAL) * 100;
}

/* 日期 → 百分比位置（精确到日） */
function dateToPercent(dateStr) {
    if (!dateStr) return null;
    const [y, m, d] = dateStr.split('-').map(Number);
    const [sy, sm] = TL_START.split('-').map(Number);
    const startDate = new Date(sy, sm - 1, 1);
    const [ey, em] = TL_END.split('-').map(Number);
    const endDate = new Date(ey, em, 0); // 月末
    const totalDays = (endDate - startDate) / (1000 * 60 * 60 * 24);
    const currentDate = new Date(y, m - 1, d);
    const offsetDays = (currentDate - startDate) / (1000 * 60 * 60 * 24);
    if (offsetDays < 0 || offsetDays > totalDays) return null;
    return (offsetDays / totalDays) * 100;
}

/* 获取事件的位置百分比（优先使用日期，否则使用月份） */
function getEventPercent(ev) {
    if (ev.date) {
        return dateToPercent(ev.date);
    }
    return monthToPercent(ev.month);
}

/* 百分比 → CSS left 值（相对于 tl-track，考虑 40px padding） */
function pctToLeft(pct) {
    return `calc(40px + (100% - 80px) * ${pct / 100})`;
}

/* 获取当前月份 YYYY-MM */
function getCurrentMonth() {
    const now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
}

/* 状态 → CSS class */
function statusDotClass(s) {
    if (s === '官方已确定') return 's-confirmed';
    if (s === '待更新') return 's-pending';
    if (s === '已放弃' || s === '已结束') return 's-abandoned';
    return 's-reference';
}

/* 大类 → CSS class */
function trackDotClass(t) {
    if (t === '体制/准体制') return 't-system';
    if (t === '互联网/市场化') return 't-market';
    return 't-other';
}

/* 生成月份刻度列表 */
function generateMonthTicks() {
    const months = [];
    for (let y = 2026; y <= 2027; y++) {
        const startM = (y === 2026) ? 7 : 1;
        const endM = (y === 2027) ? 12 : 12;
        for (let m = startM; m <= endM; m++) {
            months.push(`${y}-${String(m).padStart(2, '0')}`);
        }
    }
    return months;
}

function renderTimeline() {
    if (!tlTrack) return;

    const events = state.tlAllEvents;
    if (eventCount) eventCount.textContent = events.length;

    const months = generateMonthTicks();
    const curMonth = getCurrentMonth();

    let html = '<div class="tl-axis"></div>';

    /* 渲染月份刻度 */
    months.forEach(m => {
        const pct = monthToPercent(m);
        const isPast = m < curMonth;
        const isCurrent = m === curMonth;
        const cls = isCurrent ? 'current' : (isPast ? 'past' : '');
        const label = m.replace(/^\d{2}\d{2}-/, ''); /* 只显示月份如 "07" */
        const showYear = m.endsWith('-01') || m.endsWith('-07'); /* 在1月和7月显示年份 */
        const labelText = showYear ? m.replace('-', '.') : label;

        html += `<div class="tl-tick ${cls}" style="left: ${pctToLeft(pct)};">
            <div class="tl-tick-line"></div>
            <div class="tl-tick-label">${labelText}</div>
        </div>`;
    });

    /* 渲染事件节点 */
    /* 按位置分组，避免重叠 */
    const positionMap = new Map(); // pct -> [events]
    events.forEach(ev => {
        const pct = getEventPercent(ev);
        if (pct === null) return;
        const key = Math.round(pct * 10) / 10; // 四舍五入到0.1%精度
        if (!positionMap.has(key)) {
            positionMap.set(key, []);
        }
        positionMap.get(key).push(ev);
    });

    positionMap.forEach((posEvents, pct) => {
        /* 按日期排序 */
        posEvents.sort((a, b) => {
            const dateA = a.date || `${a.month}-01`;
            const dateB = b.date || `${b.month}-01`;
            return dateA.localeCompare(dateB);
        });

        posEvents.forEach((ev, idx) => {
            const month = ev.month;
            const isCurrentMonth = month === curMonth;
            const dotCls = `${statusDotClass(ev.status)} ${trackDotClass(ev.track)} ${isCurrentMonth ? 'current-month' : ''}`;

            /* 同一位置多个节点纵向错开，上下交替 */
            const rowHeight = 32;
            const maxVisibleRows = 3; // 最多显示3行
            let row;
            if (posEvents.length <= maxVisibleRows) {
                /* 节点少时，均匀分布 */
                row = idx;
            } else {
                /* 节点多时，限制行数 */
                if (idx < maxVisibleRows) {
                    row = idx;
                } else {
                    /* 超出的节点放在最后一行 */
                    row = maxVisibleRows - 1;
                }
            }

            /* 计算垂直位置，上下交替 */
            const direction = row % 2 === 0 ? -1 : 1;
            const distance = Math.floor(row / 2) + 1;
            const topOffset = AXIS_Y + (direction * distance * rowHeight);

            html += `<div class="tl-dot ${dotCls}"
                style="left: ${pctToLeft(pct)}; top: ${topOffset}px;"
                data-id="${ev.id}"
                data-month="${ev.month}"
                data-date="${ev.date || ''}"
                data-title="${esc(ev.title)}"
                data-track="${esc(ev.track)}"
                data-category="${esc(ev.category)}"
                data-status="${esc(ev.status)}"
                data-link="${esc(ev.link)}"
                data-note="${esc(ev.note)}"
                onmouseenter="showTlTooltip(this, event)"
                onmouseleave="scheduleHideTooltip()"
                onclick="showTlDetail(${ev.id})"
            ></div>`;

            /* 如果超出显示行数，显示提示 */
            if (idx === maxVisibleRows && posEvents.length > maxVisibleRows) {
                html += `<div class="tl-more-hint" style="left: ${pctToLeft(pct)}; top: ${AXIS_Y + 80}px; position: absolute; font-size: 11px; color: var(--c-text-3);">
                    +${posEvents.length - maxVisibleRows}个
                </div>`;
            }
        });
    });

    tlTrack.innerHTML = html;
}

/* 显示 tooltip */
function showTlTooltip(dotEl, e) {
    clearTimeout(hideTooltipTimer);
    const month = dotEl.dataset.month;
    const date = dotEl.dataset.date;
    const title = dotEl.dataset.title;
    const track = dotEl.dataset.track;
    const category = dotEl.dataset.category;
    const status = dotEl.dataset.status;
    const link = dotEl.dataset.link;
    const note = dotEl.dataset.note;

    let html = `<div class="tl-tooltip-title">${esc(title)}</div>`;
    const timeDisplay = date ? `日期：${esc(date)}` : `月份：${esc(month)}`;
    html += `<div class="tl-tooltip-row"><span class="tl-tooltip-key">${date ? '日期' : '月份'}</span><span>${date ? esc(date) : esc(month)}</span></div>`;
    html += `<div class="tl-tooltip-row"><span class="tl-tooltip-key">类别</span><span>${esc(category)}</span></div>`;
    html += `<div class="tl-tooltip-row"><span class="tl-tooltip-key">大类</span><span>${esc(track)}</span></div>`;
    html += `<div class="tl-tooltip-row"><span class="tl-tooltip-key">状态</span><span>${statusTag(status)}</span></div>`;
    if (link) html += `<div class="tl-tooltip-row"><span class="tl-tooltip-key">链接</span><span>${linkHtml(link, '查看')}</span></div>`;
    if (note) html += `<div class="tl-tooltip-note">${esc(note)}</div>`;

    tlTooltip.innerHTML = html;
    tlTooltip.style.display = 'block';

    /* 定位 tooltip */
    const dotRect = dotEl.getBoundingClientRect();
    const tipW = 260;
    let left = dotRect.left + dotRect.width / 2 - tipW / 2;
    let top = dotRect.top - tlTooltip.offsetHeight - 10;

    /* 边界检查 */
    if (left < 8) left = 8;
    if (left + tipW > window.innerWidth - 8) left = window.innerWidth - tipW - 8;
    if (top < 8) top = dotRect.bottom + 10; /* 显示在下方 */

    tlTooltip.style.left = left + 'px';
    tlTooltip.style.top = top + 'px';
    tlTooltip.style.position = 'fixed';
}

function scheduleHideTooltip() {
    hideTooltipTimer = setTimeout(() => {
        if (tlTooltip) tlTooltip.style.display = 'none';
    }, 200);
}

/* 显示节点详情弹窗 */
function showTlDetail(id) {
    if (tlTooltip) tlTooltip.style.display = 'none';
    const ev = state.tlAllEvents.find(e => e.id === id);
    if (!ev) return;
    if (!tlDetailModal || !tlDetailBody || !$('tl-detail-title')) return;

    $('tl-detail-title').textContent = ev.title;

    let html = '';
    const timeDisplay = ev.date ? `日期：${esc(ev.date)}` : `月份：${esc(ev.month)}`;
    html += `<div class="detail-modal-field"><span class="detail-modal-key">${ev.date ? '日期' : '月份'}</span><span class="detail-modal-val">${ev.date ? esc(ev.date) : esc(ev.month)}</span></div>`;
    html += `<div class="detail-modal-field"><span class="detail-modal-key">类别</span><span class="detail-modal-val">${esc(ev.category)}</span></div>`;
    html += `<div class="detail-modal-field"><span class="detail-modal-key">大类</span><span class="detail-modal-val">${trackTag(ev.track)}</span></div>`;
    html += `<div class="detail-modal-field"><span class="detail-modal-key">状态</span><span class="detail-modal-val">${statusTag(ev.status)}</span></div>`;
    if (ev.link) html += `<div class="detail-modal-field"><span class="detail-modal-key">链接</span><span class="detail-modal-val">${linkHtml(ev.link, '打开链接')}</span></div>`;
    if (ev.note) html += `<div class="detail-modal-note">${esc(ev.note)}</div>`;

    html += `<div class="detail-modal-actions">
        <button class="btn btn-sm btn-secondary" onclick="editEv(${ev.id})">编辑</button>
        <button class="btn btn-sm btn-success" onclick="setEvStatus(${ev.id},'官方已确定');tlDetailModal.style.display='none'">官方已确定</button>
        <button class="btn btn-sm btn-warning" onclick="setEvStatus(${ev.id},'待更新');tlDetailModal.style.display='none'">待更新</button>
        <button class="btn btn-sm btn-secondary" onclick="setEvStatus(${ev.id},'参考往年');tlDetailModal.style.display='none'">参考往年</button>
        <button class="btn btn-sm btn-danger" onclick="delEvFromDetail(${ev.id})">删除</button>
    </div>`;

    tlDetailBody.innerHTML = html;
    tlDetailModal.style.display = 'flex';
}

/* 从详情弹窗中删除节点 */
function delEvFromDetail(id) {
    const ev = state.tlAllEvents.find(e => e.id === id);
    if (!ev) return;
    tlDetailModal.style.display = 'none';
    showConfirm(`确认删除「${ev.title}」？`, async () => {
        try {
            const resp = await fetch(`/api/timeline/${id}`, { method: 'DELETE' });
            if (!resp.ok) throw new Error('删除失败');
            await loadData();
            if (typeof window.reloadCalendarData === 'function') {
                await window.reloadCalendarData();
            }
        } catch (err) {
            console.error(err);
            alert('删除失败');
        }
    });
}

/* 渲染节点明细列表 */
function renderDetailList() {
    if (!tlDetailList) return;
    const q = (detailSearch ? detailSearch.value : '').trim().toLowerCase();
    let events = state.tlAllEvents.slice().sort((a, b) => {
        /* 优先按日期排序，否则按月份排序 */
        const dateA = a.date || `${a.month}-01`;
        const dateB = b.date || `${b.month}-01`;
        return dateA.localeCompare(dateB);
    });

    if (q) {
        events = events.filter(e =>
            e.title.toLowerCase().includes(q) ||
            e.category.toLowerCase().includes(q) ||
            e.track.toLowerCase().includes(q) ||
            (e.note || '').toLowerCase().includes(q)
        );
    }

    if (events.length === 0) {
        tlDetailList.innerHTML = '<p class="placeholder">无匹配节点</p>';
        return;
    }

    tlDetailList.innerHTML = events.map(e => `
        <div class="detail-item" onclick="showTlDetail(${e.id})">
            <span class="detail-item-month">${esc(e.date || e.month)}</span>
            <span class="detail-item-title">${esc(e.title)}</span>
            <div class="detail-item-badges">
                ${trackTag(e.track)}
                ${statusTag(e.status)}
            </div>
        </div>
    `).join('');
}

/* ============================================================
   机会 CRUD
   ============================================================ */
function openOppModal(opp) {
    $('modal-opp-title').textContent = opp ? '编辑机会' : '新增机会';
    $('opp-id').value       = opp ? opp.id : '';
    $('opp-name').value     = opp ? opp.name : '';
    $('opp-track').value    = opp ? opp.track : '体制/准体制';
    $('opp-category').value = opp ? opp.category : '';
    $('opp-priority').value = opp ? opp.priority : '可以关注';
    $('opp-region').value   = opp ? opp.region : '全国';
    $('opp-fit').value      = opp ? opp.fit_computer_master : '待确认';
    $('opp-ann-time').value = opp ? opp.expected_announcement_time : '';
    $('opp-app-time').value = opp ? opp.expected_apply_time : '';
    $('opp-exam-time').value = opp ? opp.expected_exam_time : '';
    $('opp-int-time').value = opp ? opp.expected_interview_time : '';
    $('opp-url').value      = opp ? opp.official_url : '';
    $('opp-ann-url').value  = opp ? opp.announcement_url : '';
    $('opp-pos-url').value  = opp ? opp.position_url : '';
    $('opp-apply-url').value = opp ? opp.apply_url : '';
    $('opp-status').value   = opp ? opp.status : '待更新';
    $('opp-action').value   = opp ? opp.current_action : '持续关注';
    $('opp-note').value     = opp ? opp.note : '';
    modalOpp.style.display  = 'flex';
}

async function saveOpp(e) {
    e.preventDefault();
    const id = $('opp-id').value;
    const data = {
        track: $('opp-track').value,
        name: $('opp-name').value.trim(),
        category: $('opp-category').value.trim(),
        priority: $('opp-priority').value,
        region: $('opp-region').value,
        fit_computer_master: $('opp-fit').value,
        expected_announcement_time: $('opp-ann-time').value.trim(),
        expected_apply_time: $('opp-app-time').value.trim(),
        expected_exam_time: $('opp-exam-time').value.trim(),
        expected_interview_time: $('opp-int-time').value.trim(),
        official_url: $('opp-url').value.trim(),
        announcement_url: $('opp-ann-url').value.trim(),
        position_url: $('opp-pos-url').value.trim(),
        apply_url: $('opp-apply-url').value.trim(),
        status: $('opp-status').value,
        current_action: $('opp-action').value,
        note: $('opp-note').value.trim(),
    };
    if (!data.name || !data.category) {
        alert('请填写机会名称和具体类别');
        return;
    }

    try {
        const url = id ? `/api/opportunities/${id}` : '/api/opportunities';
        const method = id ? 'PUT' : 'POST';
        const resp = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            alert(result.error || '保存失败');
            return;
        }
        modalOpp.style.display = 'none';
        await loadData();
    } catch (err) {
        console.error(err);
        alert('保存失败');
    }
}

function editOpp(id) {
    const opp = state.opps.find(o => o.id === id);
    if (opp) openOppModal(opp);
}

function delOpp(id) {
    const opp = state.opps.find(o => o.id === id);
    if (!opp) return;
    showConfirm(`确认删除「${opp.name}」？相关时间线节点和岗位收藏也会同步删除。`, async () => {
        try {
            const resp = await fetch(`/api/opportunities/${id}`, { method: 'DELETE' });
            const result = await resp.json().catch(() => ({}));

            if (!resp.ok || result.ok === false) {
                alert(result.error || '删除失败');
                return;
            }

            console.log('删除同步结果：', result);
            await loadData();
        } catch (err) {
            console.error(err);
            alert('删除失败');
        }
    });
}

async function setOppStatus(id, status) {
    try {
        await fetch(`/api/opportunities/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
        await loadData();
    } catch (err) {
        console.error(err);
    }
}

/* ============================================================
   时间线 CRUD
   ============================================================ */
function openEvModal(ev) {
    $('modal-event-title').textContent = ev ? '编辑时间节点' : '新增时间节点';
    $('event-id').value       = ev ? ev.id : '';
    $('event-month').value    = ev ? ev.month : '';
    $('event-date').value     = ev ? ev.date : '';
    $('event-title').value    = ev ? ev.title : '';
    $('event-track').value    = ev ? ev.track : '体制/准体制';
    $('event-category').value = ev ? ev.category : '';
    $('event-status').value   = ev ? ev.status : '待更新';
    $('event-link').value     = ev ? ev.link : '';
    $('event-note').value     = ev ? ev.note : '';

    // 新增字段
    $('event-date-precision').value = ev ? (ev.date_precision || 'month') : 'month';
    $('event-end-date').value = ev ? ev.end_date : '';
    $('event-current-action').value = ev ? ev.current_action : '';

    // 填充关联机会下拉框（如果模板中存在该字段）
    const eventOppSelect = $('event-opportunity-id');
    if (eventOppSelect) {
        eventOppSelect.value = ev ? (ev.opportunity_id || '') : '';
        populateOpportunitySelect('event-opportunity-id', ev ? ev.opportunity_id : null);
    }

    modalEv.style.display     = 'flex';
}

function populateOpportunitySelect(selectId, selectedId) {
    const select = $(selectId);
    if (!select) return;

    select.innerHTML = '<option value="">不关联</option>';

    state.opps.forEach(opp => {
        const option = document.createElement('option');
        option.value = opp.id;
        option.textContent = `${opp.name} (${opp.category})`;
        if (selectedId && String(opp.id) === String(selectedId)) {
            option.selected = true;
        }
        select.appendChild(option);
    });

    /* 岗位收藏选择关联机会时，同步文本字段，避免 opportunity_id 和 opportunity_name 不一致 */
    if (selectId === 'fav-opportunity-id' && !select.dataset.syncBound) {
        select.dataset.syncBound = '1';
        select.addEventListener('change', () => {
            const opp = state.opps.find(o => String(o.id) === String(select.value));
            if (!opp) return;
            if ($('fav-opp-name')) $('fav-opp-name').value = opp.name || '';
            if ($('fav-track')) $('fav-track').value = opp.track || '体制/准体制';
        });
    }

    if (selectId === 'event-opportunity-id' && !select.dataset.syncBound) {
        select.dataset.syncBound = '1';
        select.addEventListener('change', () => {
            const opp = state.opps.find(o => String(o.id) === String(select.value));
            if (!opp) return;
            if ($('event-track')) $('event-track').value = opp.track || '体制/准体制';
            if ($('event-category')) $('event-category').value = opp.category || '';
        });
    }
}


async function saveEv(e) {
    e.preventDefault();
    const id = $('event-id').value;
    const data = {
        month: $('event-month').value,
        date: $('event-date').value,
        title: $('event-title').value.trim(),
        track: $('event-track').value,
        category: $('event-category').value.trim(),
        status: $('event-status').value,
        link: $('event-link').value.trim(),
        note: $('event-note').value.trim(),
        // 新增字段
        event_date: $('event-date').value,
        date_precision: $('event-date-precision').value,
        end_date: $('event-end-date').value,
        current_action: $('event-current-action').value,
        opportunity_id: $('event-opportunity-id') ? ($('event-opportunity-id').value || null) : null,
    };
    if (!data.month || !data.title) {
        alert('请填写月份和标题');
        return;
    }

    try {
        const url = id ? `/api/timeline/${id}` : '/api/timeline';
        const method = id ? 'PUT' : 'POST';
        const resp = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            alert(result.error || '保存失败');
            return;
        }
        modalEv.style.display = 'none';
        await loadData();
        if (typeof window.reloadCalendarData === 'function') {
            await window.reloadCalendarData();
        }
    } catch (err) {
        console.error(err);
        alert('保存失败');
    }
}

function editEv(id) {
    const ev = state.events.find(e => e.id === id);
    if (ev) openEvModal(ev);
}

function delEv(id) {
    const ev = state.events.find(e => e.id === id);
    if (!ev) return;
    showConfirm(`确认删除「${ev.title}」？`, async () => {
        try {
            const resp = await fetch(`/api/timeline/${id}`, { method: 'DELETE' });
            if (!resp.ok) throw new Error('删除失败');
            await loadData();
            if (typeof window.reloadCalendarData === 'function') {
                await window.reloadCalendarData();
            }
        } catch (err) {
            console.error(err);
            alert('删除失败');
        }
    });
}

async function setEvStatus(id, status) {
    try {
        const resp = await fetch(`/api/timeline/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
        if (!resp.ok) throw new Error('更新失败');
        await loadData();
        if (typeof window.reloadCalendarData === 'function') {
            await window.reloadCalendarData();
        }
    } catch (err) {
        console.error(err);
        alert('更新失败');
    }
}

/* ============================================================
   导入 / 导出 / 重置
   ============================================================ */
async function exportData() {
    try {
        const resp = await fetch('/api/export');
        const data = await resp.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const ts = new Date().toISOString().slice(0, 10);
        a.download = `opp-backup-${ts}.json`;
        a.click();
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error(err);
        alert('导出失败');
    }
}

function handleImport() {
    const file = fileInput.files[0];
    if (!file) return;
    showConfirm('导入将覆盖当前所有数据，确认继续？', async () => {
        try {
            const form = new FormData();
            form.append('file', file);
            form.append('overwrite', 'true');
            const resp = await fetch('/api/import', { method: 'POST', body: form });
            const result = await resp.json();
            if (!resp.ok) {
                alert(result.error || '导入失败');
                return;
            }
            alert(`导入成功：${result.opp_count} 条机会，${result.event_count} 条时间节点，${result.fav_count || 0} 条岗位收藏`);
            await loadData();
        } catch (err) {
            console.error(err);
            alert('导入失败');
        }
        fileInput.value = '';
    });
}

async function resetData() {
    try {
        const resp = await fetch('/api/reset', { method: 'POST' });
        const result = await resp.json();
        if (!resp.ok) {
            alert(result.error || '重置失败');
            return;
        }
        alert('已重置为默认数据');
        await loadData();
    } catch (err) {
        console.error(err);
        alert('重置失败');
    }
}

/* ============================================================
   确认弹窗
   ============================================================ */
function showConfirm(msg, cb) {
    if (!confirmMsg || !confirmDlg) {
        if (window.confirm(msg)) cb();
        return;
    }
    confirmMsg.textContent = msg;
    confirmCallback = cb;
    confirmDlg.style.display = 'flex';
}

if ($('confirm-yes')) {
    $('confirm-yes').addEventListener('click', () => {
        confirmDlg.style.display = 'none';
        if (confirmCallback) { confirmCallback(); confirmCallback = null; }
    });
}

if ($('confirm-no')) {
    $('confirm-no').addEventListener('click', () => {
        confirmDlg.style.display = 'none';
        confirmCallback = null;
    });
}

/* ============================================================
   岗位收藏
   ============================================================ */
async function loadFavorites() {
    try {
        const resp = await fetch('/api/job-favorites');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        state.favorites = await resp.json();
        renderFavorites();
    } catch (e) {
        console.error('加载岗位收藏失败', e);
        if (favList) favList.innerHTML = '<p class="placeholder">加载失败</p>';
    }
}

function renderFavorites() {
    if (!favList) return;

    const q = (favSearch ? favSearch.value : '').trim().toLowerCase();
    let favs = state.favorites;

    /* 搜索 */
    if (q) {
        favs = favs.filter(f =>
            f.job_name.toLowerCase().includes(q) ||
            f.organization.toLowerCase().includes(q) ||
            f.major_requirement.toLowerCase().includes(q) ||
            f.note.toLowerCase().includes(q)
        );
    }

    /* 筛选 */
    const regionFilter = $('fav-filter-region');
    const trackFilter = $('fav-filter-track');
    const matchFilter = $('fav-filter-match');

    if (regionFilter && regionFilter.value) {
        favs = favs.filter(f => f.region === regionFilter.value);
    }
    if (trackFilter && trackFilter.value) {
        favs = favs.filter(f => f.track === trackFilter.value);
    }
    if (matchFilter && matchFilter.value) {
        favs = favs.filter(f => f.match_status === matchFilter.value);
    }

    if (favCount) favCount.textContent = state.favorites.length;

    if (favs.length === 0) {
        favList.innerHTML = '<p class="placeholder">暂无岗位收藏</p>';
        return;
    }

    favList.innerHTML = favs.map(f => `
        <div class="fav-card">
            <div class="fav-card-header">
                <h3 class="fav-card-title">${esc(f.job_name)}</h3>
                <div class="opp-card-badges">
                    ${trackTag(f.track)}
                    ${matchStatusTag(f.match_status)}
                    ${priorityTag(f.priority)}
                </div>
            </div>
            <div class="fav-card-meta">
                <div><span class="meta-key">所属机会：</span>${esc(f.opportunity_name)}</div>
                <div><span class="meta-key">单位：</span>${esc(f.organization)}</div>
                <div><span class="meta-key">地区：</span>${esc(f.region)}</div>
                <div><span class="meta-key">专业要求：</span>${esc(f.major_requirement)}</div>
                <div><span class="meta-key">学历要求：</span>${esc(f.education_requirement)}</div>
                <div><span class="meta-key">当前动作：</span>${actionTag(f.current_action)}</div>
                <div><span class="meta-key">报名时间：</span>${esc(f.apply_time)}</div>
                <div><span class="meta-key">笔试时间：</span>${esc(f.exam_time)}</div>
            </div>
            <div class="fav-card-links">
                ${linkHtml(f.job_url, '岗位链接')}
                ${linkHtml(f.source_url, '公告链接')}
            </div>
            ${f.note ? `<div class="fav-card-note">${esc(f.note)}</div>` : ''}
            <div class="fav-card-actions">
                <button class="btn btn-sm btn-secondary" onclick="editFav(${f.id})">编辑</button>
                <button class="btn btn-sm btn-danger" onclick="delFav(${f.id})">删除</button>
            </div>
        </div>
    `).join('');
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

function openFavModal(fav) {
    if (!modalFav) return;
    $('modal-fav-title').textContent = fav ? '编辑岗位收藏' : '新增岗位收藏';
    $('fav-id').value = fav ? fav.id : '';
    $('fav-job-name').value = fav ? fav.job_name : '';
    $('fav-opp-name').value = fav ? fav.opportunity_name : '';
    $('fav-track').value = fav ? fav.track : '体制/准体制';
    $('fav-organization').value = fav ? fav.organization : '';
    $('fav-region').value = fav ? fav.region : '衡阳';
    $('fav-major').value = fav ? fav.major_requirement : '';
    $('fav-education').value = fav ? fav.education_requirement : '';
    $('fav-apply-time').value = fav ? fav.apply_time : '';
    $('fav-exam-time').value = fav ? fav.exam_time : '';
    $('fav-interview-time').value = fav ? fav.interview_time : '';
    $('fav-job-url').value = fav ? fav.job_url : '';
    $('fav-source-url').value = fav ? fav.source_url : '';
    $('fav-match-status').value = fav ? fav.match_status : '未判断';
    $('fav-priority').value = fav ? fav.priority : '可以关注';
    $('fav-action').value = fav ? fav.current_action : '待确认';
    $('fav-note').value = fav ? fav.note : '';

    // 填充关联机会下拉框（如果模板中存在该字段）
    const favOppSelect = $('fav-opportunity-id');
    if (favOppSelect) {
        favOppSelect.value = fav ? (fav.opportunity_id || '') : '';
        populateOpportunitySelect('fav-opportunity-id', fav ? fav.opportunity_id : null);
    }

    modalFav.style.display = 'flex';
}

async function saveFav(e) {
    e.preventDefault();
    const id = $('fav-id').value;
    const data = {
        job_name: $('fav-job-name').value.trim(),
        opportunity_name: $('fav-opp-name').value.trim(),
        track: $('fav-track').value,
        organization: $('fav-organization').value.trim(),
        region: $('fav-region').value,
        major_requirement: $('fav-major').value.trim(),
        education_requirement: $('fav-education').value.trim(),
        apply_time: $('fav-apply-time').value.trim(),
        exam_time: $('fav-exam-time').value.trim(),
        interview_time: $('fav-interview-time').value.trim(),
        job_url: $('fav-job-url').value.trim(),
        source_url: $('fav-source-url').value.trim(),
        match_status: $('fav-match-status').value,
        priority: $('fav-priority').value,
        current_action: $('fav-action').value,
        note: $('fav-note').value.trim(),
        opportunity_id: $('fav-opportunity-id') ? ($('fav-opportunity-id').value || null) : null,
    };

    if (!data.job_name) {
        alert('请填写岗位名称');
        return;
    }

    try {
        const url = id ? `/api/job-favorites/${id}` : '/api/job-favorites';
        const method = id ? 'PUT' : 'POST';
        const resp = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            alert(result.error || '保存失败');
            return;
        }
        modalFav.style.display = 'none';
        await loadFavorites();
    } catch (err) {
        console.error(err);
        alert('保存失败');
    }
}

function editFav(id) {
    const fav = state.favorites.find(f => f.id === id);
    if (fav) openFavModal(fav);
}

function delFav(id) {
    const fav = state.favorites.find(f => f.id === id);
    if (!fav) return;
    showConfirm(`确认删除岗位「${fav.job_name}」？`, async () => {
        try {
            const resp = await fetch(`/api/job-favorites/${id}`, { method: 'DELETE' });
            const result = await resp.json().catch(() => ({}));
            if (!resp.ok || result.ok === false) {
                alert(result.error || '删除失败');
                return;
            }
            await loadData();
        } catch (err) {
            console.error(err);
            alert('删除失败');
        }
    });
}

function exportFavorites() {
    const data = {
        job_favorites: state.favorites,
        exported_at: new Date().toISOString().slice(0, 19).replace('T', ' ')
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `job-favorites-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

/* ============================================================
   统计卡片
   ============================================================ */
function renderStats() {
    if (!$('stat-total')) return;

    const opps = state.opps;
    const existingOppIds = new Set(opps.map(o => String(o.id)));
    const events = state.tlAllEvents.filter(e =>
        !e.opportunity_id || existingOppIds.has(String(e.opportunity_id))
    );
    const favs = state.favorites;

    /* 总数 */
    $('stat-total').textContent = opps.length;

    /* 重点关注 */
    $('stat-priority').textContent = opps.filter(o => o.priority === '重点关注').length;

    /* 待更新 */
    $('stat-pending').textContent = opps.filter(o => o.status === '待更新').length;

    /* 官方已确定 */
    $('stat-confirmed').textContent = opps.filter(o => o.status === '官方已确定').length;

    /* 岗位收藏 */
    $('stat-favorites').textContent = favs.length;

    /* 近30天节点 */
    const now = new Date();
    const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const curMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const nextMonth = thirtyDaysLater.getFullYear() + '-' + String(thirtyDaysLater.getMonth() + 1).padStart(2, '0');
    const recentEvents = events.filter(e => e.month >= curMonth && e.month <= nextMonth);
    $('stat-recent').textContent = recentEvents.length;

    /* 状态分布条 */
    const total = opps.length || 1;
    const confirmed = opps.filter(o => o.status === '官方已确定').length;
    const pending = opps.filter(o => o.status === '待更新').length;
    const reference = opps.filter(o => o.status === '参考往年').length;
    const abandoned = opps.filter(o => o.status === '已放弃').length;

    if ($('status-confirmed')) $('status-confirmed').style.width = (confirmed / total * 100) + '%';
    if ($('status-pending')) $('status-pending').style.width = (pending / total * 100) + '%';
    if ($('status-reference')) $('status-reference').style.width = (reference / total * 100) + '%';
    if ($('status-abandoned')) $('status-abandoned').style.width = (abandoned / total * 100) + '%';

    if ($('legend-confirmed')) $('legend-confirmed').textContent = confirmed;
    if ($('legend-pending')) $('legend-pending').textContent = pending;
    if ($('legend-reference')) $('legend-reference').textContent = reference;
    if ($('legend-abandoned')) $('legend-abandoned').textContent = abandoned;
}

/* ============================================================
   待办视图
   ============================================================ */
function renderTodoView() {
    if (!todoContainer) return;

    const opps = state.opps;
    const existingOppIds = new Set(opps.map(o => String(o.id)));
    const events = state.tlAllEvents.filter(e =>
        !e.opportunity_id || existingOppIds.has(String(e.opportunity_id))
    );
    const now = new Date();
    const curMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const nextMonthStr = nextMonth.getFullYear() + '-' + String(nextMonth.getMonth() + 1).padStart(2, '0');
    const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const thirtyDaysMonth = thirtyDaysLater.getFullYear() + '-' + String(thirtyDaysLater.getMonth() + 1).padStart(2, '0');

    let html = '';

    /* 1. 本月需关注 */
    const thisMonthEvents = events.filter(e => e.month === curMonth);
    const thisMonthOpps = opps.filter(o =>
        o.expected_announcement_time.includes('本月') ||
        o.expected_apply_time.includes('本月') ||
        o.current_action === '等公告' ||
        o.current_action === '等报名'
    );
    const thisMonthItems = [...thisMonthEvents.map(e => ({type: 'event', ...e})),
                            ...thisMonthOpps.map(o => ({type: 'opp', ...o}))];

    html += renderTodoGroup('本月需关注', thisMonthItems);

    /* 2. 近30天关注 */
    const next30DaysEvents = events.filter(e => e.month >= curMonth && e.month <= thirtyDaysMonth && e.month !== curMonth);
    html += renderTodoGroup('近30天关注', next30DaysEvents.map(e => ({type: 'event', ...e})));

    /* 3. 过期待更新 */
    const overdueItems = opps.filter(o =>
        (o.status === '参考往年' || o.status === '待更新') &&
        (o.current_action === '等公告' || o.current_action === '等报名' ||
         o.current_action === '待投递' || o.current_action === '待笔试' ||
         o.current_action === '待面试')
    );
    html += renderTodoGroup('过期待更新', overdueItems.map(o => ({type: 'opp', ...o})));

    /* 4. 待确认链接 */
    const noLinkOpps = opps.filter(o =>
        !o.official_url && !o.announcement_url && !o.position_url
    );
    html += renderTodoGroup('待确认链接', noLinkOpps.map(o => ({type: 'opp', ...o})));

    /* 5. 当前动作待处理 */
    const actionOpps = opps.filter(o =>
        o.current_action === '待报名' || o.current_action === '待投递' ||
        o.current_action === '待笔试' || o.current_action === '待面试'
    );
    html += renderTodoGroup('当前动作待处理', actionOpps.map(o => ({type: 'opp', ...o})));

    todoContainer.innerHTML = html || '<p class="todo-empty">暂无待处理事项</p>';
}

function renderTodoGroup(title, items) {
    if (items.length === 0) return '';

    let html = `<div class="todo-group">
        <div class="todo-group-title">${title} <span class="todo-group-badge">${items.length}</span></div>
        <div class="todo-list">`;

    items.forEach(item => {
        if (item.type === 'event') {
            html += `
                <div class="todo-item">
                    <div class="todo-item-content">
                        <div class="todo-item-title">${esc(item.title)}</div>
                        <div class="todo-item-meta">
                            <span>${esc(item.month)}</span>
                            <span>${esc(item.category)}</span>
                            ${statusTag(item.status)}
                        </div>
                    </div>
                    <div class="todo-item-actions">
                        <button class="btn btn-sm btn-secondary" onclick="showTlDetail(${item.id})">查看</button>
                    </div>
                </div>`;
        } else {
            html += `
                <div class="todo-item">
                    <div class="todo-item-content">
                        <div class="todo-item-title">${esc(item.name)}</div>
                        <div class="todo-item-meta">
                            <span>${esc(item.category)}</span>
                            <span>${esc(item.current_action)}</span>
                            ${statusTag(item.status)}
                        </div>
                    </div>
                    <div class="todo-item-actions">
                        <button class="btn btn-sm btn-secondary" onclick="editOpp(${item.id})">编辑</button>
                        ${item.official_url ? `<a href="${esc(item.official_url)}" target="_blank" class="btn btn-sm btn-primary">官网</a>` : ''}
                    </div>
                </div>`;
        }
    });

    html += `</div></div>`;
    return html;
}
