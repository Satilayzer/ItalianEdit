import { describe, it, expect, vi } from "vitest";
import {
  parseBgDescription,
  buildDescriptionHtml,
  buildProse,
  isRewrittenDescription,
  stripLatinSpecies,
  htmlToText,
} from "../src/shopify/description";
import { buildUpdate, rewriteDescriptions } from "../src/shopify/rewriteDescriptions";
import { brandBlurb } from "../src/shopify/brandBlurbs";
import { ShopifyClient } from "../src/shopify/client";

// Реальные описания из каталога — копии, а не выдуманные образцы.
const SANDALS = `<p>Description:<br>
The product with MPN <b>5XX5783LLU085F0613</b> and code <b>F76693</b> <b>plexiglass</b> in <b>green</b> is a <b>sandals</b> designed by <b>Miu Miu</b>.</p>
<p>Additional Info:<br>
Style: Casual<br>
Materials: Leather<br>
Shoe sole: Leather<br>
Heel height: 8.5 cm<br>
Shoe tip: Open toe<br>
Heel type: Mid heels<br>
MPN: 5XX5783LLU085F0613<br>
New collection: No</p>`;

const FUR_BAG = `<p>Description:<br>
The product with MPN <b>5TY021MONTONEMUGHETTO</b> and code <b>F39896</b> <b>fur </b> in <b>pink</b> is a <b>shoulder straps</b> designed by <b>Miu Miu</b>. It has features like <b>vintage effect</b>.</p>
<p>Additional Info:<br>
Color details: Silver<br>
Closing type: Hook Closure<br>
Materials: Leather<br>
Measurements: 4×95 cm<br>
MPN: 5TY021MONTONEMUGHETTO<br>
New collection: No</p>`;

// Второй формат фида — плоская строка через тире.
const DASH_FORMAT = `<p>Description:<br>
– Composition: 100% calf leather – Inner: Leather – Insole: Leather – Sole: Leather – Open toe – Square toe – Heel 10 cm – Lace-up fastening – Made in Italy – Gender: WOMEN –</p>`;

// Третий формат фида: авторский текст бренда + хвост характеристик.
const EDITORIAL = `<p>The washed denim five-pocket Jeans by Miu Miu are a vintage-inspired yet contemporary design, defined by a relaxed wide fit and low-rise waist.</p>
<p>Season: AW26<br>
Fit: Regular<br>
Composition: 100% Calf Leather Bos Taurus</p>`;

// Тот же формат, но прозы нет вовсе — только выкрик и характеристики.
const NO_PROSE = `<p>HANDBAG</p>
<p>Season: AW26<br>
Composition: 100% Calf Leather Bos Taurus</p>`;

// Четвёртый вид: всё в одном абзаце, <br> с атрибутами, хвост без двоеточий.
const INLINE_BR = `<p data-start="0" data-end="11"><strong>MIU MIU</strong></p>
<p>Gorgeous brand new, 100% Authentic MIU MIU belt is crafted from high quality materials, this stylish belt featuring buckle fastening.<br data-start="146" data-end="149">Model: Fashion Belt<br data-start="168">Material: PVC<br data-start="208">Color: Orange<br data-start="224">Logo details<br data-start="239">Made in Italy</p>`;

// Товар бота: настоящий текст бренда, трогать нельзя.
const BOT_DESCRIPTION = `<p>The world of Ophidia continues to evolve, incorporating new shapes and materials each season.</p><h4>Product Details</h4><ul>
<li>Beige and ebony GG Supreme canvas</li>
<li>Made in Italy</li>
</ul>`;

describe("htmlToText / stripLatinSpecies", () => {
  it("<br> и </p> становятся переносами, теги уходят", () => {
    expect(htmlToText("<p>a<br>b</p><p>c</p>")).toBe("a\nb\nc");
  });

  it("латинские названия сырья вычищаются", () => {
    expect(stripLatinSpecies("Calf Leather Bos Taurus")).toBe("Calf Leather");
    expect(stripLatinSpecies("Lamb Ovis Aries lining")).toBe("Lamb lining");
  });
});

describe("parseBgDescription — формат «Description / Additional Info»", () => {
  it("вытаскивает факты из шаблонной фразы", () => {
    const facts = parseBgDescription(SANDALS)!;
    expect(facts.material).toBe("plexiglass");
    expect(facts.color).toBe("green");
    expect(facts.kind).toBe("sandals");
    expect(facts.brand).toBe("Miu Miu");
    expect(facts.mpn).toBe("5XX5783LLU085F0613");
  });

  it("служебные строки выбрасываются, а не показываются покупателю", () => {
    const facts = parseBgDescription(SANDALS)!;
    const all = [...facts.details, ...facts.fit].map((i) => `${i.label}: ${i.value}`);
    expect(all.some((s) => /MPN/i.test(s))).toBe(false);
    expect(all.some((s) => /New collection/i.test(s))).toBe(false);
  });

  it("размерные характеристики уходят в Size & Fit, остальные — в Details", () => {
    const facts = parseBgDescription(SANDALS)!;
    expect(facts.fit.map((i) => i.label)).toEqual(["Heel height", "Heel type"]);
    expect(facts.details.map((i) => i.label)).toEqual([
      "Style",
      "Materials",
      "Shoe sole",
      "Shoe tip",
    ]);
  });

  it("features разбираются в список", () => {
    const facts = parseBgDescription(FUR_BAG)!;
    expect(facts.features).toEqual(["vintage effect"]);
    expect(facts.fit.map((i) => i.label)).toEqual(["Measurements"]);
  });
});

describe("parseBgDescription — формат через тире", () => {
  it("разбирает плоскую строку и чистит края", () => {
    const facts = parseBgDescription(DASH_FORMAT)!;
    const values = facts.details.map((i) => (i.label ? `${i.label}: ${i.value}` : i.value));
    expect(values).toContain("Composition: 100% calf leather");
    expect(values).toContain("Open toe");
    expect(values).toContain("Lace-up fastening");
    // край строки не должен утащить тире в буллет
    expect(values.some((v) => v.startsWith("–"))).toBe(false);
  });

  it("Made in Italy становится отдельным фактом, Gender выбрасывается", () => {
    const facts = parseBgDescription(DASH_FORMAT)!;
    expect(facts.madeIn).toBe("Italy");
    const values = facts.details.map((i) => i.label ?? "");
    expect(values).not.toContain("Gender");
  });

  it("высота каблука уходит в Size & Fit", () => {
    const facts = parseBgDescription(DASH_FORMAT)!;
    expect(facts.fit.map((i) => i.value)).toContain("Heel 10 cm");
  });

  it("Composition служит материалом, раз шаблонной фразы нет", () => {
    expect(parseBgDescription(DASH_FORMAT)!.material).toBe("100% calf leather");
  });
});

describe("parseBgDescription — авторский текст + характеристики", () => {
  it("прозу поставщика сохраняем дословно, а не подменяем шаблоном", () => {
    const facts = parseBgDescription(EDITORIAL)!;
    expect(facts.prose).toContain("The washed denim five-pocket Jeans by Miu Miu");
    expect(buildProse(facts, { title: "Blue Cotton Relaxed Fit Jeans" })).toBe(facts.prose);
  });

  it("латинские названия сырья вычищаются и из прозы, и из характеристик", () => {
    const facts = parseBgDescription(EDITORIAL)!;
    const values = facts.details.map((i) => `${i.label}: ${i.value}`);
    expect(values).toContain("Composition: 100% Calf Leather");
    expect(values.some((v) => /Bos Taurus/.test(v))).toBe(false);
  });

  it("Fit уходит в Size & Fit, Season остаётся в Details", () => {
    const facts = parseBgDescription(EDITORIAL)!;
    expect(facts.fit.map((i) => i.label)).toEqual(["Fit"]);
    expect(facts.details.map((i) => i.label)).toEqual(["Season", "Composition"]);
  });

  it("описание без прозы разбирается, абзац собирает шаблон", () => {
    const facts = parseBgDescription(NO_PROSE)!;
    // «HANDBAG» — заголовок капсом, в текст его тащить незачем
    expect(facts.prose).toBeUndefined();
    expect(facts.details.map((i) => i.label)).toEqual(["Season", "Composition"]);
    expect(
      buildProse(facts, { title: "Black Calf Leather Handbag", vendor: "Miu Miu" })
    ).toBe("Black Calf Leather Handbag by Miu Miu.");
  });
});

describe("parseBgDescription — всё в одном абзаце", () => {
  it("<br> с атрибутами тоже даёт перенос строки", () => {
    expect(htmlToText('a<br data-start="1">b')).toBe("a\nb");
  });

  it("хвост распознаётся, даже если часть фактов без двоеточия", () => {
    const facts = parseBgDescription(INLINE_BR)!;
    expect(facts.prose).toContain("Gorgeous brand new");
    expect(facts.prose).not.toContain("MIU MIU belt is crafted from high quality materials.Model");
    expect(facts.madeIn).toBe("Italy");
    const values = facts.details.map((i) => (i.label ? `${i.label}: ${i.value}` : i.value));
    expect(values).toContain("Material: PVC");
    expect(values).toContain("Logo details");
  });
});

describe("parseBgDescription — чужие описания", () => {
  it("текст бренда у товара бота не распознаётся как BG", () => {
    expect(parseBgDescription(BOT_DESCRIPTION)).toBeNull();
  });

  it("пустое описание → null", () => {
    expect(parseBgDescription("")).toBeNull();
    expect(parseBgDescription("<p></p>")).toBeNull();
  });
});

describe("buildProse", () => {
  it("собирает фразу из фактов, без оценочных слов", () => {
    const facts = parseBgDescription(SANDALS)!;
    expect(buildProse(facts, { title: "Green Plexiglass Platform Sandals" })).toBe(
      "Sandals by Miu Miu."
    );
  });

  it("цвет и материал не повторяются, если уже есть в названии", () => {
    const facts = parseBgDescription(SANDALS)!;
    const prose = buildProse(facts, { title: "Green Plexiglass Platform Sandals" });
    expect(prose).not.toMatch(/crafted in/);
  });

  it("цвет и материал добавляются, если в названии их нет", () => {
    const facts = parseBgDescription(SANDALS)!;
    expect(buildProse(facts, { title: "Platform Sandals" })).toBe(
      "Sandals by Miu Miu, crafted in green and plexiglass."
    );
  });

  it("features и страна попадают отдельными предложениями", () => {
    const facts = parseBgDescription(FUR_BAG)!;
    expect(buildProse(facts, { title: "Pink Fur Shoulder Bag" })).toBe(
      "Shoulder straps by Miu Miu. Finished with vintage effect."
    );
  });

  it("формат без бренда берёт vendor и не дублирует его из названия", () => {
    const facts = parseBgDescription(DASH_FORMAT)!;
    expect(buildProse(facts, { title: "Black Calfskin Mules", vendor: "Miu Miu" })).toBe(
      "Black Calfskin Mules by Miu Miu, crafted in 100% calf leather. Made in Italy."
    );
  });
});

describe("buildDescriptionHtml", () => {
  it("собирает структуру и метку, Style Code берёт из MPN", () => {
    const facts = parseBgDescription(SANDALS)!;
    const html = buildDescriptionHtml(facts, {
      title: "Green Plexiglass Platform Sandals",
      vendor: "Miu Miu",
    });
    expect(html).toContain('<div class="ie-description">');
    expect(html).toContain("<h4>Details</h4>");
    expect(html).toContain("<h4>Size &amp; Fit</h4>");
    expect(html).toContain("<h4>About the Brand</h4>");
    expect(html).toContain("Style Code: 5XX5783LLU085F0613");
    expect(html).not.toMatch(/New collection/);
    expect(isRewrittenDescription(html)).toBe(true);
  });

  it("незнакомый бренд → блока About the Brand просто нет", () => {
    const facts = parseBgDescription(SANDALS)!;
    const html = buildDescriptionHtml(facts, { title: "X", vendor: "Unknown Maison" });
    expect(brandBlurb("Unknown Maison")).toBeUndefined();
    expect(html).not.toContain("About the Brand");
  });

  it("пустых заголовков не бывает: нет Size & Fit — нет и блока", () => {
    const facts = parseBgDescription(DASH_FORMAT)!;
    facts.fit = [];
    const html = buildDescriptionHtml(facts, { title: "X" });
    expect(html).not.toContain("Size &amp; Fit");
  });
});

describe("buildUpdate", () => {
  it("кладёт оригинал в метаполе вместе с новым описанием", () => {
    const update = buildUpdate({
      id: "gid://shopify/Product/1",
      title: "Green Plexiglass Platform Sandals",
      vendor: "Miu Miu",
      descriptionHtml: SANDALS,
    })!;
    expect(update.id).toBe("gid://shopify/Product/1");
    expect(String(update.descriptionHtml)).toContain('class="ie-description"');
    expect(update.metafields).toEqual([
      {
        namespace: "italian_edit",
        key: "bg_description_raw",
        type: "multi_line_text_field",
        value: SANDALS,
      },
    ]);
  });

  it("уже нашу вёрстку второй раз не перемалывает", () => {
    const facts = parseBgDescription(SANDALS)!;
    const ours = buildDescriptionHtml(facts, { title: "X", vendor: "Miu Miu" });
    expect(
      buildUpdate({ id: "1", title: "X", vendor: "Miu Miu", descriptionHtml: ours })
    ).toBeNull();
  });

  it("чужое описание не трогает", () => {
    expect(
      buildUpdate({ id: "1", title: "X", vendor: "Gucci", descriptionHtml: BOT_DESCRIPTION })
    ).toBeNull();
  });
});

function mockClient(pages: unknown[]) {
  const fetchFn = vi.fn();
  for (const p of pages) {
    fetchFn.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: p }), { status: 200 })
    );
  }
  const client = new ShopifyClient(
    { shop: "t.myshopify.com", adminToken: "x" },
    fetchFn as unknown as typeof fetch
  );
  return { client, fetchFn };
}

describe("rewriteDescriptions", () => {
  it("переписывает BG, считает чужие и уже готовые", async () => {
    const facts = parseBgDescription(SANDALS)!;
    const ours = buildDescriptionHtml(facts, { title: "X", vendor: "Miu Miu" });

    const { client, fetchFn } = mockClient([
      {
        products: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              id: "gid://shopify/Product/1",
              title: "Green Plexiglass Platform Sandals",
              vendor: "Miu Miu",
              descriptionHtml: SANDALS,
            },
            { id: "gid://shopify/Product/2", title: "Done", vendor: "Miu Miu", descriptionHtml: ours },
            { id: "gid://shopify/Product/3", title: "Handmade", vendor: "Gucci", descriptionHtml: BOT_DESCRIPTION },
          ],
        },
      },
      { productUpdate: { userErrors: [] } },
    ]);

    const stats = await rewriteDescriptions(client);
    expect(stats.scanned).toBe(3);
    expect(stats.rewritten).toBe(1);
    expect(stats.alreadyOurs).toBe(1);
    expect(stats.foreign).toEqual(["Handmade"]);
    expect(stats.failed).toBe(0);

    // Товары бота отсекаются самим запросом к Shopify.
    const listBody = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(listBody.variables.q).toContain("-tag:'tg-bot'");
  });

  it("userErrors считаются ошибкой", async () => {
    const { client } = mockClient([
      {
        products: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              id: "gid://shopify/Product/1",
              title: "Green Plexiglass Platform Sandals",
              vendor: "Miu Miu",
              descriptionHtml: SANDALS,
            },
          ],
        },
      },
      { productUpdate: { userErrors: [{ message: "нельзя" }] } },
    ]);
    const stats = await rewriteDescriptions(client);
    expect(stats.rewritten).toBe(0);
    expect(stats.failed).toBe(1);
  });
});
