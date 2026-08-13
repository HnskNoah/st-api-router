// 宿主模块（ST / TauriTavern）在浏览器里通过服务器绝对路径加载（不受扩展安装目录深度影响），
// 源码用 @sillytavern/* 惯例写法，vite 在 resolveId 阶段重写为绝对路径并标记 external，
// 这样宿主自身的代码不会被打进产物，扩展放在 /scripts/extensions/{third-party/}任意深度都能加载。
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

function stResolver(): Plugin {
    return {
        name: 'st-quicker-api-st-resolver',
        enforce: 'pre',
        resolveId(id) {
            if (id === '@sillytavern/script') {
                return { id: '/script.js', external: true };
            }
            if (id.startsWith('@sillytavern/')) {
                return { id: `/${id.replace('@sillytavern/', '')}.js`, external: true };
            }
            return null;
        },
    };
}

export default defineConfig({
    plugins: [stResolver()],
    build: {
        rollupOptions: {
            input: path.resolve(__dirname, 'src/index.ts'),
            preserveEntrySignatures: 'strict',
            output: {
                format: 'es',
                entryFileNames: '[name].js',
                assetFileNames: '[name].[ext]',
            },
        },
        outDir: 'dist',
        emptyOutDir: true,
        sourcemap: false,
        minify: true,
        target: 'esnext',
    },
});
