/**
 * Hand-written declarations for npm-public-package.mjs (plain-JS CLI), so
 * the vitest suite (tests/scripts/) can import the pure helpers with real
 * types instead of a ts-ignore.
 */
export type Manifest = Record<string, unknown>;

export const DROPPED_FIELDS: string[];
export const GUARDED_FIELDS: string[];
export function toPublicManifest(pkg: Manifest): Manifest;
export function diffManifests(source: Manifest, packed: Manifest): string[];
export function missingExportTargets(exportsField: unknown, files: string[]): string[];
export function checkTarball(
  tarball: string,
  sourcePackageJson: string,
): { dependencies: number; peerDependencies: number };
export function stagePublicPackage(sourceDir: string, outDir: string): void;
export function verifyStagedPackage(
  stageDir: string,
  sourcePackageJson: string,
): { dependencies: number; peerDependencies: number };
