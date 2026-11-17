// Unit tests for the SequenceBuilder's pure helpers: payload building,
// draft serialization and A/B weight redistribution (§9-§10, §42).
import { describe, it, expect } from "vitest";
import { buildSequencePayload, serialize, redistribute, newStepDraft, newVariantDraft } from "./SequenceBuilder";
import type { StepDraft } from "@/types/sequence";

describe("buildSequencePayload (§42)", () => {
  it("names unnamed steps by position and zeroes the first step's delay", () => {
    const steps: StepDraft[] = [
      { ...newStepDraft(), name: "", subjectTemplate: "Hello", bodyTemplate: "<p>Hi</p>", delayDays: 5, delayHours: 3, delayMinutes: 30 },
      { ...newStepDraft(), name: "Follow-up", subjectTemplate: "", bodyTemplate: "<p>Again</p>", delayDays: 2, delayHours: 0, delayMinutes: 0 },
    ];
    const payload = buildSequencePayload(steps);
    expect(payload).toHaveLength(2);
    expect(payload[0].name).toBe("Email 1");
    expect(payload[0].delayDays).toBe(0);
    expect(payload[0].delayHours).toBe(0);
    expect(payload[0].delayMinutes).toBe(0);
    expect(payload[1].name).toBe("Follow-up");
    expect(payload[1].delayDays).toBe(2);
  });

  it("maps variants through unchanged (§9)", () => {
    const s = newStepDraft();
    const v = { ...newVariantDraft({ variantName: "Variant A", weight: 100, subject: "A", bodyHtml: "<p>A</p>" }) };
    s.variants = [v];
    const payload = buildSequencePayload([s]);
    expect(payload[0].variants).toEqual([
      { variantName: "Variant A", subject: "A", bodyHtml: "<p>A</p>", bodyText: "", weight: 100 },
    ]);
  });

  it("omits the variants key when a step has none", () => {
    const payload = buildSequencePayload([{ ...newStepDraft(), subjectTemplate: "s" }]);
    expect(payload[0].variants).toBeUndefined();
  });
});

describe("serialize", () => {
  it("is stable for identical drafts and distinguishes changed ones", () => {
    const a = newStepDraft();
    const b = { ...newStepDraft(), subjectTemplate: "changed" };
    expect(serialize([a])).toBe(serialize([a]));
    expect(serialize([a])).not.toBe(serialize([b]));
  });
});

describe("redistribute (§10 — distribution must total exactly 100)", () => {
  it("splits evenly and forces the remainder onto the last variant", () => {
    const variants = [newVariantDraft(), newVariantDraft(), newVariantDraft()];
    const out = redistribute(variants);
    expect(out.map((v) => v.weight)).toEqual([33, 33, 34]);
  });

  it("single variant gets 100", () => {
    expect(redistribute([newVariantDraft()])[0].weight).toBe(100);
  });

  it("two variants get 50/50", () => {
    expect(redistribute([newVariantDraft(), newVariantDraft()]).map((v) => v.weight)).toEqual([50, 50]);
  });
});
