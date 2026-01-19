/**
 * Command implementations
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { DifyTreeDataProvider, DifyTreeItem } from './treeDataProvider';
import { ConfigManager } from './configManager';
import { getApiClient, removeApiClient } from './difyApi';
import { PlatformNodeData, AccountNodeData, WorkspaceNodeData, AppNodeData, ModelsFileNodeData, ResourceFileNodeData, ResourceFolderNodeData, KnowledgeNodeData, DocumentNodeData, APP_MODE_TO_TYPE, AppType } from './types';
import * as yaml from 'js-yaml';

/**
 * Format date to YYYY-MM-DDTHH:mm:ss (compact, no line break)
 * Handles ISO string, Unix timestamp (seconds or milliseconds)
 */
function formatDateTime(dateInput: string | number | undefined | null): string {
    if (dateInput === undefined || dateInput === null || dateInput === '') {
        return 'N/A';
    }
    
    let date: Date;
    const inputValue = typeof dateInput === 'string' ? dateInput.trim() : dateInput;
    
    if (typeof inputValue === 'number') {
        // Unix timestamp: if < 10 billion, it's seconds; otherwise milliseconds
        date = new Date(inputValue < 10000000000 ? inputValue * 1000 : inputValue);
    } else if (typeof inputValue === 'string') {
        // Check if it's a numeric string (Unix timestamp)
        const num = Number(inputValue);
        if (!isNaN(num) && /^\d+$/.test(inputValue)) {
            date = new Date(num < 10000000000 ? num * 1000 : num);
        } else {
            // ISO string or other date format
            date = new Date(inputValue);
        }
    } else {
        return 'N/A';
    }
    
    // Check for invalid date
    if (isNaN(date.getTime()) || date.getFullYear() < 2000) {
        return 'N/A';
    }
    
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Show a notification with countdown timer (auto-dismiss after timeout)
 */
function showTimedNotification(message: string, timeoutSeconds: number = 10): void {
    vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: message,
            cancellable: false,
        },
        async (progress) => {
            const steps = 100;
            const intervalMs = (timeoutSeconds * 1000) / steps;
            
            for (let i = 0; i <= steps; i++) {
                await new Promise(resolve => setTimeout(resolve, intervalMs));
                progress.report({ increment: 1 });
            }
        }
    );
}

export class CommandHandler {
    private treeDataProvider: DifyTreeDataProvider;

    constructor(treeDataProvider: DifyTreeDataProvider) {
        this.treeDataProvider = treeDataProvider;
    }

    /**
     * Register all commands
     */
    registerCommands(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            vscode.commands.registerCommand('dify.addPlatform', () => this.addPlatform()),
            vscode.commands.registerCommand('dify.editPlatform', (item: DifyTreeItem) => this.editPlatform(item)),
            vscode.commands.registerCommand('dify.deletePlatform', (item: DifyTreeItem) => this.deletePlatform(item)),
            vscode.commands.registerCommand('dify.pullPlatform', (item: DifyTreeItem) => this.pullPlatform(item)),
            
            vscode.commands.registerCommand('dify.addAccount', (item: DifyTreeItem) => this.addAccount(item)),
            vscode.commands.registerCommand('dify.editAccount', (item: DifyTreeItem) => this.editAccount(item)),
            vscode.commands.registerCommand('dify.deleteAccount', (item: DifyTreeItem) => this.deleteAccount(item)),
            vscode.commands.registerCommand('dify.pullAccount', (item: DifyTreeItem) => this.pullAccount(item)),
            
            vscode.commands.registerCommand('dify.pullWorkspace', (item: DifyTreeItem) => this.pullWorkspace(item)),
            
            vscode.commands.registerCommand('dify.openAppConfig', (item: DifyTreeItem) => this.openAppConfig(item)),
            vscode.commands.registerCommand('dify.openModelsFile', (item: DifyTreeItem) => this.openModelsFile(item)),
            vscode.commands.registerCommand('dify.openResourceFile', (item: DifyTreeItem) => this.openResourceFile(item)),
            vscode.commands.registerCommand('dify.openInDify', (item: DifyTreeItem) => this.openInDify(item)),
            vscode.commands.registerCommand('dify.pullApp', (item: DifyTreeItem) => this.pullApp(item)),
            vscode.commands.registerCommand('dify.pushApp', (item: DifyTreeItem) => this.pushApp(item)),
            vscode.commands.registerCommand('dify.copyAsNewApp', (item: DifyTreeItem) => this.copyAsNewApp(item)),
            vscode.commands.registerCommand('dify.viewSyncStatus', (item: DifyTreeItem) => this.viewSyncStatus(item)),
            
            vscode.commands.registerCommand('dify.pullAll', () => this.pullAll()),
            vscode.commands.registerCommand('dify.refreshTree', () => this.refreshTree()),
            
            // Knowledge commands
            vscode.commands.registerCommand('dify.pullKnowledge', (item: DifyTreeItem) => this.pullKnowledge(item)),
            vscode.commands.registerCommand('dify.pushKnowledge', (item: DifyTreeItem) => this.pushKnowledge(item)),
            vscode.commands.registerCommand('dify.unlinkKnowledge', (item: DifyTreeItem) => this.unlinkKnowledge(item)),
            vscode.commands.registerCommand('dify.createKnowledgeDocument', (item: DifyTreeItem) => this.createKnowledgeDocument(item)),
            
            // App creation commands
            vscode.commands.registerCommand('dify.createApp', (item: DifyTreeItem) => this.createApp(item)),
        );
    }

    // ==================== Platform Commands ====================

    /**
     * Add platform
     */
    async addPlatform(): Promise<void> {
        const configManager = this.getConfigManager();
        if (!configManager) { return; }

        // Select platform type
        const platformType = await vscode.window.showQuickPick(
            [
                { label: 'Custom Platform (Self-hosted)', description: 'Enter custom URL', value: 'custom' },
                { label: 'Dify Cloud', description: 'cloud.dify.ai', value: 'cloud' },
            ],
            { placeHolder: 'Select platform type to add' }
        );

        if (!platformType) { return; }

        let name: string;
        let url: string;

        if (platformType.value === 'cloud') {
            name = 'DifyCloud';
            url = 'https://cloud.dify.ai';
        } else {
            // Enter platform name
            const inputName = await vscode.window.showInputBox({
                prompt: 'Enter platform name',
                placeHolder: 'e.g., Company Internal Dify',
                validateInput: (value) => value.trim() ? null : 'Please enter platform name',
            });
            if (!inputName) { return; }
            name = inputName;

            // Enter platform URL
            const inputUrl = await vscode.window.showInputBox({
                prompt: 'Enter platform URL (subpaths like /apps will be auto-removed)',
                placeHolder: 'e.g., https://dify.mycompany.com or https://dify.mycompany.com/apps',
                validateInput: (value) => {
                    if (!value.trim()) { return 'Please enter platform URL'; }
                    try {
                        new URL(value);
                        return null;
                    } catch {
                        return 'Please enter a valid URL';
                    }
                },
            });
            if (!inputUrl) { return; }
            
            // Extract base URL (remove subpaths like /apps, /explore, etc.)
            url = this.extractBaseUrl(inputUrl);
        }

        // Validate platform URL by checking Dify API
        const isValid = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Validating platform URL...',
            cancellable: false,
        }, async () => {
            return await this.validateDifyPlatform(url);
        });

        if (!isValid) {
            const proceed = await vscode.window.showWarningMessage(
                `Could not connect to Dify at ${url}. The URL may be incorrect or the server is not running.`,
                'Add Anyway',
                'Cancel'
            );
            if (proceed !== 'Add Anyway') {
                return;
            }
        }

        try {
            await configManager.createPlatform(name, url);
            showTimedNotification(`✓ Platform added: ${name}`);
            this.treeDataProvider.refresh();

            // Prompt to add account
            const addAccount = await vscode.window.showInformationMessage(
                'Would you like to add an account now?',
                'Add Account',
                'Later'
            );
            if (addAccount === 'Add Account') {
                // Get the newly created platform and add account
                const platforms = await configManager.getAllPlatforms();
                const platform = platforms.find(p => p.name === name);
                if (platform) {
                    await this.addAccountToPlatform(platform);
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to add platform: ${error}`);
        }
    }

    /**
     * Edit platform
     */
    async editPlatform(item: DifyTreeItem): Promise<void> {
        if (item.nodeData.type !== 'platform') { return; }
        
        const configManager = this.getConfigManager();
        if (!configManager) { return; }

        const data = item.nodeData as PlatformNodeData;

        const name = await vscode.window.showInputBox({
            prompt: 'Platform name',
            value: data.name,
            validateInput: (value) => value.trim() ? null : 'Please enter platform name',
        });
        if (!name) { return; }

        const url = await vscode.window.showInputBox({
            prompt: 'Platform URL',
            value: data.url,
            validateInput: (value) => {
                if (!value.trim()) { return 'Please enter platform URL'; }
                try {
                    new URL(value);
                    return null;
                } catch {
                    return 'Please enter a valid URL';
                }
            },
        });
        if (!url) { return; }

        try {
            await configManager.updatePlatform(data.path, name, url);
            showTimedNotification('✓ Platform info updated');
            this.treeDataProvider.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`Update failed: ${error}`);
        }
    }

    /**
     * Delete platform
     */
    async deletePlatform(item: DifyTreeItem): Promise<void> {
        if (item.nodeData.type !== 'platform') { return; }
        
        const configManager = this.getConfigManager();
        if (!configManager) { return; }

        const data = item.nodeData as PlatformNodeData;

        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to delete platform "${data.name}" and all its accounts and app configurations?`,
            { modal: true },
            'Delete'
        );

        if (confirm !== 'Delete') { return; }

        try {
            removeApiClient(data.url);
            await configManager.deletePlatform(data.path);
            showTimedNotification(`✓ Platform deleted: ${data.name}`);
            this.treeDataProvider.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`Delete failed: ${error}`);
        }
    }

    /**
     * Pull platform updates
     */
    async pullPlatform(item: DifyTreeItem): Promise<void> {
        if (item.nodeData.type !== 'platform') { return; }
        
        const configManager = this.getConfigManager();
        if (!configManager) { return; }

        const data = item.nodeData as PlatformNodeData;
        const accounts = await configManager.getAccountsForPlatform(data.path, data.url);

        if (accounts.length === 0) {
            vscode.window.showInformationMessage('No accounts under this platform');
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Pulling all apps from ${data.name}...`,
            cancellable: false,
        }, async (progress) => {
            for (let i = 0; i < accounts.length; i++) {
                const account = accounts[i];
                progress.report({
                    increment: (100 / accounts.length),
                    message: `Account: ${account.email}`,
                });
                await this.pullAccountData(account);
            }
        });

        this.treeDataProvider.refresh();
        showTimedNotification(`✓ Pulled all apps from platform ${data.name}`);
    }

    // ==================== Account Commands ====================

    /**
     * Add account
     */
    async addAccount(item?: DifyTreeItem): Promise<void> {
        const configManager = this.getConfigManager();
        if (!configManager) { return; }

        if (item && item.nodeData.type === 'platform') {
            await this.addAccountToPlatform(item.nodeData as PlatformNodeData);
        } else {
            // Called from command palette, need to select platform first
            const platforms = await configManager.getAllPlatforms();
            if (platforms.length === 0) {
                vscode.window.showWarningMessage('Please add a platform first');
                return;
            }

            const selected = await vscode.window.showQuickPick(
                platforms.map(p => ({ label: p.name, description: p.url, platform: p })),
                { placeHolder: 'Select platform' }
            );

            if (selected) {
                await this.addAccountToPlatform(selected.platform);
            }
        }
    }

    /**
     * Add account to specified platform
     */
    private async addAccountToPlatform(platform: PlatformNodeData): Promise<void> {
        const configManager = this.getConfigManager();
        if (!configManager) { return; }

        // Enter email
        const email = await vscode.window.showInputBox({
            prompt: `Login to ${platform.name}`,
            placeHolder: 'Email address',
            validateInput: (value) => {
                if (!value.trim()) { return 'Please enter email'; }
                if (!value.includes('@')) { return 'Please enter a valid email address'; }
                return null;
            },
        });
        if (!email) { return; }

        // Enter password
        const password = await vscode.window.showInputBox({
            prompt: 'Password',
            password: true,
            validateInput: (value) => value.trim() ? null : 'Please enter password',
        });
        if (!password) { return; }

        // Verify login
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Verifying login...',
                cancellable: false,
            }, async () => {
                const client = getApiClient(platform.url);
                console.log(`[AddAccount] Logging in to ${platform.url} with ${email}`);
                const success = await client.login(email, password);

                if (!success) {
                    throw new Error('Login failed, please check email and password');
                }

                console.log('[AddAccount] Login successful, creating account...');
                // Create account
                const account = await configManager.createAccount(platform.path, platform.url, email, password);

                // Fetch workspaces
                console.log('[AddAccount] Fetching workspaces...');
                const workspaces = await client.getWorkspaces();
                console.log(`[AddAccount] Found ${workspaces.length} workspaces`);

                // For each workspace, create directory and fetch apps
                for (const ws of workspaces) {
                    console.log(`[AddAccount] Processing workspace: ${ws.name}`);
                    const workspace = await configManager.saveWorkspace(
                        account.path, ws.id, ws.name, ws.role,
                        platform.url, email
                    );

                    // Fetch apps for this workspace
                    console.log(`[AddAccount] Fetching apps for workspace: ${ws.name}...`);
                    const apps = await client.getAllApps();
                    console.log(`[AddAccount] Found ${apps.length} apps`);
                    
                    // Pull all app DSLs
                    for (const app of apps) {
                        try {
                            console.log(`[AddAccount] Exporting app: ${app.name}`);
                            const { dsl, updatedAt } = await client.exportApp(app.id);
                            await configManager.saveAppDsl(
                                workspace.path, app.id, app.name, dsl, updatedAt,
                                app.type, app.role, app.readonly
                            );
                        } catch (error) {
                            console.error(`Failed to export app ${app.name}:`, error);
                        }
                    }

                    // Pull models registry for this workspace
                    try {
                        console.log(`[AddAccount] Pulling models registry for workspace: ${ws.name}...`);
                        const modelsRegistry = await client.getAllModels();
                        await configManager.saveModelsRegistry(workspace.path, modelsRegistry);
                        console.log(`[AddAccount] Models registry saved: ${modelsRegistry.providers.length} providers`);
                    } catch (error) {
                        console.error(`Failed to pull models registry for ${ws.name}:`, error);
                    }

                    // Pull knowledge registry for this workspace
                    try {
                        console.log(`[AddAccount] Pulling knowledge registry for workspace: ${ws.name}...`);
                        const knowledgeRegistry = await client.getAllKnowledge();
                        await configManager.saveKnowledgeRegistry(workspace.path, knowledgeRegistry);
                        console.log(`[AddAccount] Knowledge registry saved: ${knowledgeRegistry.datasets.length} datasets`);
                    } catch (error) {
                        console.error(`Failed to pull knowledge registry for ${ws.name}:`, error);
                    }

                    // Pull tools registry for this workspace
                    try {
                        console.log(`[AddAccount] Pulling tools registry for workspace: ${ws.name}...`);
                        const toolsRegistry = await client.getAllTools();
                        await configManager.saveToolsRegistry(workspace.path, toolsRegistry);
                        console.log(`[AddAccount] Tools registry saved: ${toolsRegistry.providers.length} providers`);
                    } catch (error) {
                        console.error(`Failed to pull tools registry for ${ws.name}:`, error);
                    }

                    // Pull plugins registry for this workspace
                    try {
                        console.log(`[AddAccount] Pulling plugins registry for workspace: ${ws.name}...`);
                        const pluginsRegistry = await client.getAllPlugins();
                        await configManager.savePluginsRegistry(workspace.path, pluginsRegistry);
                        console.log(`[AddAccount] Plugins registry saved: ${pluginsRegistry.plugins.length} plugins`);
                    } catch (error) {
                        console.error(`Failed to pull plugins registry for ${ws.name}:`, error);
                    }
                }
            });

            this.treeDataProvider.refresh();
            showTimedNotification(`✓ Account added: ${email}, all workspaces and apps pulled`);
        } catch (error) {
            console.error('[AddAccount] Error:', error);
            vscode.window.showErrorMessage(`Failed to add account: ${error}`);
        }
    }

    /**
     * Edit account
     */
    async editAccount(item: DifyTreeItem): Promise<void> {
        if (item.nodeData.type !== 'account') { return; }
        
        const configManager = this.getConfigManager();
        if (!configManager) { return; }

        const data = item.nodeData as AccountNodeData;

        const email = await vscode.window.showInputBox({
            prompt: 'Email address',
            value: data.email,
            validateInput: (value) => {
                if (!value.trim()) { return 'Please enter email'; }
                if (!value.includes('@')) { return 'Please enter a valid email address'; }
                return null;
            },
        });
        if (!email) { return; }

        const changePassword = await vscode.window.showQuickPick(
            ['Keep unchanged', 'Change password'],
            { placeHolder: 'Change password?' }
        );

        let password: string | undefined;
        if (changePassword === 'Change password') {
            password = await vscode.window.showInputBox({
                prompt: 'New password',
                password: true,
                validateInput: (value) => value.trim() ? null : 'Please enter password',
            });
            if (!password) { return; }
        }

        try {
            await configManager.updateAccount(data.path, email, password);
            showTimedNotification('✓ Account info updated');
            this.treeDataProvider.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`Update failed: ${error}`);
        }
    }

    /**
     * Delete account
     */
    async deleteAccount(item: DifyTreeItem): Promise<void> {
        if (item.nodeData.type !== 'account') { return; }
        
        const configManager = this.getConfigManager();
        if (!configManager) { return; }

        const data = item.nodeData as AccountNodeData;

        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to delete account "${data.email}" and all its app configurations?`,
            { modal: true },
            'Delete'
        );

        if (confirm !== 'Delete') { return; }

        try {
            await configManager.deleteAccount(data.path);
            showTimedNotification(`✓ Account deleted: ${data.email}`);
            this.treeDataProvider.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`Delete failed: ${error}`);
        }
    }

    /**
     * Pull account updates
     */
    async pullAccount(item: DifyTreeItem): Promise<void> {
        if (item.nodeData.type !== 'account') { return; }
        
        const data = item.nodeData as AccountNodeData;

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Pulling apps for ${data.email}...`,
            cancellable: false,
        }, async () => {
            await this.pullAccountData(data);
        });

        this.treeDataProvider.refresh();
        showTimedNotification(`✓ Pulled all apps for account ${data.email}`);
    }

    /**
     * Pull account data (internal method)
     * Now handles workspace-level organization
     */
    private async pullAccountData(account: AccountNodeData): Promise<void> {
        const configManager = this.getConfigManager();
        if (!configManager) { return; }

        // Get password and login
        const password = await configManager.getAccountPassword(account.path);
        if (!password) {
            throw new Error('Account password not found');
        }

        const client = getApiClient(account.platformUrl);
        const success = await client.login(account.email, password);
        if (!success) {
            throw new Error('Login failed');
        }

        // Fetch workspaces from remote
        console.log('[PullAccount] Fetching workspaces...');
        const remoteWorkspaces = await client.getWorkspaces();
        const remoteWorkspaceIds = new Set(remoteWorkspaces.map(ws => ws.id));
        console.log(`[PullAccount] Remote workspaces (${remoteWorkspaces.length}):`, remoteWorkspaces.map(ws => ({ id: ws.id, name: ws.name })));

        // Get local workspaces
        const localWorkspaces = await configManager.getWorkspacesForAccount(account.path, account.platformUrl, account.email);
        console.log(`[PullAccount] Local workspaces (${localWorkspaces.length}):`, localWorkspaces.map(ws => ({ id: ws.id, name: ws.name })));

        // Process each remote workspace
        for (const ws of remoteWorkspaces) {
            console.log(`[PullAccount] Processing workspace: ${ws.name}`);
            
            // Create or update workspace
            const workspace = await configManager.saveWorkspace(
                account.path, ws.id, ws.name, ws.role,
                account.platformUrl, account.email
            );

            // Pull workspace data
            await this.pullWorkspaceData(workspace, client, configManager);
        }

        // Delete local workspaces that no longer exist on remote
        for (const localWs of localWorkspaces) {
            if (!remoteWorkspaceIds.has(localWs.id)) {
                console.log(`[PullAccount] Deleting local workspace that no longer exists on remote: ${localWs.name}`);
                try {
                    await configManager.deleteWorkspace(localWs.path);
                } catch (error) {
                    console.error(`Failed to delete workspace ${localWs.name}:`, error);
                }
            }
        }

        console.log(`[PullAccount] Complete`);
    }

    /**
     * Pull workspace data (internal method)
     */
    private async pullWorkspaceData(
        workspace: WorkspaceNodeData, 
        client: ReturnType<typeof getApiClient>,
        configManager: ConfigManager
    ): Promise<void> {
        // Get current local apps
        const localApps = await configManager.getAppsForWorkspace(
            workspace.path, 
            workspace.platformUrl, 
            workspace.accountEmail
        );
        console.log(`[PullWorkspace] Local apps (${localApps.length}):`, localApps.map(a => ({ id: a.id, name: a.name })));

        // Pull app list from remote
        const apps = await client.getAllApps();
        const remoteAppIds = new Set(apps.map(app => app.id));
        console.log(`[PullWorkspace] Remote apps (${apps.length}):`, apps.map(a => ({ id: a.id, name: a.name })));

        // Pull all app DSLs
        for (const app of apps) {
            try {
                const { dsl, updatedAt } = await client.exportApp(app.id);
                await configManager.saveAppDsl(
                    workspace.path, app.id, app.name, dsl, updatedAt,
                    app.type, app.role, app.readonly
                );
            } catch (error) {
                console.error(`Failed to export app ${app.name}:`, error);
            }
        }

        // Delete local apps that no longer exist on remote
        console.log(`[PullWorkspace] Checking for apps to delete...`);
        for (const localApp of localApps) {
            let appId = localApp.id;
            if (!appId) {
                const syncMeta = await configManager.getAppSyncMetadata(localApp.path);
                appId = syncMeta?.app_id || '';
            }
            
            const existsOnRemote = appId ? remoteAppIds.has(appId) : false;
            
            if (appId && !existsOnRemote) {
                console.log(`[PullWorkspace] Deleting local app: ${localApp.name}`);
                try {
                    await configManager.deleteApp(localApp.path);
                } catch (error) {
                    console.error(`Failed to delete app ${localApp.name}:`, error);
                }
            } else if (!appId) {
                const nameExistsOnRemote = apps.some(a => a.name === localApp.name);
                if (!nameExistsOnRemote) {
                    console.log(`[PullWorkspace] Deleting orphan app: ${localApp.name}`);
                    try {
                        await configManager.deleteApp(localApp.path);
                    } catch (error) {
                        console.error(`Failed to delete orphan app ${localApp.name}:`, error);
                    }
                }
            }
        }

        // Pull models registry
        try {
            console.log(`[PullWorkspace] Pulling models registry...`);
            const modelsRegistry = await client.getAllModels();
            await configManager.saveModelsRegistry(workspace.path, modelsRegistry);
            console.log(`[PullWorkspace] Models registry saved: ${modelsRegistry.providers.length} providers`);
        } catch (error) {
            console.error(`[PullWorkspace] Failed to pull models registry:`, error);
        }

        // Pull knowledge registry
        try {
            console.log(`[PullWorkspace] Pulling knowledge registry...`);
            const knowledgeRegistry = await client.getAllKnowledge();
            await configManager.saveKnowledgeRegistry(workspace.path, knowledgeRegistry);
            console.log(`[PullWorkspace] Knowledge registry saved: ${knowledgeRegistry.datasets.length} datasets`);
            
            // Update already-synced knowledge bases
            const syncedKnowledgeBases = await configManager.getSyncedKnowledgeBases(workspace.path);
            console.log(`[PullWorkspace] Found ${syncedKnowledgeBases.length} synced knowledge bases to update`);
            
            for (const syncedKb of syncedKnowledgeBases) {
                // Check if this knowledge base still exists in the registry
                const stillExists = knowledgeRegistry.datasets.some(d => d.id === syncedKb.datasetId);
                if (!stillExists) {
                    console.log(`[PullWorkspace] Knowledge base ${syncedKb.datasetName} no longer exists, skipping...`);
                    continue;
                }
                
                try {
                    console.log(`[PullWorkspace] Updating synced knowledge base: ${syncedKb.datasetName}`);
                    
                    // Fetch documents
                    const documents = await client.getDatasetDocuments(syncedKb.datasetId);
                    
                    // Fetch segments for each document
                    const documentsWithContent: Array<{
                        id: string;
                        name: string;
                        content: string;
                        segments: Array<{ id: string; position: number; content: string; answer?: string; keywords?: string[] }>;
                    }> = [];
                    
                    for (const doc of documents) {
                        try {
                            const segments = await client.getDocumentSegments(syncedKb.datasetId, doc.id);
                            documentsWithContent.push({
                                id: doc.id,
                                name: doc.name,
                                content: segments.map(s => s.content).join('\n\n'),
                                segments: segments.map(s => ({
                                    id: s.id,
                                    position: s.position,
                                    content: s.content,
                                    answer: s.answer,
                                    keywords: s.keywords,
                                })),
                            });
                        } catch (error) {
                            console.error(`Failed to fetch segments for ${doc.name}:`, error);
                            documentsWithContent.push({
                                id: doc.id,
                                name: doc.name,
                                content: '',
                                segments: [],
                            });
                        }
                    }
                    
                    // Save updated documents
                    await configManager.saveKnowledgeDocuments(
                        workspace.path,
                        syncedKb.datasetId,
                        syncedKb.datasetName,
                        documentsWithContent
                    );
                    console.log(`[PullWorkspace] Updated knowledge base: ${syncedKb.datasetName} (${documents.length} documents)`);
                } catch (error) {
                    console.error(`[PullWorkspace] Failed to update knowledge base ${syncedKb.datasetName}:`, error);
                }
            }
        } catch (error) {
            console.error(`[PullWorkspace] Failed to pull knowledge registry:`, error);
        }

        // Pull tools registry
        try {
            console.log(`[PullWorkspace] Pulling tools registry...`);
            const toolsRegistry = await client.getAllTools();
            await configManager.saveToolsRegistry(workspace.path, toolsRegistry);
            console.log(`[PullWorkspace] Tools registry saved: ${toolsRegistry.providers.length} providers`);
        } catch (error) {
            console.error(`[PullWorkspace] Failed to pull tools registry:`, error);
        }

        // Pull plugins registry
        try {
            console.log(`[PullWorkspace] Pulling plugins registry...`);
            const pluginsRegistry = await client.getAllPlugins();
            await configManager.savePluginsRegistry(workspace.path, pluginsRegistry);
            console.log(`[PullWorkspace] Plugins registry saved: ${pluginsRegistry.plugins.length} plugins`);
        } catch (error) {
            console.error(`[PullWorkspace] Failed to pull plugins registry:`, error);
        }
    }

    // ==================== Workspace Commands ====================

    /**
     * Pull workspace updates
     */
    async pullWorkspace(item: DifyTreeItem): Promise<void> {
        if (item.nodeData.type !== 'workspace') { return; }
        
        const configManager = this.getConfigManager();
        if (!configManager) { return; }

        const data = item.nodeData as WorkspaceNodeData;

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Pulling apps for workspace ${data.name}...`,
            cancellable: false,
        }, async () => {
            // Get account path (parent of workspace)
            const accountPath = path.dirname(data.path);
            const password = await configManager.getAccountPassword(accountPath);
            if (!password) {
                throw new Error('Account password not found');
            }

            const client = getApiClient(data.platformUrl);
            const success = await client.login(data.accountEmail, password);
            if (!success) {
                throw new Error('Login failed');
            }

            await this.pullWorkspaceData(data, client, configManager);
        });

        this.treeDataProvider.refresh();
        showTimedNotification(`✓ Pulled all apps for workspace ${data.name}`);
    }

    // ==================== App Commands ====================

    /**
     * Open app config
     */
    async openAppConfig(item: DifyTreeItem): Promise<void> {
        if (item.nodeData.type !== 'app') { return; }
        
        const data = item.nodeData as AppNodeData;
        const dslPath = path.join(data.path, 'app.yml');
        
        // Check if file exists first
        const fs = await import('fs');
        if (!fs.existsSync(dslPath)) {
            const action = await vscode.window.showWarningMessage(
                `App config file not found: ${dslPath}\n\nThis app may not have been pulled yet.`,
                'Pull App',
                'Cancel'
            );
            if (action === 'Pull App') {
                await this.pullApp(item);
            }
            return;
        }
        
        try {
            // Use Uri.file() to properly handle special characters in path
            const fileUri = vscode.Uri.file(dslPath);
            const doc = await vscode.workspace.openTextDocument(fileUri);
            await vscode.window.showTextDocument(doc, {
                preview: false,
                viewColumn: vscode.ViewColumn.One,
            });
        } catch (error) {
            // Fallback: try using vscode.commands to open the file
            console.error('[OpenAppConfig] Error opening file:', error);
            try {
                await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(dslPath));
            } catch (fallbackError) {
                vscode.window.showErrorMessage(
                    `Failed to open file. Try opening it manually from the file explorer.\n` +
                    `Path: ${dslPath}`
                );
            }
        }
    }

    /**
     * Open models registry file
     */
    async openModelsFile(item: DifyTreeItem): Promise<void> {
        if (item.nodeData.type !== 'models-file') { return; }
        
        const data = item.nodeData as ModelsFileNodeData;
        
        try {
            const doc = await vscode.workspace.openTextDocument(data.path);
            await vscode.window.showTextDocument(doc, {
                preview: false,
                viewColumn: vscode.ViewColumn.One,
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open models file: ${error}`);
        }
    }

    /**
     * Open resource file (knowledge, tools, plugins)
     */
    async openResourceFile(item: DifyTreeItem): Promise<void> {
        if (item.nodeData.type !== 'resource-file') { return; }
        
        const data = item.nodeData as ResourceFileNodeData;
        
        try {
            const doc = await vscode.workspace.openTextDocument(data.path);
            await vscode.window.showTextDocument(doc, {
                preview: false,
                viewColumn: vscode.ViewColumn.One,
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open resource file: ${error}`);
        }
    }

    /**
     * Open in Dify
     */
    async openInDify(item: DifyTreeItem): Promise<void> {
        if (item.nodeData.type !== 'app') { return; }
        
        const data = item.nodeData as AppNodeData;
        const client = getApiClient(data.platformUrl);
        const url = client.getAppEditorUrl(data.id, data.appType);
        
        vscode.env.openExternal(vscode.Uri.parse(url));
    }

    /**
     * Pull app updates
     */
    async pullApp(item: DifyTreeItem): Promise<void> {
        if (item.nodeData.type !== 'app') { return; }
        
        const configManager = this.getConfigManager();
        if (!configManager) { return; }

        const data = item.nodeData as AppNodeData;

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Pulling ${data.name}...`,
            cancellable: false,
        }, async () => {
            // Path: app -> studio -> workspace -> account
            const studioPath = path.dirname(data.path);
            const workspacePath = path.dirname(studioPath);
            const accountPath = path.dirname(workspacePath);
            
            const password = await configManager.getAccountPassword(accountPath);
            if (!password) {
                throw new Error('Account password not found');
            }

            const client = getApiClient(data.platformUrl);
            const success = await client.login(data.accountEmail, password);
            if (!success) {
                throw new Error('Login failed');
            }

            const { dsl, updatedAt } = await client.exportApp(data.id);
            await configManager.saveAppDsl(
                workspacePath, data.id, data.name, dsl, updatedAt,
                data.appType, data.role, data.readonly
            );
        });

        this.treeDataProvider.refresh();
        showTimedNotification(`✓ App pulled: ${data.name}`);
    }

    /**
     * Push app to Dify
     */
    async pushApp(item: DifyTreeItem): Promise<void> {
        if (item.nodeData.type !== 'app') { return; }
        
        const configManager = this.getConfigManager();
        if (!configManager) { return; }

        const data = item.nodeData as AppNodeData;

        if (data.readonly) {
            vscode.window.showWarningMessage('This app is read-only and cannot be uploaded');
            return;
        }

        // Only workflow and chatflow apps can be updated via import
        if (data.appType !== 'workflow' && data.appType !== 'chatflow') {
            vscode.window.showWarningMessage(
                `Push is only supported for Workflow and Chatflow apps. ` +
                `This app is of type "${data.appType}". ` +
                `Please edit it directly in Dify.`
            );
            return;
        }

        // Path: app -> studio -> workspace -> account
        const studioPath = path.dirname(data.path);
        const workspacePath = path.dirname(studioPath);
        const accountPath = path.dirname(workspacePath);

        // Check if this is a local-only app (no valid remote ID)
        const isLocalOnly = !data.id || data.id.startsWith('local-') || data.id.trim() === '';
        
        if (isLocalOnly) {
            // Handle local-only app: need to create on remote first
            const action = await vscode.window.showWarningMessage(
                `This app "${data.name}" only exists locally and has not been synced to Dify. ` +
                `Would you like to create it on Dify now?`,
                'Create on Dify',
                'Cancel'
            );
            
            if (action !== 'Create on Dify') {
                return;
            }
            
            // Create new app on remote and sync
            await this.pushLocalOnlyApp(data, configManager, workspacePath, accountPath);
            return;
        }

        // Check for unsynced remote updates
        const syncMeta = await configManager.getAppSyncMetadata(data.path);
        
        if (syncMeta) {
            const password = await configManager.getAccountPassword(accountPath);
            if (password) {
                const client = getApiClient(data.platformUrl);
                await client.login(data.accountEmail, password);
                const detail = await client.getAppDetail(data.id);
                
                if (detail.updatedAt !== syncMeta.remote_updated_at) {
                    const action = await vscode.window.showWarningMessage(
                        'Remote has updates not synced locally. Continuing may overwrite remote changes.',
                        'Pull First',
                        'Force Push',
                        'Cancel'
                    );
                    if (action === 'Pull First') {
                        await this.pullApp(item);
                        return;
                    }
                    if (action !== 'Force Push') {
                        return;
                    }
                }
            }
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Pushing ${data.name}...`,
            cancellable: false,
        }, async () => {
            const dsl = await configManager.readAppDsl(data.path);
            if (!dsl) {
                throw new Error('Failed to read app config');
            }

            const password = await configManager.getAccountPassword(accountPath);
            if (!password) {
                throw new Error('Account password not found');
            }

            const client = getApiClient(data.platformUrl);
            const success = await client.login(data.accountEmail, password);
            if (!success) {
                throw new Error('Login failed');
            }

            await client.importApp(data.id, dsl);

            // Get updated app details from remote
            const detail = await client.getAppDetail(data.id);
            
            // Check if app name changed (from DSL)
            let currentPath = data.path;
            if (detail.name !== data.name) {
                console.log(`[PushApp] App name changed: ${data.name} -> ${detail.name}`);
                currentPath = await configManager.renameApp(data.path, detail.name, data.id);
            }
            
            // Re-pull the DSL to ensure local matches remote (update in place, not create new dir)
            const { dsl: remoteDsl, updatedAt } = await client.exportApp(data.id);
            
            // Write DSL directly to current path (don't use saveAppDsl which creates new dir)
            const dslPath = path.join(currentPath, 'app.yml');
            await vscode.workspace.fs.writeFile(
                vscode.Uri.file(dslPath), 
                Buffer.from(remoteDsl, 'utf-8')
            );
            
            // Update sync metadata with new hash (preserve app_type from existing data)
            const crypto = await import('crypto');
            const localHash = crypto.createHash('md5').update(remoteDsl).digest('hex');
            await configManager.updateSyncMetadata(currentPath, {
                app_id: data.id,
                app_type: data.appType,
                last_synced_at: new Date().toISOString(),
                remote_updated_at: updatedAt,
                local_hash: localHash,
            });
        });

        this.treeDataProvider.refresh();
        showTimedNotification(`✓ App pushed: ${data.name} (to draft)`);
    }

    /**
     * Push a local-only app by creating it on Dify first
     */
    private async pushLocalOnlyApp(
        data: AppNodeData,
        configManager: ConfigManager,
        workspacePath: string,
        accountPath: string
    ): Promise<void> {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Creating "${data.name}" on Dify...`,
            cancellable: false,
        }, async () => {
            const dsl = await configManager.readAppDsl(data.path);
            if (!dsl) {
                throw new Error('Failed to read app config');
            }

            const password = await configManager.getAccountPassword(accountPath);
            if (!password) {
                throw new Error('Account password not found');
            }

            const client = getApiClient(data.platformUrl);
            const success = await client.login(data.accountEmail, password);
            if (!success) {
                throw new Error('Login failed');
            }

            // Map appType to Dify mode
            const modeMapping: Record<string, 'workflow' | 'advanced-chat'> = {
                'workflow': 'workflow',
                'chatflow': 'advanced-chat',
            };
            const mode = modeMapping[data.appType] || 'workflow';

            // Create the app on Dify
            const newApp = await client.createApp(
                data.name,
                mode,
                'emoji',
                '🤖',
                '#FFEAD5',
                ''
            );

            console.log(`[PushLocalOnly] Created remote app: ${newApp.id}`);

            // Now import the DSL to the newly created app
            await client.importApp(newApp.id, dsl);

            // Export to get the final DSL and updated time
            const { dsl: remoteDsl, updatedAt } = await client.exportApp(newApp.id);

            // Get app details
            const detail = await client.getAppDetail(newApp.id);

            // Update local files with new app ID
            // First, rename the directory if needed
            let currentPath = data.path;
            if (detail.name !== data.name) {
                console.log(`[PushLocalOnly] App name changed: ${data.name} -> ${detail.name}`);
                currentPath = await configManager.renameApp(data.path, detail.name, newApp.id);
            }

            // Write the updated DSL
            const dslPath = path.join(currentPath, 'app.yml');
            await vscode.workspace.fs.writeFile(
                vscode.Uri.file(dslPath),
                Buffer.from(remoteDsl, 'utf-8')
            );

            // Update sync metadata with real app ID
            const crypto = await import('crypto');
            const localHash = crypto.createHash('md5').update(remoteDsl).digest('hex');
            await configManager.updateSyncMetadata(currentPath, {
                app_id: newApp.id,
                app_type: data.appType,
                last_synced_at: new Date().toISOString(),
                remote_updated_at: updatedAt,
                local_hash: localHash,
            });
        });

        this.treeDataProvider.refresh();
        showTimedNotification(`✓ App created and synced: ${data.name}`);
    }

    /**
     * Create a new app (only Workflow and Chatflow are supported for DSL push)
     */
    async createApp(item: DifyTreeItem): Promise<void> {
        if (item.nodeData.type !== 'resource-folder') { return; }
        
        const configManager = this.getConfigManager();
        if (!configManager) { return; }

        const data = item.nodeData as ResourceFolderNodeData;
        if (data.folderType !== 'studio') { return; }

        // Only allow types that support DSL push
        const appType = await vscode.window.showQuickPick(
            [
                { label: '🔀 Workflow', description: 'Visual workflow orchestration', value: 'workflow' as const },
                { label: '💬 Chatflow', description: 'Advanced chat with workflow', value: 'advanced-chat' as const },
            ],
            { placeHolder: 'Select app type (only types supporting Push are available)' }
        );
        if (!appType) { return; }

        const appName = await vscode.window.showInputBox({
            prompt: 'Enter app name',
            placeHolder: 'e.g., My New Workflow',
            validateInput: (value) => value.trim() ? null : 'Please enter app name',
        });
        if (!appName) { return; }

        const description = await vscode.window.showInputBox({
            prompt: 'Enter app description (optional)',
            placeHolder: 'e.g., A workflow for data processing',
        });

        // Get account info from path structure
        // Path: studio folder -> workspace -> account
        const workspacePath = path.dirname(data.path);
        const accountPath = path.dirname(workspacePath);
        
        // Read workspace config to get account info
        const workspaceConfigPath = path.join(workspacePath, 'workspace.yml');
        let platformUrl = '';
        let accountEmail = '';
        
        try {
            const workspaceConfigUri = vscode.Uri.file(workspaceConfigPath);
            const content = await vscode.workspace.fs.readFile(workspaceConfigUri);
            const config = yaml.load(content.toString()) as { platform_url?: string; account_email?: string };
            platformUrl = config.platform_url || '';
            accountEmail = config.account_email || '';
        } catch {
            vscode.window.showErrorMessage('Failed to read workspace config');
            return;
        }

        if (!platformUrl || !accountEmail) {
            vscode.window.showErrorMessage('Missing platform URL or account email in workspace config');
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Creating new app "${appName}"...`,
            cancellable: false,
        }, async () => {
            const password = await configManager.getAccountPassword(accountPath);
            if (!password) {
                throw new Error('Account password not found');
            }

            const client = getApiClient(platformUrl);
            const success = await client.login(accountEmail, password);
            if (!success) {
                throw new Error('Login failed');
            }

            // Create app on Dify
            const newApp = await client.createApp(
                appName,
                appType.value,
                'emoji',
                '🤖',
                '#FFEAD5',
                description || ''
            );

            // Export the newly created app's DSL
            const { dsl, updatedAt } = await client.exportApp(newApp.id);
            
            // Map mode to appType
            const appTypeMapping: Record<string, AppType> = {
                'workflow': 'workflow',
                'advanced-chat': 'chatflow',
            };
            
            // Save locally
            await configManager.saveAppDsl(
                workspacePath,
                newApp.id,
                newApp.name,
                dsl,
                updatedAt,
                appTypeMapping[newApp.mode] || 'workflow',
                'owner',
                false
            );
        });

        showTimedNotification(`✓ App created: ${appName}`);
        this.treeDataProvider.refresh();
    }

    /**
     * Copy as new app
     */
    async copyAsNewApp(item: DifyTreeItem): Promise<void> {
        if (item.nodeData.type !== 'app') { return; }
        
        const configManager = this.getConfigManager();
        if (!configManager) { return; }

        const data = item.nodeData as AppNodeData;

        const newName = await vscode.window.showInputBox({
            prompt: 'New app name',
            value: `${data.name}_copy`,
            validateInput: (value) => value.trim() ? null : 'Please enter app name',
        });
        if (!newName) { return; }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Creating new app...`,
            cancellable: false,
        }, async () => {
            const dsl = await configManager.readAppDsl(data.path);
            if (!dsl) {
                throw new Error('Failed to read app config');
            }

            // Path: app -> studio -> workspace -> account
            const studioPath = path.dirname(data.path);
            const workspacePath = path.dirname(studioPath);
            const accountPath = path.dirname(workspacePath);
            
            const password = await configManager.getAccountPassword(accountPath);
            if (!password) {
                throw new Error('Account password not found');
            }

            const client = getApiClient(data.platformUrl);
            const success = await client.login(data.accountEmail, password);
            if (!success) {
                throw new Error('Login failed');
            }

            // Use API's name parameter to override DSL app name
            const newAppId = await client.createAppFromDsl(dsl, newName);

            // Pull new app (inherits type from original app)
            const { dsl: newDsl, updatedAt } = await client.exportApp(newAppId);
            await configManager.saveAppDsl(
                workspacePath, newAppId, newName, newDsl, updatedAt,
                data.appType, data.role, data.readonly
            );
        });

        this.treeDataProvider.refresh();
        showTimedNotification(`✓ New app created: ${newName}`);
    }

    /**
     * View sync status
     */
    async viewSyncStatus(item: DifyTreeItem): Promise<void> {
        if (item.nodeData.type !== 'app') { return; }
        
        const configManager = this.getConfigManager();
        if (!configManager) { return; }

        const data = item.nodeData as AppNodeData;
        const syncMeta = await configManager.getAppSyncMetadata(data.path);
        const syncStatus = await configManager.getAppSyncStatus(data.path);

        // Get status info
        let statusText = '✅ Synced';
        switch (syncStatus) {
            case 'synced':
                statusText = '✅ Synced';
                break;
            case 'local-modified':
                statusText = '⬆️ Local Modified';
                break;
            case 'remote-modified':
                statusText = '⬇️ Remote Updated';
                break;
        }

        // Use non-breaking space to keep date-time together
        const nbsp = '\u00A0';
        const lastSynced = syncMeta?.last_synced_at 
            ? formatDateTime(syncMeta.last_synced_at).replace(/ /g, nbsp) 
            : 'Never';
        const remoteUpdated = syncMeta?.remote_updated_at 
            ? formatDateTime(syncMeta.remote_updated_at).replace(/ /g, nbsp) 
            : 'Unknown';

        const message = [
            data.name,
            '',
            `Type: ${data.appType}`,
            `Status: ${statusText}`,
            `Last Synced: ${lastSynced}`,
            `Remote Updated: ${remoteUpdated}`,
        ].join('\n');

        vscode.window.showInformationMessage(message, { modal: true });
    }

    // ==================== Knowledge Commands ====================

    /**
     * Pull knowledge base documents
     */
    async pullKnowledge(item: DifyTreeItem): Promise<void> {
        if (item.nodeData.type !== 'knowledge') { return; }
        
        const configManager = this.getConfigManager();
        if (!configManager) { return; }

        const data = item.nodeData as KnowledgeNodeData;

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Pulling documents from ${data.name}...`,
            cancellable: false,
        }, async (progress) => {
            // Path: knowledge/{dataset} -> knowledge -> workspace -> account
            const knowledgeFolderPath = path.dirname(data.path);
            const workspacePath = path.dirname(knowledgeFolderPath);
            const accountPath = path.dirname(workspacePath);
            
            const password = await configManager.getAccountPassword(accountPath);
            if (!password) {
                throw new Error('Account password not found');
            }

            const client = getApiClient(data.platformUrl);
            const success = await client.login(data.accountEmail, password);
            if (!success) {
                throw new Error('Login failed');
            }

            // Get documents list
            progress.report({ message: 'Fetching documents list...' });
            const documents = await client.getDatasetDocuments(data.id);
            console.log(`[PullKnowledge] Found ${documents.length} documents`);

            // Fetch each document's segments
            const documentsWithContent: Array<{
                id: string;
                name: string;
                content: string;
                segments: Array<{ id: string; position: number; content: string; answer?: string; keywords?: string[] }>;
            }> = [];

            for (let i = 0; i < documents.length; i++) {
                const doc = documents[i];
                progress.report({ 
                    message: `Fetching document ${i + 1}/${documents.length}: ${doc.name}`,
                    increment: (80 / documents.length),
                });

                try {
                    const segments = await client.getDocumentSegments(data.id, doc.id);
                    documentsWithContent.push({
                        id: doc.id,
                        name: doc.name,
                        content: segments.map(s => s.content).join('\n\n'),
                        segments: segments.map(s => ({
                            id: s.id,
                            position: s.position,
                            content: s.content,
                            answer: s.answer,
                            keywords: s.keywords,
                        })),
                    });
                } catch (error) {
                    console.error(`Failed to fetch segments for ${doc.name}:`, error);
                    // Still add the document but without segments
                    documentsWithContent.push({
                        id: doc.id,
                        name: doc.name,
                        content: '',
                        segments: [],
                    });
                }
            }

            // Save documents locally
            progress.report({ message: 'Saving documents...', increment: 10 });
            await configManager.saveKnowledgeDocuments(
                workspacePath,
                data.id,
                data.name,
                documentsWithContent
            );
        });

        this.treeDataProvider.refresh();
        showTimedNotification(`✓ Knowledge base pulled: ${data.name}`);
    }

    /**
     * Push knowledge base documents
     * - Updates existing remote documents with local content
     * - Creates new documents for local-only files
     */
    async pushKnowledge(item: DifyTreeItem): Promise<void> {
        if (item.nodeData.type !== 'knowledge') { return; }
        
        const configManager = this.getConfigManager();
        if (!configManager) { return; }

        const data = item.nodeData as KnowledgeNodeData;

        // Check if the knowledge base has been synced
        if (data.syncStatus !== 'synced') {
            vscode.window.showWarningMessage('Please pull the knowledge base first before pushing.');
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            `This will update "${data.name}" on the server. Dify will re-process and re-embed the documents. Continue?`,
            'Push',
            'Cancel'
        );

        if (confirm !== 'Push') { return; }

        let updatedCount = 0;
        let createdCount = 0;

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Pushing documents to ${data.name}...`,
            cancellable: false,
        }, async (progress) => {
            // Path: knowledge/{dataset} -> knowledge -> workspace -> account
            const knowledgeFolderPath = path.dirname(data.path);
            const workspacePath = path.dirname(knowledgeFolderPath);
            const accountPath = path.dirname(workspacePath);
            
            const password = await configManager.getAccountPassword(accountPath);
            if (!password) {
                throw new Error('Account password not found');
            }

            const client = getApiClient(data.platformUrl);
            const success = await client.login(data.accountEmail, password);
            if (!success) {
                throw new Error('Login failed');
            }

            // Read local documents
            progress.report({ message: 'Reading local documents...' });
            const localData = await configManager.readKnowledgeDocuments(workspacePath, data.name);
            
            if (!localData.syncMetadata) {
                throw new Error('Sync metadata not found');
            }

            // Get remote documents for comparison
            progress.report({ message: 'Comparing with remote...' });
            const remoteDocuments = await client.getDatasetDocuments(data.id);
            const remoteDocMap = new Map(remoteDocuments.map(d => [d.id, d]));

            // Process each local document
            for (let i = 0; i < localData.documents.length; i++) {
                const localDoc = localData.documents[i];
                const isLocalOnly = localDoc.is_local || localDoc.id.startsWith('local-');

                progress.report({ 
                    message: `${isLocalOnly ? 'Creating' : 'Updating'} document ${i + 1}/${localData.documents.length}: ${localDoc.name}`,
                    increment: (80 / localData.documents.length),
                });

                if (isLocalOnly) {
                    // Local-only document: create new on remote
                    try {
                        await client.createDocumentByText(
                            data.id,
                            localDoc.name,
                            localDoc.content
                        );
                        console.log(`[PushKnowledge] Created new document: ${localDoc.name}`);
                        createdCount++;
                    } catch (error) {
                        console.error(`Failed to create document ${localDoc.name}:`, error);
                        vscode.window.showWarningMessage(`Failed to create: ${localDoc.name}`);
                    }
                } else {
                    // Existing remote document: update
                    const remoteDoc = remoteDocMap.get(localDoc.id);
                    
                    if (remoteDoc) {
                        try {
                            await client.updateDocumentByText(
                                data.id,
                                localDoc.id,
                                localDoc.name,
                                localDoc.content
                            );
                            console.log(`[PushKnowledge] Updated document: ${localDoc.name}`);
                            updatedCount++;
                        } catch (error) {
                            console.error(`Failed to update document ${localDoc.name}:`, error);
                            vscode.window.showWarningMessage(`Failed to update: ${localDoc.name}`);
                        }
                    } else {
                        // Document not found on remote - create it as new
                        console.log(`[PushKnowledge] Document not found on remote, creating: ${localDoc.name}`);
                        try {
                            await client.createDocumentByText(
                                data.id,
                                localDoc.name,
                                localDoc.content
                            );
                            console.log(`[PushKnowledge] Created new document: ${localDoc.name}`);
                            createdCount++;
                        } catch (error) {
                            console.error(`Failed to create document ${localDoc.name}:`, error);
                            vscode.window.showWarningMessage(`Failed to create: ${localDoc.name}`);
                        }
                    }
                }
            }

            progress.report({ message: 'Done!', increment: 20 });
        });

        this.treeDataProvider.refresh();
        
        const message = createdCount > 0 
            ? `✓ Pushed: ${updatedCount} updated, ${createdCount} created (Dify will re-embed)`
            : `✓ Pushed: ${updatedCount} documents updated (Dify will re-embed)`;
        showTimedNotification(message);
    }

    /**
     * Create a new document in a knowledge base
     */
    async createKnowledgeDocument(item: DifyTreeItem): Promise<void> {
        if (item.nodeData.type !== 'knowledge') { return; }
        
        const configManager = this.getConfigManager();
        if (!configManager) { return; }

        const data = item.nodeData as KnowledgeNodeData;

        // Check if the knowledge base has been synced
        if (data.syncStatus !== 'synced') {
            vscode.window.showWarningMessage('Please pull the knowledge base first before creating documents.');
            return;
        }

        // Ask for document name
        const documentName = await vscode.window.showInputBox({
            prompt: 'Enter document name (with extension, e.g., guide.txt)',
            placeHolder: 'my-document.txt',
            validateInput: (value) => {
                if (!value.trim()) { return 'Please enter a document name'; }
                if (!/\.\w+$/.test(value)) { return 'Please include a file extension (e.g., .txt, .md)'; }
                return null;
            },
        });

        if (!documentName) { return; }

        try {
            // Path: knowledge/{dataset} -> knowledge -> workspace
            const knowledgeFolderPath = path.dirname(data.path);
            const workspacePath = path.dirname(knowledgeFolderPath);

            const docPath = await configManager.createLocalDocument(
                workspacePath,
                data.name,
                documentName,
                `# ${documentName}\n\nWrite your content here...\n`
            );

            // Open the new document
            const doc = await vscode.workspace.openTextDocument(docPath);
            await vscode.window.showTextDocument(doc);

            this.treeDataProvider.refresh();
            showTimedNotification(`✓ Created: ${documentName} (Push to upload to Dify)`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create document: ${error}`);
        }
    }

    /**
     * Unlink knowledge base (stop syncing documents)
     */
    async unlinkKnowledge(item: DifyTreeItem): Promise<void> {
        if (item.nodeData.type !== 'knowledge') { return; }
        
        const configManager = this.getConfigManager();
        if (!configManager) { return; }

        const data = item.nodeData as KnowledgeNodeData;

        if (data.syncStatus !== 'synced') {
            vscode.window.showInformationMessage('This knowledge base has not been synced yet.');
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            `Stop syncing "${data.name}"? This will delete local documents but won't affect the server.`,
            'Unlink',
            'Cancel'
        );

        if (confirm !== 'Unlink') { return; }

        try {
            // Delete the local knowledge base directory
            const fs = await import('fs');
            await fs.promises.rm(data.path, { recursive: true, force: true });
            
            this.treeDataProvider.refresh();
            showTimedNotification(`✓ Unlinked: ${data.name}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to unlink: ${error}`);
        }
    }

    // ==================== Global Commands ====================

    /**
     * Pull all updates
     */
    async pullAll(): Promise<void> {
        const configManager = this.getConfigManager();
        if (!configManager) { return; }

        const platforms = await configManager.getAllPlatforms();
        if (platforms.length === 0) {
            vscode.window.showInformationMessage('No platforms configured');
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Pulling all apps...',
            cancellable: false,
        }, async (progress) => {
            let totalAccounts = 0;
            for (const platform of platforms) {
                const accounts = await configManager.getAccountsForPlatform(platform.path, platform.url);
                totalAccounts += accounts.length;
            }

            let processed = 0;
            for (const platform of platforms) {
                const accounts = await configManager.getAccountsForPlatform(platform.path, platform.url);
                for (const account of accounts) {
                    progress.report({
                        increment: (100 / totalAccounts),
                        message: `${platform.name} / ${account.email}`,
                    });
                    try {
                        await this.pullAccountData(account);
                    } catch (error) {
                        console.error(`Failed to pull account ${account.email}:`, error);
                    }
                    processed++;
                }
            }
        });

        this.treeDataProvider.refresh();
        showTimedNotification('✓ All apps pulled');
    }

    /**
     * Refresh tree view
     */
    refreshTree(): void {
        this.treeDataProvider.refresh();
    }

    // ==================== Utility Methods ====================

    private getConfigManager(): ConfigManager | null {
        const manager = this.treeDataProvider.getConfigManager();
        if (!manager) {
            vscode.window.showWarningMessage('Please open a workspace folder first');
            return null;
        }
        return manager;
    }

    /**
     * Extract base URL from a full URL (remove subpaths)
     * e.g., https://dify.example.com/apps -> https://dify.example.com
     */
    private extractBaseUrl(inputUrl: string): string {
        try {
            const parsed = new URL(inputUrl.trim());
            // Return only origin (protocol + host + port)
            return parsed.origin;
        } catch {
            // If parsing fails, try to clean up manually
            let url = inputUrl.trim();
            // Remove trailing slash
            url = url.replace(/\/+$/, '');
            // Remove common Dify subpaths
            const subpaths = ['/apps', '/explore', '/datasets', '/tools', '/plugins', '/app/', '/console'];
            for (const subpath of subpaths) {
                const idx = url.indexOf(subpath);
                if (idx > 0) {
                    url = url.substring(0, idx);
                    break;
                }
            }
            return url;
        }
    }

    /**
     * Validate if a URL points to a valid Dify platform
     */
    private async validateDifyPlatform(url: string): Promise<boolean> {
        try {
            const axios = (await import('axios')).default;
            // Try to access Dify's system features API (public endpoint)
            const response = await axios.get(`${url}/console/api/system-features`, {
                timeout: 10000,
                validateStatus: () => true, // Accept any status
            });
            
            // Dify should return JSON with system features
            if (response.status === 200 && response.data) {
                console.log(`[ValidatePlatform] ${url} is valid Dify platform`);
                return true;
            }
            
            // Try another endpoint
            const response2 = await axios.get(`${url}/console/api/version`, {
                timeout: 5000,
                validateStatus: () => true,
            });
            
            if (response2.status === 200) {
                console.log(`[ValidatePlatform] ${url} is valid Dify platform (version endpoint)`);
                return true;
            }
            
            console.log(`[ValidatePlatform] ${url} returned status ${response.status}`);
            return false;
        } catch (error) {
            console.error(`[ValidatePlatform] Failed to validate ${url}:`, error);
            return false;
        }
    }
}
