import * as fs from 'fs';
import * as path from 'path';

/**
 * Get the dynamic version from package.json
 */
export function getVersion(): string {
  try {
    const packageJsonPath = path.join(__dirname, '../../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return packageJson.version;
  } catch (error) {
    // Fallback to a default version if package.json is not found
    return '0.3.3';
  }
}
