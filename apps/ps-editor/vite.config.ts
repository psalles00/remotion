import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
export default defineConfig({
	plugins: [react()],
	resolve: {
		dedupe: ['react', 'react-dom'],
		alias: [
			{
				find: /^remotion$/,
				replacement: path.resolve('../../packages/core/src/index.ts'),
			},
			{
				find: /^remotion\/no-react$/,
				replacement: path.resolve('../../packages/core/src/no-react.ts'),
			},
			{
				find: /^@remotion\/player$/,
				replacement: path.resolve('../../packages/player/src/index.ts'),
			},
			{find: /^react$/, replacement: path.resolve('node_modules/react')},
			{
				find: /^react-dom$/,
				replacement: path.resolve('node_modules/react-dom'),
			},
		],
	},
	server: {
		fs: {allow: [path.resolve('../..')]},
		watch: {ignored: ['**/local-data/**', '**/work/**']},
	},
	build: {outDir: 'dist', emptyOutDir: true},
});
