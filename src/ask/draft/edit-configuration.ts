import { canonical } from '../canonical.ts';
import { parameterIssue } from './parameters.ts';
import type { ParameterKey } from './parameters.ts';
import { characterCapability } from '../../domain/characters.ts';
import { editDrawingForm } from '../../domain/edit-draft.ts';
import type { EditConfiguration, EditDraftState } from '../../domain/edit-draft.ts';
import { editorModels } from '../../domain/media.ts';
import { focusContains, inpaintFocusPlan, supportsFocusedInpaint } from '../../domain/inpaint-focus.ts';
import { supportsNaiEnhance, availableEnhanceScales } from '../../domain/nai-enhance.ts';
import { modelSamplers } from '../../domain/nai-parameters.ts';
import { naiCapabilities } from '../../domain/nai.ts';

/** Last synchronous check at the confirmed write boundary, using live capabilities/mask. */
export function checkEditConfiguration(s:EditDraftState, after:EditConfiguration):string {
  const mode=after.upscaleOpen?'upscale':after.mode, form=editDrawingForm(s,after), before=editDrawingForm(s);
  const model=editorModels({models:s.models},mode).find(m=>m.id===form.model);
  if(!model)return '目标型号已不再支持此编辑模式';
  if(after.directorOpen&&!s.models.some(m=>m.profileId==='nai-official-v1'&&m.tools.includes('director')))return 'Director Tools 没有可用来源';
  if(mode==='upscale')return '';
  const keys:ParameterKey[]=['steps','sampler','cfgRescale','scale','noiseSchedule','varietyPlus','complexity','naiMode','qualityPreset','negativePreset','transparentBg'];
  for(const key of keys)if(form[key]!==before[key]) {const issue=parameterIssue(key,form,model);if(issue)return issue;}
  if(!naiCapabilities(form.model).medium&&!modelSamplers(model,s.samplers).includes(form.sampler))return '目标型号不支持此采样器';
  if(form.characters.filter(c=>c.on).length>characterCapability(form.model).max)return '启用角色超过当前型号上限';
  if(mode==='img2img'&&after.enhance.on&&(!supportsNaiEnhance(model)||!s.source||!availableEnhanceScales(s.source,model.id).includes(after.enhance.scale)))return '当前型号或尺寸不支持此 Enhance 倍率';
  if(mode==='inpaint'&&after.focus.on) {
    if(!supportsFocusedInpaint(model))return '当前来源不支持聚焦重绘';
    if(after.focus.rect&&s.source) {
      if(s.mask.status!=='ready')return '蒙版摘要尚未就绪';
      if(s.mask.pixel_bbox&&!focusContains(after.focus.rect,s.mask.pixel_bbox))return '聚焦框必须完整包含当前蒙版';
      try {inpaintFocusPlan(s.source,after.focus.rect);}catch(error){return error instanceof Error?error.message:'聚焦框无效';}
    }
  }
  if(naiCapabilities(form.model).medium && (before.model===form.model || canonical(before.characters)!==canonical(form.characters))) {
    if(before.negative!==form.negative||['steps','sampler','cfgRescale','negativePreset'].some(k=>before[k as ParameterKey]!==form[k as ParameterKey]))return 'Medium 的步数、采样器、负向与 Rescale 固定';
  }
  return '';
}
