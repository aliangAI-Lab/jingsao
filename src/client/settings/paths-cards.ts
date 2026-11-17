import type { FunctionComponent } from 'react';
import type { ConfigMeta } from './config/index.ts';
import type { SettingsRuntime } from './runtime.ts';
import { MONO_STACK, makeUiKit } from './ui.ts';

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

/** 折叠正文的 id：与按钮的 `aria-controls` 成对，两张卡各一份。 */
const BODY_ID = {
  meta: 'pet-cfg-paths-meta',
  storage: 'pet-cfg-paths-storage',
} as const;

/**
 * 造两张落盘位置卡。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 两个卡片组件。
 */
export function makePathsCards(rt: SettingsRuntime): PathsCards {
  const { h, t, useState } = rt;
  const { foldCard } = makeUiKit({ h, t });

  function ConfigMetaCard(props: PathsCardProps) {
    const { paths } = props;
    const [open, setOpen] = useState(false);
    const line = (key: string, value: string | undefined, suffix = '') =>
      value === undefined
        ? null
        : h('div', { key, className: 'jingsao-cfg__path', children: t(key) + '：' + value + suffix });
    const body = [
      line('defaultConfig', paths.default),
      line('userConfig', paths.user),
      line('animationDir', paths.animations),
      // 日志文件路径 + 一句说明；其余位置的用途都在问号里，唯独这条写在明面上——反馈问题时要先找它。
      line('logFile', paths.logs),
      paths.logs ? h('div', { key: 'logNote', className: 'jingsao-cfg__note', children: t('logFileNote') }) : null,
    ];
    return foldCard({
      id: BODY_ID.meta,
      title: t('configMeta'),
      hint: t('configMetaHint'),
      body,
      open,
      onToggle: () => setOpen(!open),
    });
  }

  function StorageCard(props: PathsCardProps) {
    const { paths } = props;
    // hook 必须在早退之前：storage 为空时整卡不渲染，但那时也走同一条 hook 路径。
    const [open, setOpen] = useState(false);
    const storage = paths.storage ?? [];
    if (storage.length === 0) return null;
    const body = [
      // 存储位置清单：每条都是「路径（等宽、可选中复制）到作用」。
      ...storage.map((entry) =>
        h('div', {
          key: entry.key,
          className: 'jingsao-cfg__path',
          children: [
            h('b', { key: 'p', style: { fontFamily: MONO_STACK }, children: entry.path }),
            // 尚未产生的目录标一下，避免用户去找不存在的文件夹。
            h('span', {
              key: 'd',
              children: ' — ' + t('storage.' + entry.key) + (entry.exists === false ? t('storageMissing') : ''),
            }),
          ],
        }),
      ),
      h('div', {
        key: 'ut',
        className: 'jingsao-cfg__cardTitle',
        style: { marginTop: '4px' },
        children: t('uninstallTitle'),
      }),
      h('div', { key: 'u1', className: 'jingsao-cfg__note', children: t('uninstallStep1') }),
      h('div', { key: 'u2', className: 'jingsao-cfg__note', children: t('uninstallStep2') }),
      h('div', {
        key: 'cmd',
        className: 'jingsao-cfg__cmd',
        children: t('uninstallCmd').replace('{profile}', paths.profile || '<profile>'),
      }),
      h('div', { key: 'u3', className: 'jingsao-cfg__note', children: t('uninstallStep3') }),
    ];
    return foldCard({
      id: BODY_ID.storage,
      title: t('storageTitle'),
      hint: t('storageHint'),
      body,
      open,
      onToggle: () => setOpen(!open),
    });
  }

  return { ConfigMetaCard, StorageCard };
}
