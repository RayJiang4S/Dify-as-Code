/**
 * Command implementations
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { DifyTreeDataProvider, DifyTreeItem } from './treeDataProvider';
import { ConfigManager } from './configManager';
import { getApiClient, removeApiClient } from './difyApi';
import { AppInfo, PlatformNodeData, AccountNodeData, AppNodeData } from './types';

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
    // Use T separator to prevent line break
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
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
            
            vscode.commands.registerCommand('dify.openAppConfig', (item: DifyTreeItem) => this.openAppConfig(item)),
            vscode.commands.registerCommand('dify.openInDify', (item: DifyTreeItem) => this.openInDify(item)),
            vscode.commands.registerCommand('dify.pullApp', (item: DifyTreeItem) => this.pullApp(item)),
            vscode.commands.registerCommand('dify.pushApp', (item: DifyTreeItem) => this.pushApp(item)),
            vscode.commands.registerCommand('dify.copyAsNewApp', (item: DifyTreeItem) => this.copyAsNewApp(item)),
            vscode.commands.registerCommand('dify.viewSyncStatus', (item: DifyTreeItem) => this.viewSyncStatus(item)),
            
            vscode.commands.registerCommand('dify.pullAll', () => this.pullAll()),
            vscode.commands.registerCommand('dify.refreshTree', () => this.refreshTree()),
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
            vscode.window.showInformationMessage(`Platform added: ${name} (${url})`);
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
            vscode.window.showInformationMessage('Platform info updated');
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
            vscode.window.showInformationMessage(`Platform deleted: ${data.name}`);
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
        vscode.window.showInformationMessage(`Pulled all apps from platform ${data.name}`);
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

                console.log('[AddAccount] Fetching apps...');
                // Pull app list
                const apps = await client.getAllApps();
                console.log(`[AddAccount] Found ${apps.length} apps`);
                
                const appInfos: AppInfo[] = apps.map(app => ({
                    id: app.id,
                    name: app.name,
                    type: app.type,
                }));
                await configManager.updateAccountApps(account.path, appInfos);

                // Pull all app DSLs
                for (const app of apps) {
                    try {
                        console.log(`[AddAccount] Exporting app: ${app.name}`);
                        const { dsl, updatedAt } = await client.exportApp(app.id);
                        await configManager.saveAppDsl(account.path, app.id, app.name, dsl, updatedAt);
                    } catch (error) {
                        console.error(`Failed to export app ${app.name}:`, error);
                    }
                }
            });

            this.treeDataProvider.refresh();
            vscode.window.showInformationMessage(`Account added: ${email}, all apps pulled`);
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
            vscode.window.showInformationMessage('Account info updated');
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
            vscode.window.showInformationMessage(`Account deleted: ${data.email}`);
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
        vscode.window.showInformationMessage(`Pulled all apps for account ${data.email}`);
    }

    /**
     * Pull account data (internal method)
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

        // Get current local apps before pulling
        const localApps = await configManager.getAppsForAccount(
            account.path, 
            account.platformUrl, 
            account.email
        );
        console.log(`[PullAccount] Local apps (${localApps.length}):`, localApps.map(a => ({ id: a.id, name: a.name })));

        // Pull app list from remote
        const apps = await client.getAllApps();
        const remoteAppIds = new Set(apps.map(app => app.id));
        console.log(`[PullAccount] Remote apps (${apps.length}):`, apps.map(a => ({ id: a.id, name: a.name })));
        
        const appInfos: AppInfo[] = apps.map(app => ({
            id: app.id,
            name: app.name,
            type: app.type,
        }));
        await configManager.updateAccountApps(account.path, appInfos);

        // Pull all app DSLs
        for (const app of apps) {
            try {
                const { dsl, updatedAt } = await client.exportApp(app.id);
                await configManager.saveAppDsl(account.path, app.id, app.name, dsl, updatedAt);
            } catch (error) {
                console.error(`Failed to export app ${app.name}:`, error);
            }
        }

        // Delete local apps that no longer exist on remote
        console.log(`[PullAccount] Checking for apps to delete...`);
        for (const localApp of localApps) {
            // Try to get app_id from .sync.yml if not in account config
            let appId = localApp.id;
            if (!appId) {
                const syncMeta = await configManager.getAppSyncMetadata(localApp.path);
                appId = syncMeta?.app_id || '';
                console.log(`[PullAccount] App ${localApp.name} has no id in account config, got from sync.yml: "${appId}"`);
            }
            
            const existsOnRemote = appId ? remoteAppIds.has(appId) : false;
            console.log(`[PullAccount] Checking app: ${localApp.name}, id: "${appId}", exists on remote: ${existsOnRemote}`);
            
            if (appId && !existsOnRemote) {
                console.log(`[PullAccount] Deleting local app that no longer exists on remote: ${localApp.name} (${localApp.path})`);
                try {
                    await configManager.deleteApp(localApp.path);
                    console.log(`[PullAccount] Successfully deleted: ${localApp.name}`);
                } catch (error) {
                    console.error(`Failed to delete app ${localApp.name}:`, error);
                }
            } else if (!appId) {
                // App has no ID anywhere - check if name matches any remote app
                const nameExistsOnRemote = apps.some(a => a.name === localApp.name);
                if (!nameExistsOnRemote) {
                    console.log(`[PullAccount] Deleting orphan app with no ID and no matching name on remote: ${localApp.name}`);
                    try {
                        await configManager.deleteApp(localApp.path);
                        console.log(`[PullAccount] Successfully deleted orphan: ${localApp.name}`);
                    } catch (error) {
                        console.error(`Failed to delete orphan app ${localApp.name}:`, error);
                    }
                }
            }
        }
        console.log(`[PullAccount] Cleanup complete`);
    }

    // ==================== App Commands ====================

    /**
     * Open app config
     */
    async openAppConfig(item: DifyTreeItem): Promise<void> {
        if (item.nodeData.type !== 'app') { return; }
        
        const data = item.nodeData as AppNodeData;
        const dslPath = path.join(data.path, 'app.yml');
        
        try {
            const doc = await vscode.workspace.openTextDocument(dslPath);
            await vscode.window.showTextDocument(doc, {
                preview: false,
                viewColumn: vscode.ViewColumn.One,
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open file: ${error}`);
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
            // Get account path
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

            const { dsl, updatedAt } = await client.exportApp(data.id);
            await configManager.saveAppDsl(accountPath, data.id, data.name, dsl, updatedAt);
        });

        this.treeDataProvider.refresh();
        vscode.window.showInformationMessage(`App pulled: ${data.name}`);
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

        // Check for unsynced remote updates
        const syncMeta = await configManager.getAppSyncMetadata(data.path);
        if (syncMeta) {
            const accountPath = path.dirname(data.path);
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
            
            // Update sync metadata with new hash
            const crypto = await import('crypto');
            const localHash = crypto.createHash('md5').update(remoteDsl).digest('hex');
            await configManager.updateSyncMetadata(currentPath, {
                app_id: data.id,
                last_synced_at: new Date().toISOString(),
                remote_updated_at: updatedAt,
                local_hash: localHash,
            });
        });

        this.treeDataProvider.refresh();
        vscode.window.showInformationMessage(`App pushed: ${data.name} (to draft)`);
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

            // Use API's name parameter to override DSL app name
            const newAppId = await client.createAppFromDsl(dsl, newName);

            // Pull new app
            const { dsl: newDsl, updatedAt } = await client.exportApp(newAppId);
            await configManager.saveAppDsl(accountPath, newAppId, newName, newDsl, updatedAt);

            // Update account's app list
            const apps = await client.getAllApps();
            const appInfos: AppInfo[] = apps.map(app => ({
                id: app.id,
                name: app.name,
                type: app.type,
            }));
            await configManager.updateAccountApps(accountPath, appInfos);
        });

        this.treeDataProvider.refresh();
        vscode.window.showInformationMessage(`New app created: ${newName}`);
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

        let message = `App: ${data.name}\n`;
        message += `Type: ${data.appType}\n`;
        message += `Status: `;

        switch (syncStatus) {
            case 'synced':
                message += '✅ Synced';
                break;
            case 'local-modified':
                message += '⬆️ Local modified';
                break;
            case 'remote-modified':
                message += '⬇️ Remote updated';
                break;
        }

        if (syncMeta) {
            message += `\nLast synced: ${formatDateTime(syncMeta.last_synced_at)}`;
            message += `\nRemote updated: ${formatDateTime(syncMeta.remote_updated_at)}`;
        }

        vscode.window.showInformationMessage(message, { modal: true });
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
        vscode.window.showInformationMessage('All apps pulled');
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
