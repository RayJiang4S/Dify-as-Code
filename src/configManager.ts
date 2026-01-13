/**
 * Configuration File Manager
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as crypto from 'crypto';
import {
    PlatformConfig,
    AccountConfig,
    SecretsConfig,
    WorkspaceConfig,
    SyncMetadata,
    AppType,
    UserRole,
    PlatformNodeData,
    AccountNodeData,
    WorkspaceNodeData,
    AppNodeData,
    SyncStatus,
    APP_MODE_TO_TYPE,
} from './types';

export class ConfigManager {
    private workspaceRoot: string;

    constructor() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            throw new Error('Please open a workspace folder first');
        }
        this.workspaceRoot = workspaceFolders[0].uri.fsPath;
    }

    /**
     * Get workspace root directory
     */
    getWorkspaceRoot(): string {
        return this.workspaceRoot;
    }

    // ==================== Platform Operations ====================

    /**
     * Get all platforms
     */
    async getAllPlatforms(): Promise<PlatformNodeData[]> {
        const platforms: PlatformNodeData[] = [];
        
        try {
            const entries = await fs.promises.readdir(this.workspaceRoot, { withFileTypes: true });
            
            for (const entry of entries) {
                if (entry.isDirectory() && !entry.name.startsWith('.')) {
                    const platformPath = path.join(this.workspaceRoot, entry.name);
                    const configPath = path.join(platformPath, '.platform.yml');
                    
                    if (fs.existsSync(configPath)) {
                        try {
                            const content = await fs.promises.readFile(configPath, 'utf-8');
                            const config = yaml.load(content) as PlatformConfig;
                            
                            platforms.push({
                                type: 'platform',
                                name: config.name,
                                url: config.url,
                                path: platformPath,
                            });
                        } catch (error) {
                            console.error(`Failed to read platform config: ${configPath}`, error);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Failed to read platforms:', error);
        }
        
        return platforms;
    }

    /**
     * Create platform
     */
    async createPlatform(name: string, url: string): Promise<PlatformNodeData> {
        // Sanitize name, remove unsafe characters
        const safeName = this.sanitizeName(name);
        const platformPath = path.join(this.workspaceRoot, safeName);
        
        // Check if already exists
        if (fs.existsSync(platformPath)) {
            throw new Error(`Platform "${name}" already exists`);
        }
        
        // Create directory
        await fs.promises.mkdir(platformPath, { recursive: true });
        
        // Create config file
        const config: PlatformConfig = { name, url };
        const configPath = path.join(platformPath, '.platform.yml');
        await fs.promises.writeFile(configPath, yaml.dump(config), 'utf-8');
        
        return {
            type: 'platform',
            name,
            url,
            path: platformPath,
        };
    }

    /**
     * Update platform
     */
    async updatePlatform(platformPath: string, name: string, url: string): Promise<void> {
        const configPath = path.join(platformPath, '.platform.yml');
        const config: PlatformConfig = { name, url };
        await fs.promises.writeFile(configPath, yaml.dump(config), 'utf-8');
    }

    /**
     * Delete platform
     */
    async deletePlatform(platformPath: string): Promise<void> {
        await fs.promises.rm(platformPath, { recursive: true, force: true });
    }

    // ==================== Account Operations ====================

    /**
     * Get all accounts for a platform
     */
    async getAccountsForPlatform(platformPath: string, platformUrl: string): Promise<AccountNodeData[]> {
        const accounts: AccountNodeData[] = [];
        const platformName = path.basename(platformPath);
        
        try {
            const entries = await fs.promises.readdir(platformPath, { withFileTypes: true });
            
            for (const entry of entries) {
                if (entry.isDirectory() && !entry.name.startsWith('.')) {
                    const accountPath = path.join(platformPath, entry.name);
                    const configPath = path.join(accountPath, '.account.yml');
                    
                    if (fs.existsSync(configPath)) {
                        try {
                            const content = await fs.promises.readFile(configPath, 'utf-8');
                            const config = yaml.load(content) as AccountConfig;
                            
                            accounts.push({
                                type: 'account',
                                email: config.email,
                                platformName,
                                platformUrl,
                                path: accountPath,
                            });
                        } catch (error) {
                            console.error(`Failed to read account config: ${configPath}`, error);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Failed to read accounts:', error);
        }
        
        return accounts;
    }

    /**
     * Create account
     */
    async createAccount(
        platformPath: string,
        platformUrl: string,
        email: string,
        password: string
    ): Promise<AccountNodeData> {
        const safeName = this.sanitizeName(email);
        const accountPath = path.join(platformPath, safeName);
        const platformName = path.basename(platformPath);
        
        // Check if already exists
        if (fs.existsSync(accountPath)) {
            throw new Error(`Account "${email}" already exists`);
        }
        
        // Create directory
        await fs.promises.mkdir(accountPath, { recursive: true });
        
        // Create account config file (simplified - only email, no apps list)
        const accountConfig: AccountConfig = { email };
        const accountConfigPath = path.join(accountPath, '.account.yml');
        await fs.promises.writeFile(accountConfigPath, yaml.dump(accountConfig), 'utf-8');
        
        // Create secrets config file
        const secretsConfig: SecretsConfig = { password };
        const secretsPath = path.join(accountPath, '.secrets.yml');
        await fs.promises.writeFile(secretsPath, yaml.dump(secretsConfig), 'utf-8');
        
        // Ensure .gitignore exists
        await this.ensureGitignore();
        
        return {
            type: 'account',
            email,
            platformName,
            platformUrl,
            path: accountPath,
        };
    }

    /**
     * Get account password
     */
    async getAccountPassword(accountPath: string): Promise<string | null> {
        const secretsPath = path.join(accountPath, '.secrets.yml');
        
        try {
            if (fs.existsSync(secretsPath)) {
                const content = await fs.promises.readFile(secretsPath, 'utf-8');
                const secrets = yaml.load(content) as SecretsConfig;
                return secrets.password || null;
            }
        } catch (error) {
            console.error('Failed to read secrets:', error);
        }
        
        return null;
    }

    /**
     * Update account
     */
    async updateAccount(accountPath: string, email: string, password?: string): Promise<void> {
        // Update account config
        const accountConfigPath = path.join(accountPath, '.account.yml');
        const content = await fs.promises.readFile(accountConfigPath, 'utf-8');
        const config = yaml.load(content) as AccountConfig;
        config.email = email;
        await fs.promises.writeFile(accountConfigPath, yaml.dump(config), 'utf-8');
        
        // If password provided, update secrets config
        if (password) {
            const secretsPath = path.join(accountPath, '.secrets.yml');
            const secretsConfig: SecretsConfig = { password };
            await fs.promises.writeFile(secretsPath, yaml.dump(secretsConfig), 'utf-8');
        }
    }

    /**
     * Delete account
     */
    async deleteAccount(accountPath: string): Promise<void> {
        await fs.promises.rm(accountPath, { recursive: true, force: true });
    }

    // ==================== Workspace Operations ====================

    /**
     * Get all workspaces for an account
     */
    async getWorkspacesForAccount(
        accountPath: string,
        platformUrl: string,
        accountEmail: string
    ): Promise<WorkspaceNodeData[]> {
        const workspaces: WorkspaceNodeData[] = [];
        
        try {
            const entries = await fs.promises.readdir(accountPath, { withFileTypes: true });
            
            for (const entry of entries) {
                if (entry.isDirectory() && !entry.name.startsWith('.')) {
                    const workspacePath = path.join(accountPath, entry.name);
                    const configPath = path.join(workspacePath, '.workspace.yml');
                    
                    if (fs.existsSync(configPath)) {
                        try {
                            const content = await fs.promises.readFile(configPath, 'utf-8');
                            const config = yaml.load(content) as WorkspaceConfig;
                            
                            workspaces.push({
                                type: 'workspace',
                                id: config.id,
                                name: config.name,
                                role: config.role,
                                platformUrl,
                                accountEmail,
                                path: workspacePath,
                            });
                        } catch (error) {
                            console.error(`Failed to read workspace config: ${configPath}`, error);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Failed to read workspaces:', error);
        }
        
        return workspaces;
    }

    /**
     * Create or update workspace
     */
    async saveWorkspace(
        accountPath: string,
        workspaceId: string,
        workspaceName: string,
        role: UserRole,
        platformUrl: string,
        accountEmail: string
    ): Promise<WorkspaceNodeData> {
        const safeName = this.sanitizeName(workspaceName);
        const workspacePath = path.join(accountPath, safeName);
        
        // Create workspace directory
        await fs.promises.mkdir(workspacePath, { recursive: true });
        
        // Create workspace config file
        const config: WorkspaceConfig = { id: workspaceId, name: workspaceName, role };
        const configPath = path.join(workspacePath, '.workspace.yml');
        await fs.promises.writeFile(configPath, yaml.dump(config), 'utf-8');
        
        // Create subdirectories for resources
        await this.ensureWorkspaceStructure(workspacePath);
        
        return {
            type: 'workspace',
            id: workspaceId,
            name: workspaceName,
            role,
            platformUrl,
            accountEmail,
            path: workspacePath,
        };
    }

    /**
     * Ensure workspace has all required subdirectories
     */
    async ensureWorkspaceStructure(workspacePath: string): Promise<void> {
        const subdirs = ['studio', 'knowledge', 'tools', 'plugins'];
        
        for (const subdir of subdirs) {
            const subdirPath = path.join(workspacePath, subdir);
            if (!fs.existsSync(subdirPath)) {
                await fs.promises.mkdir(subdirPath, { recursive: true });
                // Create a placeholder file to indicate this is a managed directory
                const placeholderPath = path.join(subdirPath, '.gitkeep');
                await fs.promises.writeFile(placeholderPath, '', 'utf-8');
            }
        }
    }

    /**
     * Delete workspace
     */
    async deleteWorkspace(workspacePath: string): Promise<void> {
        await fs.promises.rm(workspacePath, { recursive: true, force: true });
    }

    /**
     * Find workspace by ID
     */
    async findWorkspaceById(accountPath: string, workspaceId: string): Promise<string | null> {
        try {
            const entries = await fs.promises.readdir(accountPath, { withFileTypes: true });
            
            for (const entry of entries) {
                if (entry.isDirectory() && !entry.name.startsWith('.')) {
                    const workspacePath = path.join(accountPath, entry.name);
                    const configPath = path.join(workspacePath, '.workspace.yml');
                    
                    if (fs.existsSync(configPath)) {
                        const content = await fs.promises.readFile(configPath, 'utf-8');
                        const config = yaml.load(content) as WorkspaceConfig;
                        if (config.id === workspaceId) {
                            return workspacePath;
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Failed to find workspace:', error);
        }
        
        return null;
    }

    // ==================== App Operations ====================

    /**
     * Get all apps for a workspace
     * Apps are stored in workspace/studio/ directory
     */
    async getAppsForWorkspace(
        workspacePath: string,
        platformUrl: string,
        accountEmail: string
    ): Promise<AppNodeData[]> {
        const apps: AppNodeData[] = [];
        const studioPath = path.join(workspacePath, 'studio');
        
        // Ensure studio directory exists
        if (!fs.existsSync(studioPath)) {
            return apps;
        }
        
        try {
            const entries = await fs.promises.readdir(studioPath, { withFileTypes: true });
            
            for (const entry of entries) {
                if (entry.isDirectory() && !entry.name.startsWith('.')) {
                    const appPath = path.join(studioPath, entry.name);
                    const dslPath = path.join(appPath, 'app.yml');
                    
                    if (fs.existsSync(dslPath)) {
                        // Read metadata from .sync.yml (single source of truth)
                        const syncMetadata = await this.getAppSyncMetadata(appPath);
                        const syncStatus = await this.getAppSyncStatus(appPath);
                        
                        // If no sync metadata, try to extract type from DSL
                        let appType: AppType = syncMetadata?.app_type || 'workflow';
                        if (!syncMetadata) {
                            appType = await this.extractAppTypeFromDsl(appPath) || 'workflow';
                        }
                        
                        apps.push({
                            type: 'app',
                            id: syncMetadata?.app_id || '',
                            name: entry.name,
                            appType,
                            role: syncMetadata?.role,
                            readonly: syncMetadata?.readonly || false,
                            platformUrl,
                            accountEmail,
                            path: appPath,
                            syncStatus,
                        });
                    }
                }
            }
        } catch (error) {
            console.error('Failed to read apps:', error);
        }
        
        return apps;
    }

    /**
     * Extract app type from DSL file
     */
    private async extractAppTypeFromDsl(appPath: string): Promise<AppType | null> {
        try {
            const dslPath = path.join(appPath, 'app.yml');
            const content = await fs.promises.readFile(dslPath, 'utf-8');
            const dsl = yaml.load(content) as { app?: { mode?: string } };
            if (dsl?.app?.mode) {
                return APP_MODE_TO_TYPE[dsl.app.mode] || 'workflow';
            }
        } catch (error) {
            console.error('Failed to extract app type from DSL:', error);
        }
        return null;
    }

    /**
     * Save app DSL to workspace/studio/ directory
     * @param workspacePath - Path to the workspace
     * @param appType - App type (now stored in .sync.yml)
     * @param role - User role (now stored in .sync.yml)
     */
    async saveAppDsl(
        workspacePath: string,
        appId: string,
        appName: string,
        dsl: string,
        remoteUpdatedAt: string,
        appType?: AppType,
        role?: UserRole,
        readonly?: boolean
    ): Promise<string> {
        const safeName = this.sanitizeName(appName);
        const studioPath = path.join(workspacePath, 'studio');
        const appPath = path.join(studioPath, safeName);
        
        // Ensure studio directory exists
        await fs.promises.mkdir(studioPath, { recursive: true });
        
        // Create app directory
        await fs.promises.mkdir(appPath, { recursive: true });
        
        // Save DSL
        const dslPath = path.join(appPath, 'app.yml');
        await fs.promises.writeFile(dslPath, dsl, 'utf-8');
        
        // Extract app type from DSL if not provided
        let resolvedAppType = appType;
        if (!resolvedAppType) {
            try {
                const dslObj = yaml.load(dsl) as { app?: { mode?: string } };
                if (dslObj?.app?.mode) {
                    resolvedAppType = APP_MODE_TO_TYPE[dslObj.app.mode] || 'workflow';
                }
            } catch {
                resolvedAppType = 'workflow';
            }
        }
        
        // Save sync metadata (single source of truth for app metadata)
        const syncMetadata: SyncMetadata = {
            app_id: appId,
            app_type: resolvedAppType || 'workflow',
            role,
            readonly,
            last_synced_at: new Date().toISOString(),
            remote_updated_at: remoteUpdatedAt,
            local_hash: this.computeHash(dsl),
        };
        const syncPath = path.join(appPath, '.sync.yml');
        await fs.promises.writeFile(syncPath, yaml.dump(syncMetadata), 'utf-8');
        
        return appPath;
    }

    /**
     * Read app DSL
     */
    async readAppDsl(appPath: string): Promise<string | null> {
        const dslPath = path.join(appPath, 'app.yml');
        
        try {
            if (fs.existsSync(dslPath)) {
                return await fs.promises.readFile(dslPath, 'utf-8');
            }
        } catch (error) {
            console.error('Failed to read app DSL:', error);
        }
        
        return null;
    }

    /**
     * Get app sync metadata
     */
    async getAppSyncMetadata(appPath: string): Promise<SyncMetadata | null> {
        const syncPath = path.join(appPath, '.sync.yml');
        
        try {
            if (fs.existsSync(syncPath)) {
                const content = await fs.promises.readFile(syncPath, 'utf-8');
                return yaml.load(content) as SyncMetadata;
            }
        } catch (error) {
            console.error('Failed to read sync metadata:', error);
        }
        
        return null;
    }

    /**
     * Update sync metadata
     */
    async updateSyncMetadata(appPath: string, metadata: Partial<SyncMetadata>): Promise<void> {
        const syncPath = path.join(appPath, '.sync.yml');
        let current: SyncMetadata = {
            app_id: '',
            app_type: 'workflow',
            last_synced_at: '',
            remote_updated_at: '',
            local_hash: '',
        };
        
        if (fs.existsSync(syncPath)) {
            const content = await fs.promises.readFile(syncPath, 'utf-8');
            current = yaml.load(content) as SyncMetadata;
        }
        
        const updated = { ...current, ...metadata };
        await fs.promises.writeFile(syncPath, yaml.dump(updated), 'utf-8');
    }

    /**
     * Get app sync status
     */
    async getAppSyncStatus(appPath: string): Promise<SyncStatus> {
        const dslPath = path.join(appPath, 'app.yml');
        const syncPath = path.join(appPath, '.sync.yml');
        
        try {
            if (!fs.existsSync(syncPath)) {
                return 'local-modified';
            }
            
            const syncContent = await fs.promises.readFile(syncPath, 'utf-8');
            const syncMetadata = yaml.load(syncContent) as SyncMetadata;
            
            if (fs.existsSync(dslPath)) {
                const dslContent = await fs.promises.readFile(dslPath, 'utf-8');
                const currentHash = this.computeHash(dslContent);
                
                if (currentHash !== syncMetadata.local_hash) {
                    return 'local-modified';
                }
            }
            
            return 'synced';
        } catch (error) {
            console.error('Failed to get sync status:', error);
            return 'local-modified';
        }
    }

    /**
     * Delete app
     */
    async deleteApp(appPath: string): Promise<void> {
        await fs.promises.rm(appPath, { recursive: true, force: true });
    }

    /**
     * Rename app directory
     * Returns the new app path
     * App is in workspace/studio/ directory
     */
    async renameApp(appPath: string, newName: string, _appId: string): Promise<string> {
        const studioPath = path.dirname(appPath);
        const safeName = this.sanitizeName(newName);
        const newAppPath = path.join(studioPath, safeName);
        
        // If name hasn't changed, return original path
        if (appPath === newAppPath) {
            return appPath;
        }
        
        // Check if new path already exists
        if (fs.existsSync(newAppPath)) {
            console.warn(`[ConfigManager] Target path already exists: ${newAppPath}`);
            // Delete old directory if it's different
            if (appPath !== newAppPath) {
                await fs.promises.rm(appPath, { recursive: true, force: true });
            }
            return newAppPath;
        }
        
        // Rename directory
        await fs.promises.rename(appPath, newAppPath);
        console.log(`[ConfigManager] Renamed app directory: ${appPath} -> ${newAppPath}`);
        
        return newAppPath;
    }

    // ==================== Utility Methods ====================

    /**
     * Ensure .gitignore contains necessary exclusion rules
     */
    private async ensureGitignore(): Promise<void> {
        const gitignorePath = path.join(this.workspaceRoot, '.gitignore');
        const rule = '**/.secrets.yml';
        
        try {
            let content = '';
            if (fs.existsSync(gitignorePath)) {
                content = await fs.promises.readFile(gitignorePath, 'utf-8');
            }
            
            if (!content.includes(rule)) {
                const newContent = content.trim() + (content.trim() ? '\n' : '') + rule + '\n';
                await fs.promises.writeFile(gitignorePath, newContent, 'utf-8');
            }
        } catch (error) {
            console.error('Failed to update .gitignore:', error);
        }
    }

    /**
     * Sanitize name, remove unsafe characters
     */
    private sanitizeName(name: string): string {
        return name
            .replace(/[<>:"/\\|?*]/g, '_')
            .replace(/\s+/g, '_')
            .trim();
    }

    /**
     * Compute string hash
     */
    private computeHash(content: string): string {
        return crypto.createHash('md5').update(content).digest('hex');
    }
}
