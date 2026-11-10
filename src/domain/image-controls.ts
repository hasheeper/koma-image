export const annotationModes = [
  { value: 'dual', label: '双图' },
  { value: 'native', label: '原生' },
  { value: 'text', label: '仅文字' },
];
export const annotationModeField = {
  key: 'annotation_mode', label: '标注', options: annotationModes.filter(option => option.value !== 'text').map(option => option.value), default: 'dual',
};
export const annotationModeLabel = (value: string) => annotationModes.find(option => option.value === value)?.label ?? value;
