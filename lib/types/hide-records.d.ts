import type { PetDisplay } from '../shared/types.ts';
/** 按宠物 id 保存的收起前显示位置。 */
export type HideRecords = Record<string, PetDisplay>;
/** 收起记录与主配置共用插件用户数据目录。 */
export declare const hideRecordsPath: (userRoot: string) => string;
/** 缺失、损坏或版本不支持时返回空记录；其他 IO 错误交给动作入口报告。 */
export declare function readHideRecords(path: string): Promise<HideRecords>;
/** 先写同目录临时文件再替换，避免中断留下半份 JSON。 */
export declare function writeHideRecords(path: string, pets: HideRecords): Promise<void>;
