import { readFileSync } from 'node:fs';

// Read the version from package.json (one level above dist/ or src/) so the
// MCP server never reports a stale hard-coded version.
const readVersion = (): string => {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return String(pkg.version || '0.0.0');
  } catch {
    return '0.0.0';
  }
};

export const PACKAGE_VERSION = readVersion();
