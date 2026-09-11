const REMOTE_REF_PREFIX = "mcp.remote/";
export const MAX_REMOTE_REF_CHARS = 4620;
export const remoteComponent = (value: string): string => {
  if (typeof value !== "string" || !value || value.length > 256) throw new Error("Remote names require 1..256 UTF-16 units");
  try { return encodeURIComponent(value).replace(/[!'()*]/gu, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`); }
  catch { throw new Error("Remote names require valid Unicode"); }
};
export const remoteRef = (server: string, tool: string): string => `${REMOTE_REF_PREFIX}${remoteComponent(server)}/${remoteComponent(tool)}`;
export const parseRemoteRef = (ref: string): { server: string; tool: string } | undefined => {
  if (!ref.startsWith(REMOTE_REF_PREFIX)) return undefined;
  if (ref.length > MAX_REMOTE_REF_CHARS) throw new Error("Remote reference exceeds 4620 characters");
  const parts = ref.slice(REMOTE_REF_PREFIX.length).split("/");
  if (parts.length !== 2) throw new Error("Malformed canonical remote reference");
  try {
    const server = decodeURIComponent(parts[0]!); const tool = decodeURIComponent(parts[1]!);
    if (remoteRef(server, tool) !== ref) throw new Error("noncanonical");
    return { server, tool };
  } catch { throw new Error("Malformed or noncanonical remote reference"); }
};
