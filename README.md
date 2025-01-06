# Browser Manager

一个基于Electron的多浏览器实例管理工具，支持创建和管理多个独立的Chrome浏览器实例。

## 功能特性

- 创建和管理多个Chrome浏览器实例
- 每个实例使用独立的用户数据目录
- 实时监控浏览器实例状态
- 配置持久化存储
- 跨平台支持 (Windows, macOS, Linux)

## 技术栈

- Electron
- React
- TypeScript
- Puppeteer
- Webpack

## 项目结构

```
browser-manager/
├── src/
│   ├── main/           # Electron主进程代码
│   │   ├── browserManager.ts    # 浏览器实例管理
│   │   ├── main.ts             # 主进程入口
│   │   ├── types.ts            # 类型定义
│   │   └── utils.ts            # 工具函数
│   └── renderer/       # 渲染进程代码
│       ├── App.tsx             # 主应用组件
│       └── index.tsx           # 渲染进程入口
├── build/             # 构建资源
├── dist/              # 编译输出
└── release/           # 打包输出
```

## 开发环境设置

1. 安装依赖:
```bash
npm install
```

2. 启动开发服务器:
```bash
npm run dev
```

3. 构建应用:
```bash
npm run build
```

4. 打包应用:
```bash
# 打包当前平台
npm run dist

# 打包特定平台
npm run dist:mac    # macOS
npm run dist:win    # Windows
npm run dist:linux  # Linux
```

## 开发指南

### 开发模式

项目支持热重载开发:
- 主进程代码修改会自动重启应用
- 渲染进程代码修改会热重载UI
- TypeScript代码实时编译

### 目录说明

- `src/main/`: 主进程相关代码
  - `browserManager.ts`: 浏览器实例管理核心逻辑
  - `main.ts`: Electron主进程入口
  - `types.ts`: TypeScript类型定义
  - `utils.ts`: 通用工具函数

- `src/renderer/`: 渲染进程相关代码
  - `App.tsx`: React主应用组件
  - `index.tsx`: 渲染进程入口

### 构建与打包

1. 开发构建:
```bash
npm run build
```

2. 生产打包:
```bash
npm run dist
```

打包配置在 `package.json` 的 `build` 字段中定义。

## 注意事项

1. 确保系统已安装Chrome浏览器
2. 开发时需要Node.js 20+环境
3. 打包时注意不同平台的特殊配置
4. 生产环境注意资源路径处理

## 常见问题

1. 如果遇到Chrome路径问题，检查 `utils.ts` 中的路径配置
2. 如果开发模式启动失败，确保8080端口未被占用
3. 打包时注意系统对应的图标格式要求

## License

MIT 