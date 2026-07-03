import { describe, expect, test } from "@jest/globals";
import { parseRepositoryCoordinates } from "../../utils/repository.js";

describe("parseRepositoryCoordinates", () => {
  test("splits a valid owner/repo string", () => {
    expect(parseRepositoryCoordinates("octocat/hello-world")).toEqual({
      owner: "octocat",
      repo: "hello-world",
    });
  });

  test.each(["", "owner", "owner/", "/repo", "owner/repo/extra"])(
    "throws for malformed value %p",
    (value) => {
      expect(() => parseRepositoryCoordinates(value)).toThrow(
        /GITHUB_REPOSITORY must be in the form "owner\/repo"/,
      );
    },
  );
});
