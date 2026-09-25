"""Reading declarations' source text out of a checkout, from the dataset's `source` facet."""
from __future__ import annotations

from pathlib import Path


class Sources:
    """The project's source files, read once each."""

    def __init__(self, root: Path | None):
        self.root = root
        self._files: dict[str, list[str] | None] = {}

    def lines(self, path: str) -> list[str] | None:
        if self.root is None:
            return None
        if path not in self._files:
            p = self.root / path
            self._files[path] = p.read_text(encoding="utf-8", errors="replace").splitlines() if p.exists() else None
        return self._files[path]

    def text(self, row: dict) -> str | None:
        """The declaration's text: from its start (line, UTF-16 column) to its end."""
        lines = self.lines(row["path"])
        if lines is None:
            return None
        (l0, c0), (l1, c1) = row["start"], row["end"]
        if l0 < 1 or l1 > len(lines):
            return None
        chunk = lines[l0 - 1:l1]
        if not chunk:
            return None
        chunk[-1] = chunk[-1][:utf16_to_index(chunk[-1], c1)]
        chunk[0] = chunk[0][utf16_to_index(chunk[0], c0):]
        return "\n".join(chunk)

    def readme(self) -> tuple[str, str] | None:
        """The project's README, as (file name, markdown)."""
        if self.root is None:
            return None
        for name in ("README.md", "readme.md", "Readme.md"):
            p = self.root / name
            if p.exists():
                return name, p.read_text(encoding="utf-8", errors="replace")
        return None


def utf16_to_index(line: str, col: int) -> int:
    """The index in `line` of the UTF-16 column `col` (Lean's columns count UTF-16 code units)."""
    units = 0
    for i, ch in enumerate(line):
        if units >= col:
            return i
        units += 2 if ord(ch) > 0xFFFF else 1
    return len(line)


OPEN, CLOSE = "([{⟨⦃", ")]}⟩⦄"


def split_statement(text: str) -> tuple[str, str]:
    """A declaration's text split at the start of its proof or body: the first `:=`, `where` or
    equation-compiler `|` outside brackets, strings and comments. `("text", "")` when there is none."""
    depth = 0
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if text.startswith("--", i):
            j = text.find("\n", i)
            i = n if j < 0 else j
            continue
        if text.startswith("/-", i):
            j = text.find("-/", i + 2)
            i = n if j < 0 else j + 2
            continue
        if ch == '"':
            j = i + 1
            while j < n and text[j] != '"':
                j += 2 if text[j] == "\\" else 1
            i = j + 1
            continue
        if ch in OPEN:
            depth += 1
        elif ch in CLOSE:
            depth = max(0, depth - 1)
        elif depth == 0:
            if text.startswith(":=", i):
                return text[:i].rstrip(), text[i:]
            if text.startswith("where", i) and (i == 0 or text[i - 1].isspace()) and \
                    (i + 5 == n or not (text[i + 5].isalnum() or text[i + 5] in "_'.")):
                return text[:i].rstrip(), text[i:]
            if ch == "|" and text[:i].rstrip().endswith(("\n", "")) and _line_start(text, i):
                return text[:i].rstrip(), text[i:]
        i += 1
    return text, ""


def _line_start(text: str, i: int) -> bool:
    j = text.rfind("\n", 0, i)
    return text[j + 1:i].strip() == ""
