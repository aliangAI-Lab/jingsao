import type { FunctionComponent } from 'react';
import type { ModelSelection } from '../../shared/types.ts';
import type { ModelCatalogGroup } from './picker/index.ts';
import type { ModelPickerProps } from './picker/index.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit, numberInputProps } from './ui.ts';

/** 两个模型字段的键名。 */
export type ModelFieldKey = 'whisperModel' | 'chatModel';

/** 三个对话开关的键名，与成品配置的字段名一致。 */
export type ChatFlagKey = 'chatAnimationEnabled';

/** 三个对话开关的当前值。 */
export type ChatFlagValues = Record<ChatFlagKey, boolean>;

/** 对话开关的展示顺序与文案键。 */
const CHAT_TOGGLES: Array<{ key: ChatFlagKey; label: string }> = [
  { key: 'chatAnimationEnabled', label: 'chatAnimationToggle' },
];

/** 模型卡的输入。 */
export interface ModelCardProps {
  /** 保存中或配置未就绪时禁用全部控件。 */
  busy: boolean;
  /** 候选清单；`null` 表示还在拉取。 */
  catalog: readonly ModelCatalogGroup[] | null;
  /** 候选清单拉取失败。 */
  failed: boolean;
  /** 碎碎念用的模型。 */
  whisperModel: ModelSelection;
  /** 对话用的模型。 */
  chatModel: ModelSelection;
  /** 某个模型字段被改。 */
  onModelChange: (key: ModelFieldKey, value: ModelSelection) => void;
  /** 对话历史条数。 */
  chatMemory: number;
  /** 改对话历史条数。 */
  onChatMemoryChange: (value: number) => void;
  /** 三个对话开关的当前值。 */
  values: ChatFlagValues;
  /** 某个对话开关被切换。 */
  onFlagChange: (key: ChatFlagKey, value: boolean) => void;
}

/**
 * 造模型卡。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @param picker - 模型选择器组件（由外壳用同一份运行时造好，跨渲染稳定）。
 * @returns 卡片组件。
 */
export function makeModelCard(
  rt: SettingsRuntime,
  picker: FunctionComponent<ModelPickerProps>,
): FunctionComponent<ModelCardProps> {
  const { h, t } = rt;
  const { cardHead, field, toggleCell } = makeUiKit({ h, t });

  return function ModelCard(props: ModelCardProps) {
    const { busy, catalog, failed } = props;

    /** 「全局默认」的数字格：标签与问号在上、数字输入在下。 */
    const numField = (label: string, value: number, setter: (v: number) => void) =>
      field(
        t(label),
        h('input', numberInputProps(value, setter, { step: '1', min: '0', disabled: busy })),
        t(label + 'Hint'),
      );

    /** 「AI 模型」的一格：标签与问号在上、单下拉选择器在下。 */
    const modelCell = (key: ModelFieldKey, value: ModelSelection) => {
      const label = t(key === 'whisperModel' ? 'whisperModelLabel' : 'chatModelLabel');
      return field(
        label,
        h(picker, {
          label,
          value,
          disabled: busy,
          catalog,
          failed,
          onChange: (next: ModelSelection) => props.onModelChange(key, next),
        }),
        t('modelFieldHint'),
      );
    };

    return h('div', {
      className: 'jingsao-cfg__card',
      children: [
        cardHead(t('modelTitle'), t('modelHint')),
        failed
          ? h('p', {
              className: 'jingsao-cfg__note',
              style: { color: 'var(--dsw-alias-state-error-primary)' },
              children: t('modelCatalogFailed'),
            })
          : null,
        h('div', {
          className: 'jingsao-cfg__grid2',
          children: [modelCell('whisperModel', props.whisperModel), modelCell('chatModel', props.chatModel)],
        }),
        h('div', {
          className: 'jingsao-cfg__grid4',
          children: [numField('chatMemory', props.chatMemory, props.onChatMemoryChange)],
        }),
        h('div', {
          className: 'jingsao-cfg__grid3',
          children: CHAT_TOGGLES.map((toggle) =>
            toggleCell(toggle.label, props.values[toggle.key], busy, (value) => props.onFlagChange(toggle.key, value)),
          ),
        }),
      ],
    });
  };
}
