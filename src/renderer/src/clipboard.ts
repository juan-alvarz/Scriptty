export const copyText = (text: string): Promise<void> =>
  // Clipboard unavailable: the text stays selectable on screen.
  navigator.clipboard.writeText(text).catch(() => {})
