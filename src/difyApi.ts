/**
 * Dify API Client
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import FormData from 'form-data';
import { DifyApp, DifyAppListResponse, DifyWorkspace, APP_MODE_TO_TYPE, AppType, UserRole, ModelTypeCategory, ModelProviderSummary, ModelSummary, ModelsRegistry, KnowledgeRegistry, KnowledgeSummary, ToolsRegistry, ToolSummary, ToolParameter, PluginsRegistry, PluginSummary, DocumentSummary, DocumentSegment } from './types';

/**
 * Encode sensitive field using Base64
 * Dify frontend uses Base64 encoding when transmitting passwords
 */
function encryptField(plaintext: string): string {
    // Convert string to UTF-8 bytes, then Base64 encode
    const utf8Bytes = Buffer.from(plaintext, 'utf-8');
    return utf8Bytes.toString('base64');
}

/**
 * Parse cookie value from Set-Cookie header
 */
function parseCookieValue(setCookieHeaders: string | string[] | undefined, cookieName: string): string | null {
    if (!setCookieHeaders) {
        return null;
    }
    
    const cookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    
    for (const cookie of cookies) {
        // Cookie format: name=value; Path=...; HttpOnly; ...
        // Or with prefix: __Host-name=value; ...
        const patterns = [
            new RegExp(`^${cookieName}=([^;]+)`),
            new RegExp(`^__Host-${cookieName}=([^;]+)`),
        ];
        
        for (const pattern of patterns) {
            const match = cookie.match(pattern);
            if (match) {
                return match[1];
            }
        }
    }
    
    return null;
}

export interface DifyApiConfig {
    baseUrl: string;
    email: string;
    password: string;
}

export interface AppDetails {
    id: string;
    name: string;
    type: AppType;
    updatedAt: string;
    role?: UserRole;
    readonly?: boolean;
}

export interface WorkspaceDetails {
    id: string;
    name: string;
    role: UserRole;
    current: boolean;
}

export class DifyApiClient {
    private client: AxiosInstance;
    private baseUrl: string;
    private accessToken: string | null = null;
    private refreshToken: string | null = null;
    private csrfToken: string | null = null;

    constructor(baseUrl: string) {
        // Ensure URL has no trailing slash
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.client = axios.create({
            baseURL: this.baseUrl,
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json',
            },
            withCredentials: true,
        });

        // Add request interceptor to automatically add auth headers
        this.client.interceptors.request.use((config) => {
            console.log(`[DifyAPI] Request: ${config.method?.toUpperCase()} ${config.url}`);
            
            // Build Cookie header (Node.js doesn't auto-manage cookies)
            const cookies: string[] = [];
            if (this.accessToken) {
                cookies.push(`access_token=${this.accessToken}`);
            }
            if (this.refreshToken) {
                cookies.push(`refresh_token=${this.refreshToken}`);
            }
            if (this.csrfToken) {
                cookies.push(`csrf_token=${this.csrfToken}`);
            }
            
            if (cookies.length > 0) {
                config.headers.Cookie = cookies.join('; ');
                console.log(`[DifyAPI] Cookie header set with ${cookies.length} cookies`);
            }
            
            // Also set Authorization header as fallback
            if (this.accessToken) {
                config.headers.Authorization = `Bearer ${this.accessToken}`;
            }
            
            // Add CSRF token header
            if (this.csrfToken) {
                config.headers['X-CSRF-Token'] = this.csrfToken;
            }
            
            return config;
        });

        // Add response interceptor to handle token refresh
        this.client.interceptors.response.use(
            (response) => {
                console.log(`[DifyAPI] Response received: ${response.config.url} - ${response.status}`);
                return response;
            },
            async (error: AxiosError) => {
                console.log(`[DifyAPI] Response error: ${error.config?.url} - ${error.response?.status || 'no response'}`);
                
                // Avoid triggering refresh during refresh-token request
                const isRefreshRequest = error.config?.url?.includes('refresh-token');
                
                if (error.response?.status === 401 && this.refreshToken && !isRefreshRequest) {
                    console.log('[DifyAPI] 401 received, attempting token refresh...');
                    try {
                        await this.refreshAccessToken();
                        // Retry original request
                        const config = error.config;
                        if (config && this.accessToken) {
                            config.headers.Authorization = `Bearer ${this.accessToken}`;
                            console.log('[DifyAPI] Retrying request with new token...');
                            return this.client.request(config);
                        }
                    } catch (refreshError) {
                        console.error('[DifyAPI] Token refresh failed:', refreshError);
                        // Refresh failed, clear tokens
                        this.accessToken = null;
                        this.refreshToken = null;
                    }
                }
                throw error;
            }
        );
    }

    /**
     * Login
     * Note: Different Dify versions handle passwords differently:
     * - Newer versions expect Base64-encoded passwords
     * - Older versions expect plaintext passwords
     * This method tries both approaches automatically.
     */
    async login(email: string, password: string): Promise<boolean> {
        // Try Base64-encoded password first (newer Dify versions)
        const encodedResult = await this.tryLogin(email, encryptField(password));
        if (encodedResult) {
            return true;
        }
        
        console.log('[DifyAPI] Base64 encoded password failed, trying plaintext...');
        
        // Fallback to plaintext password (older Dify versions)
        const plaintextResult = await this.tryLogin(email, password);
        if (plaintextResult) {
            return true;
        }
        
        return false;
    }

    /**
     * Internal login attempt helper
     */
    private async tryLogin(email: string, processedPassword: string): Promise<boolean> {
        try {
            console.log(`[DifyAPI] Attempting login to ${this.baseUrl} with email: ${email}`);
            console.log(`[DifyAPI] Request URL: ${this.baseUrl}/console/api/login`);
            
            const response = await this.client.post('/console/api/login', {
                email,
                password: processedPassword,
                remember_me: true,
            });

            console.log('[DifyAPI] Login response status:', response.status);
            console.log('[DifyAPI] Login response data:', JSON.stringify(response.data, null, 2));
            console.log('[DifyAPI] Response headers:', JSON.stringify(response.headers, null, 2));

            // Dify returns access_token and refresh_token on successful login
            // Possible response formats:
            // 1. { result: 'success', data: { access_token, refresh_token } }
            // 2. { access_token, refresh_token }
            // 3. Session set via Cookie

            if (response.data.result === 'success') {
                // First try to get token from response body
                if (response.data.data?.access_token) {
                    this.accessToken = response.data.data.access_token;
                    this.refreshToken = response.data.data.refresh_token;
                    console.log('[DifyAPI] Login successful (token from response body)');
                    return true;
                }
                
                // Dify sets tokens in Set-Cookie header
                const setCookieHeader = response.headers['set-cookie'];
                console.log('[DifyAPI] Set-Cookie header:', JSON.stringify(setCookieHeader, null, 2));
                
                const accessToken = parseCookieValue(setCookieHeader, 'access_token');
                const refreshToken = parseCookieValue(setCookieHeader, 'refresh_token');
                const csrfToken = parseCookieValue(setCookieHeader, 'csrf_token');
                
                console.log('[DifyAPI] Parsed access_token:', accessToken ? `${accessToken.substring(0, 20)}...` : 'null');
                console.log('[DifyAPI] Parsed refresh_token:', refreshToken ? `${refreshToken.substring(0, 20)}...` : 'null');
                console.log('[DifyAPI] Parsed csrf_token:', csrfToken ? `${csrfToken.substring(0, 20)}...` : 'null');
                
                if (accessToken) {
                    this.accessToken = accessToken;
                    this.refreshToken = refreshToken;
                    this.csrfToken = csrfToken;
                    console.log('[DifyAPI] Login successful (tokens from cookies)');
                    return true;
                }
                
                console.log('[DifyAPI] Login successful but no token found in cookies');
                // Try to continue, might be session-based auth
                return true;
            }

            // Direct token response (legacy compatibility)
            if (response.data.access_token) {
                this.accessToken = response.data.access_token;
                this.refreshToken = response.data.refresh_token;
                console.log('[DifyAPI] Login successful (direct token)');
                return true;
            }

            console.log('[DifyAPI] Login attempt: unexpected response format');
            return false;
        } catch (error: unknown) {
            const axiosError = error as AxiosError;
            console.log('[DifyAPI] Login attempt failed:', axiosError.message);
            if (axiosError.response) {
                console.log('[DifyAPI] Response status:', axiosError.response.status);
                console.log('[DifyAPI] Response data:', JSON.stringify(axiosError.response.data, null, 2));
            }
            return false;
        }
    }

    /**
     * Refresh Access Token
     */
    private async refreshAccessToken(): Promise<void> {
        console.log('[DifyAPI] Refreshing access token...');
        const response = await this.client.post('/console/api/refresh-token', {
            refresh_token: this.refreshToken,
        });
        console.log('[DifyAPI] Refresh token response:', JSON.stringify(response.data, null, 2));
        
        // Try to get token from response body
        if (response.data.data?.access_token) {
            this.accessToken = response.data.data.access_token;
            this.refreshToken = response.data.data.refresh_token;
            console.log('[DifyAPI] Token refreshed from response body');
            return;
        }
        
        // Try to get token from cookies
        const setCookieHeader = response.headers['set-cookie'];
        const accessToken = parseCookieValue(setCookieHeader, 'access_token');
        const refreshToken = parseCookieValue(setCookieHeader, 'refresh_token');
        const csrfToken = parseCookieValue(setCookieHeader, 'csrf_token');
        
        if (accessToken) {
            this.accessToken = accessToken;
            this.refreshToken = refreshToken;
            this.csrfToken = csrfToken;
            console.log('[DifyAPI] Token refreshed from cookies');
        } else {
            console.log('[DifyAPI] No new token found in refresh response');
        }
    }

    /**
     * Get workspaces list (tenants the current user belongs to)
     */
    async getWorkspaces(): Promise<WorkspaceDetails[]> {
        try {
            console.log('[DifyAPI] Getting workspaces...');
            const response = await this.client.get('/console/api/workspaces');
            
            const workspaces = response.data.workspaces || response.data || [];
            console.log(`[DifyAPI] Found ${workspaces.length} workspaces`);
            
            return workspaces.map((ws: DifyWorkspace) => ({
                id: ws.id,
                name: ws.name,
                role: (ws.role || 'normal') as UserRole,
                current: ws.current || false,
            }));
        } catch (error) {
            console.error('[DifyAPI] Failed to get workspaces:', error);
            // If workspaces API fails, try to get current workspace from account info
            try {
                console.log('[DifyAPI] Trying to get workspace from account info...');
                const accountResponse = await this.client.get('/console/api/account/profile');
                const profile = accountResponse.data;
                
                // Return single workspace based on current tenant
                if (profile.current_tenant_id) {
                    return [{
                        id: profile.current_tenant_id,
                        name: profile.current_tenant_name || 'Default Workspace',
                        role: (profile.current_tenant_role || 'normal') as UserRole,
                        current: true,
                    }];
                }
            } catch (profileError) {
                console.error('[DifyAPI] Failed to get account profile:', profileError);
            }
            throw error;
        }
    }

    /**
     * Switch to a specific workspace
     */
    async switchWorkspace(tenantId: string): Promise<boolean> {
        try {
            console.log(`[DifyAPI] Switching to workspace: ${tenantId}`);
            await this.client.post('/console/api/workspaces/switch', {
                tenant_id: tenantId,
            });
            console.log('[DifyAPI] Workspace switched successfully');
            return true;
        } catch (error) {
            console.error('[DifyAPI] Failed to switch workspace:', error);
            return false;
        }
    }

    /**
     * Get current workspace info
     */
    async getCurrentWorkspace(): Promise<WorkspaceDetails | null> {
        try {
            const workspaces = await this.getWorkspaces();
            return workspaces.find(ws => ws.current) || workspaces[0] || null;
        } catch (error) {
            console.error('[DifyAPI] Failed to get current workspace:', error);
            return null;
        }
    }

    /**
     * Get app list
     */
    async getApps(page: number = 1, limit: number = 100): Promise<AppDetails[]> {
        try {
            const response = await this.client.get<DifyAppListResponse>('/console/api/apps', {
                params: { page, limit },
            });

            return response.data.data.map((app: DifyApp) => ({
                id: app.id,
                name: app.name,
                type: APP_MODE_TO_TYPE[app.mode] || 'workflow',
                updatedAt: app.updated_at,
            }));
        } catch (error) {
            console.error('Failed to get apps:', error);
            throw error;
        }
    }

    /**
     * Get all apps (paginated)
     */
    async getAllApps(): Promise<AppDetails[]> {
        console.log('[DifyAPI] getAllApps() called');
        console.log('[DifyAPI] Current accessToken:', this.accessToken ? `${this.accessToken.substring(0, 20)}...` : 'null');
        
        const allApps: AppDetails[] = [];
        let page = 1;
        const limit = 100;
        let hasMore = true;

        while (hasMore) {
            try {
                console.log(`[DifyAPI] Fetching apps page ${page}...`);
                const response = await this.client.get<DifyAppListResponse>('/console/api/apps', {
                    params: { page, limit },
                });

                console.log(`[DifyAPI] Got response for page ${page}, status:`, response.status);
                console.log(`[DifyAPI] Response data count:`, response.data.data?.length || 0);

                const apps = response.data.data.map((app: DifyApp) => ({
                    id: app.id,
                    name: app.name,
                    type: APP_MODE_TO_TYPE[app.mode] || 'workflow',
                    updatedAt: app.updated_at,
                }));

                allApps.push(...apps);
                hasMore = response.data.has_more;
                page++;
            } catch (error) {
                console.error('[DifyAPI] Failed to get apps page:', page, error);
                throw error;
            }
        }

        console.log(`[DifyAPI] getAllApps() completed, total apps:`, allApps.length);
        return allApps;
    }

    /**
     * Create a new app
     * Only workflow and chatflow (advanced-chat) types support DSL import/export
     */
    async createApp(
        name: string,
        mode: 'workflow' | 'advanced-chat',
        icon_type: 'emoji' | 'image' = 'emoji',
        icon: string = '🤖',
        icon_background: string = '#FFEAD5',
        description: string = ''
    ): Promise<{ id: string; name: string; mode: string }> {
        try {
            console.log(`[DifyAPI] Creating new app: ${name} (${mode})...`);
            
            const response = await this.client.post('/console/api/apps', {
                name,
                mode,
                icon_type,
                icon,
                icon_background,
                description,
            });
            
            console.log(`[DifyAPI] App created: ${response.data.id}`);
            return {
                id: response.data.id,
                name: response.data.name,
                mode: response.data.mode,
            };
        } catch (error) {
            console.error('[DifyAPI] Failed to create app:', error);
            throw error;
        }
    }

    /**
     * Export app DSL
     */
    async exportApp(appId: string): Promise<{ dsl: string; updatedAt: string }> {
        try {
            const response = await this.client.get(`/console/api/apps/${appId}/export`, {
                params: { include_secret: false },
            });

            // Get app details to get updated time
            const detailResponse = await this.client.get(`/console/api/apps/${appId}`);
            
            console.log(`[DifyAPI] App ${appId} updated_at:`, detailResponse.data.updated_at, typeof detailResponse.data.updated_at);
            
            return {
                dsl: response.data.data || response.data,
                updatedAt: detailResponse.data.updated_at,
            };
        } catch (error) {
            console.error('Failed to export app:', appId, error);
            throw error;
        }
    }

    /**
     * Import DSL to existing app (update app)
     * Uses the same /apps/imports endpoint with app_id parameter
     * Note: Only workflow and chatflow (advanced-chat) apps can be updated this way
     */
    async importApp(appId: string, dsl: string): Promise<boolean> {
        try {
            console.log(`[DifyAPI] Importing DSL to app ${appId}...`);
            const response = await this.client.post('/console/api/apps/imports', {
                mode: 'yaml-content',
                yaml_content: dsl,
                app_id: appId,
            });
            console.log('[DifyAPI] Import response:', JSON.stringify(response.data, null, 2));
            
            // Check for errors
            if (response.data.status === 'failed') {
                throw new Error(response.data.error || 'Import failed');
            }
            
            // Verify the app_id matches (not creating a new app)
            if (response.data.app_id && response.data.app_id !== appId) {
                console.warn(`[DifyAPI] Warning: Returned app_id ${response.data.app_id} differs from requested ${appId}`);
            }
            
            // If confirmation needed (pending status due to version mismatch)
            if (response.data.id && response.data.status === 'pending') {
                console.log('[DifyAPI] Confirming import due to version mismatch...');
                const confirmResponse = await this.client.post(
                    `/console/api/apps/imports/${response.data.id}/confirm`,
                    {}
                );
                console.log('[DifyAPI] Confirm response:', JSON.stringify(confirmResponse.data, null, 2));
                
                if (confirmResponse.data.status === 'failed') {
                    throw new Error(confirmResponse.data.error || 'Confirm failed');
                }
            }
            
            return true;
        } catch (error) {
            console.error('Failed to import app:', appId, error);
            throw error;
        }
    }

    /**
     * Create new app (by importing DSL)
     * Dify uses two-step import process: 1. Create import task 2. Confirm import
     */
    async createAppFromDsl(dsl: string, name?: string): Promise<string> {
        try {
            // Step 1: Create import task
            console.log('[DifyAPI] Creating app from DSL...');
            const importResponse = await this.client.post('/console/api/apps/imports', {
                mode: 'yaml-content',
                yaml_content: dsl,
                name: name,
            });
            
            console.log('[DifyAPI] Import response:', JSON.stringify(importResponse.data, null, 2));
            
            // Prefer app_id (the newly created app ID)
            if (importResponse.data.app_id) {
                console.log('[DifyAPI] App created with ID:', importResponse.data.app_id);
                return importResponse.data.app_id;
            }
            
            // If confirmation needed (via import_id)
            if (importResponse.data.import_id) {
                console.log('[DifyAPI] Confirming import...');
                const confirmResponse = await this.client.post(
                    `/console/api/apps/imports/${importResponse.data.import_id}/confirm`,
                    {}
                );
                console.log('[DifyAPI] Confirm response:', JSON.stringify(confirmResponse.data, null, 2));
                return confirmResponse.data.app_id || confirmResponse.data.id;
            }
            
            // Fallback: if only id without app_id
            return importResponse.data.id;
        } catch (error) {
            console.error('Failed to create app from DSL:', error);
            throw error;
        }
    }

    /**
     * Get app details
     */
    async getAppDetail(appId: string): Promise<{ name: string; updatedAt: string; mode: string }> {
        try {
            const response = await this.client.get(`/console/api/apps/${appId}`);
            return {
                name: response.data.name,
                updatedAt: response.data.updated_at,
                mode: response.data.mode,
            };
        } catch (error) {
            console.error('Failed to get app detail:', appId, error);
            throw error;
        }
    }

    /**
     * Get Dify editor URL for app
     */
    getAppEditorUrl(appId: string, appType: AppType): string {
        const typeToPath: Record<AppType, string> = {
            'chatbot': 'configuration',
            'text-generation': 'configuration',
            'agent': 'configuration',
            'chatflow': 'workflow',
            'workflow': 'workflow',
        };
        const path = typeToPath[appType] || 'configuration';
        return `${this.baseUrl}/app/${appId}/${path}`;
    }

    /**
     * Check if logged in
     */
    isLoggedIn(): boolean {
        return this.accessToken !== null;
    }

    /**
     * Logout
     */
    logout(): void {
        this.accessToken = null;
        this.refreshToken = null;
        this.csrfToken = null;
    }

    /**
     * Get model providers list
     * Returns all configured model providers in the current workspace
     */
    async getModelProviders(): Promise<ModelProviderSummary[]> {
        try {
            console.log('[DifyAPI] Getting model providers...');
            const response = await this.client.get('/console/api/workspaces/current/model-providers');
            
            const providers = response.data.data || response.data || [];
            console.log(`[DifyAPI] Found ${providers.length} model providers`);
            
            const result: ModelProviderSummary[] = [];
            
            for (const provider of providers) {
                // Determine provider status
                const hasCredential = provider.system_configuration?.current_credentials?.length > 0 ||
                                     provider.custom_configuration?.provider?.credentials;
                
                result.push({
                    provider: provider.provider,
                    label: provider.label?.en_US || provider.label?.zh_Hans || provider.provider,
                    icon: provider.icon_small?.en_US || provider.icon_small?.zh_Hans,
                    status: hasCredential ? 'active' : 'no-configure',
                    models: [], // Will be populated by getModelsForType
                });
            }
            
            return result;
        } catch (error) {
            console.error('[DifyAPI] Failed to get model providers:', error);
            throw error;
        }
    }

    /**
     * Get models for a specific model type
     * @param modelType - Type of models to fetch (llm, text-embedding, rerank, etc.)
     */
    async getModelsForType(modelType: ModelTypeCategory): Promise<ModelSummary[]> {
        try {
            console.log(`[DifyAPI] Getting ${modelType} models...`);
            const response = await this.client.get(`/console/api/workspaces/current/models/model-types/${modelType}`);
            
            const modelsData = response.data.data || response.data || [];
            console.log(`[DifyAPI] Found ${modelsData.length} ${modelType} model entries`);
            
            const models: ModelSummary[] = [];
            
            for (const providerEntry of modelsData) {
                const providerName = providerEntry.provider;
                const providerModels = providerEntry.models || [];
                
                for (const model of providerModels) {
                    models.push({
                        model: model.model,
                        label: model.label?.en_US || model.label?.zh_Hans || model.model,
                        model_type: modelType,
                        provider: providerName,
                        features: model.features || [],
                        context_size: model.model_properties?.context_size,
                        mode: model.model_properties?.mode,
                        deprecated: model.deprecated,
                        status: model.status,
                        pricing: model.pricing,
                    });
                }
            }
            
            return models;
        } catch (error) {
            console.error(`[DifyAPI] Failed to get ${modelType} models:`, error);
            throw error;
        }
    }

    /**
     * Get all models from the workspace
     * Returns a complete ModelsRegistry with all providers and their models
     */
    async getAllModels(): Promise<ModelsRegistry> {
        console.log('[DifyAPI] Getting all models...');
        
        // Get all model providers first
        const providers = await this.getModelProviders();
        
        // Get models for each type
        const modelTypes: ModelTypeCategory[] = ['llm', 'text-embedding', 'rerank', 'speech2text', 'tts'];
        const allModels: ModelSummary[] = [];
        
        for (const modelType of modelTypes) {
            try {
                const models = await this.getModelsForType(modelType);
                allModels.push(...models);
            } catch (error) {
                console.warn(`[DifyAPI] Failed to get ${modelType} models, skipping...`);
            }
        }
        
        // Group models by provider
        const modelsByProvider = new Map<string, ModelSummary[]>();
        for (const model of allModels) {
            const existing = modelsByProvider.get(model.provider) || [];
            existing.push(model);
            modelsByProvider.set(model.provider, existing);
        }
        
        // Merge models into providers
        for (const provider of providers) {
            provider.models = modelsByProvider.get(provider.provider) || [];
        }
        
        // Filter out providers with no configured models
        const activeProviders = providers.filter(p => p.models.length > 0 || p.status === 'active');
        
        // Try to get default model settings
        let defaultModels: ModelsRegistry['default_models'] = {};
        try {
            const defaultModelResponse = await this.client.get('/console/api/workspaces/current/default-model');
            const defaultModelData = defaultModelResponse.data;
            if (defaultModelData) {
                defaultModels = {
                    llm: defaultModelData.model?.model,
                    text_embedding: defaultModelData.text_embedding_model?.model,
                    rerank: defaultModelData.rerank_model?.model,
                    speech2text: defaultModelData.speech2text_model?.model,
                    tts: defaultModelData.tts_model?.model,
                };
            }
        } catch {
            console.log('[DifyAPI] Could not get default models, continuing...');
        }
        
        const registry: ModelsRegistry = {
            last_synced_at: new Date().toISOString(),
            default_models: defaultModels,
            providers: activeProviders,
        };
        
        console.log(`[DifyAPI] Models registry complete: ${activeProviders.length} providers, ${allModels.length} models`);
        return registry;
    }

    // ==================== Knowledge (Datasets) API ====================

    /**
     * Get all knowledge bases (datasets)
     */
    async getAllKnowledge(): Promise<KnowledgeRegistry> {
        console.log('[DifyAPI] Getting all knowledge bases...');
        
        const allDatasets: KnowledgeSummary[] = [];
        let page = 1;
        const limit = 100;
        let hasMore = true;

        while (hasMore) {
            try {
                const response = await this.client.get('/console/api/datasets', {
                    params: { page, limit },
                });

                const data = response.data.data || response.data || [];
                
                for (const dataset of data) {
                    allDatasets.push({
                        id: dataset.id,
                        name: dataset.name,
                        description: dataset.description,
                        provider: dataset.provider || 'vendor',
                        permission: dataset.permission || 'only_me',
                        data_source_type: dataset.data_source_type,
                        indexing_technique: dataset.indexing_technique,
                        app_count: dataset.app_count || 0,
                        document_count: dataset.document_count || 0,
                        word_count: dataset.word_count || 0,
                        created_at: dataset.created_at,
                        updated_at: dataset.updated_at,
                    });
                }

                hasMore = response.data.has_more || false;
                page++;
            } catch (error) {
                console.error('[DifyAPI] Failed to get knowledge bases page:', page, error);
                break;
            }
        }

        const registry: KnowledgeRegistry = {
            last_synced_at: new Date().toISOString(),
            datasets: allDatasets,
        };

        console.log(`[DifyAPI] Knowledge registry complete: ${allDatasets.length} datasets`);
        return registry;
    }

    // ==================== Tools API ====================

    /**
     * Get all tool providers with their detailed tools
     */
    async getAllTools(): Promise<ToolsRegistry> {
        console.log('[DifyAPI] Getting all tools...');
        
        try {
            const response = await this.client.get('/console/api/workspaces/current/tool-providers');
            const providers = response.data || [];
            
            const toolProviders: ToolSummary[] = [];
            
            for (const provider of providers) {
                let tools = provider.tools || [];
                
                // If tools array is empty or missing parameters, try to fetch detailed tools
                if (tools.length === 0 || (tools.length > 0 && !tools[0].parameters)) {
                    const detailedTools = await this.getToolProviderTools(provider.name, provider.type || 'builtin');
                    if (detailedTools.length > 0) {
                        tools = detailedTools;
                    }
                }
                
                toolProviders.push({
                    name: provider.name,
                    author: provider.author || 'dify',
                    label: provider.label?.en_US || provider.label?.zh_Hans || provider.name,
                    description: provider.description?.en_US || provider.description?.zh_Hans,
                    icon: provider.icon,
                    type: provider.type || 'builtin',
                    team_credentials: provider.team_credentials,
                    is_team_authorization: provider.is_team_authorization || false,
                    tools: tools.map((tool: { 
                        name: string; 
                        author?: string; 
                        label?: { en_US?: string; zh_Hans?: string } | string; 
                        description?: { en_US?: string; zh_Hans?: string } | string; 
                        parameters?: unknown[];
                        human_description?: { en_US?: string; zh_Hans?: string } | string;
                    }) => ({
                        name: tool.name,
                        author: tool.author || provider.author || 'dify',
                        label: typeof tool.label === 'string' ? tool.label : (tool.label?.en_US || tool.label?.zh_Hans || tool.name),
                        description: typeof tool.description === 'string' ? tool.description : 
                            (tool.description?.en_US || tool.description?.zh_Hans || 
                             (typeof tool.human_description === 'string' ? tool.human_description : 
                              (tool.human_description?.en_US || tool.human_description?.zh_Hans))),
                        parameters: this.normalizeToolParameters(tool.parameters),
                    })),
                });
            }

            const registry: ToolsRegistry = {
                last_synced_at: new Date().toISOString(),
                providers: toolProviders,
            };

            console.log(`[DifyAPI] Tools registry complete: ${toolProviders.length} providers`);
            return registry;
        } catch (error) {
            console.error('[DifyAPI] Failed to get tools:', error);
            throw error;
        }
    }

    /**
     * Get detailed tools for a specific tool provider
     */
    private async getToolProviderTools(providerName: string, providerType: string): Promise<unknown[]> {
        // Try multiple API paths
        const pathVariations = [
            `/console/api/workspaces/current/tool-provider/${providerType}/${providerName}/tools`,
            `/console/api/workspaces/current/tool-provider/builtin/${providerName}/tools`,
            `/console/api/workspaces/current/tool-providers/${providerName}/tools`,
        ];
        
        for (const apiPath of pathVariations) {
            try {
                const response = await this.client.get(apiPath);
                if (response.data && Array.isArray(response.data)) {
                    console.log(`[DifyAPI] Got ${response.data.length} tools for provider ${providerName}`);
                    return response.data;
                }
            } catch {
                // Try next path
            }
        }
        
        return [];
    }

    /**
     * Normalize tool parameters to a consistent format
     */
    private normalizeToolParameters(parameters: unknown[] | undefined): ToolParameter[] {
        if (!parameters || !Array.isArray(parameters)) {
            return [];
        }
        
        return parameters.map((param: unknown) => {
            const p = param as {
                name?: string;
                label?: { en_US?: string; zh_Hans?: string } | string;
                human_description?: { en_US?: string; zh_Hans?: string } | string;
                type?: string;
                form?: string;
                required?: boolean;
                default?: unknown;
                options?: Array<{ label?: { en_US?: string; zh_Hans?: string } | string; value: string }>;
            };
            
            return {
                name: p.name || '',
                label: typeof p.label === 'string' ? p.label : (p.label?.en_US || p.label?.zh_Hans || p.name || ''),
                description: typeof p.human_description === 'string' ? p.human_description : 
                    (p.human_description?.en_US || p.human_description?.zh_Hans),
                type: p.type || p.form || 'string',
                required: p.required || false,
                default: p.default,
                options: p.options?.map((opt) => ({
                    label: typeof opt.label === 'string' ? opt.label : (opt.label?.en_US || opt.label?.zh_Hans || opt.value),
                    value: opt.value,
                })),
            };
        });
    }

    // ==================== Plugins API ====================

    /**
     * Get all installed plugins
     */
    async getAllPlugins(): Promise<PluginsRegistry> {
        console.log('[DifyAPI] Getting all plugins...');
        
        try {
            const response = await this.client.get('/console/api/workspaces/current/plugin/list', {
                params: { page: 1, page_size: 100 },
            });
            
            const pluginsData = response.data.plugins || response.data || [];
            
            const plugins: PluginSummary[] = [];
            
            for (const plugin of pluginsData) {
                plugins.push({
                    plugin_id: plugin.plugin_id,
                    plugin_unique_identifier: plugin.plugin_unique_identifier,
                    name: plugin.name || plugin.plugin_id,
                    label: plugin.declaration?.label?.en_US || plugin.declaration?.label?.zh_Hans || plugin.name,
                    description: plugin.declaration?.description?.en_US || plugin.declaration?.description?.zh_Hans,
                    icon: plugin.declaration?.icon,
                    version: plugin.version,
                    author: plugin.declaration?.author || 'unknown',
                    category: plugin.declaration?.category || 'tool',
                    type: plugin.source || 'marketplace',
                    source: plugin.source,
                    latest_version: plugin.latest_version,
                    latest_unique_identifier: plugin.latest_unique_identifier,
                    installation_id: plugin.installation_id,
                    endpoints_active: plugin.endpoints_active || false,
                    declaration: {
                        plugins: plugin.declaration?.plugins,
                        model: plugin.declaration?.model,
                        tool: plugin.declaration?.tool,
                        endpoint: plugin.declaration?.endpoint,
                        agent_strategy: plugin.declaration?.agent_strategy,
                    },
                    created_at: plugin.created_at,
                });
            }

            const registry: PluginsRegistry = {
                last_synced_at: new Date().toISOString(),
                plugins: plugins,
            };

            console.log(`[DifyAPI] Plugins registry complete: ${plugins.length} plugins`);
            return registry;
        } catch (error) {
            console.error('[DifyAPI] Failed to get plugins:', error);
            throw error;
        }
    }

    // ==================== Knowledge Documents API ====================

    /**
     * Get documents list from a specific knowledge base
     */
    async getDatasetDocuments(datasetId: string): Promise<DocumentSummary[]> {
        console.log(`[DifyAPI] Getting documents for dataset ${datasetId}...`);
        
        const allDocuments: DocumentSummary[] = [];
        let page = 1;
        const limit = 100;
        let hasMore = true;

        while (hasMore) {
            try {
                const response = await this.client.get(`/console/api/datasets/${datasetId}/documents`, {
                    params: { page, limit },
                });

                const data = response.data.data || response.data || [];
                
                for (const doc of data) {
                    allDocuments.push({
                        id: doc.id,
                        name: doc.name,
                        data_source_type: doc.data_source_type,
                        word_count: doc.word_count || 0,
                        tokens: doc.tokens || 0,
                        indexing_status: doc.indexing_status,
                        enabled: doc.enabled,
                        archived: doc.archived || false,
                        display_status: doc.display_status,
                        created_at: doc.created_at,
                        updated_at: doc.updated_at,
                        doc_form: doc.doc_form,
                    });
                }

                hasMore = response.data.has_more || false;
                page++;
            } catch (error) {
                console.error(`[DifyAPI] Failed to get documents page ${page}:`, error);
                break;
            }
        }

        console.log(`[DifyAPI] Found ${allDocuments.length} documents`);
        return allDocuments;
    }

    /**
     * Get document segments (chunks) from a specific document
     */
    async getDocumentSegments(datasetId: string, documentId: string): Promise<DocumentSegment[]> {
        console.log(`[DifyAPI] Getting segments for document ${documentId}...`);
        
        const allSegments: DocumentSegment[] = [];
        let page = 1;
        const limit = 100;
        let hasMore = true;

        while (hasMore) {
            try {
                const response = await this.client.get(`/console/api/datasets/${datasetId}/documents/${documentId}/segments`, {
                    params: { page, limit },
                });

                const data = response.data.data || response.data || [];
                
                for (const seg of data) {
                    allSegments.push({
                        id: seg.id,
                        position: seg.position,
                        document_id: seg.document_id,
                        content: seg.content,
                        word_count: seg.word_count || 0,
                        tokens: seg.tokens || 0,
                        keywords: seg.keywords || [],
                        index_node_id: seg.index_node_id,
                        index_node_hash: seg.index_node_hash,
                        hit_count: seg.hit_count || 0,
                        enabled: seg.enabled,
                        disabled_at: seg.disabled_at,
                        disabled_by: seg.disabled_by,
                        status: seg.status,
                        created_at: seg.created_at,
                        updated_at: seg.updated_at,
                        indexing_at: seg.indexing_at,
                        completed_at: seg.completed_at,
                        error: seg.error,
                        stopped_at: seg.stopped_at,
                        answer: seg.answer,
                    });
                }

                hasMore = response.data.has_more || false;
                page++;
            } catch (error) {
                console.error(`[DifyAPI] Failed to get segments page ${page}:`, error);
                break;
            }
        }

        console.log(`[DifyAPI] Found ${allSegments.length} segments`);
        return allSegments;
    }

    /**
     * Get knowledge base details
     */
    async getDatasetDetail(datasetId: string): Promise<KnowledgeSummary & { embedding_model?: string; embedding_model_provider?: string }> {
        console.log(`[DifyAPI] Getting dataset detail for ${datasetId}...`);
        
        try {
            const response = await this.client.get(`/console/api/datasets/${datasetId}`);
            const dataset = response.data;
            
            return {
                id: dataset.id,
                name: dataset.name,
                description: dataset.description,
                provider: dataset.provider || 'vendor',
                permission: dataset.permission || 'only_me',
                data_source_type: dataset.data_source_type,
                indexing_technique: dataset.indexing_technique,
                app_count: dataset.app_count || 0,
                document_count: dataset.document_count || 0,
                word_count: dataset.word_count || 0,
                created_at: dataset.created_at,
                updated_at: dataset.updated_at,
                embedding_model: dataset.embedding_model,
                embedding_model_provider: dataset.embedding_model_provider,
            };
        } catch (error) {
            console.error(`[DifyAPI] Failed to get dataset detail:`, error);
            throw error;
        }
    }

    /**
     * Create a new document in knowledge base by uploading text content
     * Uses multipart/form-data file upload to match Dify Console's behavior
     */
    async createDocumentByText(
        datasetId: string,
        name: string,
        text: string,
        indexingTechnique: 'high_quality' | 'economy' = 'high_quality',
        processRule?: {
            mode: 'automatic' | 'custom';
            rules?: {
                pre_processing_rules?: Array<{ id: string; enabled: boolean }>;
                segmentation?: { separator: string; max_tokens: number; chunk_overlap: number };
            };
        }
    ): Promise<{ document_id: string; batch: string }> {
        console.log(`[DifyAPI] Creating document "${name}" in dataset ${datasetId}...`);
        
        // Create a virtual file from text content
        const fileContent = Buffer.from(text, 'utf-8');
        const fileName = name.endsWith('.txt') ? name : `${name}.txt`;
        
        // Build FormData for file upload
        const formData = new FormData();
        formData.append('file', fileContent, {
            filename: fileName,
            contentType: 'text/plain; charset=utf-8',
        });
        
        // Document processing settings
        const documentData = {
            indexing_technique: indexingTechnique,
            process_rule: processRule || {
                mode: 'automatic',
            },
            doc_form: 'text_model',
            doc_language: 'Chinese',
        };
        formData.append('data', JSON.stringify(documentData));
        
        // Try multiple API path variations for file upload
        const pathVariations = [
            `/console/api/datasets/${datasetId}/document/create-by-file`,
            `/console/api/datasets/${datasetId}/document/create_by_file`,
            `/console/api/datasets/${datasetId}/documents/create-by-file`,
            `/console/api/datasets/${datasetId}/documents/create_by_file`,
        ];
        
        for (const apiPath of pathVariations) {
            try {
                console.log(`[DifyAPI] Trying file upload: POST ${apiPath}`);
                
                // Create a new FormData for each attempt
                const fd = new FormData();
                fd.append('file', fileContent, {
                    filename: fileName,
                    contentType: 'text/plain; charset=utf-8',
                });
                fd.append('data', JSON.stringify(documentData));
                
                const response = await this.client.post(apiPath, fd, {
                    headers: {
                        ...fd.getHeaders(),
                    },
                });
                
                console.log(`[DifyAPI] Document created via file upload: ${response.data.document?.id || response.data.id}`);
                return {
                    document_id: response.data.document?.id || response.data.id,
                    batch: response.data.batch,
                };
            } catch (error: unknown) {
                const axiosError = error as { response?: { status?: number; data?: unknown } };
                if (axiosError.response?.status === 404) {
                    console.log(`[DifyAPI] Path not found: ${apiPath}, trying next...`);
                    continue;
                }
                // Log error details and continue
                console.error(`[DifyAPI] Failed with ${apiPath}:`, axiosError.response?.data || error);
            }
        }
        
        // Fallback: try JSON-based create-by-text endpoints
        console.log('[DifyAPI] File upload methods failed, trying JSON-based endpoints...');
        const jsonRequestBody = {
            name,
            text,
            indexing_technique: indexingTechnique,
            process_rule: processRule || {
                mode: 'automatic',
            },
        };
        
        const jsonPathVariations = [
            `/console/api/datasets/${datasetId}/document/create-by-text`,
            `/console/api/datasets/${datasetId}/document/create_by_text`,
        ];
        
        for (const apiPath of jsonPathVariations) {
            try {
                console.log(`[DifyAPI] Trying JSON: POST ${apiPath}`);
                const response = await this.client.post(apiPath, jsonRequestBody);
                
                console.log(`[DifyAPI] Document created: ${response.data.document?.id || response.data.id}`);
                return {
                    document_id: response.data.document?.id || response.data.id,
                    batch: response.data.batch,
                };
            } catch (error: unknown) {
                const axiosError = error as { response?: { status?: number } };
                if (axiosError.response?.status === 404) {
                    console.log(`[DifyAPI] Path not found: ${apiPath}, trying next...`);
                    continue;
                }
                console.error('[DifyAPI] Failed to create document:', error);
            }
        }
        
        throw new Error('Failed to create document: No valid API endpoint found. Please check Dify version compatibility.');
    }

    /**
     * Update an existing document with new text content
     * Uses segment replacement: delete all segments and add new one with full content
     */
    async updateDocumentByText(
        datasetId: string,
        documentId: string,
        name: string,
        text: string,
        _processRule?: {
            mode: 'automatic' | 'custom';
            rules?: {
                pre_processing_rules?: Array<{ id: string; enabled: boolean }>;
                segmentation?: { separator: string; max_tokens: number; chunk_overlap: number };
            };
        }
    ): Promise<{ document_id: string; batch: string }> {
        console.log(`[DifyAPI] Updating document ${documentId} in dataset ${datasetId}...`);
        
        // Strategy: Replace all segments with new content
        // This is safer than delete-and-recreate approach
        
        try {
            // Step 1: Get existing segments
            console.log('[DifyAPI] Getting existing segments...');
            const existingSegments = await this.getDocumentSegments(datasetId, documentId);
            console.log(`[DifyAPI] Found ${existingSegments.length} existing segments`);
            
            // Step 2: Delete all existing segments
            for (const segment of existingSegments) {
                try {
                    await this.deleteSegment(datasetId, documentId, segment.id);
                } catch (error) {
                    console.warn(`[DifyAPI] Failed to delete segment ${segment.id}, continuing...`);
                }
            }
            console.log('[DifyAPI] Deleted existing segments');
            
            // Step 3: Add new segment with full content
            console.log('[DifyAPI] Adding new segment with updated content...');
            await this.addDocumentSegments(datasetId, documentId, [
                { content: text }
            ]);
            
            console.log(`[DifyAPI] Document updated via segment replacement: ${documentId}`);
            return {
                document_id: documentId,
                batch: '',
            };
        } catch (error) {
            console.error('[DifyAPI] Failed to update document via segment replacement:', error);
            throw new Error(`Failed to update document: Dify API does not support direct document update. Error: ${error}`);
        }
    }

    /**
     * Delete a document from knowledge base
     */
    async deleteDocument(datasetId: string, documentId: string): Promise<boolean> {
        console.log(`[DifyAPI] Deleting document ${documentId} from dataset ${datasetId}...`);
        
        try {
            await this.client.delete(`/console/api/datasets/${datasetId}/documents/${documentId}`);
            console.log(`[DifyAPI] Document deleted: ${documentId}`);
            return true;
        } catch (error) {
            console.error('[DifyAPI] Failed to delete document:', error);
            throw error;
        }
    }

    /**
     * Add segments to a document
     */
    async addDocumentSegments(
        datasetId: string,
        documentId: string,
        segments: Array<{ content: string; answer?: string; keywords?: string[] }>
    ): Promise<{ batch: string; segments: DocumentSegment[] }> {
        console.log(`[DifyAPI] Adding ${segments.length} segments to document ${documentId}...`);
        
        try {
            const response = await this.client.post(`/console/api/datasets/${datasetId}/documents/${documentId}/segments`, {
                segments,
            });
            
            console.log(`[DifyAPI] Segments added`);
            return {
                batch: response.data.batch,
                segments: response.data.data || [],
            };
        } catch (error) {
            console.error('[DifyAPI] Failed to add segments:', error);
            throw error;
        }
    }

    /**
     * Update a segment
     */
    async updateSegment(
        datasetId: string,
        documentId: string,
        segmentId: string,
        content: string,
        answer?: string,
        keywords?: string[]
    ): Promise<DocumentSegment> {
        console.log(`[DifyAPI] Updating segment ${segmentId}...`);
        
        try {
            const response = await this.client.patch(`/console/api/datasets/${datasetId}/documents/${documentId}/segments/${segmentId}`, {
                segment: {
                    content,
                    answer,
                    keywords,
                },
            });
            
            console.log(`[DifyAPI] Segment updated`);
            return response.data.data;
        } catch (error) {
            console.error('[DifyAPI] Failed to update segment:', error);
            throw error;
        }
    }

    /**
     * Delete a segment
     */
    async deleteSegment(datasetId: string, documentId: string, segmentId: string): Promise<boolean> {
        console.log(`[DifyAPI] Deleting segment ${segmentId}...`);
        
        try {
            await this.client.delete(`/console/api/datasets/${datasetId}/documents/${documentId}/segments/${segmentId}`);
            console.log(`[DifyAPI] Segment deleted`);
            return true;
        } catch (error) {
            console.error('[DifyAPI] Failed to delete segment:', error);
            throw error;
        }
    }
}

// Cache API client instances
const apiClients: Map<string, DifyApiClient> = new Map();

/**
 * Get or create API client
 */
export function getApiClient(baseUrl: string): DifyApiClient {
    const normalizedUrl = baseUrl.replace(/\/+$/, '');
    
    if (!apiClients.has(normalizedUrl)) {
        apiClients.set(normalizedUrl, new DifyApiClient(normalizedUrl));
    }
    
    return apiClients.get(normalizedUrl)!;
}

/**
 * Remove API client
 */
export function removeApiClient(baseUrl: string): void {
    const normalizedUrl = baseUrl.replace(/\/+$/, '');
    const client = apiClients.get(normalizedUrl);
    if (client) {
        client.logout();
        apiClients.delete(normalizedUrl);
    }
}
