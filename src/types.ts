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
export type ResourceFolderType = 'studio' | 'knowledge' | 'tools' | 'plugins' | 'models';

// Model type category
export type ModelTypeCategory = 'llm' | 'text-embedding' | 'rerank' | 'speech2text' | 'tts' | 'moderation';

// Model provider configuration
export interface ModelProviderConfig {
    provider: string;
    label: string;
    description?: string;
    icon_small?: string;
    icon_large?: string;
    supported_model_types: ModelTypeCategory[];
    configurate_methods: string[];
    provider_credential_schema?: {
        credential_form_schemas: CredentialFormSchema[];
    };
    model_credential_schema?: {
        model: {
            label: string;
            placeholder?: string;
        };
        credential_form_schemas: CredentialFormSchema[];
    };
    models: ModelConfig[];
}

// Credential form schema
export interface CredentialFormSchema {
    variable: string;
    label: string;
    type: 'text-input' | 'secret-input' | 'select' | 'radio' | 'switch';
    required: boolean;
    default?: string | number | boolean;
    options?: { label: string; value: string }[];
    placeholder?: string;
}

// Model configuration
export interface ModelConfig {
    model: string;
    label: string;
    model_type: ModelTypeCategory;
    features?: string[];
    fetch_from?: string;
    deprecated?: boolean;
    model_properties?: {
        mode?: string;
        context_size?: number;
    };
    parameter_rules?: ModelParameterRule[];
    pricing?: {
        input: string;
        output: string;
        unit: string;
        currency: string;
    };
    status?: 'active' | 'no-configure' | 'quota-exceeded' | 'no-permission';
}

// Model parameter rule
export interface ModelParameterRule {
    name: string;
    use_template?: string;
    label?: string;
    type?: string;
    help?: string;
    required?: boolean;
    default?: number | string | boolean;
    min?: number;
    max?: number;
    precision?: number;
}

// Models registry (to be saved to models.yml)
export interface ModelsRegistry {
    // Timestamp when the models were last synced
    last_synced_at: string;
    // Default models for each type
    default_models?: {
        llm?: string;
        text_embedding?: string;
        rerank?: string;
        speech2text?: string;
        tts?: string;
    };
    // All configured model providers with their models
    providers: ModelProviderSummary[];
}

// Model provider summary (simplified for local storage)
export interface ModelProviderSummary {
    provider: string;
    label: string;
    icon?: string;
    status: 'active' | 'no-configure';
    models: ModelSummary[];
}

// Model summary (simplified for local storage and AI reference)
export interface ModelSummary {
    // The model identifier used in DSL configuration
    model: string;
    // Human readable label
    label: string;
    // Model type category
    model_type: ModelTypeCategory;
    // Provider name
    provider: string;
    // Features like vision, tool-call, etc.
    features?: string[];
    // Context window size
    context_size?: number;
    // Model mode (chat, completion, etc.)
    mode?: string;
    // Whether this model is deprecated
    deprecated?: boolean;
    // Current status
    status?: 'active' | 'no-configure' | 'quota-exceeded' | 'no-permission';
    // Pricing info
    pricing?: {
        input: string;
        output: string;
        unit: string;
        currency: string;
    };
}

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

// Models file node data
export interface ModelsFileNodeData {
    type: 'models-file';
    name: string;
    path: string;
    platformUrl: string;
    accountEmail: string;
    providerCount: number;
    modelCount: number;
    lastSyncedAt?: string;
}

// Generic resource file node data (for knowledge, tools, plugins)
export interface ResourceFileNodeData {
    type: 'resource-file';
    resourceType: 'knowledge' | 'tools' | 'plugins';
    name: string;
    path: string;
    platformUrl: string;
    accountEmail: string;
    itemCount: number;
    lastSyncedAt?: string;
}

// Unified node data type
export type TreeNodeData = PlatformNodeData | AccountNodeData | WorkspaceNodeData | ResourceFolderNodeData | AppNodeData | ModelsFileNodeData | ResourceFileNodeData | KnowledgeNodeData | DocumentNodeData;

// ==================== Knowledge (Datasets) Types ====================

// Knowledge base (dataset) summary
export interface KnowledgeSummary {
    id: string;
    name: string;
    description?: string;
    provider: string;
    permission: 'only_me' | 'all_team_members' | 'partial_members';
    data_source_type?: string;
    indexing_technique?: string;
    app_count: number;
    document_count: number;
    word_count: number;
    created_at: string;
    updated_at: string;
}

// Knowledge registry
export interface KnowledgeRegistry {
    last_synced_at: string;
    datasets: KnowledgeSummary[];
}

// Document summary
export interface DocumentSummary {
    id: string;
    name: string;
    data_source_type: string;
    word_count: number;
    tokens: number;
    indexing_status: 'waiting' | 'parsing' | 'cleaning' | 'splitting' | 'indexing' | 'paused' | 'completed' | 'error' | 'archived';
    enabled: boolean;
    archived: boolean;
    display_status: string;
    created_at: string;
    updated_at: string;
    doc_form?: string;
}

// Document segment
export interface DocumentSegment {
    id: string;
    position: number;
    document_id: string;
    content: string;
    word_count: number;
    tokens: number;
    keywords: string[];
    index_node_id?: string;
    index_node_hash?: string;
    hit_count: number;
    enabled: boolean;
    disabled_at?: string;
    disabled_by?: string;
    status: string;
    created_at: string;
    updated_at?: string;
    indexing_at?: string;
    completed_at?: string;
    error?: string;
    stopped_at?: string;
    answer?: string;
}

// Knowledge base node data (for tree view)
export interface KnowledgeNodeData {
    type: 'knowledge';
    id: string;
    name: string;
    description?: string;
    documentCount: number;
    wordCount: number;
    platformUrl: string;
    accountEmail: string;
    path: string;
    syncStatus?: SyncStatus;
}

// Document node data (for tree view)
export interface DocumentNodeData {
    type: 'document';
    id: string;
    name: string;
    datasetId: string;
    wordCount: number;
    status: string;
    enabled: boolean;
    platformUrl: string;
    accountEmail: string;
    path: string;
}

// Knowledge sync metadata
export interface KnowledgeSyncMetadata {
    dataset_id: string;
    dataset_name: string;
    last_synced_at: string;
    document_count: number;
}

// ==================== Tools Types ====================

// Tool summary
export interface ToolSummary {
    name: string;
    author: string;
    label: string;
    description?: string;
    icon?: string;
    type: 'builtin' | 'api' | 'workflow';
    team_credentials?: Record<string, unknown>;
    is_team_authorization: boolean;
    tools: ToolItem[];
}

// Tool item
export interface ToolItem {
    name: string;
    author: string;
    label: string;
    description?: string;
    parameters?: ToolParameter[];
}

// Tool parameter
export interface ToolParameter {
    name: string;
    label: string;
    description?: string;
    type: string;
    required: boolean;
    default?: unknown;
    options?: { label: string; value: string }[];
}

// Tools registry
export interface ToolsRegistry {
    last_synced_at: string;
    providers: ToolSummary[];
}

// ==================== Plugins Types ====================

// Plugin summary
export interface PluginSummary {
    plugin_id: string;
    plugin_unique_identifier: string;
    name: string;
    label: string;
    description?: string;
    icon?: string;
    version: string;
    author: string;
    category: string;
    type: 'marketplace' | 'github' | 'local' | 'remote';
    source: string;
    latest_version?: string;
    latest_unique_identifier?: string;
    installation_id: string;
    endpoints_active: boolean;
    declaration: {
        plugins?: string[];
        model?: unknown;
        tool?: unknown;
        endpoint?: unknown;
        agent_strategy?: unknown;
    };
    created_at: string;
}

// Plugins registry
export interface PluginsRegistry {
    last_synced_at: string;
    plugins: PluginSummary[];
}

// Resource folder display names
export const RESOURCE_FOLDER_NAMES: Record<ResourceFolderType, string> = {
    'studio': 'Studio',
    'knowledge': 'Knowledge',
    'tools': 'Tools',
    'plugins': 'Plugins',
    'models': 'Models',
};

// Resource folder icons
export const RESOURCE_FOLDER_ICONS: Record<ResourceFolderType, string> = {
    'studio': 'symbol-method',
    'knowledge': 'book',
    'tools': 'tools',
    'plugins': 'extensions',
    'models': 'hubot',
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
