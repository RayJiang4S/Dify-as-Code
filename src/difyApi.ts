/**
 * Dify API Client
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { DifyApp, DifyAppListResponse, DifyWorkspace, APP_MODE_TO_TYPE, AppType, UserRole } from './types';

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
     */
    async login(email: string, password: string): Promise<boolean> {
        try {
            console.log(`[DifyAPI] Attempting login to ${this.baseUrl} with email: ${email}`);
            console.log(`[DifyAPI] Request URL: ${this.baseUrl}/console/api/login`);
            
            const response = await this.client.post('/console/api/login', {
                email,
                password: encryptField(password),
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

            console.log('[DifyAPI] Login failed: unexpected response format');
            return false;
        } catch (error: unknown) {
            const axiosError = error as AxiosError;
            console.error('[DifyAPI] Login failed:', axiosError.message);
            if (axiosError.response) {
                console.error('[DifyAPI] Response status:', axiosError.response.status);
                console.error('[DifyAPI] Response data:', JSON.stringify(axiosError.response.data, null, 2));
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
