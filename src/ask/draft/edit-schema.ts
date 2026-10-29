const focusRectSchema={type:'object',additionalProperties:false,required:['x','y','w','h'],properties:Object.fromEntries(['x','y','w','h'].map(k=>[k,{type:'number',minimum:0,maximum:1}]))};
export const focusSchema={anyOf:[focusRectSchema,{type:'null'}]};
export const editParameterProperties={
 editMode:{type:'string',enum:['img2img','inpaint','upscale']},inpaintKind:{type:'string',enum:['normal','focused']},
 strength:{type:'number',minimum:0,maximum:1},noise:{type:'number',minimum:0,maximum:1},
 effort:{type:'string',enum:['high','medium']},upscaleKind:{type:'string',enum:['native','external']},focusRect:focusSchema,
 enhance:{type:'object',additionalProperties:false,properties:{enabled:{type:'boolean'},scale:{anyOf:[{type:'number',minimum:1,maximum:2,description:'仅 1、1.5、2'},{type:'string',enum:['max']}]},magnitude:{type:'integer',minimum:1,maximum:5}}},
};
export const directorSchema={type:'object',additionalProperties:false,required:['kind','tool'],properties:{kind:{type:'string',enum:['director_patch']},tool:{type:'string',enum:['bg-removal','lineart','sketch','colorize','emotion','declutter']},emotion:{type:'string'},defry:{type:'integer',minimum:0,maximum:5},prompt:{type:'string',maxLength:24000}}};
