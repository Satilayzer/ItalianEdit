import { describe, it, expect } from "vitest";
import {
  registrableDomain,
  isBlockedDomain,
  hostMatchesDomain,
  pickOfficialDomain,
  discoverOfficialDomain,
} from "../src/search/discoverDomain";
import type { SearchHit } from "../src/types";

const hit = (link: string): SearchHit => ({ title: "", link });

describe("registrableDomain", () => {
  it("срезает www и поддомены", () => {
    expect(registrableDomain("www.gucci.com")).toBe("gucci.com");
    expect(registrableDomain("store.prada.com")).toBe("prada.com");
  });
  it("учитывает двухуровневые TLD", () => {
    expect(registrableDomain("www.burberry.co.uk")).toBe("burberry.co.uk");
  });
});

describe("hostMatchesDomain", () => {
  it("домен и поддомены — да", () => {
    expect(hostMatchesDomain("gucci.com", "gucci.com")).toBe(true);
    expect(hostMatchesDomain("www.gucci.com", "gucci.com")).toBe(true);
  });
  it("похожий чужой домен — нет", () => {
    expect(hostMatchesDomain("notgucci.com", "gucci.com")).toBe(false);
  });
});

describe("isBlockedDomain", () => {
  it("маркетплейсы и соцсети заблокированы", () => {
    expect(isBlockedDomain("farfetch.com")).toBe(true);
    expect(isBlockedDomain("instagram.com")).toBe(true);
    expect(isBlockedDomain("gucci.com")).toBe(false);
  });
});

describe("pickOfficialDomain", () => {
  it("отбрасывает маркетплейсы, берёт домен с именем бренда", () => {
    const domain = pickOfficialDomain("The Attico", [
      hit("https://www.farfetch.com/designers/the-attico"),
      hit("https://www.theattico.com/"),
      hit("https://www.ssense.com/en-us/women/designers/the-attico"),
    ]);
    expect(domain).toBe("theattico.com");
  });

  it("имя бренда с дефисами в домене (Off-White)", () => {
    const domain = pickOfficialDomain("Off-White", [
      hit("https://www.off---white.com/en-us"),
    ]);
    // «off---white» после очистки не содержит «offwhite» дословно? содержит: off---white → offwhite
    expect(domain).toBe("off---white.com");
  });

  it("без совпадения имени — самый частый в выдаче", () => {
    const domain = pickOfficialDomain("Saint Laurent", [
      hit("https://www.ysl.com/en-en"),
      hit("https://en.wikipedia.org/wiki/Yves_Saint_Laurent"),
      hit("https://www.ysl.com/en-en/shop"),
      hit("https://random-blog.com/ysl-history"),
    ]);
    expect(domain).toBe("ysl.com");
  });

  it("только маркетплейсы в выдаче → undefined", () => {
    const domain = pickOfficialDomain("Gucci", [
      hit("https://www.farfetch.com/x"),
      hit("https://www.ebay.com/y"),
    ]);
    expect(domain).toBeUndefined();
  });
});

describe("discoverOfficialDomain", () => {
  it("ищет по «official website» и кэширует результат", async () => {
    let calls = 0;
    const search = async () => {
      calls++;
      return [hit("https://www.jacquemus.com/")];
    };
    const d1 = await discoverOfficialDomain("Jacquemus-Test-Cache", search);
    const d2 = await discoverOfficialDomain("Jacquemus-Test-Cache", search);
    expect(d1).toBe("jacquemus.com");
    expect(d2).toBe("jacquemus.com");
    expect(calls).toBe(1);
  });
});
