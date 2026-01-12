declare module 'js-yaml' {
    export function load(input: string, options?: LoadOptions): unknown;
    export function dump(obj: unknown, options?: DumpOptions): string;
    
    export interface LoadOptions {
        filename?: string;
        schema?: Schema;
        json?: boolean;
        listener?: (eventType: string, state: unknown) => void;
    }
    
    export interface DumpOptions {
        indent?: number;
        noArrayIndent?: boolean;
        skipInvalid?: boolean;
        flowLevel?: number;
        styles?: Record<string, string>;
        schema?: Schema;
        sortKeys?: boolean | ((a: string, b: string) => number);
        lineWidth?: number;
        noRefs?: boolean;
        noCompatMode?: boolean;
        condenseFlow?: boolean;
        quotingType?: '"' | "'";
        forceQuotes?: boolean;
        replacer?: (key: string, value: unknown) => unknown;
    }
    
    export interface Schema {
        // Schema definition
    }
    
    export const JSON_SCHEMA: Schema;
    export const CORE_SCHEMA: Schema;
    export const DEFAULT_SCHEMA: Schema;
    export const FAILSAFE_SCHEMA: Schema;
}
