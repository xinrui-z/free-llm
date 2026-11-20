/// <reference types="astro/client" />
interface ImportMetaEnv {
  // Build-time values injected by astro.config.mjs (vite.define).
  readonly CATALOG_DYNAMIC: boolean;
  readonly CATALOG_API_URL: string;
  readonly CATALOG_CACHE_TTL_MS: string;
  readonly PUBLIC_STATUS_WORKER_URL?: string;
}
// Provided by astro.config.mjs: the CHECKER service binding in a production dynamic build, otherwise undefined.
declare module 'virtual:checker-binding' {
  export function checkerBinding(): Promise<import('./lib/catalog').CatalogBinding | undefined>;
}
declare namespace App {
  interface Locals {
    catalog?: import('./lib/catalog').CatalogState;
  }
}
interface Window {
  showToast?: (message: string, type?: 'success' | 'error' | 'info' | 'warning', duration?: number) => void;
}
