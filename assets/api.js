/* EdgeOne 静态数据适配器：保持 window.CduApi 契约，不请求 /api/v1/。 */
window.CduProjection = window.CduProjection || {
  apply: (catalog) => catalog,
  collegeOutOfFeatured: () => false,
};

window.CduApi = (() => {
  'use strict';
  const REVISION = 'rev-static-20261030-93319db148';
  const FIXED_NOW = (() => {
    try {
      const raw = globalThis.CDU_STATIC_NOW;
      const value = raw ? Date.parse(raw) : NaN;
      return Number.isFinite(value) ? value : null;
    } catch (_) { return null; }
  })();
  const listeners = new Set();
  const cache = new Map();
  const pending = new Map();
  const state = { meta: null, taxonomies: null, home: null, ready: false, error: null };
  const CHINA_CLOCK = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const FEATURED_EXCLUDED = new Set(['activity-4b6bd9d295d4', 'activity-941fbf19f639', 'series-770004e0fa68']);
  const COMPETITION_CATEGORIES = new Set(['technology', 'creative', 'sports', 'speech', 'career']);
  const HIGHER_LEVELS = new Set(['school', 'campus', 'national', 'province', 'international']);
  const COLLEGE_IN_TITLE = /[\u4e00-\u9fff]{2,10}学院/;

  function nowMs() { return FIXED_NOW === null ? Date.now() : FIXED_NOW; }
  function chinaNow(ms) {
    return CHINA_CLOCK.format(new Date(ms === undefined ? nowMs() : ms)).replace(' ', 'T');
  }
  function chinaDay(ms) { return chinaNow(ms).slice(0, 10); }
  function failure(message, status, detail) {
    const error = new Error(message);
    error.status = status;
    if (detail) error.detail = detail;
    return error;
  }
  function badRequest(detail) { return failure('HTTP 400', 400, detail); }

  function dataUrl(parts) {
    const root = new URL('data/', document.baseURI);
    const url = new URL(parts.map((part) => encodeURIComponent(String(part))).join('/'), root);
    if (!REVISION.startsWith('__CDU_')) url.searchParams.set('v', REVISION);
    return url.toString();
  }

  async function getJson(parts) {
    const key = parts.join('/');
    if (cache.has(key)) return cache.get(key);
    if (pending.has(key)) return pending.get(key);
    const promise = (async () => {
      const response = await fetch(dataUrl(parts), { headers: { Accept: 'application/json' } });
      if (!response.ok) {
        let detail = '';
        try { detail = (await response.json()).detail || ''; } catch (_) { /* 静态服务器 404 通常是 HTML */ }
        throw failure('HTTP ' + response.status, response.status, detail);
      }
      const payload = await response.json();
      cache.set(key, payload);
      return payload;
    })();
    pending.set(key, promise);
    try {
      return await promise;
    } finally {
      pending.delete(key);
    }
  }

  function intParam(value, name, fallback, minimum, maximum) {
    if (value === undefined || value === null || String(value).trim() === '') return fallback;
    const raw = String(value).trim();
    if (!/^[+-]?\d+$/.test(raw)) throw badRequest(`参数 ${name} 需要整数`);
    const parsed = Number(raw);
    if (minimum !== undefined && parsed < minimum) throw badRequest(`参数 ${name} 不能小于 ${minimum}`);
    if (maximum !== undefined && parsed > maximum) throw badRequest(`参数 ${name} 不能大于 ${maximum}`);
    return parsed;
  }

  function filtersFrom(params) {
    params = params || {};
    const view = params.view === undefined || params.view === null || params.view === '' ? 'all' : String(params.view);
    if (!['all', 'discover', 'registration', 'compare'].includes(view)) {
      throw badRequest('view 只能是 all / discover / registration / compare');
    }
    let month = params.month === undefined || params.month === null ? '' : String(params.month);
    if (month && month !== 'unknown') {
      if (!/^[+-]?\d+$/.test(month.trim())) throw badRequest('month 需要 1-12 或 unknown');
      const parsed = Number(month.trim());
      if (parsed < 1 || parsed > 12) throw badRequest('month 需要 1-12 或 unknown');
      month = String(parsed);
    }
    const year = params.year === undefined || params.year === null ? '' : String(params.year);
    if (year && year !== 'unknown' && !/^\d{4}$/.test(year)) throw badRequest('year 需要四位年份或 unknown');
    const basis = params.month_basis === undefined || params.month_basis === null || params.month_basis === ''
      ? 'seasonal' : String(params.month_basis);
    if (!['seasonal', 'deadline', 'event'].includes(basis)) {
      throw badRequest('month_basis 只能是 seasonal / deadline / event');
    }
    const page = intParam(params.page, 'page', 1, 1);
    const pageSize = intParam(params.page_size, 'page_size', 12, 1, 48);
    return {
      q: String(params.q === undefined || params.q === null ? '' : params.q).slice(0, 120),
      view,
      category: String(params.categories || params.category || ''),
      college: String(params.college === undefined || params.college === null ? '' : params.college),
      level: String(params.level === undefined || params.level === null ? '' : params.level),
      year,
      month,
      month_basis: basis,
      interest: String(params.interest === undefined || params.interest === null ? 'any' : params.interest),
      page,
      page_size: pageSize,
    };
  }

  function dayPart(raw) {
    const match = String(raw || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
  }

  function deadlineMs(raw) {
    if (!raw) return null;
    let value = String(raw);
    if (value.includes('T24:')) {
      const parts = value.split('T24:');
      const day = parts[0].slice(0, 10);
      const rest = parts[1] || '00:00';
      const nextDay = new Date(Date.parse(day + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
      value = nextDay + 'T00:' + rest;
    }
    if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (!match) return null;
    const hour = match[4] === undefined ? 23 : Number(match[4]);
    const minute = match[5] === undefined ? 59 : Number(match[5]);
    const second = match[6] === undefined ? 59 : Number(match[6]);
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour, minute, second) - 8 * 3600000;
  }

  function dateStatus(version, field) {
    const status = version[`${field}_status`];
    if (['confirmed', 'unverified', 'conflict'].includes(status)) return status;
    return version[field] ? 'confirmed' : null;
  }

  const DEADLINE_LABELS = {
    registration: ['报名截止前', '今日报名截止', '报名已截止'],
    submission: ['作品提交截止前', '今日作品提交截止', '交作品已截止'],
    combined: ['报名及作品截止前', '今日报名及作品截止', '报名及作品已截止'],
    notice: ['学院汇总/推荐前', '今日学院汇总/推荐', '学院汇总/推荐已过'],
  };
  const DEADLINE_EVENT_LABELS = {
    registration: '报名截止',
    submission: '作品提交截止',
    combined: '报名及作品提交截止',
    notice: '学院汇总/推荐节点',
  };

  function phase(version) {
    const deadlineStatus = dateStatus(version, 'deadline');
    const stageStatus = dateStatus(version, 'stage');
    if (deadlineStatus === 'conflict' || stageStatus === 'conflict') {
      return { id: 'unknown', label: '日期有差异', tone: 'warning' };
    }
    if (version.conflict) return { id: 'unknown', label: '版本有差异', tone: 'warning' };
    const now = nowMs();
    const day = chinaDay(now);
    const start = stageStatus === 'confirmed' ? dayPart(version.stage_start) : '';
    const end = stageStatus === 'confirmed' ? dayPart(version.stage_end) : '';
    if (start && end && start <= day && day <= end) {
      return { id: 'scheduled', label: '通知所列活动期', tone: 'active' };
    }
    const cutoff = deadlineStatus === 'confirmed' ? deadlineMs(version.deadline) : null;
    const labels = DEADLINE_LABELS[version.deadline_kind] || ['所列截止前', '今日截止', '所列截止已过'];
    if (cutoff !== null) {
      if (cutoff >= now) {
        const today = chinaDay(cutoff) === day;
        return {
          id: today ? 'today' : 'before_deadline',
          label: today ? labels[1] : labels[0],
          tone: 'active',
        };
      }
      if ((end && end < day) || (!end && start && start < day)) {
        return { id: 'past', label: '所列日期已过', tone: 'muted' };
      }
      return { id: 'deadline_passed', label: labels[2], tone: 'warning' };
    }
    if (start && start > day) return { id: 'upcoming', label: '活动日期未到', tone: 'muted' };
    if (start && start === day) return { id: 'scheduled', label: '通知所列活动日', tone: 'active' };
    if (start && start < day) return { id: 'past', label: '所列起始日已过', tone: 'muted' };
    const unverified = deadlineStatus === 'unverified' || stageStatus === 'unverified';
    return {
      id: 'unknown',
      label: version.year
        ? `${version.year} 年公告${unverified ? ' · 日期待核实' : ''}`
        : `历史公告${unverified ? ' · 日期待核实' : ''}`,
      tone: 'muted',
    };
  }

  function relevant(version, college) {
    if (!college || college === 'any') return true;
    const scope = version.audience_scope || {};
    if (scope.kind === 'campus') return true;
    return scope.kind === 'college' && (scope.colleges || []).includes(college);
  }

  function registrationOpen(version) {
    if (version.conflict) return false;
    if (dateStatus(version, 'deadline') !== 'confirmed') return false;
    const now = nowMs();
    const today = chinaDay(now);
    const windows = (version.registration_windows || []).filter((item) => item && item.start && item.end);
    if (windows.length) {
      return windows.some((item) => item.start <= today && today <= item.end) &&
        (!version.deadline || deadlineMs(version.deadline) >= now);
    }
    if (!version.deadline) return false;
    if (!['registration', 'combined', 'submission'].includes(version.deadline_kind)) return false;
    const cutoff = deadlineMs(version.deadline);
    return cutoff !== null && cutoff >= now;
  }

  function timingMonths(version, basis) {
    if (version.conflict) return [];
    if (basis === 'deadline') {
      if (dateStatus(version, 'deadline') !== 'confirmed') return [];
      const day = dayPart(version.deadline);
      return day ? [Number(day.slice(5, 7))] : [];
    }
    if (dateStatus(version, 'stage') !== 'confirmed') return [];
    const start = dayPart(version.stage_start);
    const end = dayPart(version.stage_end);
    if (!start) return [];
    const months = [Number(start.slice(5, 7))];
    if (end) {
      const safeEnd = end < start ? start : end;
      const month = Number(safeEnd.slice(5, 7));
      if (!months.includes(month)) months.push(month);
    }
    return months;
  }

  function monthMatches(version, meta, filters) {
    if (!filters.month) return true;
    const months = filters.month_basis === 'seasonal'
      ? (meta.seasonal_months || [])
      : timingMonths(version, filters.month_basis);
    if (filters.month === 'unknown') return months.length === 0;
    return months.includes(Number(filters.month));
  }

  function versionOk(card, version, filters) {
    if (filters.level && !(version.levels || []).includes(filters.level) && filters.level !== 'unknown') return false;
    if (filters.college && !(version.colleges || []).includes(filters.college)) return false;
    if (filters.year) {
      if (filters.year === 'unknown') {
        if (version.year !== null) return false;
      } else if (String(version.year) !== filters.year) {
        return false;
      }
    }
    if (filters.interest && filters.interest !== 'any' && !relevant(version, filters.interest)) return false;
    if (filters.view === 'registration' && !registrationOpen(version)) return false;
    return monthMatches(version, noticeMeta(card, version.notice_id), filters);
  }

  function selectionKey(filters) {
    const simple = filters.view === 'all' && !filters.q && !filters.category &&
      (!filters.interest || filters.interest === 'any');
    if (!simple) return '';
    if (filters.level && !filters.college && !filters.year && !filters.month) {
      return 'level:' + filters.level;
    }
    if (filters.college && !filters.level && !filters.year && !filters.month) {
      return 'college:' + filters.college;
    }
    if (!filters.level && !filters.college) {
      if (filters.year && filters.month && filters.month_basis === 'seasonal') {
        return `year:${filters.year}|month:${filters.month}`;
      }
      if (filters.year && !filters.month) return 'year:' + filters.year;
      if (!filters.year && filters.month && filters.month_basis === 'seasonal') {
        return 'month:' + filters.month;
      }
    }
    return '';
  }

  function selectVersion(card, filters) {
    const key = selectionKey(filters);
    const hintId = key && card.selection_overrides && card.selection_overrides[key]
      ? card.selection_overrides[key][card.card_id] : null;
    if (hintId) {
      const hinted = (card.entry.versions || []).find((version) =>
        version.notice_id === hintId && versionOk(card, version, filters));
      if (hinted) return hinted;
    }
    let best = null;
    let bestYear = -1;
    let bestPublished = null;
    for (const version of (card.entry.versions || [])) {
      if (!versionOk(card, version, filters)) continue;
      const year = version.year || 0;
      const published = version.published || '';
      if (!best || year > bestYear || (year === bestYear && published > bestPublished)) {
        best = version;
        bestYear = year;
        bestPublished = published;
      }
    }
    return best;
  }

  function noticeMeta(card, noticeId) {
    return card.indexNotices[noticeId] || { seasonal_months: [], facts_preview: [], search: '' };
  }

  function featuredExcluded(entry) {
    if (FEATURED_EXCLUDED.has(entry.id)) return true;
    if (!COLLEGE_IN_TITLE.test(entry.title || '')) return false;
    if (!COMPETITION_CATEGORIES.has(entry.category)) return false;
    const levels = new Set();
    for (const version of entry.versions || []) {
      for (const level of version.levels || []) levels.add(level);
    }
    return !Array.from(levels).some((level) => HIGHER_LEVELS.has(level));
  }

  function searchMatch(card, q) {
    if (!q) return true;
    const needle = String(q).toLowerCase();
    if (String(card.activity_search || '').toLowerCase().includes(needle)) return true;
    if (String(card.entry.title || '').toLowerCase().includes(needle)) return true;
    return card.notice_ids.some((noticeId) => {
      const meta = noticeMeta(card, noticeId);
      return String(meta.search || '').toLowerCase().includes(needle);
    });
  }

  function rowMatches(card, filters) {
    const entry = card.entry;
    if (filters.view === 'discover') {
      if (!(entry.featured && entry.spotlight) || entry.group_of) return false;
      if (featuredExcluded(entry)) return false;
    }
    if (filters.view === 'compare') {
      const years = new Set((entry.versions || []).map((version) => version.year).filter(Boolean));
      if (years.size < 2) return false;
    }
    if (filters.category && !filters.category.split(',').includes(entry.category)) return false;
    if (!searchMatch(card, filters.q)) return false;
    return selectVersion(card, filters) !== null;
  }

  function noticeScopeMatch(meta, filters) {
    if (filters.year) {
      if (filters.year === 'unknown') {
        if (meta.year !== null) return false;
      } else if (String(meta.year) !== filters.year) {
        return false;
      }
    }
    if (filters.college && !(meta.colleges || []).includes(filters.college)) return false;
    if (filters.level && !(meta.levels || []).includes(filters.level)) return false;
    if (filters.month && filters.month_basis === 'seasonal') {
      const months = meta.seasonal_months || [];
      if (filters.month === 'unknown') {
        if (months.length) return false;
      } else if (!months.includes(Number(filters.month))) {
        return false;
      }
    }
    return true;
  }

  /* 复刻 services._sql_scope：候选范围按“通知原始归属活动”收窄，之后才做精确筛选。
     候选元数据包含未被投影成卡片版本的公开通知，和 backend 的 SQL 预筛保持一致。 */
  function scopeCandidates(index, filters) {
    const noticeLevel = Boolean(filters.year || filters.college || filters.level) ||
      Boolean(filters.month && filters.month_basis === 'seasonal');
    const q = String(filters.q || '').trim().toLowerCase();
    if (!(noticeLevel || q || filters.category)) return null;
    const scopeNotices = (index.scope && index.scope.notices) || index.notices || {};

    let noticeIds = null;
    if (noticeLevel) {
      noticeIds = new Set();
      for (const [noticeId, meta] of Object.entries(scopeNotices)) {
        if (noticeScopeMatch(meta, filters)) noticeIds.add(noticeId);
      }
    }
    const categorySet = filters.category
      ? new Set(filters.category.split(',').filter(Boolean))
      : null;
    const activityIds = new Set();
    for (const activity of (index.scope && index.scope.activities) || []) {
      if (categorySet && !categorySet.has(activity.category)) continue;
      if (noticeIds && !activity.notice_ids.some((id) => noticeIds.has(id))) continue;
      if (q && !String(activity.search || '').toLowerCase().includes(q) &&
        !activity.notice_ids.some((id) => String((scopeNotices[id] || {}).search || '').toLowerCase().includes(q))) {
        continue;
      }
      activityIds.add(activity.id);
    }
    const groupIds = new Set();
    for (const group of (index.scope && index.scope.groups) || []) {
      if (noticeIds && !group.notice_ids.some((id) => noticeIds.has(id))) continue;
      if (q && !String(group.title || '').toLowerCase().includes(q) &&
        !group.notice_ids.some((id) => String((scopeNotices[id] || {}).search || '').toLowerCase().includes(q))) {
        continue;
      }
      groupIds.add(group.id);
    }
    return { activityIds, groupIds };
  }

  function cloneEntry(entry) {
    const copy = Object.assign({}, entry);
    copy.versions = (entry.versions || []).map((version) => Object.assign({}, version, {
      participation_facts: [],
    }));
    return copy;
  }

  function decorate(card, filters) {
    const entry = cloneEntry(card.entry);
    const selected = selectVersion(card, filters) || entry.versions[0];
    const meta = noticeMeta(card, selected.notice_id);
    const target = entry.versions.find((version) => version.notice_id === selected.notice_id) || entry.versions[0];
    target.participation_facts = (meta.facts_preview || []).map((fact) => Object.assign({}, fact));
    entry.phase = phase(target);
    entry.registration_open = registrationOpen(target);
    entry.audience_line = target.audience || '';
    entry.published = target.published;
    entry.deadline = target.deadline;
    entry.deadline_kind = target.deadline_kind;
    entry.deadline_status = target.deadline_status;
    entry.deadline_note = target.deadline_note;
    entry.stage_start = target.stage_start;
    entry.stage_end = target.stage_end;
    entry.stage_status = target.stage_status;
    entry.stage_note = target.stage_note;
    entry.source_url = target.source_url;
    entry.version_count = entry.versions.length;
    entry.selected_source_url = target.source_url;
    entry.selected_year = target.year;
    entry.selected_notice_id = target.notice_id;
    return entry;
  }

  function pageDateRange(rows) {
    const dates = rows.map((row) => row.published).filter(Boolean);
    if (dates.length !== rows.length || !dates.length) return null;
    let newest = dates[0];
    let oldest = dates[0];
    for (const value of dates) {
      if (value > newest) newest = value;
      if (value < oldest) oldest = value;
    }
    return { newest, oldest };
  }

  function compareText(left, right) {
    if (left === right) return 0;
    return left < right ? -1 : 1;
  }

  let catalogCache = { index: null, byId: new Map(), keyed: new Map(), groupsById: new Map() };

  function noticeOrder(index, leftId, rightId) {
    const left = index.notices[leftId] || {};
    const right = index.notices[rightId] || {};
    return (left.order === undefined ? 0 : left.order) - (right.order === undefined ? 0 : right.order);
  }

  function cacheFor(index) {
    if (catalogCache.index === index) return catalogCache;
    const byId = new Map();
    for (const card of index.cards || []) byId.set(card.card_id, card);
    const keyed = new Map();
    for (const [noticeId, notice] of Object.entries(index.notices || {})) {
      const key = notice.display_activity_id || notice.activity_id;
      if (!keyed.has(key)) keyed.set(key, []);
      keyed.get(key).push(noticeId);
    }
    for (const ids of keyed.values()) ids.sort((left, right) => noticeOrder(index, left, right));
    const groupsById = new Map();
    for (const group of (index.scope && index.scope.groups) || []) groupsById.set(group.id, group);
    catalogCache = { index, byId, keyed, groupsById };
    return catalogCache;
  }

  function scopedCard(base, noticeIds, index) {
    const entry = Object.assign({}, base.entry);
    entry.versions = noticeIds.map((noticeId) => Object.assign({}, index.notices[noticeId].version));
    return {
      card_id: base.card_id,
      kind: base.kind,
      entry,
      activity_search: base.activity_search || '',
      notice_ids: noticeIds,
      indexNotices: index.notices,
      selection_overrides: index.selection_overrides || {},
    };
  }

  function baseCard(index, card) {
    return Object.assign({
      indexNotices: index.notices,
      selection_overrides: index.selection_overrides || {},
    }, card);
  }

  /* 复刻 services.load_cards(activity_ids, group_ids) 的分页/筛选时通知装配。 */
  function scopedLoadCards(index, activityIds, groupIds) {
    const cache = cacheFor(index);
    const allGrouped = new Set();
    for (const group of (index.scope && index.scope.groups) || []) {
      for (const noticeId of group.notice_ids || []) allGrouped.add(noticeId);
    }
    const groupedIds = new Set();
    for (const groupId of groupIds) {
      const group = cache.groupsById.get(groupId);
      if (group) for (const noticeId of group.notice_ids || []) groupedIds.add(noticeId);
    }
    const groupCards = [];
    for (const groupId of groupIds) {
      const base = cache.byId.get(groupId);
      const group = cache.groupsById.get(groupId);
      if (!base || base.kind !== 'group' || !group) continue;
      const noticeIds = (group.notice_ids || [])
        .filter((noticeId) => Boolean(index.notices[noticeId]))
        .sort((left, right) => noticeOrder(index, left, right));
      if (noticeIds.length) groupCards.push(baseCard(index, base));
    }
    const activityCards = [];
    for (const activityId of activityIds) {
      const base = cache.byId.get(activityId);
      if (!base || base.kind !== 'activity') continue;
      const noticeIds = (cache.keyed.get(activityId) || [])
        .filter((noticeId) => !groupedIds.has(noticeId) && !allGrouped.has(noticeId))
        .sort((left, right) => noticeOrder(index, left, right));
      if (noticeIds.length) activityCards.push(baseCard(index, base));
    }
    return groupCards.concat(activityCards);
  }

  function plainFilters(filters) {
    return !filters.q && !filters.category && !filters.college && !filters.level &&
      !filters.year && !filters.month && filters.view === 'all' &&
      (filters.interest === '' || filters.interest === 'any');
  }

  async function activities(params) {
    const filters = filtersFrom(params);
    const index = await getJson(['catalog.json']);
    const size = filters.page_size;
    let rows;
    let total;
    let page;
    let pages;
    if (plainFilters(filters)) {
      const items = index.plain_items || [];
      total = items.length;
      pages = Math.max(1, Math.ceil(total / size));
      page = Math.min(Math.max(1, filters.page), pages);
      const chunk = items.slice((page - 1) * size, page * size);
      const activityIds = new Set(chunk.filter((item) => item.kind === 'activity').map((item) => item.id));
      const groupIds = new Set(chunk.filter((item) => item.kind === 'group').map((item) => item.id));
      const scoped = scopedLoadCards(index, activityIds, groupIds);
      const byId = new Map(scoped.map((card) => [card.card_id, card]));
      rows = chunk.map((item) => {
        const card = byId.get(item.id);
        return card ? decorate(card, filters) : null;
      }).filter(Boolean);
    } else {
      const scope = scopeCandidates(index, filters);
      const candidates = scope
        ? scopedLoadCards(index, scope.activityIds, scope.groupIds)
        : (index.cards || []).map((card) => baseCard(index, card));
      const matched = candidates.filter((card) => rowMatches(card, filters));
      matched.sort((left, right) => {
        const leftVersion = selectVersion(left, filters);
        const rightVersion = selectVersion(right, filters);
        const publishedCompare = compareText(
          leftVersion && leftVersion.published ? leftVersion.published : '',
          rightVersion && rightVersion.published ? rightVersion.published : '',
        );
        if (publishedCompare !== 0) return -publishedCompare;
        const titleCompare = compareText(left.entry.title || '', right.entry.title || '');
        if (titleCompare !== 0) return -titleCompare;
        return -compareText(left.card_id, right.card_id);
      });
      total = matched.length;
      pages = Math.max(1, Math.ceil(total / size));
      page = Math.min(Math.max(1, filters.page), pages);
      rows = matched.slice((page - 1) * size, page * size).map((card) => decorate(card, filters));
    }
    return {
      count: total,
      page,
      page_size: size,
      total_pages: pages,
      page_date_range: pageDateRange(rows),
      results: rows,
    };
  }

  async function detail(id, noticeId) {
    try {
      const bundle = await getJson(['details', `${String(id)}.json`]);
      const payload = noticeId
        ? (Object.hasOwn(bundle.notices, String(noticeId)) ? bundle.notices[String(noticeId)] : null)
        : bundle.default;
      if (!payload) throw failure('HTTP 404', 404, '没有找到这条公开活动');
      return JSON.parse(JSON.stringify(payload));
    } catch (error) {
      if (error.status === 404) error.detail = '没有找到这条公开活动';
      throw error;
    }
  }

  async function guide(id) {
    try {
      return await getJson(['guides', `${String(id)}.json`]);
    } catch (error) {
      if (error.status === 404) error.detail = '没有找到这篇校园指南';
      throw error;
    }
  }

  function actualCounts(index, year) {
    const counts = {};
    for (let month = 1; month <= 12; month += 1) counts[String(month).padStart(2, '0')] = 0;
    for (const card of index.cards || []) {
      for (const version of card.entry.versions || []) {
        if (version.conflict) continue;
        const deadline = dateStatus(version, 'deadline') === 'confirmed' ? dayPart(version.deadline) : '';
        if (deadline && Number(deadline.slice(0, 4)) === year) {
          counts[deadline.slice(5, 7)] += 1;
        }
        const start = dateStatus(version, 'stage') === 'confirmed' ? dayPart(version.stage_start) : '';
        if (start && Number(start.slice(0, 4)) === year) {
          counts[start.slice(5, 7)] += 1;
        }
        const end = dateStatus(version, 'stage') === 'confirmed' ? dayPart(version.stage_end) : '';
        if (end && end !== start && Number(end.slice(0, 4)) === year) {
          counts[end.slice(5, 7)] += 1;
        }
      }
    }
    return counts;
  }

  function actualEvents(index, year, month) {
    const target = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
    const events = [];
    for (const card of index.cards || []) {
      const entry = card.entry;
      for (const version of entry.versions || []) {
        if (version.conflict) continue;
        const eventMeta = {notice_id:version.notice_id, year:version.year,
          published:version.published, colleges:version.colleges||[], featured:entry.featured===true};
        const deadline = dateStatus(version, 'deadline') === 'confirmed' ? dayPart(version.deadline) : '';
        if (deadline && deadline.slice(0, 7) === target) {
          events.push({
            ...eventMeta,
            entry_id: card.card_id,
            title: entry.title,
            category: entry.category,
            category_label: entry.category_label,
            kind: 'deadline',
            label: DEADLINE_EVENT_LABELS[version.deadline_kind] || '所列截止',
            deadline_kind: version.deadline_kind || null,
            deadline_status: 'confirmed',
            start: deadline,
            end: deadline,
            precision: version.deadline_precision || null,
            raw: version.deadline,
            source_url: version.source_url,
          });
        }
        const stageStatus = dateStatus(version, 'stage');
        const start = stageStatus === 'confirmed' ? dayPart(version.stage_start) : '';
        const end = stageStatus === 'confirmed' ? dayPart(version.stage_end) : '';
        if (start || end) {
          if (start && end && end < start) continue;
          const begin = start || end;
          const finish = end || begin;
          if (begin.slice(0, 7) === target || finish.slice(0, 7) === target) {
            events.push({
              ...eventMeta,
              entry_id: card.card_id,
              title: entry.title,
              category: entry.category,
              category_label: entry.category_label,
              kind: 'event',
              label: start ? '活动阶段' : '活动阶段结束',
              stage_status: 'confirmed',
              start: begin,
              end: finish,
              only: start && end ? null : (start ? 'start' : 'end'),
              raw: start || end,
              source_url: version.source_url,
            });
          }
        }
      }
    }
    events.sort((left, right) => compareText(left.start, right.start) ||
      compareText(left.title, right.title) || compareText(left.kind, right.kind));
    return events;
  }

  async function calendar(params) {
    params = params || {};
    const mode = params.mode === undefined || params.mode === null || params.mode === '' ? 'annual' : String(params.mode);
    if (!['annual', 'actual', 'actual_counts'].includes(mode)) {
      throw badRequest('mode 只能是 annual / actual');
    }
    if (mode === 'annual') {
      const raw = params.month === undefined || params.month === null ? '' : String(params.month);
      if (raw === 'all') return getJson(['calendar', 'annual-all.json']);
      const month = intParam(raw, 'month', null, 1, 12) || Number(chinaNow().slice(5, 7));
      return getJson(['calendar', `annual-${String(month).padStart(2, '0')}.json`]);
    }
    const year = intParam(params.year, 'year', null, 2000, 2100);
    if (mode === 'actual_counts') {
      if (year === null) throw badRequest('actual_counts 需要 year');
      const index = await getJson(['catalog.json']);
      return { mode: 'actual_counts', year, counts: actualCounts(index, year) };
    }
    if (year === null) throw badRequest('actual 模式需要 year 参数');
    const month = intParam(params.month, 'month', Number(chinaNow().slice(5, 7)), 1, 12);
    const index = await getJson(['catalog.json']);
    const events = actualEvents(index, year, month);
    return { mode: 'actual', year, month, count: events.length, events };
  }

  async function guides(params) {
    params = params || {};
    const category = String(params.category === undefined || params.category === null ? '' : params.category);
    const q = String(params.q === undefined || params.q === null ? '' : params.q).slice(0, 80);
    const payload = await getJson(['guides.json']);
    const rows = (payload.results || []).filter((guide) => {
      if (category && guide.category !== category) return false;
      if (q) {
        const text = [guide.title, guide.subtitle, guide.summary, (guide.tags || []).join(' ')]
          .join(' ').toLowerCase();
        if (!text.includes(q.toLowerCase())) return false;
      }
      return true;
    });
    return { count: rows.length, results: rows };
  }

  async function services(params) {
    params = params || {};
    const category = String(params.category === undefined || params.category === null ? '' : params.category);
    const q = String(params.q === undefined || params.q === null ? '' : params.q).slice(0, 80);
    const payload = await getJson(['services.json']);
    const rows = (payload.results || []).filter((item) => {
      if (category && item.category !== category) return false;
      if (q) {
        const text = [item.name, item.description, item.owner, item.phone || '', item.location]
          .join(' ').toLowerCase();
        if (!text.includes(q.toLowerCase())) return false;
      }
      return true;
    });
    return { count: rows.length, results: rows };
  }

  function catalogShell() {
    const tax = state.taxonomies || {};
    const levels = {};
    const colleges = {};
    const categories = {};
    (tax.level || []).forEach((item) => { levels[item.code] = item.label; });
    (tax.college || []).forEach((item) => { colleges[item.code] = item.label; });
    (tax.category || []).forEach((item) => { categories[item.code] = item.label; });
    return {
      schema_version: tax.schema_version || 'catalog-1',
      colleges,
      levels,
      categories,
      entries: [],
      coverage: tax.coverage || {},
      display_options: tax.display_options || {},
      policies: tax.policies || {},
      year_policy: (tax.policies || {}).year_policy || '',
      college_policy: (tax.policies || {}).college_policy || '',
      status_policy: (tax.policies || {}).status_policy || '',
    };
  }

  async function boot() {
    try {
      const [meta, taxonomies, home] = await Promise.all([
        getJson(['meta.json']), getJson(['taxonomies.json']), getJson(['home.json']),
      ]);
      state.meta = meta;
      state.taxonomies = taxonomies;
      state.home = home;
      state.ready = true;
      window.CduData = {
        meta,
        taxonomies,
        home,
        catalog: catalogShell(),
        guides: home.guides || [],
        services: [],
      };
    } catch (error) {
      state.error = error;
      document.dispatchEvent(new CustomEvent('cdu:data-error', { detail: error }));
      throw error;
    }
    document.dispatchEvent(new Event('cdu:data-ready'));
    return state;
  }

  function onReady(handler) {
    if (state.ready) { handler(state); return; }
    listeners.add(handler);
    document.addEventListener('cdu:data-ready', () => {
      listeners.forEach((fn) => fn(state));
      listeners.clear();
    }, { once: true });
  }

  function loadScripts(list) {
    return Promise.all(list.map(src => new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const url = new URL(src, document.baseURI);
      if (!REVISION.startsWith('__CDU_')) url.searchParams.set('v', REVISION);
      script.src = url.toString();
      script.async = false; // 并行下载，仍按插入顺序执行。
      script.onload = resolve;
      script.onerror = () => reject(new Error('脚本加载失败：' + src));
      document.body.append(script);
    })));
  }

  async function request(path, options) {
    if (options && options.method && String(options.method).toUpperCase() !== 'GET') {
      throw failure('HTTP 405', 405, '静态站点只支持 GET');
    }
    const raw = String(path || '');
    const queryAt = raw.indexOf('?');
    let pathname = (queryAt >= 0 ? raw.slice(0, queryAt) : raw).replace(/^\/+|\/+$/g, '');
    const search = queryAt >= 0 ? raw.slice(queryAt + 1) : '';
    pathname = pathname.replace(/^api\/v1\//, '');
    const params = Object.fromEntries(new URLSearchParams(search));

    let match;
    if (pathname === 'meta') return getJson(['meta.json']);
    if (pathname === 'taxonomies') return getJson(['taxonomies.json']);
    if (pathname === 'home') return getJson(['home.json']);
    if (pathname === 'activities') return activities(params);
    if ((match = pathname.match(/^activities\/([^/]+)\/notices\/([^/]+)$/))) {
      try {
        const payload = await detail(decodeURIComponent(match[1]), decodeURIComponent(match[2]));
        return { entry: { id: payload.entry.id, title: payload.entry.title }, notice: payload.notice };
      } catch (error) {
        if (error.status === 404) error.detail = '没有找到这条公开通知';
        throw error;
      }
    }
    if ((match = pathname.match(/^activities\/([^/]+)$/))) {
      return detail(decodeURIComponent(match[1]), params.notice || null);
    }
    if (pathname === 'calendar') return calendar(params);
    if (pathname === 'guides') return guides(params);
    if ((match = pathname.match(/^guides\/([^/]+)$/))) return guide(decodeURIComponent(match[1]));
    if (pathname === 'services') return services(params);
    throw failure('HTTP 404', 404, '没有找到这个静态数据入口');
  }

  return {
    boot, request, activities, detail, calendar, guides, guide, services,
    onReady, loadScripts, state,
  };
})();
