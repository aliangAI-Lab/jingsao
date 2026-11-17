export declare const CORNER_SET: ReadonlySet<string>;
/** display 白名单（导出：宿主路由 POST /pet-display 写单只宠物的显示位置时复用同一份枚举）。
 *  唯一来源是 shared/config 的 PET_DISPLAYS，读写两侧必须同一份规则，不在路由里另写一个 Set。 */
export declare const PET_DISPLAY_SET: ReadonlySet<string>;
/** font.family 白名单：唯一来源是 shared/fonts 的 FONT_PRESETS，宿主只取 id 做校验。 */
export declare const FONT_FAMILY_SET: ReadonlySet<string>;
/** id 禁用的字符（Windows 文件名保留符 + 控制字符，防配置值逃逸文件路径）。
 *  同时被 thumb 路由的 petId 校验复用：那里同样是「标识符不得当路径片段」。 */
export declare const ID_FORBIDDEN: RegExp;
/** 标识符的最大长度：id 与素材根都会落成目录名，超长在部分文件系统上直接建不出来。 */
export declare const MAX_PET_ID_LENGTH = 64;
export declare function isValidPetId(value: string): boolean;
export declare const GLOBAL_DEFAULT_KEYS: readonly ["physics", "animationWeights", "font", "confineToScreen", "voiceEnabled", "voiceName", "voiceVolume", "voiceWhisperEnabled", "voiceNotifyEnabled", "chatAnimationEnabled", "chatMemoryRounds", "whisperModel", "chatModel", "eventsRefreshSec"];
export declare function warnOnce(key: string, message: string): void;
/** 配置路径集（宿主组装好后传入，单一事实来源） */
export interface ConfigPaths {
    /** 包内 assets/config.jsonc（内置默认，绝对正确） */
    defaultFile: string;
    /** ~/.dsh/jingsao/main-config.jsonc（用户主配置，可编辑层；JSONC——允许注释） */
    userFile: string;
    /** 旧路径 ~/.dsh/jingsao/main-config.json：读取回落 + 启动时迁移（见 migrateUserConfig） */
    legacyUserFile?: string;
    /** ~/.dsh/jingsao/pet（文件宠物目录） */
    petDir: string;
}
