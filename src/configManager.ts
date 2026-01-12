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
    SyncMetadata,
    AppInfo,
    PlatformNodeData,
    AccountNodeData,
    AppNodeData,
    SyncStatus,
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
        
        // Create account config file
        const accountConfig: AccountConfig = { email, apps: [] };
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

    /**
     * Update account's app list
     */
    async updateAccountApps(accountPath: string, apps: AppInfo[]): Promise<void> {
        const accountConfigPath = path.join(accountPath, '.account.yml');
        const content = await fs.promises.readFile(accountConfigPath, 'utf-8');
        const config = yaml.load(content) as AccountConfig;
        config.apps = apps;
        await fs.promises.writeFile(accountConfigPath, yaml.dump(config), 'utf-8');
    }

    // ==================== App Operations ====================

    /**
     * Get all apps for an account
     */
    async getAppsForAccount(
        accountPath: string,
        platformUrl: string,
        accountEmail: string
    ): Promise<AppNodeData[]> {
        const apps: AppNodeData[] = [];
        
        try {
            // First read .account.yml to get app metadata
            const accountConfigPath = path.join(accountPath, '.account.yml');
            const accountContent = await fs.promises.readFile(accountConfigPath, 'utf-8');
            const accountConfig = yaml.load(accountContent) as AccountConfig;
            const appInfoMap = new Map(accountConfig.apps.map(app => [app.name, app]));
            
            const entries = await fs.promises.readdir(accountPath, { withFileTypes: true });
            
            for (const entry of entries) {
                if (entry.isDirectory() && !entry.name.startsWith('.')) {
                    const appPath = path.join(accountPath, entry.name);
                    const dslPath = path.join(appPath, 'app.yml');
                    
                    if (fs.existsSync(dslPath)) {
                        const appInfo = appInfoMap.get(entry.name);
                        const syncStatus = await this.getAppSyncStatus(appPath);
                        
                        apps.push({
                            type: 'app',
                            id: appInfo?.id || '',
                            name: entry.name,
                            appType: appInfo?.type || 'workflow',
                            role: appInfo?.role,
                            readonly: appInfo?.readonly || false,
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
     * Save app DSL
     */
    async saveAppDsl(
        accountPath: string,
        appId: string,
        appName: string,
        dsl: string,
        remoteUpdatedAt: string
    ): Promise<string> {
        const safeName = this.sanitizeName(appName);
        const appPath = path.join(accountPath, safeName);
        
        // Create app directory
        await fs.promises.mkdir(appPath, { recursive: true });
        
        // Save DSL
        const dslPath = path.join(appPath, 'app.yml');
        await fs.promises.writeFile(dslPath, dsl, 'utf-8');
        
        // Save sync metadata
        const syncMetadata: SyncMetadata = {
            app_id: appId,
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
     * Rename app directory and update account config
     * Returns the new app path
     */
    async renameApp(appPath: string, newName: string, appId: string): Promise<string> {
        const accountPath = path.dirname(appPath);
        const safeName = this.sanitizeName(newName);
        const newAppPath = path.join(accountPath, safeName);
        
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
        
        // Update account config
        const accountConfigPath = path.join(accountPath, '.account.yml');
        try {
            const content = await fs.promises.readFile(accountConfigPath, 'utf-8');
            const config = yaml.load(content) as AccountConfig;
            
            // Update app name in the list
            const appInfo = config.apps.find(app => app.id === appId);
            if (appInfo) {
                appInfo.name = newName;
                await fs.promises.writeFile(accountConfigPath, yaml.dump(config), 'utf-8');
            }
        } catch (error) {
            console.error('Failed to update account config after rename:', error);
        }
        
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
