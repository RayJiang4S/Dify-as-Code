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

// Account config (simplified - workspaces are now derived from directory structure)
export interface AccountConfig {
    email: string;
}

// Workspace config
export interface WorkspaceConfig {
    id: string;
    name: string;
    role: UserRole;
}

// Secrets config
export interface SecretsConfig {
    password?: string;
    token?: string;
}

// Sync metadata (single source of truth for app metadata)
export interface SyncMetadata {
    app_id: string;
    app_type: AppType;
    role?: UserRole;
    readonly?: boolean;
    last_synced_at: string;
    remote_updated_at: string;
    local_hash: string;
}

// Resource folder type
export type ResourceFolderType = 'studio' | 'knowledge' | 'tools' | 'plugins';

// Tree node type
export type TreeNodeType = 'platform' | 'account' | 'workspace' | 'resource-folder' | 'app';

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

// Workspace node data
export interface WorkspaceNodeData {
    type: 'workspace';
    id: string;
    name: string;
    role: UserRole;
    platformUrl: string;
    accountEmail: string;
    path: string;
}

// Resource folder node data (studio, knowledge, tools, plugins)
export interface ResourceFolderNodeData {
    type: 'resource-folder';
    folderType: ResourceFolderType;
    name: string;
    platformUrl: string;
    accountEmail: string;
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
export type TreeNodeData = PlatformNodeData | AccountNodeData | WorkspaceNodeData | ResourceFolderNodeData | AppNodeData;

// Resource folder display names
export const RESOURCE_FOLDER_NAMES: Record<ResourceFolderType, string> = {
    'studio': 'Studio',
    'knowledge': 'Knowledge',
    'tools': 'Tools',
    'plugins': 'Plugins',
};

// Resource folder icons
export const RESOURCE_FOLDER_ICONS: Record<ResourceFolderType, string> = {
    'studio': 'symbol-method',
    'knowledge': 'book',
    'tools': 'tools',
    'plugins': 'extensions',
};

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

// Dify workspace/tenant response
export interface DifyWorkspace {
    id: string;
    name: string;
    role: string;
    current: boolean;
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

// Workspace role icons
export const WORKSPACE_ROLE_ICONS: Record<UserRole, string> = {
    'owner': '👑',
    'admin': '🔧',
    'editor': '',
    'viewer': '👁️',
};
