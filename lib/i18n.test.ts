import { describe, expect, test } from "bun:test";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  MESSAGES,
  localeCookie,
  resolveLocale,
  translate,
} from "./i18n";

describe("locale contract", () => {
  test("accepts supported locales and falls back safely", () => {
    expect(resolveLocale("en-US")).toBe("en-US");
    expect(resolveLocale("zh-CN")).toBe("zh-CN");
    expect(resolveLocale("zh-TW")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE);
  });

  test("every typed message has both locale values", () => {
    for (const message of Object.values(MESSAGES)) {
      expect(message["en-US"].length).toBeGreaterThan(0);
      expect(message["zh-CN"].length).toBeGreaterThan(0);
    }
  });

  test("formats values and writes a path-wide same-site cookie", () => {
    expect(translate("zh-CN", "nav.agents")).toBe("Agent");
    expect(localeCookie("zh-CN")).toContain(`${LOCALE_COOKIE}=zh-CN`);
    expect(localeCookie("zh-CN")).toContain("Path=/");
    expect(localeCookie("zh-CN")).toContain("SameSite=Lax");
  });
});
