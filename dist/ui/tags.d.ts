export interface ImplTag {
    id: string;
    version: number;
    file: string;
    line: number;
}
export interface UseTag {
    id: string;
    variant?: string;
    file: string;
    line: number;
}
export declare function parseUiTags(content: string, file: string): {
    impls: ImplTag[];
    uses: UseTag[];
};
