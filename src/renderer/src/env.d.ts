import type { IronleafApi } from '../../preload';

declare global {
  interface Window {
    nv: IronleafApi;
  }
}

export {};
