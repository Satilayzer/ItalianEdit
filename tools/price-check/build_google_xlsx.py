"""Excel «наши цены v3.0 против Google Shopping США».

Вход — CSV из `server/scripts/tdf-google-prices.ts`. Основная цифра — разница
с средней первых трёх результатов Google с брендом в названии; просто первые
три — для справки. Итоги на «Сводке» — формулами от листа «Сравнение».

    python build_google_xlsx.py tdf-google-prices.csv Italian_Edit_vs_Google.xlsx [дата]
"""
import csv
import sys
from collections import Counter

from openpyxl import Workbook
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

src, out = sys.argv[1], sys.argv[2]
date = sys.argv[3] if len(sys.argv) > 3 else ""
rows = list(csv.DictReader(open(src, encoding="utf-8-sig")))
rows.sort(key=lambda r: (r["brand"].lower(), r["title"].lower()))

F = "Arial"
base, bold = Font(name=F), Font(name=F, bold=True)
blue, green_f = Font(name=F, color="0000FF"), Font(name=F, color="008000")
grey = Font(name=F, color="666666", italic=True)
head_fill, head_font = PatternFill("solid", start_color="1F2937"), Font(name=F, bold=True, color="FFFFFF")
red_fill, green_fill = PatternFill("solid", start_color="FECACA"), PatternFill("solid", start_color="BBF7D0")


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def header(ws, row, labels, widths=None):
    for i, label in enumerate(labels, 1):
        c = ws.cell(row=row, column=i, value=label)
        c.font, c.fill = head_font, head_fill
        c.alignment = Alignment(wrap_text=True, vertical="center")
        if widths:
            ws.column_dimensions[get_column_letter(i)].width = widths[i - 1]


wb = Workbook()
s = wb.active
s.title = "Сводка"
t = wb.create_sheet("Сравнение")

# ── Лист «Сравнение» ──────────────────────────────────────────────────────
cols = [
    ("Бренд", 16), ("Модель", 44), ("Раздел", 11), ("Артикул TDF", 16),
    ("Закупка, USD", 11), ("Пошлина", 8), ("Все расходы без комиссии, USD", 12), ("Наценка", 8),
    ("Наша цена (v3.0), USD", 11),
    ("Результатов Google с брендом", 10), ("Google: средняя 3 с брендом, USD", 12), ("Мы к Google (с брендом)", 11),
    ("Google: средняя первых 3, USD", 12), ("Мы к Google (первые 3)", 11),
    ("Google 1, USD", 9), ("Google 1: магазин", 16), ("Google 1: товар", 36),
    ("Google 2, USD", 9), ("Google 2: магазин", 16), ("Google 2: товар", 36),
    ("Google 3, USD", 9), ("Google 3: магазин", 16), ("Google 3: товар", 36),
    ("Запрос в Google", 40), ("Ссылка поставщика", 30),
]
header(t, 1, [c[0] for c in cols], [c[1] for c in cols])
t.row_dimensions[1].height = 44
t.freeze_panes = "C2"
for i, r in enumerate(rows, 2):
    vals = {
        1: r["brand"], 2: r["title"], 3: r["section"], 4: r["model_code"],
        5: num(r["purchase_usd"]), 6: num(r["duty_rate"]), 7: num(r["costs_usd"]), 8: num(r["markup"]),
        9: num(r["our_price_usd"]), 10: int(r["brand_hits"] or 0), 11: num(r["google_brand_avg3_usd"]),
        13: num(r["google_avg3_usd"]),
        15: num(r["g1_usd"]), 16: r["g1_source"], 17: r["g1_title"],
        18: num(r["g2_usd"]), 19: r["g2_source"], 20: r["g2_title"],
        21: num(r["g3_usd"]), 22: r["g3_source"], 23: r["g3_title"],
        24: r["query"], 25: r["supplier_link"],
    }
    for col, v in vals.items():
        if v not in (None, ""):
            c = t.cell(row=i, column=col, value=v)
            c.font = blue if col in (5, 6, 7, 8, 9, 11, 13, 15, 18, 21) else base
    t.cell(row=i, column=12, value=f'=IF(OR(K{i}="",I{i}=""),"",I{i}/K{i}-1)').font = base
    t.cell(row=i, column=14, value=f'=IF(OR(M{i}="",I{i}=""),"",I{i}/M{i}-1)').font = base
    for col in (5, 7):
        t.cell(row=i, column=col).number_format = "$#,##0.00"
    for col in (9, 11, 13, 15, 18, 21):
        t.cell(row=i, column=col).number_format = "$#,##0"
    for col in (6, 8, 12, 14):
        t.cell(row=i, column=col).number_format = "0.0%"
last = len(rows) + 1
t.auto_filter.ref = f"A1:Y{last}"
for rng in (f"L2:L{last}", f"N2:N{last}"):
    t.conditional_formatting.add(rng, CellIsRule(operator="greaterThan", formula=["0.1"], fill=red_fill))
    t.conditional_formatting.add(rng, CellIsRule(operator="lessThan", formula=["-0.1"], fill=green_fill))
t.cell(row=last + 2, column=1, value=(
    f"Google Shopping США (Serper, gl=us), {date}. Запрос — «бренд + название». «Мы к Google» = наша цена / средняя − 1: "
    "плюс — мы дороже, минус — дешевле. Красным — дороже больше чем на 10%, зелёным — дешевле больше чем на 10%. "
    "Средняя «с брендом» — по первым трём результатам, где в названии есть бренд; это основная цифра. "
    "Google может показывать похожие, а не те же модели, и цены без доставки и пошлин."
)).font = grey

# ── Сводка ────────────────────────────────────────────────────────────────
for col, w in zip("ABCDEF", (44, 14, 14, 14, 14, 14)):
    s.column_dimensions[col].width = w
s["A1"] = "Italian Edit — цены v3.0 против Google Shopping США"
s["A1"].font = Font(name=F, bold=True, size=14)
s["A2"] = (f"{date}. Наша цена = все расходы × (1 + наценка): закупка + доставка $20 + сбор DHL $17,5 + пошлина по HS-коду "
           "(ЕС — не ниже 15%) + комиссия 2,7% + $0,30; наценка 10% при закупке до $300, дальше 15%.")
s["A2"].font = grey
s["A2"].alignment = Alignment(wrap_text=True)
s.merge_cells("A2:F2")
s.row_dimensions[2].height = 32

L, K, I, C, A = (f"'Сравнение'!{c}2:{c}{last}" for c in "LKICA")
header(s, 4, ["Показатель (основная цифра — Google с брендом)", "Значение"])
summary = [
    ("Моделей в сравнении", f"=COUNTA({A})", "0"),
    ("…нашлась цена Google с брендом", f"=COUNT({K})", "0"),
    ("Медиана: мы к Google", f"=MEDIAN({L})", "+0.0%;-0.0%"),
    ("Среднее: мы к Google", f"=AVERAGE({L})", "+0.0%;-0.0%"),
    ("Мы дешевле Google", f'=COUNTIF({L},"<0")', "0"),
    ("…дешевле больше чем на 10%", f'=COUNTIF({L},"<-0.1")', "0"),
    ("В пределах ±10%", f'=COUNTIFS({L},">=-0.1",{L},"<=0.1")', "0"),
    ("Мы дороже больше чем на 10%", f'=COUNTIF({L},">0.1")', "0"),
    ("…дороже больше чем на 25%", f'=COUNTIF({L},">0.25")', "0"),
    ("Справочно: медиана к первым трём без фильтра", f"=MEDIAN('Сравнение'!N2:N{last})", "+0.0%;-0.0%"),
]
for i, (k, f, fmt) in enumerate(summary, 5):
    s.cell(row=i, column=1, value=k).font = base
    c = s.cell(row=i, column=2, value=f)
    c.font, c.number_format, c.alignment = green_f, fmt, Alignment(horizontal="left")

r0 = 5 + len(summary) + 1
s.cell(row=r0, column=1, value="По разделам").font = bold
header(s, r0 + 1, ["Раздел", "Моделей", "С ценой Google", "Мы к Google, в среднем", "Дешевле", "Дороже >10%"])
sections = ["Clothing", "Shoes", "Bags", "Accessories"]
for j, sec in enumerate(sections, r0 + 2):
    s.cell(row=j, column=1, value=sec).font = base
    s.cell(row=j, column=2, value=f'=COUNTIF({C},A{j})').font = green_f
    s.cell(row=j, column=3, value=f'=COUNTIFS({C},A{j},{K},">0")').font = green_f
    c = s.cell(row=j, column=4, value=f'=IFERROR(AVERAGEIFS({L},{C},A{j}),"")')
    c.font, c.number_format = green_f, "+0.0%;-0.0%"
    s.cell(row=j, column=5, value=f'=COUNTIFS({C},A{j},{L},"<0")').font = green_f
    s.cell(row=j, column=6, value=f'=COUNTIFS({C},A{j},{L},">0.1")').font = green_f

r1 = r0 + 2 + len(sections) + 1
s.cell(row=r1, column=1, value="По брендам (от 15 моделей с ценой Google)").font = bold
header(s, r1 + 1, ["Бренд", "Моделей", "С ценой Google", "Мы к Google, в среднем", "Дешевле", "Дороже >10%"])
counts = Counter(r["brand"] for r in rows if num(r["google_brand_avg3_usd"]))
brands = sorted([b for b, n in counts.items() if n >= 15], key=lambda b: -counts[b])
for j, b in enumerate(brands, r1 + 2):
    s.cell(row=j, column=1, value=b).font = base
    s.cell(row=j, column=2, value=f'=COUNTIF({A},A{j})').font = green_f
    s.cell(row=j, column=3, value=f'=COUNTIFS({A},A{j},{K},">0")').font = green_f
    c = s.cell(row=j, column=4, value=f'=IFERROR(AVERAGEIFS({L},{A},A{j}),"")')
    c.font, c.number_format = green_f, "+0.0%;-0.0%"
    s.cell(row=j, column=5, value=f'=COUNTIFS({A},A{j},{L},"<0")').font = green_f
    s.cell(row=j, column=6, value=f'=COUNTIFS({A},A{j},{L},">0.1")').font = green_f
for j in range(r1 + 2, r1 + 2 + len(brands)):
    s.conditional_formatting.add(f"D{j}", CellIsRule(operator="greaterThan", formula=["0.1"], fill=red_fill))
    s.conditional_formatting.add(f"D{j}", CellIsRule(operator="lessThan", formula=["-0.1"], fill=green_fill))

# ── По ступеням наценки ──────────────────────────────────────────────────
# Ступени — из MARKUP_BANDS (server/src/tdf/pricing.ts); синие ячейки можно править для подписи.
BANDS = [(0, 300, 0.10), (300, 800, 0.15), (800, 1200, 0.20), (1200, 1_000_000, 0.25)]
m = wb.create_sheet("По наценке", 1)
m["A1"] = "Наши цены v3.0 против Google по ступеням наценки (закупка, USD)"
m["A1"].font = Font(name=F, bold=True, size=14)
m["A2"] = ("«Мы к Google» = наша цена / средняя первых трёх − 1: минус — мы дешевле. "
           "Основная цифра — Google с брендом в названии; без фильтра — для справки.")
m["A2"].font = grey
m["A2"].alignment = Alignment(wrap_text=True)
m.merge_cells("A2:J2")
m.row_dimensions[2].height = 30
header(m, 4, ["Закупка от, USD", "Закупка до, USD", "Наценка на все расходы", "Моделей", "Наша цена, в среднем",
              "Google с брендом, в среднем", "Мы к Google (с брендом), в среднем", "Дешевле Google", "Дороже >10%",
              "Мы к Google (первые 3 без фильтра), в среднем"], [11, 11, 11, 9, 12, 12, 14, 10, 10, 16])
m.row_dimensions[4].height = 58
E_, N_ = (f"'Сравнение'!${c}$2:${c}${last}" for c in "EN")
Ia, Ka, La = (f"'Сравнение'!${c}$2:${c}${last}" for c in "IKL")
for r, (lo, hi, mk) in enumerate(BANDS, 5):
    for col, v, fmt in ((1, lo, "$#,##0"), (2, hi, "$#,##0"), (3, mk, "0%")):
        c = m.cell(row=r, column=col, value=v)
        c.font, c.number_format = blue, fmt
    cond = f'{E_},">="&A{r},{E_},"<"&B{r}'
    for col, (fm, fmt) in {
        4: (f"=COUNTIFS({cond})", "0"),
        5: (f'=IFERROR(AVERAGEIFS({Ia},{cond}),"")', "$#,##0"),
        6: (f'=IFERROR(AVERAGEIFS({Ka},{cond}),"")', "$#,##0"),
        7: (f'=IFERROR(AVERAGEIFS({La},{cond}),"")', "+0.0%;-0.0%"),
        8: (f'=COUNTIFS({cond},{La},"<0")', "0"),
        9: (f'=COUNTIFS({cond},{La},">0.1")', "0"),
        10: (f'=IFERROR(AVERAGEIFS({N_},{cond}),"")', "+0.0%;-0.0%"),
    }.items():
        c = m.cell(row=r, column=col, value=fm)
        c.font, c.number_format = green_f, fmt
tot = 5 + len(BANDS)
m.cell(row=tot, column=1, value="Итого").font = bold
for col, (fm, fmt) in {4: (f"=SUM(D5:D{tot - 1})", "0"), 7: (f"=AVERAGE({La})", "+0.0%;-0.0%"),
                       8: (f"=SUM(H5:H{tot - 1})", "0"), 9: (f"=SUM(I5:I{tot - 1})", "0"),
                       10: (f"=AVERAGE({N_})", "+0.0%;-0.0%")}.items():
    c = m.cell(row=tot, column=col, value=fm)
    c.font, c.number_format = green_f, fmt
m.conditional_formatting.add(f"G5:G{tot}", CellIsRule(operator="greaterThan", formula=["0"], fill=red_fill))
m.conditional_formatting.add(f"G5:G{tot}", CellIsRule(operator="lessThan", formula=["0"], fill=green_fill))

wb.calculation.fullCalcOnLoad = True
wb.save(out)
print(f"{len(rows)} строк, брендов в сводке {len(brands)} → {out}")
