import type { FunctionComponent } from 'react';
import type { ConfigMeta } from './config/index.ts';
import type { SettingsRuntime } from './runtime.ts';
/** 两张卡的共同输入。 */
export interface PathsCardProps {
    /** 宿主给出的路径与存储清单。 */
    paths: ConfigMeta;
}
/** 一对落盘位置卡。 */
export interface PathsCards {
    ConfigMetaCard: FunctionComponent<PathsCardProps>;
    /** 卸载与存储：插件落盘的全部位置 + 卸载步骤与命令。 */
    StorageCard: FunctionComponent<PathsCardProps>;
}
/**
 * 造两张落盘位置卡。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 两个卡片组件。
 */
export declare function makePathsCards(rt: SettingsRuntime): PathsCards;
