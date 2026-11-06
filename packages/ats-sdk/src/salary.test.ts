import { describe, expect, it } from "vitest";
import {
  chooseSalaryOption,
  isAnnualDollarText,
  parseSalaryBounds,
  salaryAnswer,
  salaryMeetsPosted,
} from "./salary.js";

describe("parseSalaryBounds", () => {
  it.each([
    ["$100,000 - $150,000", { low: 100_000, high: 150_000 }],
    ["$100,000-$150,000", { low: 100_000, high: 150_000 }],
    ["$100,000 – $150,000", { low: 100_000, high: 150_000 }],
    ["100,000 to 150,000", { low: 100_000, high: 150_000 }],
    ["between $100,000 and $150,000", { low: 100_000, high: 150_000 }],
    ["USD 90,000 - 110,000", { low: 90_000, high: 110_000 }],
    ["$50k-$75k", { low: 50_000, high: 75_000 }],
    ["$50K–$75K", { low: 50_000, high: 75_000 }],
    ["50-75k", { low: 50_000, high: 75_000 }],
    ["$50-75k", { low: 50_000, high: 75_000 }],
    ["100 - 150", { low: 100_000, high: 150_000 }],
    ["$1.2m - $1.5m", { low: 1_200_000, high: 1_500_000 }],
    ["$150,000+", { low: 150_000 }],
    ["$150k+", { low: 150_000 }],
    ["Over $150,000", { low: 150_000 }],
    ["150,000 or more", { low: 150_000 }],
    ["At least $120k", { low: 120_000 }],
    ["Under $50,000", { high: 50_000 }],
    ["Less than 60k", { high: 60_000 }],
    ["Up to $60,000", { high: 60_000 }],
    ["$120,000", { low: 120_000, high: 120_000 }],
  ])("reads %s", (text, bounds) => {
    expect(parseSalaryBounds(text)).toEqual(bounds);
  });

  it.each([
    "Prefer not to say",
    "$25 - $35 per hour",
    "$25/hr",
    "$8,000 a month",
    "£50,000 - £60,000",
    "€60,000+",
    "CAD 90,000 - 110,000",
    "C$90,000",
    "$100,000 base and $20,000 bonus",
    "",
  ])("understands nothing in %j", (text) => {
    expect(parseSalaryBounds(text)).toBeUndefined();
  });

  it("counts only money in a question's own sentence", () => {
    expect(
      parseSalaryBounds("With 5 years of experience, is $100,000-$150,000 enough?", true),
    ).toEqual({ low: 100_000, high: 150_000 });
    expect(parseSalaryBounds("Do you have 5 years of experience?", true)).toBeUndefined();
    expect(parseSalaryBounds("Do you have experience with 401(k) plans?", true)).toBeUndefined();
  });

  it("knows when a text is not annual dollars", () => {
    expect(isAnnualDollarText("Desired annual salary")).toBe(true);
    expect(isAnnualDollarText("Expected hourly rate")).toBe(false);
    expect(isAnnualDollarText("Desired salary (GBP)")).toBe(false);
  });
});

const RANGES = ["$80,000 - $100,000", "$100,000 - $120,000", "$120,000 - $140,000", "$140,000+"];

describe("chooseSalaryOption", () => {
  it("picks the range that holds the salary", () => {
    expect(chooseSalaryOption(RANGES, 130_000)).toEqual({
      option: "$120,000 - $140,000",
      within: true,
    });
    expect(chooseSalaryOption(RANGES, 90_000)).toEqual({
      option: "$80,000 - $100,000",
      within: true,
    });
  });

  it("gives a salary on the boundary of two ranges to the one it starts", () => {
    expect(chooseSalaryOption(RANGES, 120_000)?.option).toBe("$120,000 - $140,000");
    expect(chooseSalaryOption(RANGES, 100_000)?.option).toBe("$100,000 - $120,000");
    expect(chooseSalaryOption(RANGES, 140_000)?.option).toBe("$140,000+");
  });

  it("lets an open-ended top range hold a salary above it", () => {
    expect(chooseSalaryOption(RANGES, 400_000)).toEqual({ option: "$140,000+", within: true });
    expect(chooseSalaryOption(["Under $50,000", "$50,000 - $75,000"], 30_000)).toEqual({
      option: "Under $50,000",
      within: true,
    });
  });

  it("picks the highest when above every range, the lowest when below every range", () => {
    const closed = ["$50,000 - $75,000", "$75,000 - $100,000", "$100,000 - $125,000"];
    expect(chooseSalaryOption(closed, 300_000)).toEqual({
      option: "$100,000 - $125,000",
      within: false,
    });
    expect(chooseSalaryOption(closed, 20_000)).toEqual({
      option: "$50,000 - $75,000",
      within: false,
    });
  });

  it("picks the nearer range when the salary falls in a gap, the higher one on a tie", () => {
    const gappy = ["$50,000 - $60,000", "$80,000 - $90,000"];
    expect(chooseSalaryOption(gappy, 62_000)).toEqual({
      option: "$50,000 - $60,000",
      within: false,
    });
    expect(chooseSalaryOption(gappy, 78_000)).toEqual({
      option: "$80,000 - $90,000",
      within: false,
    });
    expect(chooseSalaryOption(gappy, 70_000)?.option).toBe("$80,000 - $90,000");
  });

  it("prefers the narrower of two ranges that both hold it", () => {
    expect(chooseSalaryOption(["Under $200,000", "$100,000 - $150,000"], 120_000)?.option).toBe(
      "$100,000 - $150,000",
    );
  });

  it("reads short labels and ignores options that are not ranges", () => {
    expect(
      chooseSalaryOption(["Select...", "50-75k", "75-100k", "Prefer not to say"], 80_000),
    ).toEqual({ option: "75-100k", within: true });
  });

  it("chooses nothing when no option is an annual dollar range, or the salary is unusable", () => {
    expect(chooseSalaryOption(["Yes", "No"], 100_000)).toBeUndefined();
    expect(
      chooseSalaryOption(["$20 - $30 per hour", "$30 - $40 per hour"], 100_000),
    ).toBeUndefined();
    expect(chooseSalaryOption(["£40,000 - £50,000"], 45_000)).toBeUndefined();
    expect(chooseSalaryOption(RANGES, 0)).toBeUndefined();
    expect(chooseSalaryOption(RANGES, Number.NaN)).toBeUndefined();
    expect(chooseSalaryOption([], 100_000)).toBeUndefined();
  });
});

describe("salaryMeetsPosted", () => {
  const ask = (range: string) =>
    `Does our posted annual salary of ${range} meet your salary expectations?`;

  it("says yes when the posted range holds the salary", () => {
    expect(salaryMeetsPosted(ask("$100,000-$150,000"), 120_000)).toBe(true);
    expect(salaryMeetsPosted(ask("$100,000-$150,000"), 150_000)).toBe(true);
  });

  it("says yes when the posted range is above the salary, which it meets", () => {
    expect(salaryMeetsPosted(ask("$100,000-$150,000"), 90_000)).toBe(true);
  });

  it("says no when the salary is above the posted range", () => {
    expect(salaryMeetsPosted(ask("$100,000-$150,000"), 150_001)).toBe(false);
    expect(salaryMeetsPosted(ask("$100,000-$150,000"), 200_000)).toBe(false);
  });

  it("reads an open-ended or single posted amount", () => {
    expect(salaryMeetsPosted(ask("$120,000+"), 500_000)).toBe(true);
    expect(salaryMeetsPosted(ask("up to $150,000"), 160_000)).toBe(false);
    expect(salaryMeetsPosted(ask("$120,000"), 130_000)).toBe(false);
  });

  it("has no answer when the question posts no annual dollar range", () => {
    expect(salaryMeetsPosted("Does the salary meet your expectations?", 100_000)).toBeUndefined();
    expect(salaryMeetsPosted(ask("$50 - $60 per hour"), 100_000)).toBeUndefined();
    expect(salaryMeetsPosted(ask("£50,000 - £60,000"), 100_000)).toBeUndefined();
    expect(salaryMeetsPosted(ask("$100,000-$150,000"), 0)).toBeUndefined();
  });
});

describe("salaryAnswer", () => {
  it("gives the number for an input and Yes/No for the posted-salary question", () => {
    expect(salaryAnswer("job.salary_expectation", "Desired salary", 120_000)).toBe(120_000);
    expect(
      salaryAnswer(
        "job.salary_acceptable",
        "Does our posted salary of $100,000-$150,000 meet your salary expectations?",
        120_000,
      ),
    ).toBe(true);
  });

  it("leaves other questions, other units and a missing salary to the candidate", () => {
    expect(salaryAnswer("job.relocation", "Relocate?", 120_000)).toBeUndefined();
    expect(salaryAnswer("job.salary_expectation", "Expected hourly rate", 120_000)).toBeUndefined();
    expect(salaryAnswer("job.salary_expectation", "Desired salary (CAD)", 120_000)).toBeUndefined();
    expect(salaryAnswer("job.salary_expectation", "Desired salary", undefined)).toBeUndefined();
    expect(salaryAnswer("job.salary_expectation", "Desired salary", "120000")).toBeUndefined();
    expect(salaryAnswer("job.salary_expectation", "Desired salary", -1)).toBeUndefined();
  });
});
