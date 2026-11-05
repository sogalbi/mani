import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '프리나눔',
    short_name: '프리나눔',
    description: 'e-프리퀀시 스티커 무료 나눔·교환을 이어 주는 작은 동화 마을',
    lang: 'ko',
    start_url: '/',
    display: 'standalone',
    background_color: '#fbf6ea',
    theme_color: '#fbf6ea',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
