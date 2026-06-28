/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_CCSYNC_TOKEN: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
