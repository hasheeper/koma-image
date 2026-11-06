import { inject } from 'vue';
import type { InjectionKey } from 'vue';
import type { Annotations } from '../services/annotations.ts';
export const annotationsKey:InjectionKey<Annotations>=Symbol('annotations');
export function useAnnotations(){const service=inject(annotationsKey);if(!service)throw new Error('Annotations unavailable');return service;}
