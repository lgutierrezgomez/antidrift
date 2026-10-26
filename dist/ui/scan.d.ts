export interface UiFinding {
    kind: 'stale-impl' | 'orphan-impl' | 'broken-use' | 'broken-token' | 'stale-generated' | 'id-clash' | 'invalid-component' | 'invalid-tokens' | 'hardcoded';
    line: string;
}
export interface UiScanResult {
    problems: UiFinding[];
    warnings: UiFinding[];
    implCount: number;
    useCount: number;
}
/** Spec/implementation/use drift, stale generated token files, and hardcoded colors. Call only when uiEnabled(root). */
export declare function computeUiScan(root: string): UiScanResult;
