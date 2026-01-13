/**
 * Dify App Tree Data Provider
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
    TreeNodeData,
    PlatformNodeData,
    AccountNodeData,
    WorkspaceNodeData,
    ResourceFolderNodeData,
    ResourceFolderType,
    AppNodeData,
    APP_TYPE_ICONS,
    ROLE_ICONS,
    WORKSPACE_ROLE_ICONS,
    RESOURCE_FOLDER_NAMES,
    RESOURCE_FOLDER_ICONS,
} from './types';
import { ConfigManager } from './configManager';

export class DifyTreeDataProvider implements vscode.TreeDataProvider<DifyTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<DifyTreeItem | undefined | null | void> = 
        new vscode.EventEmitter<DifyTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<DifyTreeItem | undefined | null | void> = 
        this._onDidChangeTreeData.event;

    private configManager: ConfigManager | null = null;

    constructor() {
        try {
            this.configManager = new ConfigManager();
        } catch {
            // No workspace, skip initialization
        }
    }

    /**
     * Refresh tree view
     */
    refresh(): void {
        try {
            if (!this.configManager) {
                this.configManager = new ConfigManager();
            }
        } catch {
            // Ignore
        }
        this._onDidChangeTreeData.fire();
    }

    /**
     * Get tree item
     */
    getTreeItem(element: DifyTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Get children
     */
    async getChildren(element?: DifyTreeItem): Promise<DifyTreeItem[]> {
        if (!this.configManager) {
            return [];
        }

        try {
            if (!element) {
                // Root node: get all platforms
                const platforms = await this.configManager.getAllPlatforms();
                return platforms.map(p => new DifyTreeItem(p, vscode.TreeItemCollapsibleState.Expanded));
            }

            const data = element.nodeData;

            if (data.type === 'platform') {
                // Platform node: get accounts
                const accounts = await this.configManager.getAccountsForPlatform(data.path, data.url);
                return accounts.map(a => new DifyTreeItem(a, vscode.TreeItemCollapsibleState.Expanded));
            }

            if (data.type === 'account') {
                // Account node: get workspaces
                const workspaces = await this.configManager.getWorkspacesForAccount(data.path, data.platformUrl, data.email);
                return workspaces.map(w => new DifyTreeItem(w, vscode.TreeItemCollapsibleState.Expanded));
            }

            if (data.type === 'workspace') {
                // Workspace node: get resource folders (studio, knowledge, tools, plugins)
                const folderTypes: ResourceFolderType[] = ['studio', 'knowledge', 'tools', 'plugins'];
                const folders: ResourceFolderNodeData[] = [];
                
                for (const folderType of folderTypes) {
                    const folderPath = path.join(data.path, folderType);
                    if (fs.existsSync(folderPath)) {
                        folders.push({
                            type: 'resource-folder',
                            folderType,
                            name: RESOURCE_FOLDER_NAMES[folderType],
                            platformUrl: data.platformUrl,
                            accountEmail: data.accountEmail,
                            path: folderPath,
                        });
                    }
                }
                
                return folders.map(f => new DifyTreeItem(f, vscode.TreeItemCollapsibleState.Expanded));
            }

            if (data.type === 'resource-folder') {
                // Resource folder node: only studio has apps for now
                if (data.folderType === 'studio') {
                    const workspacePath = path.dirname(data.path);
                    const apps = await this.configManager.getAppsForWorkspace(workspacePath, data.platformUrl, data.accountEmail);
                    return apps.map(a => new DifyTreeItem(a, vscode.TreeItemCollapsibleState.None));
                }
                // Other folders are empty for now
                return [];
            }

            return [];
        } catch (error) {
            console.error('Failed to get children:', error);
            return [];
        }
    }

    /**
     * Get ConfigManager instance
     */
    getConfigManager(): ConfigManager | null {
        return this.configManager;
    }
}

export class DifyTreeItem extends vscode.TreeItem {
    public readonly nodeData: TreeNodeData;

    constructor(
        data: TreeNodeData,
        collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        const label = DifyTreeItem.getLabel(data);
        super(label, collapsibleState);

        this.nodeData = data;
        this.contextValue = DifyTreeItem.getContextValue(data);
        this.iconPath = DifyTreeItem.getIcon(data);
        this.tooltip = DifyTreeItem.getTooltip(data);
        this.description = DifyTreeItem.getDescription(data);

        // Open config file when clicking on app node
        if (data.type === 'app') {
            this.command = {
                command: 'dify.openAppConfig',
                title: 'Open App Config',
                arguments: [this],
            };
        }
    }

    private static getLabel(data: TreeNodeData): string {
        switch (data.type) {
            case 'platform':
                return data.name;
            case 'account':
                return data.email;
            case 'workspace': {
                const roleIcon = WORKSPACE_ROLE_ICONS[data.role] || '';
                return `${data.name}${roleIcon ? ` ${roleIcon}` : ''}`;
            }
            case 'resource-folder':
                return data.name;
            case 'app': {
                const icon = APP_TYPE_ICONS[data.appType] || '📦';
                const roleIcon = data.role ? ROLE_ICONS[data.role] || '' : '';
                const suffix = roleIcon ? ` ${roleIcon}` : (data.readonly ? ' 🔒' : '');
                return `${icon} ${data.name}${suffix}`;
            }
        }
    }

    private static getContextValue(data: TreeNodeData): string {
        switch (data.type) {
            case 'platform':
                return 'platform';
            case 'account':
                return 'account';
            case 'workspace':
                return 'workspace';
            case 'resource-folder':
                return `resource-folder-${data.folderType}`;
            case 'app':
                return data.readonly ? 'app-readonly' : 'app-editable';
        }
    }

    private static getIcon(data: TreeNodeData): vscode.ThemeIcon | undefined {
        switch (data.type) {
            case 'platform':
                return new vscode.ThemeIcon('cloud');
            case 'account':
                return new vscode.ThemeIcon('account');
            case 'workspace':
                return new vscode.ThemeIcon('folder-library');
            case 'resource-folder':
                return new vscode.ThemeIcon(RESOURCE_FOLDER_ICONS[data.folderType]);
            case 'app':
                return undefined; // Use emoji icons
        }
    }

    private static getTooltip(data: TreeNodeData): string {
        switch (data.type) {
            case 'platform':
                return `${data.name}\n${data.url}`;
            case 'account':
                return `${data.email}\nPlatform: ${data.platformName}`;
            case 'workspace':
                return `${data.name}\nRole: ${data.role}\nAccount: ${data.accountEmail}`;
            case 'resource-folder':
                return `${data.name}\nPath: ${data.path}`;
            case 'app': {
                const role = data.role ? `\nRole: ${data.role}` : '';
                const status = data.syncStatus ? `\nStatus: ${data.syncStatus}` : '';
                return `${data.name}\nType: ${data.appType}${role}${status}`;
            }
        }
    }

    private static getDescription(data: TreeNodeData): string {
        if (data.type === 'app' && data.syncStatus) {
            switch (data.syncStatus) {
                case 'synced':
                    return '✅';
                case 'local-modified':
                    return '⬆️';
                case 'remote-modified':
                    return '⬇️';
            }
        }
        return '';
    }
}
