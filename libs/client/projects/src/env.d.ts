/// <reference types="@shipfox/vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_TEST_VCS_PROVIDER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
