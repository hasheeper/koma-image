import { inject } from 'vue';
import type { InjectionKey } from 'vue';
import type { Photopea } from '../services/photopea.ts';
export const photopeaKey: InjectionKey<Photopea> = Symbol('photopea');
export function usePhotopea() { const value=inject(photopeaKey);if(!value)throw new Error('Photopea unavailable');return value; }
