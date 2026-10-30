"""Public-projection redaction rules (single source of truth).

The backend imports these names from ``catalog.services``.  This module has no
Django dependency so it can be unit-tested without a database and reused by
export/scan tooling.

Design constraints:
* private mobile numbers, private mailboxes, ID-card numbers and social group
  numbers must never reach public text;
* office mailboxes on .edu.cn/.gov.cn stay readable;
* 18-digit contest codes that are not checksum-valid ID cards must survive;
* a mailbox whose local part was already replaced by a placeholder
  (``〔个人手机号...〕@163.com``) must be removed together with its domain.
"""
from __future__ import annotations

import re
from datetime import date

# Optional +86, then an 11-digit mainland mobile with optional spaces/hyphens.
PUBLIC_PHONE = re.compile(
    r'(?<![0-9A-Za-z@])(?:\+?86[-\s]?)?1[3-9]\d(?:[-\s]?\d{4}){2}(?![0-9A-Za-z@])')
PUBLIC_ID_LABELED = re.compile(
    r'((?:居民身份证(?:号码|号)?|身份证(?:号码|号)?|证件号码|证件号)\s*[:：]?\s*)(\d{17}[\dXx])', re.I)
PUBLIC_ID_ANY = re.compile(r'(?<![0-9A-Za-z])\d{17}[\dXx](?![0-9A-Za-z])')

# A keyword followed by a short tail.  Numbers are redacted anywhere inside the
# tail, so ``QQ群（123456）``, ``官方QQ（123456）``, ``QQ群：交流群123456`` and
# ``成长群123456、就业群654321`` all get cleaned in one pass.
PUBLIC_QQ = re.compile(
    r'(?:QQ\s*群号?|Q\s*群号?|官方QQ|腾讯QQ|QQ\s*群|群号|QQ|[\u4e00-\u9fff]{0,12}群)'
    r'\s*[:：]?(?P<tail>[^。；;\n]{0,40})',
    re.I)
PUBLIC_QQ_NUMBER = re.compile(
    r'(?<![0-9A-Za-z_-])(?<!代码)(?<!编号)(?<!学号)(?<!工号)(?<!证号)(?<!证件)(?<!参赛)'
    r'\d{5,12}(?![0-9A-Za-z_-])')

PUBLIC_NAME = re.compile(
    r'((?:联系人|联系人姓名|负责人|队长|组长)\s*[:：]\s*)([一-鿿]{2,4})(?=$|[，,。；;、\s（(])')
PUBLIC_EMAIL = re.compile(
    r'(?<![\w.+-])([\w.+-]+)\s*@\s*([A-Z0-9-]+(?:\s*[.．,，、。]\s*[A-Z0-9-]+)+)', re.I)
# Placeholder local parts produced by an earlier scrub pass, e.g.
# ``〔个人手机号，原文见来源包〕@163.com`` or ``（个人手机号未公开）@163.com``.
PUBLIC_EMAIL_PLACEHOLDER = re.compile(
    r'[（(〔\[]\s*[^）)〕\]\n]{0,40}?'
    r'(?:手机号|手机号码|联系电话|电话|邮箱|电子邮箱|联系方式|群号|QQ号|社交账号)'
    r'[^）)〕\]\n]{0,30}?[）)〕\]]\s*@\s*'
    r'[A-Za-z0-9-]+(?:\s*[.．,，、。]\s*[A-Za-z0-9-]+)+')
PUBLIC_EMAIL_ALLOWED_SUFFIXES = ('.edu.cn', '.gov.cn')
PUBLIC_INTERNAL_LEVEL = re.compile(
    r'\b(?:competition_level|stage_level)\s*[:=：]\s*'
    r'(?:school|college|provincial|national|international|none|unknown)\b',
    re.I)
PUBLIC_INTERNAL_PROCESS = re.compile(
    r'[^。；;\n]*(?:冻结包|未随包提供|镜像附件|编号核验|不作为单日节点|'
    r'内部核验|候选修订|未完成核查|审计复核|'
    r'A0[1-9][^。；;\n]{0,16}未读取|附件[^。；;\n]{0,10}未读取)[^。；;\n]*[。；;]?'
)


def _is_valid_cn_id(value: str) -> bool:
    """Recognize a checksum-valid mainland ID; do not erase arbitrary 18-digit codes."""
    if not re.fullmatch(r'\d{17}[\dXx]', value):
        return False
    try:
        date(int(value[6:10]), int(value[10:12]), int(value[12:14]))
    except ValueError:
        return False
    weights = (7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2)
    checks = '10X98765432'
    expected = checks[sum(int(char) * weight for char, weight in zip(value[:17], weights)) % 11]
    return value[-1].upper() == expected


def redact_qq_groups(text: str) -> str:
    def replace(match: re.Match) -> str:
        tail = PUBLIC_QQ_NUMBER.sub('〔群号已隐去〕', match.group('tail'))
        keyword = match.group(0)[:len(match.group(0)) - len(match.group('tail'))]
        return keyword + tail

    # Re-run because a single match consumes at most 40 tail chars; repeated
    # groups in a long sentence are handled on the next pass.
    previous = None
    while previous != text:
        previous = text
        text = PUBLIC_QQ.sub(replace, text)
    return text


def redact_public(value) -> str:
    text = str(value or '')
    # Pipeline enums and audit-process sentences are not reader-facing.
    text = PUBLIC_INTERNAL_PROCESS.sub('', text)
    text = PUBLIC_INTERNAL_LEVEL.sub('', text)
    text = re.sub(r'\s*[；;，,]\s*[；;，,]+\s*', '；', text)
    text = re.sub(r'^[\s；;,。]+|[\s；;,。]+$', '', text)
    text = PUBLIC_EMAIL_PLACEHOLDER.sub('〔个人邮箱已隐去〕', text)
    text = PUBLIC_PHONE.sub('〔手机号已隐去〕', text)
    text = PUBLIC_ID_LABELED.sub(lambda m: m.group(1) + '〔身份证号已隐去〕', text)
    text = PUBLIC_ID_ANY.sub(
        lambda m: '〔身份证号已隐去〕' if _is_valid_cn_id(m.group()) else m.group(), text)
    text = redact_qq_groups(text)
    # A group mask can turn ``QQ邮箱<digits>@qq.com`` into a dangling
    # ``〔群号已隐去〕@qq.com``; sweep placeholders again before the mail pass.
    text = PUBLIC_EMAIL_PLACEHOLDER.sub('〔个人邮箱已隐去〕', text)
    text = PUBLIC_NAME.sub(lambda m: m.group(1) + '〔姓名已隐去〕', text)

    def redact_email(match: re.Match) -> str:
        domain = re.sub(r'\s*[.．,，、。]\s*', '.', match.group(2)).lower().rstrip('.')
        if domain.endswith(PUBLIC_EMAIL_ALLOWED_SUFFIXES):
            return match.group(0)
        return '〔个人邮箱已隐去〕'

    text = PUBLIC_EMAIL.sub(redact_email, text)
    return text


def find_private_shapes(text: str) -> list[str]:
    """Return the private-data categories still visible in ``text``.

    Used by the repair transaction gate, the runtime projection verifier and
    the static-export scanner so all three agree on what "leaked" means.
    """
    text = str(text or "")
    found = []
    if PUBLIC_PHONE.search(text):
        found.append("phone")
    if PUBLIC_ID_LABELED.search(text):
        found.append("labeled_id")
    for match in PUBLIC_ID_ANY.finditer(text):
        if _is_valid_cn_id(match.group()):
            found.append("id")
            break
    if PUBLIC_EMAIL_PLACEHOLDER.search(text):
        found.append("placeholder_email")
    for match in PUBLIC_EMAIL.finditer(text):
        domain = re.sub(r'\s*[.．,，、。]\s*', '.', match.group(2)).lower().rstrip('.')
        if not domain.endswith(PUBLIC_EMAIL_ALLOWED_SUFFIXES):
            found.append("email")
            break
    for match in PUBLIC_QQ.finditer(text):
        if PUBLIC_QQ_NUMBER.search(match.group("tail")):
            found.append("qq_group")
            break
    if PUBLIC_INTERNAL_LEVEL.search(text):
        found.append("internal_level")
    return sorted(set(found))


def _redact_tree(value):
    """Apply the public-text privacy rule recursively to JSON-shaped values."""
    if isinstance(value, dict):
        return {key: _redact_tree(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_redact_tree(item) for item in value]
    if isinstance(value, str):
        return redact_public(value)
    return value


def redact_profile(payload: dict) -> dict:
    """Drop semantic-audit internals and raw candidate evidence from public profiles."""
    import copy
    copied = copy.deepcopy(payload or {})
    copied.pop('semantic_fields', None)
    copied.pop('review', None)
    for section in copied.get('sections') or []:
        if isinstance(section, dict):
            section.pop('evidence', None)
    return _redact_tree(copied)
