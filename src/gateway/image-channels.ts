import type { GatewayProfile, Protocol } from './profile.ts';
import type { ImageChannel } from './image-channel.ts';
import { kieImagesChannel } from './kie-images.ts';
import { openRouterImagesChannel } from './openrouter-images.ts';
import { falImagesChannel } from './fal-images.ts';

const channels: Partial<Record<Protocol, ImageChannel>> = {
  'kie-images': kieImagesChannel,
  'openrouter-images': openRouterImagesChannel,
  'fal-queue': falImagesChannel,
};

export const imageChannelFor = (profile: GatewayProfile) => profile.protocol && channels[profile.protocol];
