import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const promptDirectory = fileURLToPath(new URL("../prompts/", import.meta.url));
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function listPromptIds(): string[] {
  return readdirSync(promptDirectory).filter(name => name.endsWith(".md")).map(name => name.slice(0, -3)).sort();
}

/** Returns the packaged prompt verbatim. Prompts are the only authored source for installer snapshots and docs fallback. */
export function loadPrompt(id: string): string {
  if (!idPattern.test(id)) throw new Error(`Unknown prompt: ${id}`);
  try { return readFileSync(path.join(promptDirectory, `${id}.md`), "utf8"); }
  catch { throw new Error(`Unknown prompt: ${id}. Available: ${listPromptIds().join(", ")}`); }
}

export function renderPrompt(id: string, variables: Record<string, string> = {}): string {
  const template = loadPrompt(id);
  const variablePattern = /{{([A-Z][A-Z0-9_]*)}}/g;
  const required = [...new Set([...template.matchAll(variablePattern)].map(match => match[1]!))];
  const missing = required.filter(key => !Object.hasOwn(variables, key));
  if (missing.length > 0) throw new Error(`Missing prompt variables for ${id}: ${missing.join(", ")}`);
  return template.replace(variablePattern, (_token, key: string) => variables[key]!);
}

export function promptFiles(): Array<{ id: string; name: string; content: string }> {
  return listPromptIds().map(id => ({ id, name: `${id}.md`, content: loadPrompt(id) }));
}