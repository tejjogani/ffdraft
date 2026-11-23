/** Shared by the runtime theme store and the HTML boot script, so they can never disagree. */
export const THEME_STORAGE_KEY = 'pave:theme'

/**
 * Inlined into <head> so the first paint already has the right theme (no flash of the wrong
 * one before React mounts).
 */
export const themeBootScript = `try{var p=JSON.parse(localStorage.getItem('${THEME_STORAGE_KEY}'))||'system';document.documentElement.dataset.theme=p==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p}catch(e){}`
