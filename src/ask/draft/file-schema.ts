export const fileSchema = { type: 'object', additionalProperties: false, required: ['kind','document'], properties: {
  kind: { type: 'string', enum: ['save_ref'] }, document: { type: 'string', enum: ['recipe','memo','slate'] },
  document_title: { type: 'string', minLength: 1, maxLength: 80 }, text: { type: 'string', maxLength: 24000 },
} };
