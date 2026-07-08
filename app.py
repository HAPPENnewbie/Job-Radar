"""
就业雷达 - 2027届计算机硕士机会管理工具
Flask + SQLite + Jinja2 轻量级本地应用
"""

from flask import Flask, render_template, request, jsonify
import sqlite3
import os
import json
import re
import copy
from datetime import datetime

app = Flask(__name__)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
DB_PATH = os.path.join(DATA_DIR, 'app.db')
SEED_PATH = os.path.join(BASE_DIR, 'seed', 'default_data.json')
SETTINGS_PATH = os.path.join(DATA_DIR, 'settings.json')

DEFAULT_CATEGORY_GROUPS = [
    {'track': '体制/准体制', 'categories': ['公务员', '事业单位', '烟草', '国企/央企', '银行']},
    {'track': '互联网/市场化', 'categories': ['计算机秋招', '互联网大厂', '中小厂', '远程岗位']},
]

DEFAULT_SETTINGS = {
    'app_name': '就业雷达',
    'grad_year': '2027届',
    'school': 'xx大学',
    'education': '硕士研究生',
    'major': '计算机技术 / 计算机类',
    'undergraduate_major': '计算机科学与技术',
    'target_region_1': '衡阳',
    'target_region_2': '湖南省内',
    'target_region_3': '全国稳定机会',
    'backup_route': '互联网 / 市场化就业',
    'timeline_start': '2026-07',
    'timeline_end': '2027-12',
    'default_todo_range': '90d',
    'default_track': 'all',
    'default_priority': '',
    'sidebar_default_collapsed': False,
    'categories': DEFAULT_CATEGORY_GROUPS,
    'note': ''
}

CORE_EVENT_TYPES = ['公告', '报名/投递', '笔试/测评', '面试']
CATEGORY_SPLIT_RE = re.compile(r'(?:\\n|\r\n|\r|\n|[，,、;；/|]+)+')


def split_category_items(value):
    """拆分二级分类，兼容真实换行和字面量 \\n。"""
    if value is None:
        return []
    return [item.strip() for item in CATEGORY_SPLIT_RE.split(str(value)) if item.strip()]




# ============================================================
# 应用设置
# ============================================================

def month_str_is_valid(value):
    return isinstance(value, str) and re.match(r'^\d{4}-\d{2}$', value or '') is not None


def normalize_categories(raw_categories=None):
    """规范化用户自定义机会分类。只影响设置文件，不改数据库。"""
    if raw_categories is None:
        raw_categories = DEFAULT_CATEGORY_GROUPS

    groups = []
    # 兼容 {"体制/准体制": ["公务员"]} 这种结构
    if isinstance(raw_categories, dict):
        raw_categories = [
            {'track': track, 'categories': cats}
            for track, cats in raw_categories.items()
        ]

    if not isinstance(raw_categories, list):
        raw_categories = DEFAULT_CATEGORY_GROUPS

    seen_tracks = set()
    for item in raw_categories:
        if not isinstance(item, dict):
            continue
        track = str(item.get('track', '') or '').strip()
        if not track or track in seen_tracks:
            continue

        raw_items = item.get('categories', [])
        if isinstance(raw_items, str):
            raw_items = split_category_items(raw_items)
        if not isinstance(raw_items, list):
            raw_items = []

        expanded_items = []
        for cat in raw_items:
            # 兼容旧设置中把多个分类保存成一个字符串的情况，例如：公务员\n事业单位\n烟草
            expanded_items.extend(split_category_items(cat))

        cats = []
        seen_cats = set()
        for cat in expanded_items:
            cat = str(cat or '').strip()
            if cat and cat not in seen_cats:
                cats.append(cat)
                seen_cats.add(cat)

        groups.append({'track': track, 'categories': cats})
        seen_tracks.add(track)

    if not groups:
        return copy.deepcopy(DEFAULT_CATEGORY_GROUPS)
    return groups


def normalize_settings(raw=None):
    """合并并校验设置，避免前端写入异常值。"""
    raw = raw or {}
    settings = copy.deepcopy(DEFAULT_SETTINGS)
    for key in DEFAULT_SETTINGS.keys():
        if key in raw:
            settings[key] = raw[key]

    for key in [
        'app_name', 'grad_year', 'school', 'education', 'major', 'undergraduate_major',
        'target_region_1', 'target_region_2', 'target_region_3', 'backup_route',
        'default_track', 'default_priority', 'note'
    ]:
        settings[key] = str(settings.get(key, '') or '').strip()

    if not settings['app_name']:
        settings['app_name'] = DEFAULT_SETTINGS['app_name']
    if not settings['grad_year']:
        settings['grad_year'] = DEFAULT_SETTINGS['grad_year']

    if not month_str_is_valid(settings.get('timeline_start')):
        settings['timeline_start'] = DEFAULT_SETTINGS['timeline_start']
    if not month_str_is_valid(settings.get('timeline_end')):
        settings['timeline_end'] = DEFAULT_SETTINGS['timeline_end']
    if settings['timeline_end'] < settings['timeline_start']:
        settings['timeline_start'], settings['timeline_end'] = settings['timeline_end'], settings['timeline_start']

    settings['categories'] = normalize_categories(settings.get('categories'))

    if settings.get('default_todo_range') not in {'7d', '30d', '90d', 'all'}:
        settings['default_todo_range'] = DEFAULT_SETTINGS['default_todo_range']
    allowed_tracks = {'all'} | {g['track'] for g in settings['categories']}
    if settings.get('default_track') not in allowed_tracks:
        settings['default_track'] = DEFAULT_SETTINGS['default_track']
    if settings.get('default_priority') not in {'', '重点关注', '可以关注', '低频关注'}:
        settings['default_priority'] = DEFAULT_SETTINGS['default_priority']

    settings['sidebar_default_collapsed'] = bool(settings.get('sidebar_default_collapsed'))
    return settings


def get_app_settings():
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(SETTINGS_PATH):
        return copy.deepcopy(DEFAULT_SETTINGS)
    try:
        with open(SETTINGS_PATH, 'r', encoding='utf-8') as f:
            return normalize_settings(json.load(f))
    except Exception as e:
        print(f"[WARN] 读取设置失败，使用默认设置: {e}")
        return copy.deepcopy(DEFAULT_SETTINGS)


def save_app_settings(data):
    os.makedirs(DATA_DIR, exist_ok=True)
    settings = normalize_settings(data)
    with open(SETTINGS_PATH, 'w', encoding='utf-8') as f:
        json.dump(settings, f, ensure_ascii=False, indent=2)
    return settings


@app.context_processor
def inject_app_settings():
    return {'app_settings': get_app_settings()}


# ============================================================
# 数据库
# ============================================================

def get_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS opportunities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            track TEXT NOT NULL DEFAULT '',
            name TEXT NOT NULL DEFAULT '',
            category TEXT NOT NULL DEFAULT '',
            priority TEXT NOT NULL DEFAULT '可以关注',
            region TEXT NOT NULL DEFAULT '全国',
            fit_computer_master TEXT NOT NULL DEFAULT '待确认',
            expected_announcement_time TEXT NOT NULL DEFAULT '',
            expected_apply_time TEXT NOT NULL DEFAULT '',
            expected_exam_time TEXT NOT NULL DEFAULT '',
            expected_interview_time TEXT NOT NULL DEFAULT '',
            official_url TEXT NOT NULL DEFAULT '',
            announcement_url TEXT NOT NULL DEFAULT '',
            position_url TEXT NOT NULL DEFAULT '',
            apply_url TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT '待更新',
            current_action TEXT NOT NULL DEFAULT '持续关注',
            note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS timeline_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            month TEXT NOT NULL DEFAULT '',
            date TEXT NOT NULL DEFAULT '',
            title TEXT NOT NULL DEFAULT '',
            track TEXT NOT NULL DEFAULT '',
            category TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT '待更新',
            link TEXT NOT NULL DEFAULT '',
            note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT '',
            event_date TEXT DEFAULT '',
            date_precision TEXT DEFAULT 'month',
            end_date TEXT DEFAULT '',
            current_action TEXT DEFAULT '',
            opportunity_id INTEGER DEFAULT NULL,
            event_type TEXT DEFAULT '其他'
        );

        CREATE TABLE IF NOT EXISTS job_favorites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_name TEXT NOT NULL DEFAULT '',
            opportunity_name TEXT NOT NULL DEFAULT '',
            track TEXT NOT NULL DEFAULT '',
            organization TEXT NOT NULL DEFAULT '',
            region TEXT NOT NULL DEFAULT '',
            major_requirement TEXT NOT NULL DEFAULT '',
            education_requirement TEXT NOT NULL DEFAULT '',
            apply_time TEXT NOT NULL DEFAULT '',
            exam_time TEXT NOT NULL DEFAULT '',
            interview_time TEXT NOT NULL DEFAULT '',
            job_url TEXT NOT NULL DEFAULT '',
            source_url TEXT NOT NULL DEFAULT '',
            match_status TEXT NOT NULL DEFAULT '未判断',
            priority TEXT NOT NULL DEFAULT '可以关注',
            current_action TEXT NOT NULL DEFAULT '待确认',
            note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT '',
            opportunity_id INTEGER DEFAULT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_timeline_opportunity_id ON timeline_events(opportunity_id);
        CREATE INDEX IF NOT EXISTS idx_favorites_opportunity_id ON job_favorites(opportunity_id);
    """)
    conn.commit()
    conn.close()


def migrate_timeline_fields():
    """兼容旧 SQLite 数据库，补齐后续新增字段。"""
    conn = get_db()
    try:
        cursor = conn.execute("PRAGMA table_info(timeline_events)")
        columns = [row[1] for row in cursor.fetchall()]

        if 'event_date' not in columns:
            conn.execute("ALTER TABLE timeline_events ADD COLUMN event_date TEXT DEFAULT ''")
        if 'date_precision' not in columns:
            conn.execute("ALTER TABLE timeline_events ADD COLUMN date_precision TEXT DEFAULT 'month'")
        if 'end_date' not in columns:
            conn.execute("ALTER TABLE timeline_events ADD COLUMN end_date TEXT DEFAULT ''")
        if 'current_action' not in columns:
            conn.execute("ALTER TABLE timeline_events ADD COLUMN current_action TEXT DEFAULT ''")
        if 'opportunity_id' not in columns:
            conn.execute("ALTER TABLE timeline_events ADD COLUMN opportunity_id INTEGER DEFAULT NULL")
        if 'event_type' not in columns:
            conn.execute("ALTER TABLE timeline_events ADD COLUMN event_type TEXT DEFAULT '其他'")

        conn.execute("""
            UPDATE timeline_events
            SET event_type = CASE
                WHEN title LIKE '%公告%' OR current_action LIKE '%公告%' THEN '公告'
                WHEN title LIKE '%报名%' OR title LIKE '%投递%' OR current_action LIKE '%报名%' OR current_action LIKE '%投递%' THEN '报名/投递'
                WHEN title LIKE '%笔试%' OR title LIKE '%测评%' OR current_action LIKE '%笔试%' OR current_action LIKE '%测评%' THEN '笔试/测评'
                WHEN title LIKE '%面试%' OR current_action LIKE '%面试%' THEN '面试'
                ELSE '其他'
            END
            WHERE event_type IS NULL OR event_type = '' OR event_type = '其他'
        """)

        conn.execute("""
            UPDATE timeline_events
            SET date_precision = CASE
                WHEN date != '' AND date IS NOT NULL THEN 'day'
                ELSE 'month'
            END
            WHERE date_precision = '' OR date_precision IS NULL
        """)

        cursor = conn.execute("PRAGMA table_info(job_favorites)")
        fav_columns = [row[1] for row in cursor.fetchall()]
        if 'opportunity_id' not in fav_columns:
            conn.execute("ALTER TABLE job_favorites ADD COLUMN opportunity_id INTEGER DEFAULT NULL")

        conn.execute("CREATE INDEX IF NOT EXISTS idx_timeline_opportunity_id ON timeline_events(opportunity_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_favorites_opportunity_id ON job_favorites(opportunity_id)")

        conn.commit()
    except Exception as e:
        print(f"[WARN] 数据库迁移警告: {e}")
    finally:
        conn.close()


def backfill_opportunity_id():
    """给历史 timeline_events / job_favorites 回填 opportunity_id。"""
    conn = get_db()
    try:
        opps = conn.execute("""
            SELECT id, name, category, track
            FROM opportunities
            ORDER BY id
        """).fetchall()

        for opp in opps:
            opp_id = opp['id']
            opp_name = opp['name'] or ''
            opp_category = opp['category'] or ''
            opp_track = opp['track'] or ''

            category_count = conn.execute("""
                SELECT COUNT(*)
                FROM opportunities
                WHERE category = ? AND track = ?
            """, (opp_category, opp_track)).fetchone()[0]
            category_unique = 1 if category_count == 1 else 0

            conn.execute("""
                UPDATE timeline_events
                SET opportunity_id = ?
                WHERE (opportunity_id IS NULL OR TRIM(CAST(opportunity_id AS TEXT)) = '')
                  AND track = ?
                  AND (
                      title LIKE ?
                      OR note LIKE ?
                      OR (? = 1 AND category = ?)
                  )
            """, (
                opp_id,
                opp_track,
                f"%{opp_name}%",
                f"%{opp_name}%",
                category_unique,
                opp_category
            ))

            conn.execute("""
                UPDATE job_favorites
                SET opportunity_id = ?
                WHERE (opportunity_id IS NULL OR TRIM(CAST(opportunity_id AS TEXT)) = '')
                  AND (
                      opportunity_name = ?
                      OR opportunity_name LIKE ?
                      OR job_name LIKE ?
                      OR note LIKE ?
                  )
            """, (
                opp_id,
                opp_name,
                f"%{opp_name}%",
                f"%{opp_name}%",
                f"%{opp_name}%"
            ))

        conn.commit()
    finally:
        conn.close()


def cleanup_orphaned_data():
    """清理已经关联到不存在机会的孤儿时间线节点和岗位收藏。"""
    conn = get_db()
    try:
        deleted_events = conn.execute("""
            DELETE FROM timeline_events
            WHERE opportunity_id IS NOT NULL
              AND TRIM(CAST(opportunity_id AS TEXT)) != ''
              AND CAST(opportunity_id AS INTEGER) NOT IN (
                  SELECT id FROM opportunities
              )
        """).rowcount

        deleted_favorites = conn.execute("""
            DELETE FROM job_favorites
            WHERE opportunity_id IS NOT NULL
              AND TRIM(CAST(opportunity_id AS TEXT)) != ''
              AND CAST(opportunity_id AS INTEGER) NOT IN (
                  SELECT id FROM opportunities
              )
        """).rowcount

        conn.commit()
        print(f"[INFO] 清理孤儿数据：timeline_events={deleted_events}, job_favorites={deleted_favorites}")
    finally:
        conn.close()


def seed_db():
    """从 seed/default_data.json 导入默认数据。"""
    conn = get_db()
    try:
        count_opp = conn.execute("SELECT COUNT(*) FROM opportunities").fetchone()[0]
        count_tl = conn.execute("SELECT COUNT(*) FROM timeline_events").fetchone()[0]
        if count_opp > 0 or count_tl > 0:
            conn.close()
            return False
    except Exception:
        pass

    if not os.path.exists(SEED_PATH):
        print(f"[WARN] 未找到 seed 文件: {SEED_PATH}")
        conn.close()
        return False

    with open(SEED_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)

    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    old_opp_id_to_new_id = {}
    opp_name_to_new_id = {}

    for opp in data.get('opportunities', []):
        if not opp.get('name'):
            continue
        cur = conn.execute("""
            INSERT INTO opportunities
            (track, name, category, priority, region, fit_computer_master,
             expected_announcement_time, expected_apply_time,
             expected_exam_time, expected_interview_time,
             official_url, announcement_url, position_url, apply_url,
             status, current_action, note, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            opp.get('track', ''), opp.get('name', ''),
            opp.get('category', ''), opp.get('priority', '可以关注'),
            opp.get('region', '全国'), opp.get('fit_computer_master', '待确认'),
            opp.get('expected_announcement_time', ''),
            opp.get('expected_apply_time', ''),
            opp.get('expected_exam_time', ''),
            opp.get('expected_interview_time', ''),
            opp.get('official_url', ''), opp.get('announcement_url', ''),
            opp.get('position_url', ''), opp.get('apply_url', ''),
            opp.get('status', '待更新'), opp.get('current_action', '持续关注'),
            opp.get('note', ''), now, now
        ))
        new_id = cur.lastrowid
        if opp.get('id') is not None:
            old_opp_id_to_new_id[str(opp.get('id'))] = new_id
        opp_name_to_new_id[opp.get('name', '')] = new_id

    def mapped_opp_id(raw_id, fallback_name=''):
        if raw_id is not None and str(raw_id).strip() != '':
            mapped = old_opp_id_to_new_id.get(str(raw_id))
            if mapped:
                return mapped
        if fallback_name:
            return opp_name_to_new_id.get(fallback_name)
        return None

    for ev in data.get('timeline', []):
        conn.execute("""
            INSERT INTO timeline_events
            (month, date, title, track, category, status, link, note, created_at, updated_at,
             event_date, date_precision, end_date, current_action, opportunity_id, event_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            ev.get('month', ''), ev.get('date', ''),
            ev.get('title', ''), ev.get('track', ''),
            ev.get('category', ''), ev.get('status', '待更新'),
            ev.get('link', ''), ev.get('note', ''), now, now,
            ev.get('event_date', ev.get('date', '')), ev.get('date_precision', 'month'),
            ev.get('end_date', ''), ev.get('current_action', ''),
            mapped_opp_id(ev.get('opportunity_id'), ev.get('opportunity_name', '')),
            ev.get('event_type', '其他')
        ))

    for fav in data.get('job_favorites', []):
        conn.execute("""
            INSERT INTO job_favorites
            (job_name, opportunity_name, track, organization, region,
             major_requirement, education_requirement, apply_time, exam_time, interview_time,
             job_url, source_url, match_status, priority, current_action, note,
             created_at, updated_at, opportunity_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            fav.get('job_name', ''), fav.get('opportunity_name', ''),
            fav.get('track', ''), fav.get('organization', ''),
            fav.get('region', ''), fav.get('major_requirement', ''),
            fav.get('education_requirement', ''), fav.get('apply_time', ''),
            fav.get('exam_time', ''), fav.get('interview_time', ''),
            fav.get('job_url', ''), fav.get('source_url', ''),
            fav.get('match_status', '未判断'), fav.get('priority', '可以关注'),
            fav.get('current_action', '待确认'), fav.get('note', ''),
            now, now,
            mapped_opp_id(fav.get('opportunity_id'), fav.get('opportunity_name', ''))
        ))

    conn.commit()
    conn.close()
    return True


# ============================================================
# 序列化辅助
# ============================================================

def row_to_opp(row):
    return {
        'id': row['id'],
        'track': row['track'],
        'name': row['name'],
        'category': row['category'],
        'priority': row['priority'],
        'region': row['region'],
        'fit_computer_master': row['fit_computer_master'],
        'expected_announcement_time': row['expected_announcement_time'],
        'expected_apply_time': row['expected_apply_time'],
        'expected_exam_time': row['expected_exam_time'],
        'expected_interview_time': row['expected_interview_time'],
        'official_url': row['official_url'],
        'announcement_url': row['announcement_url'],
        'position_url': row['position_url'],
        'apply_url': row['apply_url'],
        'status': row['status'],
        'current_action': row['current_action'],
        'note': row['note'],
        'created_at': row['created_at'],
        'updated_at': row['updated_at']
    }


def row_to_event(row):
    result = {
        'id': row['id'],
        'month': row['month'],
        'date': row['date'],
        'title': row['title'],
        'track': row['track'],
        'category': row['category'],
        'status': row['status'],
        'link': row['link'],
        'note': row['note'],
        'created_at': row['created_at'],
        'updated_at': row['updated_at'],
        'event_date': row['event_date'],
        'date_precision': row['date_precision'],
        'end_date': row['end_date'],
        'current_action': row['current_action'],
        'opportunity_id': row['opportunity_id'],
        'event_type': row['event_type'] if 'event_type' in row.keys() else '其他'
    }
    if 'opportunity_name' in row.keys():
        result['opportunity_name'] = row['opportunity_name'] or ''
    return result


def row_to_fav(row):
    """序列化收藏。若已关联机会，优先使用机会表中的实时字段，避免收藏页显示旧副本。"""
    keys = set(row.keys()) if hasattr(row, 'keys') else set()

    def rv(key, default=''):
        try:
            value = row[key]
        except Exception:
            return default
        return default if value is None else value

    linked_live = 'opp_name_live' in keys and rv('opp_name_live', None) not in (None, '')
    stored_opp_name = rv('opportunity_name')
    live_opp_name = rv('opp_name_live') if linked_live else stored_opp_name
    stored_job_name = rv('job_name')
    stored_org = rv('organization')

    # 如果岗位名/单位原本只是机会名称副本，则跟随机会名更新；如果用户改成具体岗位名，则保留用户值。
    job_name = stored_job_name
    if live_opp_name and (not stored_job_name or stored_job_name == stored_opp_name):
        job_name = live_opp_name

    organization = stored_org
    if live_opp_name and (not stored_org or stored_org == stored_opp_name):
        organization = live_opp_name

    if linked_live:
        track = rv('opp_track_live')
        region = rv('opp_region_live')
        priority = rv('opp_priority_live')
        current_action = rv('opp_action_live')
        apply_time = rv('opp_apply_time_live')
        exam_time = rv('opp_exam_time_live')
        interview_time = rv('opp_interview_time_live')
        job_url = rv('opp_position_url_live') or rv('opp_apply_url_live') or rv('opp_official_url_live')
        source_url = rv('opp_announcement_url_live') or rv('opp_official_url_live')
    else:
        track = rv('track')
        region = rv('region')
        priority = rv('priority')
        current_action = rv('current_action')
        apply_time = rv('apply_time')
        exam_time = rv('exam_time')
        interview_time = rv('interview_time')
        job_url = rv('job_url')
        source_url = rv('source_url')

    return {
        'id': rv('id'),
        'job_name': job_name,
        'opportunity_name': live_opp_name,
        'track': track,
        'organization': organization,
        'region': region,
        'major_requirement': rv('major_requirement'),
        'education_requirement': rv('education_requirement'),
        'apply_time': apply_time,
        'exam_time': exam_time,
        'interview_time': interview_time,
        'job_url': job_url,
        'source_url': source_url,
        'match_status': rv('match_status'),
        'priority': priority,
        'current_action': current_action,
        'note': rv('note'),
        'created_at': rv('created_at'),
        'updated_at': rv('updated_at'),
        'opportunity_id': rv('opportunity_id', None)
    }


# ============================================================
# 页面路由
# ============================================================

@app.route('/')
def index():
    return render_template('index.html', active_page='home')


@app.route('/opportunities')
def opportunities_page():
    return render_template('opportunities.html', active_page='opportunities')


@app.route('/job-favorites')
def job_favorites_page():
    return render_template('job_favorites.html', active_page='favorites')


@app.route('/timeline')
def timeline_page():
    return render_template('timeline.html', active_page='timeline')


@app.route('/todos')
def todos_page():
    return render_template('todos.html', active_page='todos')


@app.route('/data')
def data_page():
    return render_template('data.html', active_page='data')


@app.route('/settings')
def settings_page():
    return render_template('settings.html', active_page='settings')



# ============================================================
# 设置 API
# ============================================================

@app.route('/api/settings', methods=['GET'])
def get_settings_api():
    return jsonify({'ok': True, 'settings': get_app_settings()})


@app.route('/api/settings', methods=['PUT'])
def update_settings_api():
    data = request.get_json() or {}
    try:
        settings = save_app_settings(data.get('settings', data))
        return jsonify({'ok': True, 'settings': settings})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 400


@app.route('/api/settings/reset', methods=['POST'])
def reset_settings_api():
    settings = save_app_settings(copy.deepcopy(DEFAULT_SETTINGS))
    return jsonify({'ok': True, 'settings': settings})


# ============================================================
# 机会 API
# ============================================================

@app.route('/api/opportunities', methods=['GET'])
def list_opportunities():
    conn = get_db()
    conditions = []
    params = []

    for arg, column in [
        ('track', 'track'),
        ('priority', 'priority'),
        ('region', 'region'),
        ('fit_computer_master', 'fit_computer_master'),
        ('status', 'status'),
        ('current_action', 'current_action'),
    ]:
        value = request.args.get(arg, '').strip()
        if value and value != 'all':
            conditions.append(f"{column} = ?")
            params.append(value)

    q = request.args.get('q', '').strip()
    if q:
        conditions.append("""(
            name LIKE ? OR category LIKE ? OR region LIKE ? OR
            note LIKE ? OR official_url LIKE ? OR announcement_url LIKE ?
        )""")
        like = f"%{q}%"
        params.extend([like] * 6)

    where = "WHERE " + " AND ".join(conditions) if conditions else ""
    rows = conn.execute(f"SELECT * FROM opportunities {where} ORDER BY id DESC", params).fetchall()
    conn.close()
    return jsonify([row_to_opp(r) for r in rows])


@app.route('/api/opportunities', methods=['POST'])
def create_opportunity():
    data = request.get_json() or {}
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    if not (data.get('name') or '').strip():
        return jsonify({'error': '机会名称不能为空'}), 400
    if not (data.get('category') or '').strip():
        return jsonify({'error': '具体类别不能为空'}), 400

    conn = get_db()
    cur = conn.execute("""
        INSERT INTO opportunities
        (track, name, category, priority, region, fit_computer_master,
         expected_announcement_time, expected_apply_time, expected_exam_time,
         expected_interview_time, official_url, announcement_url, position_url,
         apply_url, status, current_action, note, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        data.get('track', ''), data.get('name', '').strip(),
        data.get('category', '').strip(), data.get('priority', '可以关注'),
        data.get('region', '全国'), data.get('fit_computer_master', '待确认'),
        data.get('expected_announcement_time', ''),
        data.get('expected_apply_time', ''), data.get('expected_exam_time', ''),
        data.get('expected_interview_time', ''), data.get('official_url', ''),
        data.get('announcement_url', ''), data.get('position_url', ''),
        data.get('apply_url', ''), data.get('status', '待更新'),
        data.get('current_action', '持续关注'), data.get('note', ''), now, now
    ))
    conn.commit()
    row = conn.execute("SELECT * FROM opportunities WHERE id = ?", (cur.lastrowid,)).fetchone()
    conn.close()
    return jsonify(row_to_opp(row)), 201


@app.route('/api/opportunities/<int:oid>', methods=['PUT'])
def update_opportunity(oid):
    data = request.get_json() or {}
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    fields = [
        'track', 'name', 'category', 'priority', 'region', 'fit_computer_master',
        'expected_announcement_time', 'expected_apply_time', 'expected_exam_time',
        'expected_interview_time', 'official_url', 'announcement_url', 'position_url',
        'apply_url', 'status', 'current_action', 'note'
    ]
    sets = []
    params = []
    for field in fields:
        if field in data:
            sets.append(f"{field} = ?")
            params.append(data[field])
    if not sets:
        return jsonify({'error': '无可更新字段'}), 400

    conn = get_db()
    try:
        old_opp = conn.execute("SELECT * FROM opportunities WHERE id = ?", (oid,)).fetchone()
        if not old_opp:
            return jsonify({'error': '未找到该机会'}), 404

        sets.append("updated_at = ?")
        params.append(now)
        params.append(oid)
        conn.execute(f"UPDATE opportunities SET {', '.join(sets)} WHERE id = ?", params)

        new_opp = conn.execute("SELECT * FROM opportunities WHERE id = ?", (oid,)).fetchone()
        if not new_opp:
            return jsonify({'error': '未找到该机会'}), 404

        sync_related_records_after_opportunity_update(conn, old_opp, new_opp, now)
        conn.commit()
        return jsonify(row_to_opp(new_opp))
    except Exception as e:
        conn.rollback()
        return jsonify({'ok': False, 'error': str(e)}), 500
    finally:
        conn.close()




def normalize_nullable_id(value):
    """把前端传来的空字符串/None 统一成 None，非空值转 int。"""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return int(text)
    except (TypeError, ValueError):
        return None


def auto_event_titles_for_opp_name(name):
    return [
        f"{name} 公告发布",
        f"{name} 报名/投递",
        f"{name} 笔试/测评",
        f"{name} 面试",
    ] if name else []


def favorite_join_select(where='', order_by='f.id DESC'):
    """收藏查询统一从机会表取实时字段，避免不同页面数据副本不同步。"""
    where_sql = f"WHERE {where}" if where else ''
    return f"""
        SELECT f.*,
               o.name AS opp_name_live,
               o.track AS opp_track_live,
               o.region AS opp_region_live,
               o.priority AS opp_priority_live,
               o.current_action AS opp_action_live,
               o.expected_apply_time AS opp_apply_time_live,
               o.expected_exam_time AS opp_exam_time_live,
               o.expected_interview_time AS opp_interview_time_live,
               o.position_url AS opp_position_url_live,
               o.apply_url AS opp_apply_url_live,
               o.official_url AS opp_official_url_live,
               o.announcement_url AS opp_announcement_url_live
        FROM job_favorites f
        LEFT JOIN opportunities o ON CAST(f.opportunity_id AS TEXT) = CAST(o.id AS TEXT)
        {where_sql}
        ORDER BY {order_by}
    """

@app.route('/api/opportunities/<int:oid>', methods=['DELETE'])
def delete_opportunity(oid):
    conn = get_db()
    try:
        opp = conn.execute("SELECT * FROM opportunities WHERE id = ?", (oid,)).fetchone()
        if not opp:
            return jsonify({'ok': False, 'error': '机会不存在'}), 404

        opp_name = opp['name'] or ''
        opp_category = opp['category'] or ''
        opp_track = opp['track'] or ''

        # 删除已通过 opportunity_id 明确关联的记录。
        deleted_events = conn.execute("""
            DELETE FROM timeline_events
            WHERE CAST(opportunity_id AS TEXT) = CAST(? AS TEXT)
        """, (oid,)).rowcount

        deleted_favorites = conn.execute("""
            DELETE FROM job_favorites
            WHERE CAST(opportunity_id AS TEXT) = CAST(? AS TEXT)
        """, (oid,)).rowcount

        # 兼容旧数据：只删除“完全像自动生成副本”的未关联记录，避免 LIKE 误删相似机会。
        auto_titles = auto_event_titles_for_opp_name(opp_name)
        if auto_titles:
            placeholders = ','.join(['?'] * len(auto_titles))
            deleted_events += conn.execute(f"""
                DELETE FROM timeline_events
                WHERE (opportunity_id IS NULL OR TRIM(CAST(opportunity_id AS TEXT)) = '')
                  AND track = ?
                  AND category = ?
                  AND title IN ({placeholders})
            """, [opp_track, opp_category, *auto_titles]).rowcount

        deleted_favorites += conn.execute("""
            DELETE FROM job_favorites
            WHERE (opportunity_id IS NULL OR TRIM(CAST(opportunity_id AS TEXT)) = '')
              AND opportunity_name = ?
              AND (job_name = ? OR organization = ? OR job_name = '' OR organization = '')
        """, (opp_name, opp_name, opp_name)).rowcount

        deleted_opp = conn.execute("DELETE FROM opportunities WHERE id = ?", (oid,)).rowcount
        conn.commit()
        return jsonify({
            'ok': True,
            'deleted_opportunity': deleted_opp,
            'deleted_events': deleted_events,
            'deleted_favorites': deleted_favorites
        })
    except Exception as e:
        conn.rollback()
        return jsonify({'ok': False, 'error': str(e)}), 500
    finally:
        conn.close()


# ============================================================
# 机会收藏 API
# ============================================================

def favorite_payload_from_opp(opp, data=None):
    data = data or {}
    return {
        'job_name': data.get('job_name') or opp['name'] or '',
        'opportunity_name': opp['name'] or '',
        'track': opp['track'] or '',
        'organization': data.get('organization') or opp['name'] or '',
        'region': data.get('region') or opp['region'] or '',
        'major_requirement': data.get('major_requirement', ''),
        'education_requirement': data.get('education_requirement', ''),
        'apply_time': data.get('apply_time') or opp['expected_apply_time'] or '',
        'exam_time': data.get('exam_time') or opp['expected_exam_time'] or '',
        'interview_time': data.get('interview_time') or opp['expected_interview_time'] or '',
        'job_url': data.get('job_url') or opp['position_url'] or opp['apply_url'] or opp['official_url'] or '',
        'source_url': data.get('source_url') or opp['announcement_url'] or opp['official_url'] or '',
        'match_status': data.get('match_status', '未判断'),
        'priority': data.get('priority') or opp['priority'] or '可以关注',
        'current_action': data.get('current_action') or opp['current_action'] or '待确认',
        'note': data.get('note') or opp['note'] or '',
        'opportunity_id': opp['id']
    }


def insert_favorite(conn, payload, now):
    cur = conn.execute("""
        INSERT INTO job_favorites
        (job_name, opportunity_name, track, organization, region,
         major_requirement, education_requirement, apply_time, exam_time, interview_time,
         job_url, source_url, match_status, priority, current_action, note,
         created_at, updated_at, opportunity_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        payload['job_name'], payload['opportunity_name'], payload['track'], payload['organization'], payload['region'],
        payload['major_requirement'], payload['education_requirement'], payload['apply_time'], payload['exam_time'], payload['interview_time'],
        payload['job_url'], payload['source_url'], payload['match_status'], payload['priority'], payload['current_action'], payload['note'],
        now, now, payload['opportunity_id']
    ))
    return cur.lastrowid


def get_favorite_row(conn, favorite_id):
    return conn.execute(favorite_join_select("f.id = ?", "f.id DESC"), (favorite_id,)).fetchone()



@app.route('/api/opportunities/<int:oid>/favorite', methods=['POST'])
def favorite_opportunity(oid):
    data = request.get_json() or {}
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    conn = get_db()
    try:
        opp = conn.execute("SELECT * FROM opportunities WHERE id = ?", (oid,)).fetchone()
        if not opp:
            return jsonify({'ok': False, 'error': '机会不存在'}), 404

        existing = conn.execute(
            "SELECT * FROM job_favorites WHERE CAST(opportunity_id AS TEXT) = CAST(? AS TEXT) LIMIT 1",
            (oid,)
        ).fetchone()
        if existing:
            return jsonify({'ok': True, 'created': False, 'favorite': row_to_fav(get_favorite_row(conn, existing['id']) or existing)})

        payload = favorite_payload_from_opp(opp, data)
        new_id = insert_favorite(conn, payload, now)
        conn.commit()
        row = get_favorite_row(conn, new_id)
        return jsonify({'ok': True, 'created': True, 'favorite': row_to_fav(row)}), 201
    except Exception as e:
        conn.rollback()
        return jsonify({'ok': False, 'error': str(e)}), 500
    finally:
        conn.close()


@app.route('/api/opportunities/<int:oid>/favorite', methods=['DELETE'])
def unfavorite_opportunity(oid):
    conn = get_db()
    try:
        opp = conn.execute("SELECT * FROM opportunities WHERE id = ?", (oid,)).fetchone()
        if not opp:
            return jsonify({'ok': False, 'error': '机会不存在'}), 404

        deleted = conn.execute(
            "DELETE FROM job_favorites WHERE CAST(opportunity_id AS TEXT) = CAST(? AS TEXT)",
            (oid,)
        ).rowcount
        if deleted == 0:
            deleted = conn.execute(
                "DELETE FROM job_favorites WHERE opportunity_name = ? OR job_name = ?",
                (opp['name'], opp['name'])
            ).rowcount
        conn.commit()
        return jsonify({'ok': True, 'deleted': deleted})
    except Exception as e:
        conn.rollback()
        return jsonify({'ok': False, 'error': str(e)}), 500
    finally:
        conn.close()


# ============================================================
# 时间解析 / 机会同步时间线 API
# ============================================================

def parse_standard_time_value(value):
    """解析标准时间：YYYY-MM / YYYY-MM-DD / start~end。返回 None 表示无法解析。"""
    value = (value or '').strip()
    if not value:
        return None

    parts = value.split('~')
    if len(parts) > 2:
        return None
    start = parts[0].strip()
    end = parts[1].strip() if len(parts) == 2 else ''

    month_re = re.compile(r'^\d{4}-\d{2}$')
    day_re = re.compile(r'^\d{4}-\d{2}-\d{2}$')

    if not (month_re.match(start) or day_re.match(start)):
        return None
    if end and not (month_re.match(end) or day_re.match(end)):
        return None
    if end and end < start:
        return None

    precision = 'day' if len(start) == 10 or len(end) == 10 else 'month'
    month = start[:7]
    date = start if len(start) == 10 else ''
    event_date = date
    return {
        'raw': value,
        'month': month,
        'date': date,
        'event_date': event_date,
        'end_date': end,
        'date_precision': precision,
    }


def event_link_for_type(opp, event_type):
    if event_type == '公告':
        return opp['announcement_url'] or opp['official_url'] or ''
    if event_type == '报名/投递':
        return opp['apply_url'] or opp['announcement_url'] or opp['official_url'] or ''
    if event_type == '笔试/测评':
        return opp['announcement_url'] or opp['official_url'] or ''
    if event_type == '面试':
        return opp['announcement_url'] or opp['official_url'] or ''
    return opp['official_url'] or ''


def row_value(row, key, default=''):
    """安全读取 sqlite3.Row 字段。"""
    try:
        value = row[key]
    except Exception:
        return default
    return default if value is None else value


def replace_name_if_needed(value, old_name, new_name):
    """只替换文本中的旧机会名称；没有旧名称时保留原值。"""
    value = str(value or '')
    old_name = str(old_name or '').strip()
    new_name = str(new_name or '').strip()
    if old_name and new_name and old_name in value:
        return value.replace(old_name, new_name)
    return value


def should_follow_opportunity_value(current_value, old_value, related_value=''):
    """判断收藏字段是否属于从机会复制来的字段，避免覆盖明显手动维护的内容。"""
    current_value = str(current_value or '').strip()
    old_value = str(old_value or '').strip()
    related_value = str(related_value or '').strip()
    return (not current_value) or (old_value and current_value == old_value) or (related_value and current_value == related_value)


def timeline_field_mapping_for_opp(opp):
    name = row_value(opp, 'name')
    return [
        ('expected_announcement_time', '公告', f"{name} 公告发布"),
        ('expected_apply_time', '报名/投递', f"{name} 报名/投递"),
        ('expected_exam_time', '笔试/测评', f"{name} 笔试/测评"),
        ('expected_interview_time', '面试', f"{name} 面试"),
    ]


def sync_favorites_after_opportunity_update(conn, old_opp, new_opp, now):
    """机会修改后，同步已关联的岗位收藏。"""
    oid = row_value(new_opp, 'id')
    old_name = row_value(old_opp, 'name')
    old_note = row_value(old_opp, 'note')
    new_name = row_value(new_opp, 'name')
    new_track = row_value(new_opp, 'track')
    new_region = row_value(new_opp, 'region')
    new_priority = row_value(new_opp, 'priority')
    new_action = row_value(new_opp, 'current_action')
    new_note = row_value(new_opp, 'note')
    new_apply_time = row_value(new_opp, 'expected_apply_time')
    new_exam_time = row_value(new_opp, 'expected_exam_time')
    new_interview_time = row_value(new_opp, 'expected_interview_time')
    new_job_url = row_value(new_opp, 'position_url') or row_value(new_opp, 'apply_url') or row_value(new_opp, 'official_url')
    new_source_url = row_value(new_opp, 'announcement_url') or row_value(new_opp, 'official_url')

    # 先把历史收藏中还没有 opportunity_id、但名称能匹配的记录补齐关联。
    if old_name:
        conn.execute("""
            UPDATE job_favorites
            SET opportunity_id = ?, updated_at = ?
            WHERE (opportunity_id IS NULL OR TRIM(CAST(opportunity_id AS TEXT)) = '')
              AND (opportunity_name = ? OR job_name = ? OR organization = ?)
        """, (oid, now, old_name, old_name, old_name))

    favorites = conn.execute("""
        SELECT *
        FROM job_favorites
        WHERE CAST(opportunity_id AS TEXT) = CAST(? AS TEXT)
    """, (oid,)).fetchall()

    for fav in favorites:
        fav_job_name = row_value(fav, 'job_name')
        fav_opp_name = row_value(fav, 'opportunity_name')
        fav_org = row_value(fav, 'organization')
        fav_note = row_value(fav, 'note')

        synced_job_name = new_name if should_follow_opportunity_value(fav_job_name, old_name, fav_opp_name) else replace_name_if_needed(fav_job_name, old_name, new_name)
        synced_org = new_name if should_follow_opportunity_value(fav_org, old_name, fav_opp_name) else replace_name_if_needed(fav_org, old_name, new_name)
        synced_note = new_note if should_follow_opportunity_value(fav_note, old_note) else replace_name_if_needed(fav_note, old_name, new_name)

        conn.execute("""
            UPDATE job_favorites
            SET job_name = ?,
                opportunity_name = ?,
                track = ?,
                organization = ?,
                region = ?,
                apply_time = ?,
                exam_time = ?,
                interview_time = ?,
                job_url = ?,
                source_url = ?,
                priority = ?,
                current_action = ?,
                note = ?,
                updated_at = ?
            WHERE id = ?
        """, (
            synced_job_name, new_name, new_track, synced_org, new_region,
            new_apply_time, new_exam_time, new_interview_time, new_job_url,
            new_source_url, new_priority, new_action, synced_note, now,
            row_value(fav, 'id')
        ))


def sync_timeline_after_opportunity_update(conn, old_opp, new_opp, now):
    """机会修改后，同步已关联的时间线节点和历史可匹配节点。"""
    oid = row_value(new_opp, 'id')
    old_name = row_value(old_opp, 'name')
    new_name = row_value(new_opp, 'name')
    new_track = row_value(new_opp, 'track')
    new_category = row_value(new_opp, 'category')
    new_status = row_value(new_opp, 'status')
    new_action = row_value(new_opp, 'current_action')
    old_category = row_value(old_opp, 'category')
    old_track = row_value(old_opp, 'track')

    # 兼容旧数据：把没有 opportunity_id 但明显属于该机会的节点先补齐关联。
    if old_name:
        conn.execute("""
            UPDATE timeline_events
            SET opportunity_id = ?, updated_at = ?
            WHERE (opportunity_id IS NULL OR TRIM(CAST(opportunity_id AS TEXT)) = '')
              AND (
                    title LIKE ? OR note LIKE ?
                    OR (category = ? AND track = ?)
              )
        """, (oid, now, f"%{old_name}%", f"%{old_name}%", old_category, old_track))

    mapping = {event_type: (field, default_title) for field, event_type, default_title in timeline_field_mapping_for_opp(new_opp)}
    events = conn.execute("""
        SELECT *
        FROM timeline_events
        WHERE CAST(opportunity_id AS TEXT) = CAST(? AS TEXT)
    """, (oid,)).fetchall()

    for ev in events:
        event_type = row_value(ev, 'event_type') or '其他'
        event_id = row_value(ev, 'id')
        link = event_link_for_type(new_opp, event_type)

        if event_type in mapping:
            field, default_title = mapping[event_type]
            parsed = parse_standard_time_value(row_value(new_opp, field))
            if parsed:
                conn.execute("""
                    UPDATE timeline_events
                    SET month = ?,
                        date = ?,
                        title = ?,
                        track = ?,
                        category = ?,
                        status = ?,
                        link = ?,
                        event_date = ?,
                        date_precision = ?,
                        end_date = ?,
                        current_action = ?,
                        updated_at = ?
                    WHERE id = ?
                """, (
                    parsed['month'], parsed['date'], default_title, new_track,
                    new_category, new_status, link, parsed['event_date'],
                    parsed['date_precision'], parsed['end_date'], new_action or '',
                    now, event_id
                ))
            else:
                conn.execute("""
                    UPDATE timeline_events
                    SET title = ?,
                        track = ?,
                        category = ?,
                        status = ?,
                        link = ?,
                        current_action = ?,
                        updated_at = ?
                    WHERE id = ?
                """, (
                    default_title, new_track, new_category, new_status, link,
                    new_action or '', now, event_id
                ))
        else:
            current_title = row_value(ev, 'title')
            current_note = row_value(ev, 'note')
            synced_title = replace_name_if_needed(current_title, old_name, new_name)
            synced_note = replace_name_if_needed(current_note, old_name, new_name)
            conn.execute("""
                UPDATE timeline_events
                SET title = ?,
                    track = ?,
                    category = ?,
                    status = ?,
                    note = ?,
                    current_action = ?,
                    updated_at = ?
                WHERE id = ?
            """, (
                synced_title, new_track, new_category, new_status,
                synced_note, new_action or '', now, event_id
            ))


def sync_related_records_after_opportunity_update(conn, old_opp, new_opp, now):
    """机会修改后，级联同步收藏和日历。"""
    sync_favorites_after_opportunity_update(conn, old_opp, new_opp, now)
    sync_timeline_after_opportunity_update(conn, old_opp, new_opp, now)


@app.route('/api/opportunities/<int:oid>/sync-timeline', methods=['POST'])
def sync_opportunity_timeline(oid):
    conn = get_db()
    try:
        opp = conn.execute("SELECT * FROM opportunities WHERE id = ?", (oid,)).fetchone()
        if not opp:
            return jsonify({'ok': False, 'error': '机会不存在'}), 404

        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        field_mapping = [
            ('expected_announcement_time', '公告', f"{opp['name']} 公告发布"),
            ('expected_apply_time', '报名/投递', f"{opp['name']} 报名/投递"),
            ('expected_exam_time', '笔试/测评', f"{opp['name']} 笔试/测评"),
            ('expected_interview_time', '面试', f"{opp['name']} 面试"),
        ]

        created = 0
        updated = 0
        skipped = []

        for field, event_type, default_title in field_mapping:
            time_text = opp[field] or ''
            if not time_text.strip():
                continue

            parsed = parse_standard_time_value(time_text)
            if not parsed:
                skipped.append({
                    'field': field,
                    'value': time_text,
                    'reason': '旧格式无法解析，请重新选择标准时间'
                })
                continue

            existing = conn.execute("""
                SELECT id FROM timeline_events
                WHERE CAST(opportunity_id AS TEXT) = CAST(? AS TEXT)
                  AND event_type = ?
            """, (opp['id'], event_type)).fetchone()

            link = event_link_for_type(opp, event_type)
            if existing:
                conn.execute("""
                    UPDATE timeline_events
                    SET month = ?, date = ?, title = ?, track = ?, category = ?,
                        status = ?, link = ?, event_date = ?, date_precision = ?,
                        end_date = ?, current_action = ?, updated_at = ?
                    WHERE id = ?
                """, (
                    parsed['month'], parsed['date'], default_title, opp['track'], opp['category'],
                    opp['status'], link, parsed['event_date'], parsed['date_precision'],
                    parsed['end_date'], opp['current_action'] or '', now, existing['id']
                ))
                updated += 1
            else:
                conn.execute("""
                    INSERT INTO timeline_events
                    (month, date, title, track, category, status, link, note,
                     created_at, updated_at, event_date, date_precision, end_date,
                     current_action, opportunity_id, event_type)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    parsed['month'], parsed['date'], default_title, opp['track'], opp['category'],
                    opp['status'], link, '', now, now, parsed['event_date'],
                    parsed['date_precision'], parsed['end_date'], opp['current_action'] or '',
                    opp['id'], event_type
                ))
                created += 1

        conn.commit()
        return jsonify({'ok': True, 'created': created, 'updated': updated, 'skipped': skipped})
    except Exception as e:
        conn.rollback()
        return jsonify({'ok': False, 'error': str(e)}), 500
    finally:
        conn.close()




def hydrate_event_from_opportunity(conn, data, old_event=None):
    """时间节点绑定机会后，后端统一继承机会大类、类别、状态、动作和默认链接。"""
    data = dict(data or {})
    opp_id = normalize_nullable_id(data.get('opportunity_id'))
    if opp_id is None:
        if 'opportunity_id' in data:
            data['opportunity_id'] = None
        return data

    opp = conn.execute("SELECT * FROM opportunities WHERE id = ?", (opp_id,)).fetchone()
    if not opp:
        raise ValueError('关联机会不存在')

    event_type = data.get('event_type') or (row_value(old_event, 'event_type') if old_event else '') or '其他'
    data['opportunity_id'] = opp_id
    data['track'] = opp['track'] or data.get('track', '')
    data['category'] = opp['category'] or data.get('category', '')
    data['status'] = data.get('status') or opp['status'] or '待更新'
    data['current_action'] = data.get('current_action') or opp['current_action'] or ''
    if not data.get('link'):
        data['link'] = event_link_for_type(opp, event_type)
    return data

# ============================================================
# 时间线 API
# ============================================================

@app.route('/api/timeline', methods=['GET'])
def list_timeline():
    conn = get_db()
    conditions = []
    params = []

    track = request.args.get('track', '').strip()
    if track and track != 'all':
        conditions.append("t.track = ?")
        params.append(track)

    month_from = request.args.get('month_from', '').strip()
    if month_from:
        conditions.append("t.month >= ?")
        params.append(month_from)

    month_to = request.args.get('month_to', '').strip()
    if month_to:
        conditions.append("t.month <= ?")
        params.append(month_to)

    status = request.args.get('status', '').strip()
    if status:
        conditions.append("t.status = ?")
        params.append(status)

    category = request.args.get('category', '').strip()
    if category:
        conditions.append("t.category = ?")
        params.append(category)

    event_type = request.args.get('event_type', '').strip()
    if event_type and event_type != 'all':
        conditions.append("t.event_type = ?")
        params.append(event_type)

    opportunity_id = request.args.get('opportunity_id', '').strip()
    if opportunity_id and opportunity_id != 'all':
        if opportunity_id == 'none':
            conditions.append("t.opportunity_id IS NULL")
        else:
            conditions.append("t.opportunity_id = ?")
            params.append(int(opportunity_id))

    q = request.args.get('q', '').strip()
    if q:
        conditions.append("(t.title LIKE ? OR t.note LIKE ? OR o.name LIKE ?)")
        like = f"%{q}%"
        params.extend([like, like, like])

    where = "WHERE " + " AND ".join(conditions) if conditions else ""
    sql = f"""SELECT t.*, o.name as opportunity_name
              FROM timeline_events t
              LEFT JOIN opportunities o ON t.opportunity_id = o.id
              {where}
              ORDER BY t.month ASC, COALESCE(NULLIF(t.date, ''), t.month || '-01') ASC, t.id ASC"""
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return jsonify([row_to_event(r) for r in rows])


@app.route('/api/timeline', methods=['POST'])
def create_event():
    data = request.get_json() or {}
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    if not (data.get('month') or '').strip():
        return jsonify({'error': '月份不能为空'}), 400
    if not (data.get('title') or '').strip():
        return jsonify({'error': '标题不能为空'}), 400

    conn = get_db()
    try:
        data = hydrate_event_from_opportunity(conn, data)
        cur = conn.execute("""
            INSERT INTO timeline_events
            (month, date, title, track, category, status, link, note, created_at, updated_at,
             event_date, date_precision, end_date, current_action, opportunity_id, event_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            data.get('month', ''), data.get('date', ''),
            data.get('title', ''), data.get('track', ''),
            data.get('category', ''), data.get('status', '待更新'),
            data.get('link', ''), data.get('note', ''), now, now,
            data.get('event_date', data.get('date', '')), data.get('date_precision', 'month'),
            data.get('end_date', ''), data.get('current_action', ''),
            normalize_nullable_id(data.get('opportunity_id')), data.get('event_type', '其他')
        ))
        conn.commit()
        row = conn.execute("""
            SELECT t.*, o.name as opportunity_name
            FROM timeline_events t
            LEFT JOIN opportunities o ON t.opportunity_id = o.id
            WHERE t.id = ?
        """, (cur.lastrowid,)).fetchone()
        return jsonify(row_to_event(row)), 201
    except ValueError as e:
        conn.rollback()
        return jsonify({'ok': False, 'error': str(e)}), 400
    except Exception as e:
        conn.rollback()
        return jsonify({'ok': False, 'error': str(e)}), 500
    finally:
        conn.close()


@app.route('/api/timeline/<int:eid>', methods=['PUT'])
def update_event(eid):
    data = request.get_json() or {}
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    fields = ['month', 'date', 'title', 'track', 'category', 'status', 'link', 'note',
              'event_date', 'date_precision', 'end_date', 'current_action', 'opportunity_id', 'event_type']

    conn = get_db()
    try:
        old = conn.execute("SELECT * FROM timeline_events WHERE id = ?", (eid,)).fetchone()
        if not old:
            return jsonify({'error': '未找到该时间节点'}), 404

        data = hydrate_event_from_opportunity(conn, data, old_event=old)
        sets = []
        params = []
        for f in fields:
            if f in data:
                sets.append(f"{f} = ?")
                params.append(normalize_nullable_id(data[f]) if f == 'opportunity_id' else data[f])
        if not sets:
            return jsonify({'error': '无可更新字段'}), 400

        sets.append("updated_at = ?")
        params.append(now)
        params.append(eid)

        conn.execute(f"UPDATE timeline_events SET {', '.join(sets)} WHERE id = ?", params)
        conn.commit()
        row = conn.execute("""
            SELECT t.*, o.name as opportunity_name
            FROM timeline_events t
            LEFT JOIN opportunities o ON t.opportunity_id = o.id
            WHERE t.id = ?
        """, (eid,)).fetchone()
        return jsonify(row_to_event(row))
    except ValueError as e:
        conn.rollback()
        return jsonify({'ok': False, 'error': str(e)}), 400
    except Exception as e:
        conn.rollback()
        return jsonify({'ok': False, 'error': str(e)}), 500
    finally:
        conn.close()


@app.route('/api/timeline/<int:eid>', methods=['DELETE'])
def delete_event(eid):
    conn = get_db()
    conn.execute("DELETE FROM timeline_events WHERE id = ?", (eid,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# ============================================================
# 岗位收藏 API
# ============================================================

@app.route('/api/job-favorites', methods=['GET'])
def list_job_favorites():
    conn = get_db()
    conditions = []
    params = []

    # 过滤条件也使用机会表实时字段，否则机会修改后筛选结果会和显示内容不一致。
    field_expr = {
        'track': "COALESCE(o.track, f.track)",
        'region': "COALESCE(o.region, f.region)",
        'priority': "COALESCE(o.priority, f.priority)",
        'current_action': "COALESCE(o.current_action, f.current_action)",
        'match_status': "f.match_status",
    }
    for arg in ['track', 'region', 'match_status', 'priority', 'current_action']:
        value = request.args.get(arg, '').strip()
        if value and value != 'all':
            conditions.append(f"{field_expr[arg]} = ?")
            params.append(value)

    q = request.args.get('q', '').strip()
    if q:
        conditions.append("""(
            f.job_name LIKE ? OR f.organization LIKE ? OR f.major_requirement LIKE ? OR
            f.education_requirement LIKE ? OR f.note LIKE ? OR COALESCE(o.name, f.opportunity_name) LIKE ?
        )""")
        like = f"%{q}%"
        params.extend([like] * 6)

    where = " AND ".join(conditions)
    rows = conn.execute(favorite_join_select(where), params).fetchall()
    conn.close()
    return jsonify([row_to_fav(r) for r in rows])


@app.route('/api/job-favorites', methods=['POST'])
def create_job_favorite():
    """只允许基于 opportunity_id 创建收藏，防止岗位收藏变成独立新建入口。"""
    data = request.get_json() or {}
    raw_opp_id = data.get('opportunity_id')
    if raw_opp_id is None or str(raw_opp_id).strip() == '':
        return jsonify({'ok': False, 'error': '岗位收藏必须从机会管理中选择机会添加'}), 400

    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    conn = get_db()
    try:
        opp = conn.execute("SELECT * FROM opportunities WHERE id = ?", (raw_opp_id,)).fetchone()
        if not opp:
            return jsonify({'ok': False, 'error': '关联机会不存在'}), 404

        existing = conn.execute(
            "SELECT * FROM job_favorites WHERE CAST(opportunity_id AS TEXT) = CAST(? AS TEXT) LIMIT 1",
            (raw_opp_id,)
        ).fetchone()
        if existing:
            return jsonify({'ok': True, 'created': False, 'favorite': row_to_fav(get_favorite_row(conn, existing['id']) or existing)})

        payload = favorite_payload_from_opp(opp, data)
        new_id = insert_favorite(conn, payload, now)
        conn.commit()
        row = get_favorite_row(conn, new_id)
        return jsonify(row_to_fav(row)), 201
    except Exception as e:
        conn.rollback()
        return jsonify({'ok': False, 'error': str(e)}), 500
    finally:
        conn.close()


@app.route('/api/job-favorites/<int:fid>', methods=['PUT'])
def update_job_favorite(fid):
    data = request.get_json() or {}
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    fields = [
        'job_name', 'opportunity_name', 'track', 'organization', 'region',
        'major_requirement', 'education_requirement', 'apply_time', 'exam_time', 'interview_time',
        'job_url', 'source_url', 'match_status', 'priority', 'current_action', 'note', 'opportunity_id'
    ]
    sets = []
    params = []
    for f in fields:
        if f in data:
            sets.append(f"{f} = ?")
            params.append(data[f])
    if not sets:
        return jsonify({'error': '无可更新字段'}), 400

    sets.append("updated_at = ?")
    params.append(now)
    params.append(fid)

    conn = get_db()
    try:
        if data.get('opportunity_id'):
            opp = conn.execute("SELECT * FROM opportunities WHERE id = ?", (data.get('opportunity_id'),)).fetchone()
            if not opp:
                return jsonify({'ok': False, 'error': '关联机会不存在'}), 404
        conn.execute(f"UPDATE job_favorites SET {', '.join(sets)} WHERE id = ?", params)
        conn.commit()
        row = get_favorite_row(conn, fid)
        if not row:
            return jsonify({'error': '未找到该岗位'}), 404
        return jsonify(row_to_fav(row))
    except Exception as e:
        conn.rollback()
        return jsonify({'ok': False, 'error': str(e)}), 500
    finally:
        conn.close()


@app.route('/api/job-favorites/<int:fid>', methods=['DELETE'])
def delete_job_favorite(fid):
    conn = get_db()
    conn.execute("DELETE FROM job_favorites WHERE id = ?", (fid,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# ============================================================
# 导入 / 导出 / 重置
# ============================================================

@app.route('/api/export', methods=['GET'])
def export_data():
    conn = get_db()
    opps = [row_to_opp(r) for r in conn.execute("SELECT * FROM opportunities ORDER BY id").fetchall()]
    events = [row_to_event(r) for r in conn.execute("SELECT * FROM timeline_events ORDER BY id").fetchall()]
    favs = [row_to_fav(r) for r in conn.execute("SELECT * FROM job_favorites ORDER BY id").fetchall()]
    conn.close()
    return jsonify({
        'opportunities': opps,
        'timeline': events,
        'job_favorites': favs,
        'exported_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    })


@app.route('/api/import', methods=['POST'])
def import_data():
    if 'file' not in request.files:
        return jsonify({'error': '未上传文件'}), 400

    f = request.files['file']
    if not f.filename.endswith('.json'):
        return jsonify({'error': '文件必须是 JSON 格式'}), 400

    try:
        data = json.load(f)
    except Exception:
        return jsonify({'error': 'JSON 解析失败'}), 400

    if not isinstance(data, dict) or 'opportunities' not in data or 'timeline' not in data:
        return jsonify({'error': 'JSON 结构错误，需包含 opportunities 和 timeline'}), 400

    overwrite = request.form.get('overwrite', 'false').lower() == 'true'
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    conn = get_db()
    old_opp_id_to_new_id = {}
    opp_name_to_new_id = {}

    try:
        if overwrite:
            conn.execute("DELETE FROM timeline_events")
            conn.execute("DELETE FROM job_favorites")
            conn.execute("DELETE FROM opportunities")

        opp_count = 0
        for opp in data.get('opportunities', []):
            if not opp.get('name'):
                continue
            cur = conn.execute("""
                INSERT INTO opportunities
                (track, name, category, priority, region, fit_computer_master,
                 expected_announcement_time, expected_apply_time,
                 expected_exam_time, expected_interview_time,
                 official_url, announcement_url, position_url, apply_url,
                 status, current_action, note, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                opp.get('track', ''), opp.get('name', ''),
                opp.get('category', ''), opp.get('priority', '可以关注'),
                opp.get('region', '全国'), opp.get('fit_computer_master', '待确认'),
                opp.get('expected_announcement_time', ''),
                opp.get('expected_apply_time', ''),
                opp.get('expected_exam_time', ''),
                opp.get('expected_interview_time', ''),
                opp.get('official_url', ''), opp.get('announcement_url', ''),
                opp.get('position_url', ''), opp.get('apply_url', ''),
                opp.get('status', '待更新'), opp.get('current_action', '持续关注'),
                opp.get('note', ''), now, now
            ))
            new_id = cur.lastrowid
            if opp.get('id') is not None:
                old_opp_id_to_new_id[str(opp.get('id'))] = new_id
            opp_name_to_new_id[opp.get('name', '')] = new_id
            opp_count += 1

        def mapped_opportunity_id(raw_id, fallback_name=''):
            if raw_id is not None and str(raw_id).strip() != '':
                mapped = old_opp_id_to_new_id.get(str(raw_id))
                if mapped:
                    return mapped
                exists = conn.execute("SELECT 1 FROM opportunities WHERE id = ?", (raw_id,)).fetchone()
                if exists:
                    return raw_id
            if fallback_name:
                return opp_name_to_new_id.get(fallback_name)
            return None

        ev_count = 0
        for ev in data.get('timeline', []):
            if not ev.get('title') or not ev.get('month'):
                continue
            opp_id = mapped_opportunity_id(ev.get('opportunity_id'), ev.get('opportunity_name', ''))
            conn.execute("""
                INSERT INTO timeline_events
                (month, date, title, track, category, status, link, note, created_at, updated_at,
                 event_date, date_precision, end_date, current_action, opportunity_id, event_type)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                ev.get('month', ''), ev.get('date', ''),
                ev.get('title', ''), ev.get('track', ''),
                ev.get('category', ''), ev.get('status', '待更新'),
                ev.get('link', ''), ev.get('note', ''), now, now,
                ev.get('event_date', ev.get('date', '')), ev.get('date_precision', 'month'),
                ev.get('end_date', ''), ev.get('current_action', ''),
                opp_id, ev.get('event_type', '其他')
            ))
            ev_count += 1

        fav_count = 0
        for fav in data.get('job_favorites', []):
            if not fav.get('job_name'):
                continue
            opp_id = mapped_opportunity_id(fav.get('opportunity_id'), fav.get('opportunity_name', ''))
            conn.execute("""
                INSERT INTO job_favorites
                (job_name, opportunity_name, track, organization, region,
                 major_requirement, education_requirement, apply_time, exam_time, interview_time,
                 job_url, source_url, match_status, priority, current_action, note,
                 created_at, updated_at, opportunity_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                fav.get('job_name', ''), fav.get('opportunity_name', ''),
                fav.get('track', ''), fav.get('organization', ''),
                fav.get('region', ''), fav.get('major_requirement', ''),
                fav.get('education_requirement', ''), fav.get('apply_time', ''),
                fav.get('exam_time', ''), fav.get('interview_time', ''),
                fav.get('job_url', ''), fav.get('source_url', ''),
                fav.get('match_status', '未判断'), fav.get('priority', '可以关注'),
                fav.get('current_action', '待确认'), fav.get('note', ''),
                now, now, opp_id
            ))
            fav_count += 1

        conn.commit()
    except Exception as e:
        conn.rollback()
        return jsonify({'ok': False, 'error': str(e)}), 500
    finally:
        conn.close()

    backfill_opportunity_id()
    cleanup_orphaned_data()

    return jsonify({
        'ok': True,
        'mode': '覆盖' if overwrite else '追加',
        'opp_count': opp_count,
        'event_count': ev_count,
        'fav_count': fav_count
    })


@app.route('/api/reset', methods=['POST'])
def reset_data():
    if not os.path.exists(SEED_PATH):
        return jsonify({'error': f'未找到 seed 文件: {SEED_PATH}'}), 404

    conn = get_db()
    try:
        conn.execute("DELETE FROM timeline_events")
        conn.execute("DELETE FROM job_favorites")
        conn.execute("DELETE FROM opportunities")
        conn.commit()
    except Exception as e:
        conn.rollback()
        return jsonify({'ok': False, 'error': str(e)}), 500
    finally:
        conn.close()

    seeded = seed_db()
    backfill_opportunity_id()
    cleanup_orphaned_data()
    return jsonify({'ok': True, 'seeded': seeded})


# ============================================================
# 启动
# ============================================================

if __name__ == '__main__':
    is_new = not os.path.exists(DB_PATH)
    init_db()
    migrate_timeline_fields()

    if is_new:
        if seed_db():
            print("[INFO] 已从 seed/default_data.json 初始化默认数据")
        else:
            print("[WARN] 未能导入默认数据，请检查 seed/default_data.json")

    backfill_opportunity_id()
    cleanup_orphaned_data()

    print(f"[INFO] 数据库: {DB_PATH}")
    print("[INFO] 访问 http://127.0.0.1:5001")
    app.run(host='127.0.0.1', port=5001, debug=True)
