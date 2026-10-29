"""业务规则：API、后台和导入命令共用同一套口径。

这里集中处理：公开可见性、时间状态、报名是否仍开放、往年月份归类、
筛选与排序、卡片与详情序列化、首页与日历聚合。

三条硬规则（见返工单 P1-1 / P1-2）：
1. “某张公开卡片到底包含哪些通知”只有 card_notice_qs 一个答案，
   列表、版本目录、详情深链接、日历都走它。
2. 列表只给轻量版本；选中通知的详情给全部事实，不再截断。
3. 搜索与往日月份用导入时算好的 search_text / seasonal_months，
   不靠每次请求把全部事实装进内存再拼字符串。
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from django.db.models import (Case, CharField, Count, F, FilteredRelation, Max, Q,
                              Subquery, Value, When, Window)
from django.db.models.functions import Coalesce, Concat, RowNumber
from django.utils import timezone
from . import participation

from .models import (Activity, ActivityGroup, CampusService, Fact, Guide, Notice, SiteMeta,
                     Taxonomy)

# ---------------------------------------------------------------- 时间与状态



PUBLIC_PHONE = re.compile(r'(?<![0-9A-Za-z@])1[3-9]\d{9}(?![0-9A-Za-z@])')
PUBLIC_ID_LABELED = re.compile(
    r'((?:居民身份证(?:号码|号)?|身份证(?:号码|号)?|证件号码|证件号)\s*[:：]?\s*)(\d{17}[\dXx])', re.I)
PUBLIC_ID_ANY = re.compile(r'(?<![0-9A-Za-z])\d{17}[\dXx](?![0-9A-Za-z])')
PUBLIC_QQ = re.compile(r'(?:QQ群|群号|QQ)\s*[:：]?\s*\d{5,12}', re.I)
PUBLIC_NAME = re.compile(r'((?:联系人|联系人姓名|负责人|队长|组长)\s*[:：]\s*)([一-鿿]{2,4})(?=$|[，,。；;、\s（(])')
PUBLIC_EMAIL = re.compile(
    r'(?<![\w.+-])([\w.+-]+)\s*@\s*([A-Z0-9-]+(?:\s*[.．,，、。]\s*[A-Z0-9-]+)+)', re.I)
PUBLIC_EMAIL_ALLOWED_SUFFIXES = ('.edu.cn', '.gov.cn')
PUBLIC_INTERNAL_LEVEL = re.compile(
    r'\b(?:competition_level|stage_level)\s*[:=：]\s*(?:school|college|provincial|national|international|none|unknown)\b',
    re.I,
)
PUBLIC_INTERNAL_PROCESS = re.compile(
    r'[^。；;\n]*(?:冻结包|未随包提供|镜像附件|编号核验|不作为单日节点|'
    r'内部核验|候选修订|未完成核查|审计复核|'
    r'A0[1-9][^。；;\n]{0,16}未读取|附件[^。；;\n]{0,10}未读取)[^。；;\n]*[。；;]?'
)


def _is_valid_cn_id(value: str) -> bool:
    """Only mask checksum-valid mainland ID numbers; keep valid event codes."""
    if not re.fullmatch(r'\d{17}[\dXx]', value):
        return False
    from datetime import date
    try:
        date(int(value[6:10]), int(value[10:12]), int(value[12:14]))
    except ValueError:
        return False
    weights = (7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2)
    checks = '10X98765432'
    expected = checks[sum(int(char) * weight for char, weight in zip(value[:17], weights)) % 11]
    return value[-1].upper() == expected


def redact_public(value: str) -> str:
    text = str(value or '')
    text = PUBLIC_INTERNAL_PROCESS.sub('', text)
    text = PUBLIC_INTERNAL_LEVEL.sub('', text)
    text = re.sub(r'\s*[；;，,]\s*[；;，,]+\s*', '；', text)
    text = re.sub(r'^[\s；;,。]+|[\s；;,。]+$', '', text)
    text = PUBLIC_PHONE.sub('〔手机号已隐去〕', text)
    text = PUBLIC_ID_LABELED.sub(lambda m: m.group(1) + '〔身份证号已隐去〕', text)
    text = PUBLIC_ID_ANY.sub(lambda m: '〔身份证号已隐去〕' if _is_valid_cn_id(m.group()) else m.group(), text)
    text = PUBLIC_QQ.sub(lambda m: re.sub(r'\d{5,12}', '〔群号已隐去〕', m.group()), text)
    text = PUBLIC_NAME.sub(lambda m: m.group(1) + '〔姓名已隐去〕', text)
    def redact_email(match):
        domain = re.sub(r'\s*[.．,，、。]\s*', '.', match.group(2)).lower().rstrip('.')
        if domain.endswith(PUBLIC_EMAIL_ALLOWED_SUFFIXES):
            return match.group(0)
        return '〔个人邮箱已隐去〕'
    text = PUBLIC_EMAIL.sub(redact_email, text)
    return text

CN_TZ = timezone.get_current_timezone()


def china_now() -> datetime:
    return timezone.localtime(timezone.now())


def _parse_day(raw) -> str | None:
    if not raw:
        return None
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})', str(raw))
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3))).isoformat()
    except ValueError:
        return None


def end_time(notice: Notice) -> datetime | None:
    """截止时间按北京时间解释；24:00 归到当天 23:59。"""
    if not notice.deadline:
        return None
    value = notice.deadline
    if isinstance(value, str):
        from django.utils.dateparse import parse_datetime
        value = parse_datetime(value)
        if value is None:
            return None
    if timezone.is_aware(value):
        return timezone.localtime(value)
    return timezone.make_aware(value, CN_TZ)


def date_status(notice: Notice, field: str) -> str | None:
    """confirmed / unverified / conflict；缺省视为已确认（供旧记录兼容）。"""
    extras = notice.extras or {}
    status = extras.get(f'{field}_status')
    if status in ('confirmed', 'unverified', 'conflict'):
        return status
    value = notice.deadline if field == 'deadline' else (notice.stage_start or notice.stage_end)
    return 'confirmed' if value else None


DEADLINE_LABELS = {
    'registration': ('报名截止前', '今日报名截止', '报名已截止'),
    'submission': ('作品提交截止前', '今日作品提交截止', '交作品已截止'),
    'combined': ('报名及作品截止前', '今日报名及作品截止', '报名及作品已截止'),
    'notice': ('学院汇总/推荐前', '今日学院汇总/推荐', '学院汇总/推荐已过'),
}

DEADLINE_EVENT_LABELS = {
    'registration': '报名截止',
    'submission': '作品提交截止',
    'combined': '报名及作品提交截止',
    'notice': '学院汇总/推荐节点',
}


def phase(notice: Notice, kind: str = 'notice') -> dict:
    if kind == 'reference':
        return {'id': 'reference', 'label': '参考资料', 'tone': 'muted'}
    deadline_status = date_status(notice, 'deadline')
    stage_status = date_status(notice, 'stage')
    if deadline_status == 'conflict' or stage_status == 'conflict':
        return {'id': 'unknown', 'label': '日期有差异', 'tone': 'warning'}
    if notice.conflict:
        return {'id': 'unknown', 'label': '版本有差异', 'tone': 'warning'}
    now = china_now()
    day = now.date().isoformat()
    start = notice.stage_start.isoformat() if notice.stage_start and stage_status == 'confirmed' else ''
    end = notice.stage_end.isoformat() if notice.stage_end and stage_status == 'confirmed' else ''
    if start and end and start <= day <= end:
        return {'id': 'scheduled', 'label': '通知所列活动期', 'tone': 'active'}
    cutoff = end_time(notice) if deadline_status == 'confirmed' else None
    before, today_label, passed = DEADLINE_LABELS.get(
        notice.deadline_kind or '', ('所列截止前', '今日截止', '所列截止已过'))
    if cutoff:
        if cutoff >= now:
            today = cutoff.date().isoformat() == day
            return {'id': 'today' if today else 'before_deadline',
                    'label': today_label if today else before, 'tone': 'active'}
        if (end and end < day) or (not end and start and start < day):
            return {'id': 'past', 'label': '所列日期已过', 'tone': 'muted'}
        return {'id': 'deadline_passed', 'label': passed, 'tone': 'warning'}
    if start and start > day:
        return {'id': 'upcoming', 'label': '活动日期未到', 'tone': 'muted'}
    if start == day:
        return {'id': 'scheduled', 'label': '通知所列活动日', 'tone': 'active'}
    if start and start < day:
        return {'id': 'past', 'label': '所列起始日已过', 'tone': 'muted'}
    unverified = deadline_status == 'unverified' or stage_status == 'unverified'
    label = (f'{notice.year} 年公告 · 日期待核实' if notice.year else '历史公告 · 日期待核实') if unverified \
        else (f'{notice.year} 年公告' if notice.year else '历史公告')
    return {'id': 'unknown', 'label': label, 'tone': 'muted'}


def registration_open(notice: Notice) -> bool:
    """当前报名/作品提交：只认有依据的学生节点，学院汇总/推荐节点不纳入。"""
    if notice.conflict:
        return False
    if date_status(notice, 'deadline') in ('unverified', 'conflict'):
        return False
    today = china_now().date().isoformat()
    windows = [] if participation.curated(notice) else (notice.extras or {}).get('registration_windows') or []
    windows = [w for w in windows if w.get('start') and w.get('end')]
    if windows:
        inside = any(w['start'] <= today <= w['end'] for w in windows)
        cutoff = end_time(notice)
        return inside and (cutoff is None or cutoff >= china_now())
    if not notice.deadline:
        return False
    if notice.deadline_kind not in ('registration', 'combined', 'submission'):
        return False
    return end_time(notice) >= china_now()


def timing_range(notice: Notice, basis: str = 'event') -> tuple[str, str] | None:
    if notice.conflict:
        return None
    if basis == 'deadline':
        if date_status(notice, 'deadline') != 'confirmed':
            return None
        day = notice.deadline.date().isoformat() if notice.deadline else None
        return (day, day) if day else None
    if date_status(notice, 'stage') != 'confirmed':
        return None
    start = notice.stage_start.isoformat() if notice.stage_start else None
    end = notice.stage_end.isoformat() if notice.stage_end else None
    if not start:
        return None
    if end and end < start:
        end = start
    return start, end or start

# ---------------------------------------------------------------- 月份归类

MONTH_RANGE = re.compile(r'(1[0-2]|0?[1-9])月[^月]{0,25}?(?:至|到|—|–|~|～|－|-)[^月]{0,12}?(1[0-2]|0?[1-9])月')
MONTH_ONE = re.compile(r'(?:^|[^\d])(1[0-2]|0?[1-9])月')
ISO_DAY = re.compile(r'20\d{2}[./-](\d{1,2})[./-]\d{1,2}')
BIOGRAPHICAL = re.compile(
    '研究方向|研究领域|主要从事|个人简介|主讲人简介|履历|博士后|获.{0,6}(?:博士|硕士|学士)学位|任教|聘为'
    '|加入.{0,8}(?:大学|学院|研究所)|发表.{0,10}(?:论文|文章)|出版专著|H指数|引用.{0,6}次')
WORK_CONDITION = re.compile(
    r'(?:作品|视频|论文|方案|设计|成果).{0,14}(?:须|应|需|必须|要求).{0,26}'
    r'(?:原创|创作|完成|拍摄|制作|发表|首发)')
TIMED = re.compile(r'\d+\s*月|\d+\s*日|\d{4}\s*年|截止|时间\s*[:：]|日期|周[一二三四五六日天]|上午|下午|即日起|学期|开学')


def month_ranges(text: str) -> list[dict]:
    value = ISO_DAY.sub(lambda m: f'{int(m.group(1))}月', str(text or ''))
    return [{'start': int(m.group(1)), 'end': int(m.group(2)), 'text': m.group(0)}
            for m in MONTH_RANGE.finditer(value)]


def mentioned_months(text: str) -> set[int]:
    value = str(text or '')
    months = {int(m.group(1)) for m in MONTH_ONE.finditer(value)}
    for m in MONTH_RANGE.finditer(value):
        n, stop = int(m.group(1)), int(m.group(2))
        for _ in range(12):
            months.add(n)
            if n == stop:
                break
            n = n % 12 + 1
    return months


def seasonal_months(text: str) -> set[int]:
    remainder = ISO_DAY.sub(lambda m: f'{int(m.group(1))}月', str(text or ''))
    ranges = month_ranges(remainder)
    months = {r['start'] for r in ranges}
    for r in ranges:
        remainder = remainder.replace(r['text'], '')
    months |= mentioned_months(remainder)
    return months


def timing_clue(fact_kind: str, value: str) -> bool:
    if fact_kind not in ('schedule', 'registration'):
        return False
    text = str(value or '')
    if BIOGRAPHICAL.search(text) or WORK_CONDITION.search(text) or not TIMED.search(text):
        return False
    return True


def seasonal_months_for_notice(notice: Notice) -> set[int]:
    """往年“这个月”：只取征集/活动期的起始月，跨月征集不重复计入结束月。"""
    if notice.conflict:
        return set()
    months: set[int] = set()
    if notice.deadline:
        months.add(notice.deadline.month)
    if notice.stage_start:
        months.add(notice.stage_start.month)
    if participation.curated(notice):
        text=participation.curated(notice).get('fields',{}).get('event_time','')
        return months | seasonal_months(text)
    for fact in notice.facts.all():
        if timing_clue(fact.kind, fact.value):
            months |= seasonal_months(fact.value)
    return months


def encode_months(months) -> str:
    """存成 ',3,5,'，便于 SQL LIKE 精确匹配单月。"""
    return ',' + ','.join(str(m) for m in sorted(set(months))) + ',' if months else ''


def decode_months(raw: str) -> set[int]:
    return {int(part) for part in str(raw or '').split(',') if part.strip().isdigit()}


def notice_search_text(notice: Notice, facts=None, profile=None) -> str:
    """导入/编辑时算好，列表与搜索不再需要加载事实。"""
    parts = [notice.audience or '', (notice.extras or {}).get('original_title') or '']
    if notice.source_id:
        parts.append(notice.source.title or '')
    curated_sections=participation.sections(notice)
    if curated_sections is not None:
        parts.extend(item['text'] for section in curated_sections for item in section['items'])
        return ' '.join(part for part in parts if part).lower()
    for fact in (facts if facts is not None else notice.facts.all()):
        parts.extend([fact.label or '', fact.value or '', fact.quote or ''])
    payload = (profile.payload if profile is not None else
               (notice.profile.payload if hasattr(notice, 'profile') else {}))
    for section in (payload or {}).get('sections') or []:
        parts.append(section.get('title') or '')
        parts.extend(item.get('text') or '' for item in section.get('items') or [])
    return ' '.join(part for part in parts if part).lower()


def activity_search_text(activity: Activity) -> str:
    parts = [activity.title or '', activity.summary or '', activity.editorial_note or '',
             ' '.join(activity.tags or []), activity.category_label]
    return ' '.join(part for part in parts if part).lower()

# ---------------------------------------------------------------- 卡片与通知（唯一口径）


def _notice_qs(with_content: bool = False):
    # Only the most recently published notice per display card and year is public.
    # Original notices stay editable in the workbench. Unknown dates are not guessed.
    candidates = (Notice.objects.filter(visibility='public')
        .annotate(public_group=FilteredRelation('groups', condition=Q(groups__visibility='public'))))
    candidates = candidates.annotate(public_scope=Case(
        When(public_group__id__isnull=False,
             then=Concat(Value('group:'), F('public_group__id'))),
        default=Concat(Value('activity:'), Coalesce('display_activity_id', 'activity_id')),
        output_field=CharField()))
    winners = (candidates.annotate(public_year=Case(
        When(Q(year__isnull=True) | Q(published__isnull=True), then=F('id')),
        default=Value('dated'), output_field=CharField()))
        .annotate(public_rank=Window(expression=RowNumber(),
            partition_by=[F('public_scope'), F('year'), F('public_year')],
            order_by=[F('published').desc(nulls_last=True), F('position').asc(), F('id').asc()]))
        .filter(public_rank=1).order_by().values('id'))
    # 画像是一对一，join 过来即可；事实只有详情才需要
    qs = (Notice.objects.filter(visibility='public', pk__in=Subquery(winners))
          .select_related('source', 'activity', 'activity__category', 'profile')
          .prefetch_related('taxonomies'))
    if with_content:
        qs = qs.prefetch_related('facts')
    return qs


def _notice_order(notice: Notice):
    return (notice.year or 0, notice.published or date.min, -notice.position)


def latest_notice_versions(notices):
    """Keep unknown dates untouched; break same-day ties deterministically."""
    ordered = sorted(notices, key=lambda n: (
        -(n.year or 0), -(n.published.toordinal() if n.published else 0),
        n.position, n.pk))
    years = set()
    selected = []
    for notice in ordered:
        if notice.year and notice.published:
            if notice.year in years:
                continue
            years.add(notice.year)
        selected.append(notice)
    return selected


@dataclass
class Card:
    """一张公开卡片：要么是活动本身，要么是学院拆分卡。"""
    kind: str
    id: str
    activity: Activity
    group: ActivityGroup | None = None

    @property
    def title(self) -> str:
        return self.group.title if self.group is not None else self.activity.title

    @property
    def is_group(self) -> bool:
        return self.group is not None


def resolve_card(card_id: str) -> Card | None:
    group = (ActivityGroup.objects.filter(id=card_id, visibility='public')
             .select_related('activity', 'activity__category').first())
    if group is not None:
        return Card('group', group.id, group.activity, group)
    activity = (Activity.objects.filter(id=card_id, visibility='public')
                .select_related('category').first())
    if activity is not None:
        return Card('activity', activity.id, activity, None)
    return None


def card_notice_qs(card: Card | str, with_content: bool = False):
    """这张卡片实际包含哪些通知。

    - 学院拆分卡：只含分组里明确登记的通知。
    - 活动卡：含展示归属指向它的通知；归属为空时沿用原活动；
      已经被公开分组卡收走的通知不再重复出现在活动卡上。
    """
    if isinstance(card, str):
        card = resolve_card(card)
    if card is None:
        return Notice.objects.none()
    qs = _notice_qs(with_content)
    if card.group is not None:
        qs = qs.filter(groups=card.group).distinct()
    else:
        qs = (qs.filter(Q(display_activity=card.activity) |
                      Q(display_activity__isnull=True, activity=card.activity))
            .exclude(groups__visibility='public').distinct())
    # A source can belong to more than one group; enforce the rule for this card too.
    ids = [n.pk for n in latest_notice_versions(
        qs.select_related(None).prefetch_related(None).only('id', 'year', 'published', 'position'))]
    return qs.filter(pk__in=ids)


def card_has_notice(card_id: str, notice_id: str) -> bool:
    card = resolve_card(card_id)
    if card is None:
        return False
    return card_notice_qs(card).filter(id=notice_id).exists()


@dataclass
class CardRow:
    card: Card
    notices: list[Notice] = field(default_factory=list)


def load_cards(public_only: bool = True, activity_ids=None, group_ids=None) -> list[CardRow]:
    """一次读轻量通知，再按口径分到卡片上；不碰事实。

    activity_ids / group_ids 用来把候选范围先缩到一页或一批，None 表示全量。
    """
    qs = _notice_qs()
    if activity_ids is not None or group_ids is not None:
        scope = Q(pk__in=[])
        if activity_ids:
            scope |= (Q(display_activity_id__in=activity_ids) |
                      Q(display_activity__isnull=True, activity_id__in=activity_ids))
        if group_ids:
            scope |= Q(groups__id__in=group_ids)
        qs = qs.filter(scope).distinct()
    notices = list(qs)
    notices.sort(key=_notice_order, reverse=True)
    by_card: dict[str, list[Notice]] = {}
    for notice in notices:
        by_card.setdefault(notice.display_activity_id or notice.activity_id, []).append(notice)

    all_groups = (ActivityGroup.objects.filter(visibility='public')
                  .prefetch_related('notices'))
    all_grouped_ids = {n.id for group in all_groups for n in group.notices.all()}
    groups = all_groups
    if group_ids is not None:
        groups = groups.filter(id__in=group_ids)
    grouped_ids: set[str] = set()
    rows: list[CardRow] = []
    for group in groups:
        ids = {n.id for n in group.notices.all()}
        grouped_ids |= ids
        rows.append(CardRow(Card('group', group.id, group.activity, group),
                            latest_notice_versions([n for n in notices if n.id in ids])))

    activities = Activity.objects.select_related('category')
    if public_only:
        activities = activities.filter(visibility='public')
    if activity_ids is not None:
        activities = activities.filter(id__in=activity_ids)
    for activity in activities:
        own = [n for n in by_card.get(activity.id, []) if n.id not in all_grouped_ids]
        rows.append(CardRow(Card('activity', activity.id, activity, None), latest_notice_versions(own)))
    return [row for row in rows if row.notices]


def load_entries(public_only: bool = True) -> list[dict]:
    """兼容旧调用：把卡片序列化成条目（轻量版本，不含正文）。"""
    return [serialize_entry(row.card, row.notices) for row in load_cards(public_only)]

# ---------------------------------------------------------------- 序列化

FACT_FIELDS = ('kind', 'label', 'value', 'quote', 'locator', 'source_url', 'basis')


def _fact_payload(fact: Fact) -> dict:
    data = {key: getattr(fact, key) for key in FACT_FIELDS}
    data['value'] = redact_public(data['value'])
    data['quote'] = redact_public(data['quote'])
    data['label'] = fact.label or (fact.extras or {}).get('label', '')
    return data


def preview_facts(notice):
    sections=participation.sections(notice)
    if sections is None:
        return [_fact_payload(f) for f in list(notice.facts.all())[:12]]
    return [{'kind':section['kind'],'label':section['title'],'value':item['text'],
             'quote':'','locator':'','source_url':notice.source.url if notice.source_id else '',
             'basis':'editorial'} for section in sections for item in section['items']][:12]


def _redact_profile(payload: dict) -> dict:
    copied = json.loads(json.dumps(payload or {}, ensure_ascii=False))
    # Semantic audit internals and raw candidate evidence are not reader-facing.
    copied.pop('semantic_fields', None)
    copied.pop('review', None)
    for section in copied.get('sections', []):
        section.pop('evidence', None)
    for section in copied.get('sections', []):
        for item in section.get('items', []):
            if isinstance(item.get('text'), str):
                item['text'] = redact_public(item['text'])
    return copied


def serialize_notice(notice: Notice, detail: bool = False) -> dict:
    """detail=True 给全部事实与完整画像；detail=False 只给列表需要的字段。"""
    extras = notice.extras or {}
    curated_sections=participation.sections(notice)
    data = {
        'notice_id': notice.id,
        'year': notice.year,
        'published': notice.published.isoformat() if notice.published else None,
        'deadline': notice.deadline.isoformat() if notice.deadline else None,
        'deadline_kind': notice.deadline_kind or None,
        'deadline_precision': extras.get('deadline_precision') or None,
        'deadline_status': date_status(notice, 'deadline'),
        'deadline_note': redact_public(extras.get('deadline_note') or ''),
        'stage_status': date_status(notice, 'stage'),
        'stage_note': redact_public(extras.get('stage_note') or ''),
        'stage_start': notice.stage_start.isoformat() if notice.stage_start else None,
        'stage_end': notice.stage_end.isoformat() if notice.stage_end else None,
        'colleges': [t.code for t in notice.taxonomies.all() if t.kind == 'college'],
        'levels': [t.code for t in notice.taxonomies.all() if t.kind == 'level'],
        'college_role': extras.get('college_role', ''),
        'level_basis': extras.get('level_basis', ''),
        'audience': redact_public(notice.audience or ''),
        'audience_scope': extras.get('audience_scope') or {},
        'source_url': notice.source.url if notice.source_id else '',
        'conflict': bool(notice.conflict),
        'edition_label': extras.get('edition_label') or '',
        'original_title': extras.get('original_title') or '',
        'registration_windows': [] if curated_sections is not None else extras.get('registration_windows') or [],
        'fact_count': len(notice.facts.all()) if detail else None,
    }
    if curated_sections is not None:
        data['editorial_curated']=True
        data['content_profile']={'sections':curated_sections}
        data['participation_facts']=preview_facts(notice)
        data['fact_count']=sum(len(section['items']) for section in curated_sections)
    elif detail:
        profile = getattr(notice, 'profile', None)
        data['content_profile'] = _redact_profile(profile.payload if profile else {'sections': []})
        data['participation_facts'] = [_fact_payload(f) for f in notice.facts.all()]
        data['fact_count'] = len(data['participation_facts'])
    else:
        profile = getattr(notice, 'profile', None)
        coverage = (profile.payload or {}).get('coverage', {}) if profile else {}
        data['content_profile'] = {'sections': [], 'coverage': coverage, 'truncated': True}
        data['participation_facts'] = []
    if detail:
        for field in ('deadline', 'stage'):
            evidence = extras.get(f'{field}_evidence')
            if isinstance(evidence, dict):
                evidence = dict(evidence)
                evidence['quote'] = redact_public(evidence.get('quote') or '')
                data[f'{field}_evidence'] = evidence
            else:
                data[f'{field}_evidence'] = None
    return data


# 旧页面把这条院级通知并进校级详情，作为“学院内部选拔”补充；不单独成卡。
COLLEGE_SELECTIONS = {
    'activity-59984d77d57d': [{
        'from': 'activity-50ab394de0d9',
        'template': '学院内部选拔：影视与动画学院同主题海报设计大赛（{published} 通知）。'
                    '作品仍按校级通知提交与评审。',
    }],
}


def _college_selections(activity: Activity) -> list[dict]:
    rows = COLLEGE_SELECTIONS.get(activity.id)
    if not rows:
        return []
    result = []
    for spec in rows:
        notice = (Notice.objects.filter(activity_id=spec['from'])
                  .select_related('source').order_by('-published').first())
        if notice is None:
            continue
        published = notice.published.isoformat() if notice.published else ''
        result.append({
            'text': spec['template'].format(published=published),
            'url': notice.source.url if notice.source_id else '',
        })
    return result


def serialize_entry(card: Card | Activity, notices: list[Notice] | None = None) -> dict:
    if isinstance(card, Activity):
        card = Card('activity', card.id, card, None)
    if notices is None:
        notices = list(card_notice_qs(card))
    extras = card.activity.extras or {}
    if card.is_group:
        label = card.activity.category_label
        return {
            'id': card.id,
            'title': card.group.title,
            'kind': 'notice',
            'category': card.activity.category.code if card.activity.category_id else '',
            'category_label': label,
            'summary': redact_public(card.group.title),
            'tags': [redact_public(str(tag)) for tag in (card.group.tags or [label, '官方公告'])],
            'editorial_note': '',
            'featured': card.activity.featured,
            'spotlight': False,
            'material_ids': [],
            'group_of': card.activity.id,
            'versions': [serialize_notice(n) for n in notices],
        }
    activity = card.activity
    return {
        'id': activity.id,
        'title': activity.title,
        'kind': activity.kind,
        'category': activity.category.code if activity.category_id else extras.get('category', ''),
        'category_label': activity.category_label,
        'summary': redact_public(activity.summary or extras.get('summary', '')),
        'tags': [redact_public(str(tag)) for tag in (activity.tags or extras.get('tags', []))],
        'editorial_note': redact_public(activity.editorial_note),
        'featured': activity.featured,
        'spotlight': activity.spotlight,
        'material_ids': activity.material_ids or [],
        'versions': [serialize_notice(n) for n in notices],
        # 与前端既有字段一致（旧页面 CduProjection 也是这个拼写）
        'collegeSelections': _college_selections(activity),
    }

# ---------------------------------------------------------------- 筛选


@dataclass
class Filters:
    q: str = ''
    view: str = 'all'
    category: str = ''
    college: str = ''
    level: str = ''
    year: str = ''
    month: str = ''
    month_basis: str = 'seasonal'
    interest: str = 'any'
    page: int = 1
    page_size: int = 12


def relevant(version: dict, college: str) -> bool:
    if not college or college == 'any':
        return True
    scope = version.get('audience_scope') or {}
    if scope.get('kind') == 'campus':
        return True
    return scope.get('kind') == 'college' and college in (scope.get('colleges') or [])


def version_months(notice: Notice, basis: str = 'seasonal') -> set[int]:
    if basis == 'seasonal':
        return decode_months(notice.seasonal_months)
    return {int(day[5:7]) for day in timing_range(notice, basis) or ()
            if _parse_day(day)}


def month_matches(notice: Notice, filters: Filters) -> bool:
    if not filters.month:
        return True
    months = version_months(notice, filters.month_basis)
    if filters.month == 'unknown':
        return not months
    return int(filters.month) in months


def search_match(row: CardRow, q: str) -> bool:
    if not q:
        return True
    needle = q.lower()
    if needle in (row.card.activity.search_text or '') or needle in row.card.title.lower():
        return True
    return any(needle in (notice.search_text or '') for notice in row.notices)


def _version_ok(notice: Notice, filters: Filters) -> bool:
    if filters.level and filters.level not in {t.code for t in notice.taxonomies.all() if t.kind == 'level'} | {'unknown'}:
        return False
    if filters.college and filters.college not in {t.code for t in notice.taxonomies.all() if t.kind == 'college'}:
        return False
    if filters.year:
        if filters.year == 'unknown':
            if notice.year is not None:
                return False
        elif str(notice.year) != filters.year:
            return False
    if filters.interest and filters.interest != 'any':
        if not relevant(serialize_notice(notice), filters.interest):
            return False
    if filters.view == 'registration' and not registration_open(notice):
        return False
    return month_matches(notice, filters)


def select_version(notices: list[Notice], filters: Filters) -> Notice | None:
    candidates = [n for n in notices if _version_ok(n, filters)]
    if not candidates:
        return None
    return max(candidates, key=lambda n: (n.year or 0, n.published or date.min))


FEATURED_EXCLUDED = {'activity-4b6bd9d295d4', 'activity-941fbf19f639', 'series-770004e0fa68'}
COMPETITION_CATEGORIES = {'technology', 'creative', 'sports', 'speech', 'career'}
HIGHER_LEVELS = {'school', 'campus', 'national', 'province', 'international'}
COLLEGE_IN_TITLE = re.compile(r'[\u4e00-\u9fff]{2,10}学院')


def featured_excluded(entry: dict) -> bool:
    """院级初赛/预赛不进精选：标题点名学院、且没有校级及以上级别依据的赛事。"""
    if entry.get('id') in FEATURED_EXCLUDED:
        return True
    if not COLLEGE_IN_TITLE.search(entry.get('title', '')):
        return False
    if entry.get('category') not in COMPETITION_CATEGORIES:
        return False
    levels = {level for version in entry['versions'] for level in (version.get('levels') or [])}
    return not (levels & HIGHER_LEVELS)


def row_matches(row: CardRow, filters: Filters) -> bool:
    entry = serialize_entry(row.card, row.notices)
    if filters.view == 'discover':
        if not (entry.get('featured') and entry.get('spotlight')) or entry.get('group_of'):
            return False
        if featured_excluded(entry):
            return False
    if filters.view == 'compare':
        years = {n.year for n in row.notices if n.year}
        if len(years) < 2:
            return False
    if filters.category:
        wanted = set(filters.category.split(','))
        if entry.get('category') not in wanted:
            return False
    if not search_match(row, filters.q):
        return False
    return select_version(row.notices, filters) is not None


def _sql_scope(filters: Filters):
    """把能在数据库里判断的条件先缩范围，返回 (活动 ID, 分组 ID)。

    只做“必要条件”的收窄：算不出来的（报名窗口、跨月规则里的非 seasonal 口径、
    参与范围 JSON）留给后面的精确判断，宁可多取几条，不会少取。
    """
    q = (filters.q or '').strip().lower()
    notice_level = bool(filters.year or filters.college or filters.level)
    if filters.month and filters.month_basis == 'seasonal':
        notice_level = True
    if not (notice_level or q or filters.category):
        return None

    notice_ids = None
    if notice_level:
        nqs = Notice.objects.all()
        if filters.year:
            nqs = (nqs.filter(year__isnull=True) if filters.year == 'unknown'
                   else nqs.filter(year=int(filters.year)))
        if filters.college:
            nqs = nqs.filter(taxonomies__kind='college', taxonomies__code=filters.college)
        if filters.level:
            nqs = nqs.filter(taxonomies__kind='level', taxonomies__code=filters.level)
        if filters.month and filters.month_basis == 'seasonal':
            nqs = (nqs.filter(seasonal_months='') if filters.month == 'unknown'
                   else nqs.filter(seasonal_months__contains=f',{int(filters.month)},'))
        notice_ids = set(nqs.values_list('id', flat=True))

    aqs = Activity.objects.filter(visibility='public')
    if filters.category:
        aqs = aqs.filter(category__code__in=[c for c in filters.category.split(',') if c])
    if notice_ids is not None:
        aqs = aqs.filter(notices__id__in=notice_ids)
    if q:
        aqs = aqs.filter(Q(search_text__icontains=q) | Q(notices__search_text__icontains=q))
    activity_ids = set(aqs.values_list('id', flat=True))

    gqs = ActivityGroup.objects.filter(visibility='public')
    if notice_ids is not None:
        gqs = gqs.filter(notices__id__in=notice_ids)
    if q:
        gqs = gqs.filter(Q(title__icontains=q) | Q(notices__search_text__icontains=q))
    return activity_ids, set(gqs.values_list('id', flat=True))


def _plain_filters(filters: Filters) -> bool:
    """没有任何筛选：可以用 SQL 排序分页的快速路径。"""
    return not any([filters.q, filters.category, filters.college, filters.level,
                    filters.year, filters.month, filters.view != 'all']) and \
        filters.interest in ('', 'any')


def _page_card_ids(filters: Filters):
    """SQL 排序 + 分页（不分页取正文），返回 ('activity'|'group', id) 与总数。"""
    activities = (Activity.objects.filter(visibility='public')
                  .annotate(latest=Max('notices__published'), rows=Count('notices'))
                  .filter(rows__gt=0).values_list('id', 'latest', 'title'))
    groups = (ActivityGroup.objects.filter(visibility='public')
              .annotate(latest=Max('activity__notices__published'))
              .filter(activity__notices__isnull=False)
              .values_list('id', 'latest', 'title'))
    merged = [('activity', row[0], row[1], row[2]) for row in activities]
    merged += [('group', row[0], row[1], row[2]) for row in groups]
    merged.sort(key=lambda item: ((item[2].isoformat() if item[2] else ''), item[3], item[1]),
                reverse=True)
    total = len(merged)
    size = filters.page_size
    pages = max(1, (total + size - 1) // size)
    page = min(max(1, filters.page), pages)
    start = (page - 1) * size
    chunk = merged[start:start + size]
    return chunk, total, page, pages


def query_entries(filters: Filters) -> dict:
    """列表查询：范围先在数据库里缩小，只给本页装配正文。"""
    if _plain_filters(filters):
        chunk, total, page, pages = _page_card_ids(filters)
        activity_ids = {cid for kind, cid, _, _ in chunk if kind == 'activity'}
        group_ids = {cid for kind, cid, _, _ in chunk if kind == 'group'}
        by_id = {row.card.id: row for row in
                 load_cards(activity_ids=activity_ids, group_ids=group_ids)}
        ordered = [by_id[cid] for kind, cid, _, _ in chunk if cid in by_id]
        return {'count': total, 'page': page, 'page_size': filters.page_size,
                'total_pages': pages,
                'results': [decorate(row, filters) for row in ordered]}

    scope = _sql_scope(filters)
    if scope is None:
        candidates = load_cards()
    else:
        activity_ids, group_ids = scope
        candidates = load_cards(activity_ids=activity_ids, group_ids=group_ids)
    rows = [row for row in candidates if row_matches(row, filters)]

    def sort_key(row: CardRow):
        version = select_version(row.notices, filters)
        return (version.published.isoformat() if version and version.published else '',
                row.card.title, row.card.id)

    rows.sort(key=sort_key, reverse=True)
    total = len(rows)
    size = filters.page_size
    pages = max(1, (total + size - 1) // size)
    page = min(max(1, filters.page), pages)
    start = (page - 1) * size
    page_rows = rows[start:start + size]
    return {
        'count': total, 'page': page, 'page_size': size, 'total_pages': pages,
        'results': [decorate(row, filters) for row in page_rows],
    }


def decorate(row: CardRow, filters: Filters) -> dict:
    """给列表项补上卡片需要的最小字段；只对本页调用。"""
    entry = serialize_entry(row.card, row.notices)
    notice = select_version(row.notices, filters) or row.notices[0]
    version = next(v for v in entry['versions'] if v['notice_id'] == notice.id)
    # 卡片上的“关键条件”需要几条事实，只取本页这一条通知
    version['participation_facts'] = preview_facts(notice)
    entry['phase'] = phase(notice)
    entry['registration_open'] = registration_open(notice)
    entry['audience_line'] = notice.audience or ''
    entry['published'] = version.get('published')
    entry['deadline'] = version.get('deadline')
    entry['deadline_kind'] = version.get('deadline_kind')
    entry['deadline_status'] = version.get('deadline_status')
    entry['deadline_note'] = version.get('deadline_note')
    entry['stage_start'] = version.get('stage_start')
    entry['stage_end'] = version.get('stage_end')
    entry['stage_status'] = version.get('stage_status')
    entry['stage_note'] = version.get('stage_note')
    entry['source_url'] = version.get('source_url')
    entry['version_count'] = len(entry['versions'])
    entry['selected_source_url'] = version.get('source_url')
    entry['selected_year'] = version.get('year')
    entry['selected_notice_id'] = notice.id
    return entry

# ---------------------------------------------------------------- 详情


def activity_detail(card_id: str, notice_id: str | None = None) -> dict | None:
    """详情：版本目录（轻量）+ 选中通知（完整事实）。归属判断走 card_notice_qs。"""
    card = resolve_card(card_id)
    if card is None:
        return None
    notices = list(card_notice_qs(card))
    notices.sort(key=_notice_order, reverse=True)
    entry = serialize_entry(card, notices)
    target = None
    if notice_id:
        match = next((n for n in notices if n.id == notice_id), None)
        if match is None:
            return None
        target = match
    elif notices:
        target = notices[0]
    if target is not None:
        # 只有选中的这一条通知需要完整事实与画像，单独取一次
        target = _notice_qs(with_content=True).get(pk=target.pk)
    payload = {
        'entry': entry,
        'notice': serialize_notice(target, detail=True) if target is not None else None,
        'groups': [{'id': g.id, 'title': g.title}
                   for g in card.activity.groups.filter(visibility='public')],
        'activity_id': card.activity.id,
    }
    return payload

# ---------------------------------------------------------------- 首页 / 日历 / 词表


def public_counts() -> dict:
    rows = load_cards()
    return {
        'activities': len([row for row in rows if not row.card.is_group]),
        'cards': len(rows),
        'versions': sum(len(row.notices) for row in rows),
        'groups': len([row for row in rows if row.card.is_group]),
        'guides': Guide.objects.filter(visibility='public').count(),
        'services': CampusService.objects.filter(visibility='public').count(),
    }


def home_payload() -> dict:
    rows = [row for row in load_cards()
            if row.card.activity.spotlight and row.card.activity.featured and not row.card.is_group]
    featured = [(row, serialize_entry(row.card, row.notices)) for row in rows]
    featured.sort(key=lambda item: (item[0].notices[0].published or date.min), reverse=True)

    def light(entry):
        version = entry['versions'][0] if entry['versions'] else {}
        return {'id': entry['id'], 'title': entry['title'],
                'category': entry.get('category'), 'category_label': entry.get('category_label'),
                'summary': entry.get('summary'), 'featured': entry.get('featured'),
                'spotlight': entry.get('spotlight'),
                'versions': [{'year': version.get('year'), 'published': version.get('published'),
                              'source_url': version.get('source_url')}]}

    hero_ids = ['network', 'digital', 'marathon']
    by_id = {entry['id']: entry for _, entry in featured}
    hero = [light(by_id[i]) for i in hero_ids if i in by_id]
    if len(hero) < 3:
        hero += [light(entry) for _, entry in featured if entry['id'] not in {h['id'] for h in hero}][:3 - len(hero)]
    picks = [light(entry) for _, entry in featured[:4]]
    categories: dict[str, int] = {}
    for _, entry in featured:
        code = entry.get('category') or ''
        categories[code] = categories.get(code, 0) + 1
    guides = list(Guide.objects.filter(visibility='public').order_by('position')[:3].values(
        'id', 'title', 'subtitle', 'category', 'number', 'icon'))
    meta = SiteMeta.objects.first()
    return {
        'hero': hero,
        'picks': picks,
        'categories': categories,
        'counts': public_counts(),
        'guides': guides,
        'coverage': (meta.coverage if meta else {}),
        'revision': meta.current_revision if meta else '',
    }


def taxonomy_payload() -> dict:
    payload = {'category': [], 'college': [], 'level': []}
    for item in Taxonomy.objects.all():
        payload.setdefault(item.kind, []).append({'code': item.code, 'label': item.label})
    meta = SiteMeta.objects.first()
    payload['display_options'] = meta.display_options if meta else {}
    payload['policies'] = meta.policies if meta else {}
    payload['coverage'] = meta.coverage if meta else {}
    payload['schema_version'] = meta.schema_version if meta else 'catalog-1'
    return payload


def meta_payload() -> dict:
    meta = SiteMeta.objects.first()
    return {
        'site_name': meta.site_name if meta else '成都大学校园生活与活动',
        'revision': meta.current_revision if meta else '',
        'published_at': meta.published_at.isoformat() if meta and meta.published_at else None,
        'schema_version': meta.schema_version if meta else 'catalog-1',
        'counts': public_counts(),
        'coverage': meta.coverage if meta else {},
        'policies': meta.policies if meta else {},
        'generated_at': china_now().isoformat(timespec='seconds'),
    }


def calendar_annual(month: int) -> dict:
    """往年这个月：按月归类的活动与线索（跨月征集只进开始月）。"""
    notices = {n.id: n for n in _notice_qs(with_content=True)}
    records = []
    for row in load_cards():
        versions = []
        for notice in row.notices:
            if notice.conflict:
                continue
            if month not in decode_months(notice.seasonal_months):
                continue
            full = notices.get(notice.id, notice)
            signals = []
            deadline_day = full.deadline.date().isoformat() if full.deadline and date_status(full, 'deadline') == 'confirmed' else None
            if deadline_day and int(deadline_day[5:7]) == month:
                signals.append({'kind': 'deadline',
                                'text': DEADLINE_EVENT_LABELS.get(full.deadline_kind or '', '所列截止'),
                                'deadline_kind': full.deadline_kind or None,
                                'deadline_status': 'confirmed',
                                'raw': full.deadline.isoformat(), 'start': deadline_day, 'end': deadline_day})
            stage_day = full.stage_start.isoformat() if full.stage_start and date_status(full, 'stage') == 'confirmed' else None
            if stage_day and int(stage_day[5:7]) == month:
                stage_end = full.stage_end.isoformat() if full.stage_end else stage_day
                signals.append({'kind': 'event', 'text': '活动阶段', 'stage_status': 'confirmed',
                                'raw': stage_day, 'start': stage_day, 'end': stage_end})
            editorial=participation.curated(full)
            clues=([('schedule',line) for line in editorial.get('fields',{}).get('event_time','').splitlines()]
                   if editorial else [(fact.kind, redact_public(fact.value)) for fact in full.facts.all()])
            for kind,value in clues:
                if not timing_clue(kind, value):
                    continue
                if month in seasonal_months(value):
                    signals.append({'kind': 'deadline' if kind == 'registration' else 'event',
                                    'text': value, 'raw': None})
            if signals:
                versions.append({'version': full, 'signals': signals})
        if versions:
            versions.sort(key=lambda item: item['version'].published or date.min, reverse=True)
            light = {'id': row.card.id, 'title': row.card.title,
                     'category': (row.card.activity.category.code if row.card.activity.category_id else ''),
                     'category_label': row.card.activity.category_label,
                     'featured': row.card.activity.featured,
                     'spotlight': row.card.activity.spotlight,
                     'summary': row.card.title,
                     'group_of': row.card.activity.id if row.card.is_group else None}
            records.append({'entry': light, 'versions': [{
                'version': {key: value for key, value in serialize_notice(item['version']).items()
                            if key in ('year', 'published', 'deadline', 'deadline_kind',
                                       'deadline_status', 'deadline_note', 'stage_start', 'stage_end',
                                       'stage_status', 'stage_note', 'source_url', 'levels', 'colleges',
                                       'edition_label', 'audience')},
                'signals': item['signals']} for item in versions]})
    records.sort(key=lambda r: (not r['entry'].get('spotlight'), -len(r['versions']), r['entry']['title']))
    return {'mode': 'annual', 'month': month, 'count': len(records), 'results': records}


def annual_counts() -> dict:
    counts = {f'{m:02d}': 0 for m in range(1, 13)}
    for row in load_cards():
        months: set[int] = set()
        for notice in row.notices:
            months |= decode_months(notice.seasonal_months)
        for month in months:
            counts[f'{month:02d}'] += 1
    return counts


def actual_counts(year: int) -> dict:
    """一次遍历算出该年 12 个月各自的节点数。"""
    counts = {f'{m:02d}': 0 for m in range(1, 13)}
    for row in load_cards():
        for notice in row.notices:
            if notice.conflict:
                continue
            deadline_status = date_status(notice, 'deadline')
            stage_status = date_status(notice, 'stage')
            if notice.deadline and deadline_status == 'confirmed' and notice.deadline.year == year:
                counts[f'{notice.deadline.month:02d}'] += 1
            if notice.stage_start and stage_status == 'confirmed' and notice.stage_start.year == year:
                counts[f'{notice.stage_start.month:02d}'] += 1
            if (notice.stage_end and stage_status == 'confirmed' and notice.stage_end.year == year
                    and notice.stage_end != notice.stage_start):
                counts[f'{notice.stage_end.month:02d}'] += 1
    return counts


def calendar_actual(year: int, month: int) -> dict:
    """真实年月：只标报名截止与活动开始/结束节点。"""
    events = []
    for row in load_cards():
        for notice in row.notices:
            if notice.conflict:
                continue
            event_meta = {
                'notice_id': notice.id, 'year': notice.year,
                'published': notice.published.isoformat() if notice.published else None,
                'colleges': [t.code for t in notice.taxonomies.all() if t.kind == 'college'],
                'featured': row.card.activity.featured,
            }
            deadline_status = date_status(notice, 'deadline')
            stage_status = date_status(notice, 'stage')
            if (notice.deadline and deadline_status == 'confirmed'
                    and (notice.deadline.year, notice.deadline.month) == (year, month)):
                events.append({
                    **event_meta,
                    'entry_id': row.card.id, 'title': row.card.title,
                    'category': (row.card.activity.category.code if row.card.activity.category_id else ''),
                    'category_label': row.card.activity.category_label,
                    'kind': 'deadline',
                    'label': DEADLINE_EVENT_LABELS.get(notice.deadline_kind or '', '所列截止'),
                    'deadline_kind': notice.deadline_kind or None,
                    'deadline_status': 'confirmed',
                    'start': notice.deadline.date().isoformat(),
                    'end': notice.deadline.date().isoformat(),
                    'precision': (notice.extras or {}).get('deadline_precision') or None,
                    'raw': notice.deadline.isoformat(),
                    'source_url': notice.source.url if notice.source_id else '',
                })
            start = notice.stage_start.isoformat() if notice.stage_start else None
            end = notice.stage_end.isoformat() if notice.stage_end else None
            if stage_status == 'confirmed' and (start or end):
                if start and end and end < start:
                    continue
                begin = start or end
                finish = end or begin
                if begin[:7] == f'{year:04d}-{month:02d}' or finish[:7] == f'{year:04d}-{month:02d}':
                    events.append({
                        **event_meta,
                        'entry_id': row.card.id, 'title': row.card.title,
                        'category': (row.card.activity.category.code if row.card.activity.category_id else ''),
                        'category_label': row.card.activity.category_label,
                        'kind': 'event',
                        'label': '活动阶段' if start else '活动阶段结束',
                        'stage_status': 'confirmed',
                        'start': begin, 'end': finish,
                        'only': None if start and end else ('start' if start else 'end'),
                        'raw': start or end,
                        'source_url': notice.source.url if notice.source_id else '',
                    })
    events.sort(key=lambda e: (e['start'], e['title'], e['kind']))
    return {'mode': 'actual', 'year': year, 'month': month, 'count': len(events), 'events': events}


def guide_list(category: str = '', q: str = '') -> list[dict]:
    guides = Guide.objects.filter(visibility='public').prefetch_related('sections', 'faqs', 'sources')
    rows = []
    for guide in guides:
        text = ' '.join([guide.title, guide.subtitle, guide.summary, ' '.join(guide.tags or [])]).lower()
        if category and guide.category != category:
            continue
        if q and q.lower() not in text:
            continue
        rows.append({
            'id': guide.id, 'title': guide.title, 'subtitle': guide.subtitle,
            'category': guide.category, 'summary': guide.summary, 'number': guide.number,
            'icon': guide.icon, 'tags': guide.tags,
            'section_count': len(guide.sections.all()),
        })
    return rows


def guide_detail(guide_id: str) -> dict | None:
    guide = (Guide.objects.filter(id=guide_id, visibility='public')
             .prefetch_related('sections__blocks', 'faqs', 'sources').first())
    if guide is None:
        return None
    return {
        'id': guide.id, 'title': guide.title, 'subtitle': guide.subtitle,
        'category': guide.category, 'summary': guide.summary, 'scope': guide.scope,
        'caution': guide.caution, 'source_note': guide.source_note, 'number': guide.number,
        'icon': guide.icon, 'tags': guide.tags, 'related_service': guide.related_service,
        'sections': [{'title': s.title, 'kind': s.kind,
                      'items': [b.text for b in s.blocks.all()]} for s in guide.sections.all()],
        'faqs': [{'q': f.question, 'a': f.answer} for f in guide.faqs.all()],
        'sources': [{'label': s.label, 'url': s.url, 'page_ref': s.page_ref,
                     'checked_on': s.checked_on.isoformat() if s.checked_on else None,
                     'note': s.note} for s in guide.sources.all()],
    }


def service_list(category: str = '', q: str = '') -> list[dict]:
    rows = []
    for item in CampusService.objects.filter(visibility='public'):
        text = ' '.join([item.name, item.description, item.owner, item.phone or '', item.location]).lower()
        if category and item.category != category:
            continue
        if q and q.lower() not in text:
            continue
        rows.append({
            'id': item.id, 'name': item.name, 'category': item.category,
            'description': item.description, 'owner': item.owner, 'phone': item.phone,
            'url': item.url, 'location': item.location, 'open_hours': item.open_hours,
            'source_url': item.source_url, 'source_label': item.source_label,
            'source_date': item.source_date.isoformat() if item.source_date else None,
            'checked_on': item.checked_on.isoformat() if item.checked_on else None,
            'note': item.note, 'related_guide': item.related_guide,
        })
    return rows


def services_and_guides_index() -> dict:
    payload = taxonomy_payload()
    return {'guides': guide_list(), 'services': service_list(),
            'categories': payload.get('category', [])}
