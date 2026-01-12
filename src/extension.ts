/**
 * Dify as Code - VS Code Extension Entry Point
 */

import * as vscode from 'vscode';
import { DifyTreeDataProvider } from './treeDataProvider';
import { CommandHandler } from './commands';

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    console.log('Dify as Code extension is now active!');

    // Create tree data provider
    const treeDataProvider = new DifyTreeDataProvider();
    
    // Register tree view
    const treeView = vscode.window.createTreeView('difyAsCode', {
        treeDataProvider,
        showCollapseAll: true,
    });
    context.subscriptions.push(treeView);

    // Create command handler and register commands
    const commandHandler = new CommandHandler(treeDataProvider);
    commandHandler.registerCommands(context);

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.text = '$(cloud) Dify';
    statusBarItem.tooltip = 'Dify as Code';
    statusBarItem.command = 'dify.pullAll';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Listen for file save events to detect app config changes
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((document) => {
            if (document.fileName.endsWith('app.yml')) {
                // Refresh tree view to update sync status
                treeDataProvider.refresh();
            }
        })
    );

    // Listen for workspace changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            treeDataProvider.refresh();
        })
    );

    console.log('Dify as Code extension activated successfully');
}

export function deactivate() {
    if (statusBarItem) {
        statusBarItem.dispose();
    }
}
