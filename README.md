# yingo-base

**YingoTab 默认基础应用仓库**（默认内容源）。YingoTab 在未配置自定义仓库时，会从本仓库读取 `yingotab.yml` 清单，加载其中的应用、组件与音乐内容。

## 目录结构

```
yingo-base/
├── yingotab.yml                  # 内容清单（由 CI 自动再生成）
├── apps/                         # 应用 / 组件
│   ├── translator/               # 翻译应用（dock 类型）
│   └── example-clock-widget/     # 示例时钟组件（grid 类型）
├── music/                        # 音乐文件目录（含 music.json 元数据表）
├── scripts/gen-yml.mjs           # 清单生成脚本（Node 22 原生 ESM，零依赖）
└── .github/workflows/manifest.yml# CI：自动再生成 yingotab.yml
```

## 触发 CI

CI 使用 `workflow_dispatch` 手动触发。在 GitHub 仓库页面进入 **Actions → Regenerate manifest → Run workflow** 即可运行。CI 会扫描 `apps/*/app.json` 与 `music/` 目录，重新生成根目录的 `yingotab.yml`，若有变更会自动提交（commit 信息：`chore: regenerate yingotab.yml [skip ci]`）。

## 在自己的实例中添加本仓库

在 YingoTab 实例的 **设置 → 内容源** 中，添加本仓库 URL：

```
https://github.com/yingo-server/yingo-base
```

保存后 YingoTab 会拉取 `yingotab.yml` 并加载本仓库中的应用、组件与音乐。

## License

Apache-2.0
