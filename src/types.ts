/**
 * Dify as Code - Type Definitions
 */

// App type
export type AppType = 'chatbot' | 'text-generation' | 'agent' | 'chatflow' | 'workflow';

// User role
export type UserRole = 'owner' | 'admin' | 'editor' | 'viewer';

// Sync status
export type SyncStatus = 'synced' | 'local-modified' | 'remote-modified';

// Platform config
export interface PlatformConfig {
    name: string;
    url: string;
}

// Account config
export interface AccountConfig {
    email: string;
    apps: AppInfo[];
}

// Secrets config
export interface SecretsConfig {
    password?: string;
    token?: string;
}

// App info
export interface AppInfo {
    id: string;
    name: string;
    type: AppType;
    role?: UserRole;
    readonly?: boolean;
}

// Sync metadata
export interface SyncMetadata {
    app_id: string;
    last_synced_at: string;
    remote_updated_at: string;
    local_hash: string;
}

// Tree node type
export type TreeNodeType = 'platform' | 'account' | 'app';

// Platform node data
export interface PlatformNodeData {
    type: 'platform';
    name: string;
    url: string;
    path: string;
}

// Account node data
export interface AccountNodeData {
    type: 'account';
    email: string;
    platformName: string;
    platformUrl: string;
    path: string;
}

// App node data
export interface AppNodeData {
    type: 'app';
    id: string;
    name: string;
    appType: AppType;
    role?: UserRole;
    readonly: boolean;
    platformUrl: string;
    accountEmail: string;
    path: string;
    syncStatus?: SyncStatus;
}

// Unified node data type
export type TreeNodeData = PlatformNodeData | AccountNodeData | AppNodeData;

// Dify API response types
export interface DifyLoginResponse {
    result: string;
    data?: {
        access_token: string;
        refresh_token: string;
    };
}

export interface DifyAppListResponse {
    data: DifyApp[];
    has_more: boolean;
    page: number;
    limit: number;
    total: number;
}

export interface DifyApp {
    id: string;
    name: string;
    mode: string;
    icon: string;
    icon_background: string;
    description: string;
    updated_at: string;
    created_at: string;
}

export interface DifyExportResponse {
    data: string; // YAML DSL content
}

// App mode to type mapping
export const APP_MODE_TO_TYPE: Record<string, AppType> = {
    'chat': 'chatbot',
    'completion': 'text-generation',
    'agent-chat': 'agent',
    'advanced-chat': 'chatflow',
    'workflow': 'workflow',
};

// App type icons
export const APP_TYPE_ICONS: Record<AppType, string> = {
    'chatbot': '🤖',
    'text-generation': '📝',
    'agent': '🧠',
    'chatflow': '💬',
    'workflow': '🔄',
};

// Role icons
export const ROLE_ICONS: Record<UserRole, string> = {
    'owner': '👑',
    'admin': '👑',
    'editor': '',
    'viewer': '🔒',
};
