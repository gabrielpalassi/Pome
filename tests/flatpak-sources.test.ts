import { describe, expect, test } from "bun:test";
import { generateSources } from "../scripts/flatpak-sources.ts";

const integrity = `sha512-${new Uint8Array(64).fill(1).toBase64()}`;

describe("Flatpak offline sources", () => {
  test("declares verified registry archives in Bun's cache, including scoped and nested packages", () => {
    const sources = generateSources({
      lockfileVersion: 3,
      packages: {
        "@scope/example": ["@scope/example@1.2.3", "", {}, integrity],
        "parent/child": ["child@2.0.0", "", {}, integrity],
        "other/child": ["child@2.0.0", "", {}, integrity],
      },
    });
    expect(sources).toEqual([
      {
        type: "archive",
        url: "https://registry.npmjs.org/@scope/example/-/example-1.2.3.tgz",
        sha512: "01".repeat(64),
        dest: "flatpak-bun/cache/@scope/example@1.2.3@@@1",
      },
      {
        type: "archive",
        url: "https://registry.npmjs.org/child/-/child-2.0.0.tgz",
        sha512: "01".repeat(64),
        dest: "flatpak-bun/cache/child@2.0.0@@@1",
      },
    ]);
  });

  test("rejects changed lockfile formats and dependencies it cannot reproduce offline", () => {
    expect(() => generateSources({ lockfileVersion: 4, packages: {} })).toThrow("lockfile version");
    for (const [specifier, registry, checksum] of [
      ["example@git:abc", "", integrity],
      ["example@1.0.0-beta.1", "", integrity],
      ["example@1.0.0", "https://custom.example/", integrity],
      ["example@1.0.0", "", ""],
      ["example@1.0.0", "", "sha512-YWJj"],
    ]) {
      expect(() =>
        generateSources({ lockfileVersion: 3, packages: { example: [specifier, registry, {}, checksum] } }),
      ).toThrow();
    }
  });
});
