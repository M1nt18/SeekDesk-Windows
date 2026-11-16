/** The original DeskSidebarSizing values, shared by persistence and controls. */
export const SIDEBAR_STANDARD=228;
export const SIDEBAR_MIN=184;
export const SIDEBAR_MAX=360;
export const PANE_DIVIDER=9;

export function sidebarBounds(windowWidth?:number):readonly [number,number] {
  const maximum=windowWidth===undefined||!Number.isFinite(windowWidth)?SIDEBAR_MAX:
    Math.max(SIDEBAR_MIN,Math.min(SIDEBAR_MAX,windowWidth-(240+412+2*PANE_DIVIDER)));
  return [SIDEBAR_MIN,maximum];
}

/** Old valid preferences remain untouched; a finite legacy width is fitted. */
export function clampSidebarWidth(value:number,windowWidth?:number):number {
  if(!Number.isFinite(value))throw new Error('侧栏宽度无效');
  const [minimum,maximum]=sidebarBounds(windowWidth);
  return Math.max(minimum,Math.min(maximum,value));
}
