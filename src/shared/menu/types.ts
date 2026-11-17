/**
 * 菜单节点类型：叶子、分支与挂载句柄。
 *
 * 纯类型声明，不含实现。
 * 必须始终成立：叶子带 action 或 anim（至少其一），分支必须带 children，二者不可兼得。
 * @module jingsao/src/shared/menu/types
 */
import { type PetDisplay } from '../types.ts';

/** 叶子：可点击的菜单项。 */
export interface MenuLeaf {
  label: string;
  /** 播放的动画名（点播动作）；action 优先于 anim */
  anim?: string;

  action?:
    | 'open-site'
    | 'show-balance'
    | 'whisper'
    | 'chat'
    | 'hide'
    | 'home'
    | 'reload'
    | 'set-display'
    | 'sleep'
    | 'wake'
    | 'third-party'
    | 'clean';
  /** set-display 的目标显示位置（与设置页的下拉框同一套取值） */
  display?: PetDisplay;
  /** third-party：注册它的 owner（身份键，只用于回传，不显示）；同一个 owner 的项收在同一分组下，
   *  只有一项时跳过这层直接平铺。 */
  owner?: string;
  /** 项目右侧的灰色小字（如快捷键）：纯视觉提示，不参与文本匹配也不影响动作分发，缺省不占位。 */
  hint?: string;

  /** 该项左侧的缩略图地址（完整 URL，已编码）。缺省 = 只有文字，不占位。 */
  thumb?: string;
  /** 在此项前显示分隔线。 */
  separatorBefore?: boolean;
}

/** 分支：带子菜单的项。 */
export interface MenuBranch {
  label: string;
  children: MenuNode[];
}

export type MenuNode = MenuLeaf | MenuBranch;

/** 第三方菜单项（宿主经 /state 的 sections.menu 下发的快照，一条 = 一个可点项）。 */
export interface MenuMoreItem {
  /** 注册方身份；同时也是一级分组名（显示用） */
  owner: string;
  /** 项名（显示用，也是回传给注册方的标识） */
  label: string;
}

/** 右键菜单挂载句柄。 */
export interface ContextMenuMount {
  /** 已挂载的根元素（document.body 下） */
  el: HTMLElement;
  /** 关闭并清理（幂等） */
  close: () => void;
}
