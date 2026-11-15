"""Inspect a .docx file structure."""
import sys
from docx import Document

doc = Document(sys.argv[1])

print(f"=== Paragraphs: {len(doc.paragraphs)} ===")
style_counts = {}
for para in doc.paragraphs:
    s = para.style.name if para.style else "None"
    style_counts[s] = style_counts.get(s, 0) + 1

for s, c in sorted(style_counts.items()):
    print(f"  {s}: {c}")

print(f"\n=== Tables: {len(doc.tables)} ===")
for i, table in enumerate(doc.tables):
    print(f"  Table {i}: {len(table.rows)} rows x {len(table.columns)} cols")

print("\n=== First 60 paragraphs ===")
for i, para in enumerate(doc.paragraphs[:60]):
    text = para.text.strip()[:80]
    style = para.style.name if para.style else "None"
    if text:
        print(f"  [{i}] ({style}) {text}")