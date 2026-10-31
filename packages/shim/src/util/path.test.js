import { afterEach, describe, expect, it } from "vitest";
import { normalize, setVaultPrefix } from "./path.js";

describe("normalize with a vault prefix", () => {
  afterEach(() => setVaultPrefix(""));

  it("makes paths under the vault relative", () => {
    setVaultPrefix("/vaults/wiki");
    expect(normalize("/vaults/wiki/notes/a.md")).toBe("notes/a.md");
    expect(normalize("vaults/wiki/a.md")).toBe("a.md");
  });

  it("maps the vault itself to the root", () => {
    setVaultPrefix("/vaults/wiki");
    expect(normalize("/vaults/wiki")).toBe("");
  });

  it("leaves relative paths and similar names alone", () => {
    setVaultPrefix("/vaults/wiki");
    expect(normalize("notes/a.md")).toBe("notes/a.md");
    expect(normalize("/vaults/wiki2/a.md")).toBe("vaults/wiki2/a.md");
  });

  it("does nothing without a prefix", () => {
    expect(normalize("/vaults/wiki/a.md")).toBe("vaults/wiki/a.md");
  });
});
