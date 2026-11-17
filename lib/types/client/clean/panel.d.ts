/** 宿主给的 React 原语（与对话面板同一套注入）。 */
export interface CleanPanelRuntime {
    h: (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) => unknown;
    useState: <T>(init: T | (() => T)) => [T, (next: T | ((prev: T) => T)) => void];
    useEffect: (effect: () => void | (() => void), deps?: unknown[]) => void;
    useRef: <T>(init: T) => {
        current: T;
    };
}
/** 面板的 props：onClose = 关掉所在的小窗 / 浮层（右侧栏没有，动作被接受后就留在原地看进度）。 */
export interface CleanPanelProps {
    onClose?: () => void;
}
/** 造面板组件。 */
export declare function makeCleanPanel(rt: CleanPanelRuntime): (props: CleanPanelProps) => unknown;
