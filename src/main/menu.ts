import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import type { TreeAction } from '../shared/protocol'
import { ACTIONS, type ActionId, type Bindings } from '../shared/keybindings'

const isMac = process.platform === 'darwin'

/**
 * The menu shows each action's current shortcut. The keys themselves are matched in main's
 * before-input-event (index.ts), whose preventDefault also keeps the accelerator here from firing twice.
 */
export function appMenu(send: (a: ActionId) => void, keys: Bindings): Menu {
  const item = (id: ActionId, label: string = ACTIONS.find((a) => a.id === id)!.label): MenuItemConstructorOptions => ({
    label,
    accelerator: keys[id] || undefined,
    click: () => send(id)
  })
  const settings = item('settings', 'Settings…')
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
        item('new-file'),
        item('new-folder'),
        { type: 'separator' },
        item('quick-open', 'Go to File…'),
        { type: 'separator' },
        item('close-tab'),
        ...(isMac
          ? [{ label: 'Close Window', accelerator: 'Shift+Cmd+W', role: 'close' } as const]
          : [{ type: 'separator' } as const, settings, { type: 'separator' } as const, { role: 'quit' } as const])
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        item('toggle-sidebar'),
        item('search'),
        { type: 'separator' },
        item('next-tab'),
        item('prev-tab'),
        { type: 'separator' },
        item('split-right'),
        item('focus-split-1'),
        item('focus-split-2'),
        item('focus-split-3'),
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
      submenu: [item('run'), item('stop')]
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
