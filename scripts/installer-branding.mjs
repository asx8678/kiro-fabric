import packageMetadata from "../package.json" with { type: "json" };

// esbuild embeds this checkout's version in the installed manager. Never read
// an unrelated package.json beside an installed runtime to choose its label.
export const INSTALLER_VERSION = packageMetadata.version;
const width = 46;
const row = text => `| ${text.padEnd(width - 2)} |`;
export const INSTALLER_BANNER = [
  `+${"-".repeat(width)}+`,
  row(`KIRO FABRIC v${INSTALLER_VERSION}`),
  row("Fabric + Navigator repository intelligence"),
  `+${"-".repeat(width)}+`,
].join("\n") + "\n";
