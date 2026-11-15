"""Convert a .docx file to PDF using python-docx + fpdf2.

Usage:
    python docx_to_pdf.py <input.docx> <output.pdf>
"""
import sys
from pathlib import Path

from docx import Document
from fpdf import FPDF


class HandbookPDF(FPDF):
    def header(self):
        if self.page_no() > 1:
            self.set_font("Arial", "I", 8)
            self.set_text_color(150, 150, 150)
            self.cell(0, 8, "AI Drama Studio - Developer Handbook", align="R")
            self.ln(10)
            self.set_text_color(0, 0, 0)

    def footer(self):
        self.set_y(-15)
        self.set_font("Arial", "I", 8)
        self.set_text_color(150, 150, 150)
        self.cell(0, 10, f"Page {self.page_no()}", align="C")
        self.set_text_color(0, 0, 0)


FONT_DIR = "C:/Windows/Fonts"


def convert(docx_path: str, pdf_path: str) -> None:
    doc = Document(docx_path)
    pdf = HandbookPDF()
    pdf.add_font("Arial", "", f"{FONT_DIR}/arial.ttf")
    pdf.add_font("Arial", "B", f"{FONT_DIR}/arialbd.ttf")
    pdf.add_font("Arial", "I", f"{FONT_DIR}/ariali.ttf")
    pdf.add_font("Arial", "BI", f"{FONT_DIR}/arialbi.ttf")
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()
    lm = pdf.l_margin

    for para in doc.paragraphs:
        text = para.text.strip()
        if not text:
            pdf.ln(3)
            continue

        style_name = para.style.name if para.style else "Normal"
        pdf.set_x(lm)

        if style_name == "Title" or style_name == "Part Title":
            pdf.ln(6)
            pdf.set_font("Arial", "B", 18)
            pdf.set_text_color(15, 50, 100)
            pdf.multi_cell(0, 9, text)
            pdf.set_text_color(0, 0, 0)
            pdf.ln(3)
        elif style_name == "Part Subtitle":
            pdf.set_font("Arial", "I", 12)
            pdf.set_text_color(60, 90, 140)
            pdf.multi_cell(0, 6, text)
            pdf.set_text_color(0, 0, 0)
            pdf.ln(2)
        elif style_name == "Part Number":
            pdf.ln(4)
            pdf.set_font("Arial", "B", 14)
            pdf.set_text_color(100, 130, 180)
            pdf.multi_cell(0, 7, text)
            pdf.set_text_color(0, 0, 0)
        elif style_name == "Edition Label":
            pdf.set_font("Arial", "B", 9)
            pdf.set_text_color(120, 120, 120)
            pdf.multi_cell(0, 5, text)
            pdf.set_text_color(0, 0, 0)
        elif style_name.startswith("Heading 1"):
            pdf.ln(4)
            pdf.set_font("Arial", "B", 15)
            pdf.set_text_color(20, 60, 120)
            pdf.multi_cell(0, 7, text)
            pdf.set_text_color(0, 0, 0)
            pdf.ln(2)
        elif style_name.startswith("Heading 2"):
            pdf.ln(3)
            pdf.set_font("Arial", "B", 12)
            pdf.set_text_color(30, 80, 150)
            pdf.multi_cell(0, 6, text)
            pdf.set_text_color(0, 0, 0)
            pdf.ln(1)
        elif style_name.startswith("Heading 3"):
            pdf.ln(2)
            pdf.set_font("Arial", "B", 11)
            pdf.set_text_color(50, 100, 170)
            pdf.multi_cell(0, 6, text)
            pdf.set_text_color(0, 0, 0)
        elif style_name.startswith("Heading 4") or style_name.startswith("Heading 5"):
            pdf.ln(2)
            pdf.set_font("Arial", "B", 10)
            pdf.multi_cell(0, 5, text)
        elif style_name.startswith("List Bullet"):
            pdf.set_font("Arial", "", 10)
            pdf.set_x(lm + 5)
            pdf.multi_cell(0, 5, f"-  {text}")
        elif style_name.startswith("List Number"):
            pdf.set_font("Arial", "", 10)
            pdf.set_x(lm + 5)
            pdf.multi_cell(0, 5, f"   {text}")
        elif style_name in ("Intense Quote", "Quote"):
            pdf.ln(2)
            pdf.set_font("Arial", "I", 10)
            pdf.set_text_color(80, 80, 80)
            pdf.set_x(lm + 5)
            pdf.multi_cell(0, 5, f'"{text}"')
            pdf.set_text_color(0, 0, 0)
            pdf.ln(2)
        else:
            runs_bold = any(r.bold for r in para.runs if r.text.strip())
            runs_italic = any(r.italic for r in para.runs if r.text.strip())
            style = ""
            if runs_bold and runs_italic:
                style = "BI"
            elif runs_bold:
                style = "B"
            elif runs_italic:
                style = "I"
            pdf.set_font("Arial", style, 10)
            pdf.multi_cell(0, 5, text)

    for table in doc.tables:
        pdf.ln(4)
        pdf.set_x(lm)
        col_count = len(table.columns)
        if col_count == 0:
            continue
        col_w = pdf.epw / col_count

        for row_idx, row in enumerate(table.rows):
            row_height = 5
            cell_texts = []
            for cell in row.cells:
                cell_texts.append(cell.text.strip().replace("\n", " "))

            for ci, cell_text in enumerate(cell_texts):
                if row_idx == 0:
                    pdf.set_font("Arial", "B", 9)
                    pdf.set_fill_color(220, 230, 240)
                    pdf.multi_cell(col_w, row_height, cell_text, border=1, fill=True)
                else:
                    pdf.set_font("Arial", "", 9)
                    pdf.multi_cell(col_w, row_height, cell_text, border=1)
            pdf.ln(0)
            pdf.set_x(lm)
        pdf.ln(3)
        pdf.set_x(lm)

    pdf.output(pdf_path)
    size_kb = Path(pdf_path).stat().st_size / 1024
    print(f"PDF generated: {pdf_path} ({size_kb:.0f} KB, {pdf.page_no()} pages)")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python docx_to_pdf.py <input.docx> <output.pdf>")
        sys.exit(1)
    convert(sys.argv[1], sys.argv[2])