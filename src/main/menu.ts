import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import type { MenuAction, TreeAction } from '../shared/protocol'

const isMac = process.platform === 'darwin'

export function appMenu(send: (a: MenuAction) => void): Menu {
  const settings: MenuItemConstructorOptions = { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => send('settings') }
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              settings,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          } satisfies MenuItemConstructorOptions
        ]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New File', accelerator: 'CmdOrCtrl+N', click: () => send('new-file') },
        { label: 'New Folder', accelerator: 'Shift+CmdOrCtrl+N', click: () => send('new-folder') },
        { type: 'separator' },
        { label: 'Go to File…', accelerator: 'CmdOrCtrl+P', click: () => send('quick-open') },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => send('close-tab') },
        ...(isMac
          ? [{ label: 'Close Window', accelerator: 'Shift+Cmd+W', role: 'close' } as const]
          : [{ type: 'separator' } as const, settings, { type: 'separator' } as const, { role: 'quit' } as const])
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: () => send('toggle-sidebar') },
        { type: 'separator' },
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: () => send('next-tab') },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: () => send('prev-tab') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Run',
      // ⌘. / Ctrl+. is Quick Fix in Monaco; the editor rebinds it to Stop too (App.svelte), so both agree.
      submenu: [{ label: 'Stop', accelerator: 'CmdOrCtrl+.', click: () => send('stop') }]
    },
    { role: 'windowMenu' }
  ]
  return Menu.buildFromTemplate(template)
}

/** Native context menu for the file tree. Resolves with the chosen action, or null if dismissed. */
export function treeMenu(win: BrowserWindow, onItem: boolean): Promise<TreeAction | null> {
  return new Promise((resolve) => {
    const item = (label: string, action: TreeAction): MenuItemConstructorOptions => ({ label, click: () => resolve(action) })
    const template: MenuItemConstructorOptions[] = [
      item('New File', 'new-file'),
      item('New Folder', 'new-folder'),
      { type: 'separator' },
      ...(onItem ? [item('Rename', 'rename'), item('Move to Trash', 'trash'), { type: 'separator' } as const] : []),
      item(isMac ? 'Reveal in Finder' : 'Show in Explorer', 'reveal')
    ]
    // The close callback can fire before the click handler, so give the click a moment to win.
    Menu.buildFromTemplate(template).popup({ window: win, callback: () => setTimeout(() => resolve(null), 50) })
  })
}
