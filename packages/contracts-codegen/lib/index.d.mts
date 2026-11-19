export interface ContractsConfig {
  /** Name of the package, for messages. */
  packageName?: string;
  /** Schema files of the mirror, in hash order. */
  schemas: string[];
  /** Every schema `$id` must start with this prefix. */
  idPrefix: string;
  /** Text that must not appear in the mirror (another tier's `$id`). */
  forbiddenIds: string[];
  /** Output directory of the generated sources, relative to the package. */
  out: string;
  /** Composer package of the producer, e.g. `middag-io/ui`. */
  producer: string;
  /** `$ref` prefix of another contracts package -> module to import from. */
  externals: Record<string, string>;
  /** Extra zod export name -> `$def` name. */
  aliases: Record<string, string>;
  /** Render bare `{ type: "object" }` as a string-keyed record. */
  relaxBareObjects: boolean;
  /** Contracts packages (directories) whose `$defs` names must not be redefined. */
  disjointWith: string[];
  /** Commands printed in the generated header. */
  commands: { generate: string; check: string };
}

export interface ContractSource {
  repository: string | null;
  ref: string | null;
  sha: string | null;
  path: string;
  files: Record<string, string>;
}

export interface CompatReport {
  level: "none" | "patch" | "additive" | "breaking";
  versionBumped: boolean;
  ok: boolean;
  breaks: string[];
  additions: string[];
}

export interface Contract {
  version: string;
  defs: Record<string, unknown>;
}

export interface BuildResult {
  config: ContractsConfig;
  version: string;
  hash: string;
  defs: Record<string, unknown>;
  source: ContractSource;
  files: Record<string, string>;
}

export const CONFIG_FILE: string;
export const SCHEMA_DIR: string;
export const SOURCE_FILE: string;

export function sha256(text: string): string;
export function loadConfig(packageDir: string): ContractsConfig;
export function readSource(packageDir: string): ContractSource;
export function writeSource(packageDir: string, source: ContractSource): void;
export function schemaHash(files: { raw: string }[]): string;
export function validateSchemas(
  files: { name: string; raw: string; json: Record<string, unknown> }[],
  config: ContractsConfig,
): string;
export function mergeDefs(files: { json: Record<string, unknown> }[]): Record<string, unknown>;
export function sharedNames(
  defs: Record<string, unknown>,
  otherDefs: Record<string, unknown>,
): string[];
export function build(packageDir: string): Promise<BuildResult>;
export function check(
  packageDir: string,
): Promise<{ ok: boolean; problems: string[]; hash: string; version: string }>;
export function generate(packageDir: string): Promise<BuildResult>;
export function copyLocalSource(packageDir: string, sourceDir: string): void;
export function contractOf(dir: string, config: ContractsConfig): Contract;
export function compat(packageDir: string, baseDir: string): CompatReport;
export function compareContracts(base: Contract, next: Contract): CompatReport;
export function provenanceProblems(
  packageDir: string,
  config: ContractsConfig,
  source: ContractSource,
): string[];
export function emitZod(options: {
  defs: Record<string, unknown>;
  externals?: Record<string, string>;
  typesModule: string;
  aliases?: Record<string, string>;
}): { body: string; order: string[]; recursive: string[] };
export function mirror(
  packageDir: string,
  options: { repository: string; ref: string; path?: string; token?: string },
): Promise<{ changed: boolean; report?: CompatReport | null }>;
export function verifySource(
  packageDir: string,
  options?: { token?: string },
): Promise<{ ok: boolean; problems: string[] }>;
