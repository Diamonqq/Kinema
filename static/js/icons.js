// Shared navigation and playback glyphs. Labels belong to the surrounding control.
const paths = {
 left: 'M14.5 5.5 8 12l6.5 6.5', right: 'm9.5 5.5 6.5 6.5-6.5 6.5',
 reset: 'M4 10a8 8 0 1 1 2 8M4 4v6h6',
 play: 'm9 5 11 7-11 7Z', pause: 'M8 5v14M16 5v14',
 fit: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
 close: 'm6 6 12 12M6 18 18 6',
 book: 'M5 4h14v15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2M4 17a2 2 0 0 1 2-2h13M8 4v11',
 cube: 'm12 3 8 4.5v9L12 21l-8-4.5v-9L12 3m-8 4.5 8 4.5 8-4.5M12 12v9',
};
export function controlIcon(name) {
 if (!Object.hasOwn(paths,name)) throw new Error('Unknown control icon: '+name);
 return `<svg class="ki-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" style="display:inline-block;flex:none;vertical-align:middle"><path d="${paths[name]}"/></svg>`;
}
