import { CatConfig, CatType } from './types';

export const BLACK_CAT_CONFIG: CatConfig = {
  type: CatType.BLACK,
  name: 'Kuro',
  gender: 'male',
  voiceName: 'x5_lingfeiyi_flow',
  avatarIdle: 'https://picsum.photos/seed/blackcatidle/400/400',
  avatarTalk: 'https://picsum.photos/seed/blackcattalk/400/400',
  themeColor: 'bg-slate-800'
};

export const WHITE_CAT_CONFIG: CatConfig = {
  type: CatType.WHITE,
  name: 'Shiro',
  gender: 'female',
  voiceName: 'x5_lingxiaoxuan_flow',
  avatarIdle: 'https://picsum.photos/seed/whitecatidle/400/400',
  avatarTalk: 'https://picsum.photos/seed/whitecattalk/400/400',
  themeColor: 'bg-pink-500'
};