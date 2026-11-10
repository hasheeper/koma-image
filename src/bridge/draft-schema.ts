import { draftSchema } from '../ask/draft/schema.ts';
import { parameterSchema } from '../ask/draft/parameters.ts';
import { DRAFT_SCHEMA } from './protocol.ts';

const externalKinds = new Set(['prompt_patch', 'params_patch', 'character_edit', 'restore_partial', 'slate_edit', 'save_ref']);
const steps = draftSchema.properties.steps;

/** Document the external envelope from shared definitions, without advertising internal write ports. */
export const externalDraftSchema = {
  ...draftSchema,
  required: ['schema', 'draft_id', 'draft_title', 'steps'],
  properties: {
    schema: { type: 'string', enum: [DRAFT_SCHEMA] },
    draft_id: { type: 'string', minLength: 1, maxLength: 120, pattern: '^[A-Za-z0-9_.-]+$' },
    source_label: { type: 'string', minLength: 1, maxLength: 80 },
    picture_ref_version: { type: 'integer', enum: [2] },
    picture_scope_id: { type: 'string', description: '引用 #h/#e 时原样带回 state.live.json 的值。' },
    favorites_scope_id: { type: 'string', description: '引用 #f 时原样带回 state.live.json 的值。' },
    edit_board_id: { type: 'string', description: '使用本板 #e 简写时带回 edit.active_board_id；推荐完整编号。' },
    ...draftSchema.properties,
    base_hash: { ...draftSchema.properties.base_hash, description: '推荐原样带回 state.live.json 的 base_hash；省略时以接收时活动 IMAGE 画板为基底。' },
    new_board_name: { ...draftSchema.properties.new_board_name, description: '可选的新画板名称。应用时复制基底画板并写入修改；省略则默认写入来源画板。' },
    steps: { ...steps, items: { anyOf: steps.items.anyOf.filter(step => externalKinds.has(step.properties.kind.enum[0]!)).map(step => {
      if ('params' in step.properties && step.properties.kind.enum.includes('params_patch')) return { ...step, properties: { ...step.properties, params: parameterSchema } };
      if ('target' in step.properties && step.properties.kind.enum.includes('prompt_patch')) return { ...step, properties: { ...step.properties, target: {
        type: 'string', pattern: '^image\\.(prompt|negative|char\\.c[1-9][0-9]*\\.(prompt|negative))$',
        description: 'image.prompt、image.negative 或 image.char.cN.prompt/negative；cN 使用状态中的稳定角色 ID。',
      } } };
      if ('source' in step.properties && step.properties.kind.enum.includes('restore_partial')) return { ...step, properties: { ...step.properties, source: {
        type: 'string', description: '当前图片索引中的 #h/#f/#e；需有可恢复参数。企划文件路径和附件不能用作恢复来源。',
      } } };
      return step;
    }) } },
  },
};
