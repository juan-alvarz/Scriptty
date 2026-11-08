import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import type { MenuAction, TreeAction } from '../shared/protocol'

const isMac = process.platform === 'darwin'

export function appMenu(send: (a: MenuAction) => void): Menu {
  const debugItem = (label: string, accelerator: string, action: MenuAction): MenuItemConstructorOptions => ({
    label,
    accelerator,
    registerAccelerator: false,
    click: () => send(action)
  })
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
        { label: 'Search Scratches', accelerator: 'Shift+CmdOrCtrl+F', click: () => send('search') },
        { type: 'separator' },
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: () => send('next-tab') },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: () => send('prev-tab') },
        // Shown here; the keys themselves are caught in before-input-event (shortcuts.ts) so the editor never swallows them.
        { label: 'Move Tab Left', accelerator: 'CmdOrCtrl+Shift+PageUp', click: () => send('move-tab-left') },
        { label: 'Move Tab Right', accelerator: 'CmdOrCtrl+Shift+PageDown', click: () => send('move-tab-right') },
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
    {
      label: 'Debug',
      // The renderer handles these keys itself (Monaco binds F8); the menu only shows them. registerAccelerator
      // is ignored on macOS, where a key the page already handled does not reach the menu.
      submenu: [
        debugItem('Start Debugging', 'F5', 'debug-start'),
        debugItem('Stop Debugging', 'Shift+F5', 'debug-stop'),
        { type: 'separator' },
        debugItem('Continue', 'F8', 'debug-continue'),
        debugItem('Step Over', 'F10', 'debug-step-over'),
        debugItem('Step Into', 'F11', 'debug-step-into'),
        debugItem('Step Out', 'Shift+F11', 'debug-step-out'),
        { type: 'separator' },
        debugItem('Toggle Breakpoint', 'F9', 'toggle-breakpoint')
      ]
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
