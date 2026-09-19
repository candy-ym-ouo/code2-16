# 浮空岛邮政调度员

React 调度面板 + Node.js 权威游戏服务。完整的玩法、规则、接口、运行和验收说明见 [项目文档.md](./项目文档.md)。

```bash
npm install
npm run dev
```

开发模式访问 `http://localhost:5173`，生产模式执行：

```bash
npm run build
npm start
```

然后访问 `http://localhost:3001`。

## 航线风险沙盘

独立的仿真实验模块（`server/sandbox/`），模拟多日逐小时风况与延误在机队轮转中的传播：

```bash
npm run sandbox -- run --seed demo --days 5     # 运行实验并写入实验区
npm run sandbox -- verify --seed demo --days 5  # 校验同一种子复现同一态势
npm run sandbox -- list                         # 查看实验区 / 正式存档区
npm run sandbox -- promote --run-id <id> --name summary  # 显式归档（唯一通道）
```

- 同一种子必然复现同一态势：天气场、班表、延误事件均由种子派生的独立随机流生成，结果带 SHA-256 态势摘要。
- 实验数据写入 `server/data/sandbox/experiments/`，与正式存档 `server/data/game-state.json` 物理隔离；进入正式存档区 `server/data/sandbox/archive/` 必须经过显式 `promote`，且不可覆盖。
