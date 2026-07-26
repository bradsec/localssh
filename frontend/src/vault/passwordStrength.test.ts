import { describe, expect, it } from "vitest";
import { rateMasterPassword } from "./passwordStrength.js";

describe("rateMasterPassword", () => {
  it("rates an empty password as weak with no bits", () => {
    const rated = rateMasterPassword("");
    expect(rated.band).toBe("weak");
    expect(rated.bits).toBe(0);
  });

  // NIST SP 800-63B: length dominates. A long lowercase passphrase must beat a
  // short password that ticks every character class.
  it("rates a long passphrase above a short mixed-class password", () => {
    const passphrase = rateMasterPassword("correct horse battery staple");
    const gauntlet = rateMasterPassword("P@ss1!");

    expect(passphrase.bits).toBeGreaterThan(gauntlet.bits);
    expect(passphrase.band).toBe("strong");
  });

  it("bands by estimated entropy", () => {
    expect(rateMasterPassword("short").band).toBe("weak");
    expect(rateMasterPassword("brambleTHICKET").band).toBe("fair");
    expect(rateMasterPassword("brambleTHICKET42").band).toBe("good");
    expect(rateMasterPassword("bramble thicket lantern quarry").band).toBe("strong");
  });

  it("clamps a known common password to weak however long it looks", () => {
    for (const common of ["password", "qwerty123", "letmein", "iloveyou"]) {
      expect(rateMasterPassword(common).band).toBe("weak");
    }
  });

  it("ignores case and padding when matching common passwords", () => {
    expect(rateMasterPassword("P@ssw0rd").band).toBe("weak");
    expect(rateMasterPassword("Password1").band).toBe("weak");
  });

  it("penalises keyboard and digit runs", () => {
    const run = rateMasterPassword("qwertyuiopasdfgh");
    const varied = rateMasterPassword("bramblethicketxz");

    expect(run.bits).toBeLessThan(varied.bits);
  });

  it("penalises a single repeated character", () => {
    expect(rateMasterPassword("aaaaaaaaaaaaaaaaaaaa").band).toBe("weak");
  });

  it("counts a larger character set as more entropy at equal length", () => {
    const lower = rateMasterPassword("brambleth");
    const mixed = rateMasterPassword("brambleTh");

    expect(mixed.bits).toBeGreaterThan(lower.bits);
  });

  it("advises on length rather than on symbols", () => {
    expect(rateMasterPassword("short").advice).toMatch(/longer|length/i);
  });

  it("always returns a band and never throws on odd input", () => {
    for (const odd of ["   ", "\u{1F510}\u{1F510}\u{1F510}", "\n\t", "a".repeat(500)]) {
      expect(() => rateMasterPassword(odd)).not.toThrow();
      expect(["weak", "fair", "good", "strong"]).toContain(rateMasterPassword(odd).band);
    }
  });
});
