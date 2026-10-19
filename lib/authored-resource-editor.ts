import type {
  AuthoredResourceContent,
  AuthoredResourceKind,
} from "@/packages/contracts/platform/authored-resources";

function textToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function textFromAuthoredResourceContent(
  kind: AuthoredResourceKind,
  content: AuthoredResourceContent,
): string {
  if (kind === "instruction") return content.text;
  const root = content.files.find((file) => file.path === "SKILL.md");
  if (!root) return "";
  try {
    const binary = atob(root.data);
    return new TextDecoder().decode(
      Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    );
  } catch {
    return "";
  }
}

export function contentFromAuthoredResourceEditor(
  kind: AuthoredResourceKind,
  text: string,
  tags: string,
  source?: AuthoredResourceContent,
): AuthoredResourceContent {
  const normalizedTags = tags.split(",").map((tag) => tag.trim()).filter(Boolean);
  if (kind === "instruction") return { text, files: [], tags: normalizedTags };

  const root = { path: "SKILL.md", data: textToBase64(text) };
  const sourceFiles = source?.files ?? [];
  const hasRoot = sourceFiles.some((file) => file.path === root.path);
  return {
    text: source?.text ?? "",
    files: hasRoot
      ? sourceFiles.map((file) => file.path === root.path ? root : { ...file })
      : [root, ...sourceFiles.map((file) => ({ ...file }))],
    tags: normalizedTags,
  };
}

export function initialAuthoredResourceContent(
  kind: AuthoredResourceKind,
): AuthoredResourceContent {
  return kind === "skill"
    ? contentFromAuthoredResourceEditor("skill", "# New Skill\n", "")
    : { text: "", files: [], tags: [] };
}
