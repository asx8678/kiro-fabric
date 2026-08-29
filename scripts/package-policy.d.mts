export declare const REPOSITORY_ROOT: string;
export interface PublicEntrypoint {
  source: string;
  runtime: string;
  declaration?: string;
  exported: boolean;
}
export declare const PUBLIC_ENTRYPOINTS: readonly PublicEntrypoint[];
export declare const PUBLIC_SOURCE_ENTRYPOINTS: readonly string[];
export declare const BUILT_RUNTIME_ARTIFACTS: readonly string[];
export declare const PUBLIC_RUNTIME_ARTIFACTS: readonly string[];
export declare const PUBLIC_DECLARATION_ROOTS: readonly string[];
export declare const PACKAGE_FILES: string[];
export declare const PUBLISHED_DECLARATION_ARTIFACTS: string[];
export declare const PACKAGE_BIN_ARTIFACTS: string[];
export declare const REMOVED_BUILD_ARTIFACTS: string[];
export declare function assertPackagePolicy(): void;
