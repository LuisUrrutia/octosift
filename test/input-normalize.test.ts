import { expect, test } from "bun:test";

import { normalizeInputs } from "../src/input/normalize";

test("normalizes users, repositories, and GitHub URLs", async () => {
  const result = await normalizeInputs([
    "LuisUrrutia",
    "LuisUrrutia/dotfiles",
    "https://github.com/LuisUrrutia",
    "https://github.com/LuisUrrutia/dotfiles",
    "https://github.com/LuisUrrutia/dotfiles/",
    "https://github.com/LuisUrrutia/dotfiles.git",
    "https://github.com/LuisUrrutia/dotfiles/issues",
  ]);

  expect(JSON.stringify(result.errors)).toBe("[]");
  expect(JSON.stringify(result.inputs)).toBe(
    JSON.stringify([
      {
        kind: "user",
        login: "LuisUrrutia",
        url: "https://github.com/LuisUrrutia",
      },
      {
        kind: "repository",
        owner: "LuisUrrutia",
        name: "dotfiles",
        fullName: "LuisUrrutia/dotfiles",
        url: "https://github.com/LuisUrrutia/dotfiles",
      },
    ]),
  );
});

test("normalizes already-expanded file values with source metadata", async () => {
  const result = await normalizeInputs([
    { value: "LuisUrrutia", source: "--file" },
    { value: "LuisUrrutia/dotfiles", source: "--file" },
    { value: "https://github.com/another-user", source: "--file" },
    { value: "https://github.com/another-user/dotfiles/issues", source: "@more-inputs.txt" },
  ]);

  expect(JSON.stringify(result.errors)).toBe("[]");
  expect(JSON.stringify(result.inputs)).toBe(
    JSON.stringify([
      {
        kind: "user",
        login: "LuisUrrutia",
        url: "https://github.com/LuisUrrutia",
      },
      {
        kind: "repository",
        owner: "LuisUrrutia",
        name: "dotfiles",
        fullName: "LuisUrrutia/dotfiles",
        url: "https://github.com/LuisUrrutia/dotfiles",
      },
      {
        kind: "user",
        login: "another-user",
        url: "https://github.com/another-user",
      },
      {
        kind: "repository",
        owner: "another-user",
        name: "dotfiles",
        fullName: "another-user/dotfiles",
        url: "https://github.com/another-user/dotfiles",
      },
    ]),
  );
});

test("deduplicates mixed inputs in first-seen order", async () => {
  const result = await normalizeInputs([
    "LuisUrrutia/dotfiles",
    "https://github.com/LuisUrrutia/dotfiles/issues",
    "luisurrutia/dotfiles.git",
    "LuisUrrutia",
    "https://github.com/luisurrutia/",
  ]);

  expect(JSON.stringify(result.errors)).toBe("[]");
  expect(JSON.stringify(result.inputs)).toBe(
    JSON.stringify([
      {
        kind: "repository",
        owner: "LuisUrrutia",
        name: "dotfiles",
        fullName: "LuisUrrutia/dotfiles",
        url: "https://github.com/LuisUrrutia/dotfiles",
      },
      {
        kind: "user",
        login: "LuisUrrutia",
        url: "https://github.com/LuisUrrutia",
      },
    ]),
  );
});

test("returns structured errors for malformed values", async () => {
  const result = await normalizeInputs([
    "not a valid/input/too/many",
    "https://example.com/LuisUrrutia",
  ]);

  expect(JSON.stringify(result.inputs)).toBe("[]");
  expect(JSON.stringify(result.errors)).toBe(
    JSON.stringify([
      {
        code: "invalid-input",
        input: "not a valid/input/too/many",
        message: "Invalid GitHub input: not a valid/input/too/many",
      },
      {
        code: "invalid-input",
        input: "https://example.com/LuisUrrutia",
        message: "Invalid GitHub input: https://example.com/LuisUrrutia",
      },
    ]),
  );
});

test("treats CLI file syntax as invalid GitHub values when not expanded", async () => {
  const result = await normalizeInputs(["fixtures/nested/input.txt", "--file", "actual-file.txt", "@missing.txt"]);

  expect(JSON.stringify(result.inputs)).toBe("[]");
  expect(JSON.stringify(result.errors)).toBe(
    JSON.stringify([
      {
        code: "invalid-input",
        input: "fixtures/nested/input.txt",
        message: "Invalid GitHub input: fixtures/nested/input.txt",
      },
      {
        code: "invalid-input",
        input: "--file",
        message: "Invalid GitHub input: --file",
      },
      {
        code: "invalid-input",
        input: "actual-file.txt",
        message: "Invalid GitHub input: actual-file.txt",
      },
      {
        code: "invalid-input",
        input: "@missing.txt",
        message: "Invalid GitHub input: @missing.txt",
      },
    ]),
  );
});
