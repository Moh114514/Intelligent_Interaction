from __future__ import annotations

import re


_NAMES = ("Kuro", "Shiro", "Vanguard", "BLACK", "WHITE", "SOLDIER")
_TOKEN = r"(?:\[(?:" + "|".join(_NAMES) + r")\]|(?:" + "|".join(_NAMES) + r")\s*[:：])"
_PREFIX = re.compile(r"^\s*(?:" + _TOKEN + r"\s*)+", re.IGNORECASE)
_CANDIDATES = tuple(
    value.casefold()
    for name in _NAMES
    for value in (f"[{name}]", f"{name}:", f"{name}：")
)


def strip_role_prefix(text: str, *, final: bool = True) -> str:
    leading_trimmed = text.lstrip()
    if not final and not leading_trimmed:
        return ""
    if not final:
        folded = leading_trimmed.casefold()
        if any(candidate.startswith(folded) for candidate in _CANDIDATES):
            return ""
    return _PREFIX.sub("", text, count=1)
