export const workflow = {
  "3": { class_type: "CustomSampler", inputs: { seed: 4, noise_seed: 9, steps: 20, cfg: 6.5, positive: ["6", 0] } },
  "6": { class_type: "ImprovedPromptInput", inputs: { prompt_text: "", translated: "fixed text", enabled: true }, _meta: { title: "Prompt box" }, extra: { keep: true } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "fixed negative", clip: ["4", 1] } },
  "4": { class_type: "LoraLoader", inputs: { lora_name: "example.safetensors", strength_model: 0.75 } },
  "9": { class_type: "SaveImage", inputs: { images: ["3", 0], filename_prefix: "example" } },
  "10": { class_type: "PreviewImage", inputs: { images: ["3", 0] } },
};
export const config = { workflow, bindings: { prompt: [{ nodeId: "6", field: "prompt_text" }], seed: [{ nodeId: "3", field: "seed" }, { nodeId: "3", field: "noise_seed" }], output: "9" } };
export const connection = { id: "gpu", name: "Example workflow", baseUrl: "https://comfy.example.test/prefix", profileId: "comfyui-workflow", credentialRef: "gpu-key", revision: "rev1", authMode: "none", comfyWorkflow: config };
export const routing = { version: 1, connections: { gpu: connection }, links: {} };
export const complete = (id = "job") => ({ [id]: { status: { status_str: "success", completed: true }, outputs: {
  "9": { images: [{ filename: "chosen image.png", subfolder: "a/b", type: "output" }, { filename: "ignored.png", subfolder: "", type: "output" }] },
  "10": { images: [{ filename: "preview.png", subfolder: "", type: "temp" }] },
} } });

export const adjustableConfig = {
  workflow: { ...structuredClone(config.workflow),
    '5': { class_type: 'CustomLatent', inputs: { width: 1000, height: 750, batch_size: 1 } },
    '11': { class_type: 'SecondSampler', inputs: { steps: 12, cfg: 1.5, width: 2000 } },
  },
  bindings: { ...structuredClone(config.bindings), parameters: {
    width: { nodeId: '5', field: 'width' }, height: { nodeId: '5', field: 'height' },
    steps: { nodeId: '3', field: 'steps' }, cfg: { nodeId: '3', field: 'cfg' },
  } },
};

export const controlledConfig = structuredClone(adjustableConfig);
controlledConfig.workflow['4'].inputs.strength_clip = 0.5;
controlledConfig.workflow['12'] = { class_type:'KSamplerSelect',inputs:{sampler_name:'euler'} };
controlledConfig.workflow['13'] = { class_type:'BasicScheduler',inputs:{scheduler:'normal',steps:20} };
controlledConfig.workflow['14'] = { class_type:'LoraLoaderModelOnly',inputs:{model:['4',0],lora_name:'detail.safetensors',strength_model:-0.2} };
controlledConfig.bindings.controls = {
  sampler:{nodeId:'12',field:'sampler_name'},scheduler:{nodeId:'13',field:'scheduler'},
  loras:[{nodeId:'4',nameField:'lora_name',modelField:'strength_model',clipField:'strength_clip',zeroDisables:true},{nodeId:'14',nameField:'lora_name',modelField:'strength_model',zeroDisables:true}],
};
export function nodeInfo(type) {
  const strength=['FLOAT',{default:1,min:-10,max:10,step:0.01}];
  const input = type==='KSamplerSelect' ? {sampler_name:[['euler','dpmpp_2m']]} : type==='BasicScheduler' ? {scheduler:[['normal','karras']],steps:['INT',{min:1,max:10000}]} : {lora_name:[['example.safetensors','detail.safetensors','style/new.safetensors']],strength_model:strength,...(type==='LoraLoader'?{strength_clip:strength}:{})};
  return {[type]:{input:{required:input}}};
}
