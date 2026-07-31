# easy-weixin-clawbot 官网

项目主页（landing page）。单页静态站，源码零构建——本地起个 HTTP 服务就能改，
`npm run build` 只在部署前跑一次做打包压缩。

背景那颗气泡是原生 WebGL2 + GLSL 的实现，不依赖 Cables.gl 或其他渲染框架，
细节见下面的[背景动画](#背景动画)。

## 运行

ES Modules 和 Shader 资源需要通过 HTTP 访问：

```bash
npm run dev     # 零依赖静态服务器，伺服源码目录
```

然后打开 <http://127.0.0.1:8731/>。

部署前的构建与预览：

```bash
npm install     # 装 esbuild（唯一的依赖）
npm run build   # 产出 dist/
npm run serve   # 预览 dist/，http://127.0.0.1:8732/
```

## 部署（Vercel）

本目录不在 `pnpm-workspace.yaml` 的 `packages/*` 里，是独立的 npm 项目，
自带 `package-lock.json`。在 Vercel 上把 **Root Directory 设为 `apps/landing`**，
其余交给 `vercel.json`（`npm ci` → `npm run build` → `dist/`）。

`index.html` 的 canonical、`og:url`、`og:image`，以及 `sitemap.xml`、`robots.txt`
里的绝对 URL 都硬编码了站点域名。**换域名（绑定自定义域）时这四个文件要一起改**，
否则社交卡片抓不到图、canonical 会把权重指到旧地址。

`og-image.jpg` 是 1200×630 的首页截图，只被 `og:image` 和 `twitter:image` 引用，
普通访客不会加载它。存成 JPEG 是因为部分抓取器（WhatsApp 等）不渲染 300KB
以上的预览图，原来的 PNG 截图有 960KB。

## 背景动画

几何、动画、材质和后处理全部使用原生 WebGL2 与 GLSL。主体沿用原版参数：
512×512 高细分球、0.5Hz 半径呼吸、上下两组反向 XYZ 顶点形变，以及 X/Y/Z 为
10°/10°/20° 每秒的自转。形变后的法线用球面切向差分重算，光照会跟着起伏走。
脸部作为独立分支，只跟随鼠标视角，不随主体自转到背面，绘制前清一次深度缓冲，
因此不会被形变的身体挡住。

浏览器创建不了 WebGL2 上下文时，页面会给出提示并停用背景动画，内容不受影响。

### 交互

- 移动指针：以 2° 步进控制视线，水平与垂直方向均限制在 ±20°
- 按住：短暂改变色场
- 滚轮：缩放
- `R`：重置缩放与动画
- `L`：触发一次弹性脉冲

系统开启「减少动态效果」时，自转、呼吸和形变会停在一个安定的姿势，
指针跟随与缩放这类主动交互仍然保留。

## 结构

- `src/main.js`：渲染循环、交互和各渲染阶段
- `src/gl.js`：WebGL 程序、几何体和 Framebuffer 工具
- `src/shaders.js`：主体材质、模糊与最终合成 Shader
- `src/math.js`：插值与投影矩阵
- `build.mjs`：esbuild 打包脚本，只在部署前跑
- `serve.mjs`：本地静态服务器，`dev` 和 `serve` 共用
