"""Check coverage IDs and local links; optionally compare downloaded McNeel command lists."""

import argparse
import re
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path


HERE = Path(__file__).resolve().parent
INDEX = HERE / "cad-feature-evidence.md"
RHINO = HERE / "22-rhino-full-parity.md"
JEWELRY = HERE / "13-jewelry-cad-features.md"


def section(text, title):
    return text.split(f"## {title}\n", 1)[1].split("\n## ", 1)[0]


def table_keys(text):
    for line in text.splitlines():
        if line.startswith("| "):
            yield line.split("|")[1].strip()


def audit_rows(name, source_ids, coverage):
    keys = []
    for cell in table_keys(coverage):
        if not re.match(r"[A-Z]?\d", cell):
            continue
        for token in cell.split(", "):
            match = re.fullmatch(r"([A-Z]?)(\d+)(?:–([A-Z]?)(\d+))?", token)
            if not match:
                raise ValueError(f"{name}: invalid coverage ID {token!r}")
            family, start, end_family, end = match.groups()
            if end_family and family != end_family or end and int(end) < int(start):
                raise ValueError(f"{name}: invalid range {token!r}")
            keys.extend(f"{family}{n}" for n in range(int(start), int(end or start) + 1))
    expected = Counter(source_ids)
    actual = Counter(keys)
    if actual != expected or any(count != 1 for count in expected.values()):
        raise ValueError(f"{name}: missing {expected - actual}, extra {actual - expected}")
    print(f"{name}: {len(keys)} IDs accounted for once")


class Headings(HTMLParser):
    def __init__(self):
        super().__init__()
        self.reading = False
        self.words = []
        self.names = []

    def handle_starttag(self, tag, attrs):
        if tag == "h5":
            self.words = []
            self.reading = True

    def handle_endtag(self, tag):
        if tag == "h5" and self.reading:
            self.names.append(" ".join("".join(self.words).split()))
            self.reading = False

    def handle_data(self, text):
        if self.reading:
            self.words.append(text)


def headings(path):
    parser = Headings()
    parser.feed(path.read_text())
    if not parser.names or "" in parser.names:
        raise ValueError(f"{path}: empty or missing command headings")
    return set(parser.names)


def audit_names(names, text, label):
    missing = sorted(n for n in names if not re.search(r"(?<!\w)" + re.escape(n) + r"(?!\w)", text))
    if missing:
        raise ValueError(f"{label}: missing headings {missing}")
    print(f"{label}: {len(names)} distinct displayed headings located")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--command-lists", type=Path, nargs=2, metavar=("RHINO8_HTML", "RHINO9_HTML"))
    args = parser.parse_args()
    index = INDEX.read_text()
    rhino = RHINO.read_text()
    jewelry = JEWELRY.read_text()
    audit_rows("Rhino", re.findall(r"^\| ([A-Z]\d+) \|", rhino, re.M),
               section(index, "Coverage of the Rhino inventory"))
    audit_rows("Jewelry", re.findall(r"^\| (\d+) \|", section(jewelry, "3. Capability matrix"), re.M),
               section(index, "Jewelry workflow coverage"))
    for target in re.findall(r"\]\(([^)]+)\)", index):
        if target.startswith(("https://", "#")):
            continue
        if not (HERE / target.split("#", 1)[0]).exists():
            raise ValueError(f"Missing local evidence {target}")
    print("Local evidence paths exist")
    if args.command_lists:
        v8, v9 = map(headings, args.command_lists)
        inventory = rhino.split("## 3. The inventory", 1)[1].split("## 4.", 1)[0]
        audit_names(v8, inventory, "Rhino 8 inventory")
        headings_table = "\n".join(table_keys(section(index, "Command names outside the original groups")))
        audit_names(v9 - v8, headings_table, "Additional Rhino 9 headings")


if __name__ == "__main__":
    main()
