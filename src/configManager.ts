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
    ModelsRegistry,
    KnowledgeRegistry,
    ToolsRegistry,
    PluginsRegistry,
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
        const subdirs = ['studio', 'knowledge', 'tools', 'plugins', 'models'];
        
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

    // ==================== Models Operations ====================

    /**
     * Save models registry to workspace/models/ directory
     * Creates a models.yml file with all available models information
     */
    async saveModelsRegistry(workspacePath: string, registry: ModelsRegistry): Promise<string> {
        const modelsPath = path.join(workspacePath, 'models');
        
        // Ensure models directory exists
        await fs.promises.mkdir(modelsPath, { recursive: true });
        
        // Save the main models registry file
        const registryPath = path.join(modelsPath, 'models.yml');
        const content = yaml.dump(registry, {
            indent: 2,
            lineWidth: 120,
            noRefs: true,
        });
        await fs.promises.writeFile(registryPath, content, 'utf-8');
        
        console.log(`[ConfigManager] Models registry saved: ${registry.providers.length} providers, total models: ${registry.providers.reduce((sum, p) => sum + p.models.length, 0)}`);
        
        return registryPath;
    }

    /**
     * Read models registry from workspace
     */
    async readModelsRegistry(workspacePath: string): Promise<ModelsRegistry | null> {
        const registryPath = path.join(workspacePath, 'models', 'models.yml');
        
        try {
            if (fs.existsSync(registryPath)) {
                const content = await fs.promises.readFile(registryPath, 'utf-8');
                return yaml.load(content) as ModelsRegistry;
            }
        } catch (error) {
            console.error('Failed to read models registry:', error);
        }
        
        return null;
    }

    /**
     * Check if models directory exists and has content
     */
    hasModelsRegistry(workspacePath: string): boolean {
        const registryPath = path.join(workspacePath, 'models', 'models.yml');
        return fs.existsSync(registryPath);
    }

    // ==================== Knowledge Operations ====================

    /**
     * Save knowledge registry to workspace/knowledge/ directory
     */
    async saveKnowledgeRegistry(workspacePath: string, registry: KnowledgeRegistry): Promise<string> {
        const knowledgePath = path.join(workspacePath, 'knowledge');
        
        // Ensure knowledge directory exists
        await fs.promises.mkdir(knowledgePath, { recursive: true });
        
        // Save the knowledge registry file
        const registryPath = path.join(knowledgePath, 'knowledge.yml');
        const content = yaml.dump(registry, {
            indent: 2,
            lineWidth: 120,
            noRefs: true,
        });
        await fs.promises.writeFile(registryPath, content, 'utf-8');
        
        console.log(`[ConfigManager] Knowledge registry saved: ${registry.datasets.length} datasets`);
        
        return registryPath;
    }

    /**
     * Read knowledge registry from workspace
     */
    async readKnowledgeRegistry(workspacePath: string): Promise<KnowledgeRegistry | null> {
        const registryPath = path.join(workspacePath, 'knowledge', 'knowledge.yml');
        
        try {
            if (fs.existsSync(registryPath)) {
                const content = await fs.promises.readFile(registryPath, 'utf-8');
                return yaml.load(content) as KnowledgeRegistry;
            }
        } catch (error) {
            console.error('Failed to read knowledge registry:', error);
        }
        
        return null;
    }

    // ==================== Tools Operations ====================

    /**
     * Save tools registry to workspace/tools/ directory
     */
    async saveToolsRegistry(workspacePath: string, registry: ToolsRegistry): Promise<string> {
        const toolsPath = path.join(workspacePath, 'tools');
        
        // Ensure tools directory exists
        await fs.promises.mkdir(toolsPath, { recursive: true });
        
        // Save the tools registry file
        const registryPath = path.join(toolsPath, 'tools.yml');
        const content = yaml.dump(registry, {
            indent: 2,
            lineWidth: 120,
            noRefs: true,
        });
        await fs.promises.writeFile(registryPath, content, 'utf-8');
        
        console.log(`[ConfigManager] Tools registry saved: ${registry.providers.length} providers`);
        
        return registryPath;
    }

    /**
     * Read tools registry from workspace
     */
    async readToolsRegistry(workspacePath: string): Promise<ToolsRegistry | null> {
        const registryPath = path.join(workspacePath, 'tools', 'tools.yml');
        
        try {
            if (fs.existsSync(registryPath)) {
                const content = await fs.promises.readFile(registryPath, 'utf-8');
                return yaml.load(content) as ToolsRegistry;
            }
        } catch (error) {
            console.error('Failed to read tools registry:', error);
        }
        
        return null;
    }

    // ==================== Plugins Operations ====================

    /**
     * Save plugins registry to workspace/plugins/ directory
     */
    async savePluginsRegistry(workspacePath: string, registry: PluginsRegistry): Promise<string> {
        const pluginsPath = path.join(workspacePath, 'plugins');
        
        // Ensure plugins directory exists
        await fs.promises.mkdir(pluginsPath, { recursive: true });
        
        // Save the plugins registry file
        const registryPath = path.join(pluginsPath, 'plugins.yml');
        const content = yaml.dump(registry, {
            indent: 2,
            lineWidth: 120,
            noRefs: true,
        });
        await fs.promises.writeFile(registryPath, content, 'utf-8');
        
        console.log(`[ConfigManager] Plugins registry saved: ${registry.plugins.length} plugins`);
        
        return registryPath;
    }

    /**
     * Read plugins registry from workspace
     */
    async readPluginsRegistry(workspacePath: string): Promise<PluginsRegistry | null> {
        const registryPath = path.join(workspacePath, 'plugins', 'plugins.yml');
        
        try {
            if (fs.existsSync(registryPath)) {
                const content = await fs.promises.readFile(registryPath, 'utf-8');
                return yaml.load(content) as PluginsRegistry;
            }
        } catch (error) {
            console.error('Failed to read plugins registry:', error);
        }
        
        return null;
    }

    // ==================== Knowledge Documents Operations ====================

    /**
     * Save a knowledge base's documents to local directory
     * Creates workspace/knowledge/{dataset_name}/ directory with documents
     * 
     * Key behavior: Only saves documents that don't exist locally (local-first)
     * - If local file exists: skip (preserve local content)
     * - If local file doesn't exist: save from remote (smart de-overlap)
     */
    async saveKnowledgeDocuments(
        workspacePath: string,
        datasetId: string,
        datasetName: string,
        documents: Array<{
            id: string;
            name: string;
            content: string;
            segments?: Array<{ id: string; position: number; content: string; answer?: string; keywords?: string[] }>;
        }>,
        chunkOverlap: number = 50  // Default overlap size for de-duplication
    ): Promise<{ saved: number; skipped: number; datasetPath: string }> {
        const safeName = this.sanitizeName(datasetName);
        const datasetPath = path.join(workspacePath, 'knowledge', safeName);
        
        // Ensure dataset directory exists
        await fs.promises.mkdir(datasetPath, { recursive: true });
        
        let savedCount = 0;
        let skippedCount = 0;
        
        // Save each document as plain text (original content)
        for (const doc of documents) {
            const docSafeName = this.sanitizeName(doc.name);
            // Determine file extension based on original document name
            const originalExt = path.extname(doc.name);
            const ext = originalExt || '.txt';
            const docPath = path.join(datasetPath, `${docSafeName}${ext}`);
            
            // Check if local file already exists - if so, skip (local-first)
            if (fs.existsSync(docPath)) {
                console.log(`[ConfigManager] Skipping existing local file: ${docSafeName}${ext}`);
                skippedCount++;
                continue;
            }
            
            // Smart de-overlap: reconstruct content from segments
            let content = '';
            if (doc.segments && doc.segments.length > 0) {
                // Sort by position
                const sortedSegments = [...doc.segments].sort((a, b) => a.position - b.position);
                
                // First segment is kept entirely
                content = sortedSegments[0].content;
                
                // For subsequent segments, try to remove overlap
                for (let i = 1; i < sortedSegments.length; i++) {
                    const currentSegment = sortedSegments[i].content;
                    const previousEnd = content.slice(-chunkOverlap * 2); // Look at end of current content
                    
                    // Try to find overlap by checking if start of current segment appears in previous end
                    let overlapFound = false;
                    for (let overlapSize = Math.min(chunkOverlap * 2, currentSegment.length); overlapSize > 0; overlapSize--) {
                        const segmentStart = currentSegment.slice(0, overlapSize);
                        const overlapIndex = previousEnd.lastIndexOf(segmentStart);
                        if (overlapIndex !== -1 && overlapIndex >= previousEnd.length - overlapSize - 10) {
                            // Found overlap, append only the non-overlapping part
                            content += '\n\n' + currentSegment.slice(overlapSize);
                            overlapFound = true;
                            break;
                        }
                    }
                    
                    if (!overlapFound) {
                        // No overlap found, just append with separator
                        content += '\n\n' + currentSegment;
                    }
                }
            } else {
                content = doc.content || '';
            }
            
            await fs.promises.writeFile(docPath, content, 'utf-8');
            savedCount++;
            console.log(`[ConfigManager] Saved document: ${docSafeName}${ext}`);
        }
        
        // Read existing sync metadata to preserve local-only documents
        const syncPath = path.join(datasetPath, '.sync.yml');
        let existingDocs: Array<{ id: string; name: string; file: string; is_local?: boolean }> = [];
        if (fs.existsSync(syncPath)) {
            try {
                const existingContent = await fs.promises.readFile(syncPath, 'utf-8');
                const existing = yaml.load(existingContent) as { documents?: typeof existingDocs };
                existingDocs = existing.documents || [];
            } catch {
                // Ignore
            }
        }
        
        // Merge remote documents with existing local-only documents
        const remoteDocIds = new Set(documents.map(d => d.id));
        const localOnlyDocs = existingDocs.filter(d => d.is_local && !remoteDocIds.has(d.id));
        
        // Build new document list
        const allDocs = [
            ...documents.map(d => {
                const originalExt = path.extname(d.name);
                const ext = originalExt || '.txt';
                return {
                    id: d.id,
                    name: d.name,
                    file: `${this.sanitizeName(d.name)}${ext}`,
                    segment_count: d.segments?.length || 0,
                    is_local: false,
                };
            }),
            ...localOnlyDocs,
        ];
        
        // Save sync metadata
        const syncMetadata = {
            dataset_id: datasetId,
            dataset_name: datasetName,
            last_synced_at: new Date().toISOString(),
            document_count: allDocs.length,
            documents: allDocs,
        };
        await fs.promises.writeFile(syncPath, yaml.dump(syncMetadata, { indent: 2, lineWidth: 120 }), 'utf-8');
        
        console.log(`[ConfigManager] Knowledge documents: ${savedCount} saved, ${skippedCount} skipped (local-first) in ${datasetName}`);
        
        return { saved: savedCount, skipped: skippedCount, datasetPath };
    }

    /**
     * Create a new local document in a knowledge base
     * This document will be marked as local-only until pushed to remote
     */
    async createLocalDocument(
        workspacePath: string,
        datasetName: string,
        documentName: string,
        content: string = ''
    ): Promise<string> {
        const safeName = this.sanitizeName(datasetName);
        const datasetPath = path.join(workspacePath, 'knowledge', safeName);
        
        // Ensure dataset directory exists
        await fs.promises.mkdir(datasetPath, { recursive: true });
        
        // Determine file path
        const docSafeName = this.sanitizeName(documentName);
        const originalExt = path.extname(documentName);
        const ext = originalExt || '.txt';
        const docPath = path.join(datasetPath, `${docSafeName}${ext}`);
        
        // Check if file already exists
        if (fs.existsSync(docPath)) {
            throw new Error(`Document "${documentName}" already exists`);
        }
        
        // Create the document file
        await fs.promises.writeFile(docPath, content, 'utf-8');
        
        // Update sync metadata to mark as local-only
        const syncPath = path.join(datasetPath, '.sync.yml');
        let syncMetadata: {
            dataset_id: string;
            dataset_name: string;
            last_synced_at: string;
            document_count: number;
            documents: Array<{ id: string; name: string; file: string; is_local?: boolean }>;
        } = {
            dataset_id: '',
            dataset_name: datasetName,
            last_synced_at: new Date().toISOString(),
            document_count: 0,
            documents: [],
        };
        
        if (fs.existsSync(syncPath)) {
            try {
                const existingContent = await fs.promises.readFile(syncPath, 'utf-8');
                syncMetadata = yaml.load(existingContent) as typeof syncMetadata;
            } catch {
                // Ignore
            }
        }
        
        // Add new local document
        syncMetadata.documents.push({
            id: `local-${Date.now()}`,  // Temporary ID for local-only documents
            name: documentName,
            file: `${docSafeName}${ext}`,
            is_local: true,
        });
        syncMetadata.document_count = syncMetadata.documents.length;
        syncMetadata.last_synced_at = new Date().toISOString();
        
        await fs.promises.writeFile(syncPath, yaml.dump(syncMetadata, { indent: 2, lineWidth: 120 }), 'utf-8');
        
        console.log(`[ConfigManager] Created local document: ${documentName}`);
        
        return docPath;
    }

    /**
     * Read knowledge base documents from local directory
     */
    async readKnowledgeDocuments(workspacePath: string, datasetName: string): Promise<{
        syncMetadata: { dataset_id: string; dataset_name: string; last_synced_at: string; document_count: number; documents: Array<{ id: string; name: string; file: string; is_local?: boolean }> } | null;
        documents: Array<{ id: string; name: string; file: string; content: string; is_local?: boolean }>;
    }> {
        const safeName = this.sanitizeName(datasetName);
        const datasetPath = path.join(workspacePath, 'knowledge', safeName);
        
        const result: {
            syncMetadata: { dataset_id: string; dataset_name: string; last_synced_at: string; document_count: number; documents: Array<{ id: string; name: string; file: string; is_local?: boolean }> } | null;
            documents: Array<{ id: string; name: string; file: string; content: string; is_local?: boolean }>;
        } = {
            syncMetadata: null,
            documents: [],
        };
        
        if (!fs.existsSync(datasetPath)) {
            return result;
        }
        
        // Read sync metadata
        const syncPath = path.join(datasetPath, '.sync.yml');
        if (fs.existsSync(syncPath)) {
            try {
                const content = await fs.promises.readFile(syncPath, 'utf-8');
                result.syncMetadata = yaml.load(content) as typeof result.syncMetadata;
            } catch (error) {
                console.error('Failed to read knowledge sync metadata:', error);
            }
        }
        
        // Read documents based on sync metadata
        if (result.syncMetadata?.documents) {
            for (const docMeta of result.syncMetadata.documents) {
                const filePath = path.join(datasetPath, docMeta.file);
                if (fs.existsSync(filePath)) {
                    try {
                        const content = await fs.promises.readFile(filePath, 'utf-8');
                        result.documents.push({
                            id: docMeta.id,
                            name: docMeta.name,
                            file: docMeta.file,
                            content,
                            is_local: docMeta.is_local,
                        });
                    } catch (error) {
                        console.error(`Failed to read document ${docMeta.file}:`, error);
                    }
                }
            }
        }
        
        return result;
    }

    /**
     * Get all synced knowledge bases for a workspace
     */
    async getSyncedKnowledgeBases(workspacePath: string): Promise<Array<{
        datasetId: string;
        datasetName: string;
        path: string;
        documentCount: number;
        lastSyncedAt: string;
    }>> {
        const knowledgePath = path.join(workspacePath, 'knowledge');
        const result: Array<{
            datasetId: string;
            datasetName: string;
            path: string;
            documentCount: number;
            lastSyncedAt: string;
        }> = [];
        
        if (!fs.existsSync(knowledgePath)) {
            return result;
        }
        
        try {
            const entries = await fs.promises.readdir(knowledgePath, { withFileTypes: true });
            
            for (const entry of entries) {
                if (entry.isDirectory() && !entry.name.startsWith('.')) {
                    const datasetPath = path.join(knowledgePath, entry.name);
                    const syncPath = path.join(datasetPath, '.sync.yml');
                    
                    if (fs.existsSync(syncPath)) {
                        try {
                            const content = await fs.promises.readFile(syncPath, 'utf-8');
                            const syncData = yaml.load(content) as {
                                dataset_id: string;
                                dataset_name: string;
                                last_synced_at: string;
                                document_count: number;
                            };
                            
                            result.push({
                                datasetId: syncData.dataset_id,
                                datasetName: syncData.dataset_name,
                                path: datasetPath,
                                documentCount: syncData.document_count,
                                lastSyncedAt: syncData.last_synced_at,
                            });
                        } catch (error) {
                            console.error(`Failed to read sync metadata for ${entry.name}:`, error);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Failed to read synced knowledge bases:', error);
        }
        
        return result;
    }

    /**
     * Check if a knowledge base has been synced
     */
    hasKnowledgeSync(workspacePath: string, datasetName: string): boolean {
        const safeName = this.sanitizeName(datasetName);
        const syncPath = path.join(workspacePath, 'knowledge', safeName, '.sync.yml');
        return fs.existsSync(syncPath);
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
