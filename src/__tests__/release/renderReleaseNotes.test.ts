import { describe, expect, test } from "@jest/globals";
import {
  FALLBACK_DESCRIPTION,
  renderReleaseBody,
} from "../../release/renderReleaseNotes.js";

describe("renderReleaseBody", () => {
  test("renders the normal case with a description and commit list", () => {
    const body = renderReleaseBody("Some description.", [
      "* First change by @alice in [#1](https://example.com/pull/1)",
    ]);

    expect(body).toBe(
      [
        "Some description.",
        "",
        "------",
        "",
        "## What's Changed",
        "* First change by @alice in [#1](https://example.com/pull/1)",
      ].join("\n"),
    );
  });

  test("uses the fallback description constant when given an empty description", () => {
    const body = renderReleaseBody(FALLBACK_DESCRIPTION, [
      "* No changes since last release.",
    ]);

    expect(body).toContain("This release includes the changes below.");
  });

  test("includes the Full Changelog link when provided", () => {
    const body = renderReleaseBody(
      "Description",
      ["* Change"],
      "**Full Changelog**: [v1.0.0...v1.1.0](https://example.com/compare/v1.0.0...v1.1.0)",
    );

    expect(body).toContain(
      "**Full Changelog**: [v1.0.0...v1.1.0](https://example.com/compare/v1.0.0...v1.1.0)",
    );
    expect(
      body.endsWith(
        "**Full Changelog**: [v1.0.0...v1.1.0](https://example.com/compare/v1.0.0...v1.1.0)",
      ),
    ).toBe(true);
  });

  test("omits the Full Changelog section entirely when not provided", () => {
    const body = renderReleaseBody("Description", ["* Change"]);

    expect(body).not.toContain("Full Changelog");
  });

  test("heading is exactly '## What's Changed'", () => {
    const body = renderReleaseBody("Description", ["* Change"]);

    expect(body).toMatch(/^## What's Changed$/m);
  });

  test("never renders the legacy '## What's Changed (commits)' heading", () => {
    const body = renderReleaseBody("Description", ["* Change"]);

    expect(body).not.toContain("## What's Changed (commits)");
  });

  test("never renders an HTML contributor table", () => {
    const body = renderReleaseBody("Description", [
      "* Change by @alice in [#1](https://example.com/pull/1)",
    ]);

    expect(body).not.toContain("<table");
    expect(body).not.toContain("### Contributors");
  });
});
