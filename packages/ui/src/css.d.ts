declare module "*.css";
// TS 7 起，副作用 import 的模块也必须有类型声明（TS2882）。
// dumi 主题从 dumi/theme-default 引入 .less。
declare module "*.less";
