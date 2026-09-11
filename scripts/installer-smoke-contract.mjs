// Installer/backend acceptance only: not authenticated Kiro qualification.
export const installerSmokeCode = `
const read = await local.read({ path: "probe.txt", limit: 1 });
const search = await local.grep({ pattern: payloads.needle, path: ".", literal: true, limit: 2 });
return { read, search };
`;
/** @param {string} sentinel */
export const installerSmokeInput = sentinel => ({ code: installerSmokeCode, payloads: { needle: sentinel }, resultFormat: "json" });

/** Validate the actual JSON projection, never a token in logs/errors/metadata.
 * Both independent operations must describe the one exact fixture line.
 * @param {any} frame @param {string} sentinel */
export function assertInstallerSmokeResult(frame, sentinel) {
  const result = frame?.result;
  if (!frame || frame.error !== undefined || !result || result.isError || result.error !== undefined ||
      !Array.isArray(result.content) || result.content.length !== 1 || result.content[0]?.type !== "text" ||
      typeof result.content[0].text !== "string" || result.content[0].text.length > 32_000) {
    throw new Error("Candidate checked read/search failed: unsuccessful MCP result");
  }
  let value;
  try { value = JSON.parse(result.content[0].text); }
  catch { throw new Error("Candidate checked read/search failed: expected a structured JSON result"); }
  const read = value?.read, search = value?.search;
  if (value?.error !== undefined || value?.status !== undefined || !read || read.error !== undefined || read.isError ||
      read.path !== "probe.txt" || read.text !== `${sentinel}\n` || read.truncated !== false || read.totalLines !== 1) {
    throw new Error("Candidate checked read failed: expected complete probe.txt line 1");
  }
  if (!search || search.error !== undefined || search.isError || search.truncated !== false ||
      !Array.isArray(search.matches) || search.matches.length !== 1 ||
      search.matches[0]?.path !== "probe.txt" || search.matches[0]?.line !== 1 || search.matches[0]?.text !== sentinel) {
    throw new Error("Candidate checked search failed: expected exact probe.txt path/line/text");
  }
  return { read: "PASS", search: "PASS" };
}
