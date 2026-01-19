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
    ModelsFileNodeData,
    ResourceFileNodeData,
    KnowledgeNodeData,
    DocumentNodeData,
    ModelsRegistry,
    KnowledgeRegistry,
    ToolsRegistry,
    PluginsRegistry,
    APP_TYPE_ICONS,
    ROLE_ICONS,
    WORKSPACE_ROLE_ICONS,
    RESOURCE_FOLDER_NAMES,
    RESOURCE_FOLDER_ICONS,
} from './types';
import * as yaml from 'js-yaml';
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
                // Workspace node: get resource folders (studio, knowledge, tools, plugins, models)
                const folderTypes: ResourceFolderType[] = ['studio', 'knowledge', 'tools', 'plugins', 'models'];
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
                
                // Models folder: show models.yml file
                if (data.folderType === 'models') {
                    const modelsFilePath = path.join(data.path, 'models.yml');
                    if (fs.existsSync(modelsFilePath)) {
                        try {
                            const content = fs.readFileSync(modelsFilePath, 'utf-8');
                            const registry = yaml.load(content) as ModelsRegistry;
                            const modelCount = registry.providers?.reduce((sum, p) => sum + (p.models?.length || 0), 0) || 0;
                            
                            const modelsFileNode: ModelsFileNodeData = {
                                type: 'models-file',
                                name: 'models.yml',
                                path: modelsFilePath,
                                platformUrl: data.platformUrl,
                                accountEmail: data.accountEmail,
                                providerCount: registry.providers?.length || 0,
                                modelCount: modelCount,
                                lastSyncedAt: registry.last_synced_at,
                            };
                            return [new DifyTreeItem(modelsFileNode, vscode.TreeItemCollapsibleState.None)];
                        } catch (error) {
                            console.error('Failed to parse models.yml:', error);
                        }
                    }
                }

                // Knowledge folder: show knowledge bases list (like apps)
                if (data.folderType === 'knowledge') {
                    const items: DifyTreeItem[] = [];
                    const workspacePath = path.dirname(data.path);
                    
                    // First add the knowledge.yml registry file
                    const knowledgeFilePath = path.join(data.path, 'knowledge.yml');
                    if (fs.existsSync(knowledgeFilePath)) {
                        try {
                            const content = fs.readFileSync(knowledgeFilePath, 'utf-8');
                            const registry = yaml.load(content) as KnowledgeRegistry;
                            
                            // Add each knowledge base as a node (like apps)
                            for (const dataset of registry.datasets || []) {
                                // Check if this knowledge base has been synced locally
                                const safeName = dataset.name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_').trim();
                                const datasetPath = path.join(data.path, safeName);
                                const isSynced = fs.existsSync(path.join(datasetPath, '.sync.yml'));
                                
                                const knowledgeNode: KnowledgeNodeData = {
                                    type: 'knowledge',
                                    id: dataset.id,
                                    name: dataset.name,
                                    description: dataset.description,
                                    documentCount: dataset.document_count,
                                    wordCount: dataset.word_count,
                                    platformUrl: data.platformUrl,
                                    accountEmail: data.accountEmail,
                                    path: datasetPath,
                                    syncStatus: isSynced ? 'synced' : undefined,
                                };
                                
                                // If synced, make it expandable to show documents
                                const collapsibleState = isSynced 
                                    ? vscode.TreeItemCollapsibleState.Collapsed 
                                    : vscode.TreeItemCollapsibleState.None;
                                items.push(new DifyTreeItem(knowledgeNode, collapsibleState));
                            }
                        } catch (error) {
                            console.error('Failed to parse knowledge.yml:', error);
                        }
                    }
                    
                    return items;
                }

                // Tools folder: show tools.yml file
                if (data.folderType === 'tools') {
                    const toolsFilePath = path.join(data.path, 'tools.yml');
                    if (fs.existsSync(toolsFilePath)) {
                        try {
                            const content = fs.readFileSync(toolsFilePath, 'utf-8');
                            const registry = yaml.load(content) as ToolsRegistry;
                            
                            const toolsFileNode: ResourceFileNodeData = {
                                type: 'resource-file',
                                resourceType: 'tools',
                                name: 'tools.yml',
                                path: toolsFilePath,
                                platformUrl: data.platformUrl,
                                accountEmail: data.accountEmail,
                                itemCount: registry.providers?.length || 0,
                                lastSyncedAt: registry.last_synced_at,
                            };
                            return [new DifyTreeItem(toolsFileNode, vscode.TreeItemCollapsibleState.None)];
                        } catch (error) {
                            console.error('Failed to parse tools.yml:', error);
                        }
                    }
                }

                // Plugins folder: show plugins.yml file
                if (data.folderType === 'plugins') {
                    const pluginsFilePath = path.join(data.path, 'plugins.yml');
                    if (fs.existsSync(pluginsFilePath)) {
                        try {
                            const content = fs.readFileSync(pluginsFilePath, 'utf-8');
                            const registry = yaml.load(content) as PluginsRegistry;
                            
                            const pluginsFileNode: ResourceFileNodeData = {
                                type: 'resource-file',
                                resourceType: 'plugins',
                                name: 'plugins.yml',
                                path: pluginsFilePath,
                                platformUrl: data.platformUrl,
                                accountEmail: data.accountEmail,
                                itemCount: registry.plugins?.length || 0,
                                lastSyncedAt: registry.last_synced_at,
                            };
                            return [new DifyTreeItem(pluginsFileNode, vscode.TreeItemCollapsibleState.None)];
                        } catch (error) {
                            console.error('Failed to parse plugins.yml:', error);
                        }
                    }
                }
                
                // Other folders are empty for now
                return [];
            }

            // Knowledge node: show documents
            if (data.type === 'knowledge') {
                const items: DifyTreeItem[] = [];
                const syncPath = path.join(data.path, '.sync.yml');
                
                if (fs.existsSync(syncPath)) {
                    try {
                        const syncContent = fs.readFileSync(syncPath, 'utf-8');
                        const syncData = yaml.load(syncContent) as {
                            documents?: Array<{ id: string; name: string; file: string; segment_count?: number }>;
                        };
                        
                        for (const doc of syncData.documents || []) {
                            const docPath = path.join(data.path, doc.file);
                            if (fs.existsSync(docPath)) {
                                const documentNode: DocumentNodeData = {
                                    type: 'document',
                                    id: doc.id,
                                    name: doc.name,
                                    datasetId: data.id,
                                    wordCount: doc.segment_count || 0,
                                    status: 'synced',
                                    enabled: true,
                                    platformUrl: data.platformUrl,
                                    accountEmail: data.accountEmail,
                                    path: docPath,
                                };
                                items.push(new DifyTreeItem(documentNode, vscode.TreeItemCollapsibleState.None));
                            }
                        }
                    } catch (error) {
                        console.error('Failed to read knowledge sync data:', error);
                    }
                }
                
                return items;
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

        // Open models.yml file when clicking on models-file node
        if (data.type === 'models-file') {
            this.command = {
                command: 'dify.openModelsFile',
                title: 'Open Models Registry',
                arguments: [this],
            };
        }

        // Open resource file when clicking on resource-file node
        if (data.type === 'resource-file') {
            this.command = {
                command: 'dify.openResourceFile',
                title: 'Open Resource File',
                arguments: [this],
            };
        }

        // Open document file when clicking on document node
        if (data.type === 'document') {
            this.command = {
                command: 'vscode.open',
                title: 'Open Document',
                arguments: [vscode.Uri.file(data.path)],
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
            case 'models-file':
                return `📋 ${data.name}`;
            case 'resource-file': {
                const icons: Record<string, string> = {
                    'knowledge': '📚',
                    'tools': '🔧',
                    'plugins': '🔌',
                };
                return `${icons[data.resourceType] || '📄'} ${data.name}`;
            }
            case 'knowledge': {
                const syncIcon = data.syncStatus === 'synced' ? ' ✅' : '';
                return `📚 ${data.name}${syncIcon}`;
            }
            case 'document':
                return `📄 ${data.name}`;
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
            case 'models-file':
                return 'models-file';
            case 'resource-file':
                return `resource-file-${data.resourceType}`;
            case 'knowledge':
                return data.syncStatus === 'synced' ? 'knowledge-synced' : 'knowledge';
            case 'document':
                return 'document';
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
            case 'models-file':
                return undefined; // Use emoji icon in label
            case 'resource-file':
                return undefined; // Use emoji icon in label
            case 'knowledge':
                return undefined; // Use emoji icon in label
            case 'document':
                return undefined; // Use emoji icon in label
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
            case 'models-file': {
                const syncTime = data.lastSyncedAt ? new Date(data.lastSyncedAt).toLocaleString() : 'Unknown';
                return `Models Registry\nProviders: ${data.providerCount}\nModels: ${data.modelCount}\nLast synced: ${syncTime}`;
            }
            case 'resource-file': {
                const labels: Record<string, string> = {
                    'knowledge': 'Knowledge Bases',
                    'tools': 'Tool Providers',
                    'plugins': 'Plugins',
                };
                const syncTime = data.lastSyncedAt ? new Date(data.lastSyncedAt).toLocaleString() : 'Unknown';
                return `${labels[data.resourceType] || 'Resources'} Registry\nItems: ${data.itemCount}\nLast synced: ${syncTime}`;
            }
            case 'knowledge': {
                const desc = data.description ? `\n${data.description}` : '';
                const syncStatus = data.syncStatus === 'synced' ? '\n(Documents synced locally)' : '\n(Right-click to pull documents)';
                return `${data.name}${desc}\nDocuments: ${data.documentCount}\nWords: ${data.wordCount}${syncStatus}`;
            }
            case 'document': {
                return `${data.name}\nDataset: ${data.datasetId}\nStatus: ${data.status}`;
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
        if (data.type === 'models-file') {
            return `${data.providerCount} providers, ${data.modelCount} models`;
        }
        if (data.type === 'resource-file') {
            const labels: Record<string, string> = {
                'knowledge': 'datasets',
                'tools': 'providers',
                'plugins': 'plugins',
            };
            return `${data.itemCount} ${labels[data.resourceType] || 'items'}`;
        }
        if (data.type === 'knowledge') {
            return `${data.documentCount} docs, ${data.wordCount} words`;
        }
        if (data.type === 'document') {
            return data.status === 'synced' ? '✅' : '';
        }
        return '';
    }
}
