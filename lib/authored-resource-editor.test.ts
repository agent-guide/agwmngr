import { expect, test } from "bun:test";
import {
  contentFromAuthoredResourceEditor,
  textFromAuthoredResourceContent,
} from "./authored-resource-editor";

test("skill revision editing preserves auxiliary package content", () => {
  const source = {
    text: "package metadata",
    files: [
      { path: "SKILL.md", data: Buffer.from("# Before\n").toString("base64") },
      { path: "scripts/run.sh", data: Buffer.from("#!/bin/sh\n").toString("base64") },
      { path: "references/guide.md", data: Buffer.from("Guide\n").toString("base64") },
    ],
    tags: ["old"],
  };

  const edited = contentFromAuthoredResourceEditor(
    "skill",
    "# After\n",
    "new, package",
    source,
  );

  expect(edited.text).toBe("package metadata");
  expect(edited.tags).toEqual(["new", "package"]);
  expect(edited.files.map((file) => file.path)).toEqual([
    "SKILL.md",
    "scripts/run.sh",
    "references/guide.md",
  ]);
  expect(textFromAuthoredResourceContent("skill", edited)).toBe("# After\n");
  expect(edited.files[1]).toEqual(source.files[1]);
  expect(edited.files[2]).toEqual(source.files[2]);
  expect(source.files[0]?.data).toBe(Buffer.from("# Before\n").toString("base64"));
});

test("new skill content contains only the editor-owned root file", () => {
  const content = contentFromAuthoredResourceEditor("skill", "# New\n", "one");

  expect(content).toMatchObject({ text: "", tags: ["one"] });
  expect(content.files).toHaveLength(1);
  expect(textFromAuthoredResourceContent("skill", content)).toBe("# New\n");
});

test("instruction editing uses the editor text and cannot carry package files", () => {
  const content = contentFromAuthoredResourceEditor(
    "instruction",
    "Updated instruction",
    " safety , reviewed ",
    {
      text: "Old instruction",
      files: [{ path: "unexpected.txt", data: "" }],
      tags: ["old"],
    },
  );

  expect(content).toEqual({
    text: "Updated instruction",
    files: [],
    tags: ["safety", "reviewed"],
  });
});
