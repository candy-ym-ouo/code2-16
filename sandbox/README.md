# 航线风险沙盘

多日风况与延误传播的确定性模拟沙盘，用于评估航线网络在扰动下的韧性。纯 Node.js 标准库实现，零依赖。

## 快速开始

```bash
node sandbox/cli.js run --seed 42 --days 7 --name baseline   # 运行一次实验
node sandbox/cli.js list                                     # 查看实验区
node sandbox/cli.js show baseline-5aa87352                   # 查看结果
node sandbox/cli.js promote baseline-5aa87352                # 复算验证后晋升正式存档
node sandbox/cli.js archive                                  # 查看正式存档
```

也可使用 `npm run sandbox -- run --seed 42`。测试：`npm run test:sandbox`。

## 模拟模型

- **风况（`src/weather.js`）**：高空风场在粗网格上生成空间相关的正态创新，双线性插值到细网格；逐日按 AR(1) 演变（`weather.rho` 控制日际粘滞度），叠加随纬度变化的盛行西风。地面风由高空风折算并叠加固定日变化曲线。
- **航班计划（`src/network.js`）**：机队按衔接rotation生成每日多航段计划，前段与后段通过 `prevFid` 链接，是延误传播的通道。
- **延误传播（`src/engine.js`）**：按计划出港时刻顺序推进事件，逐班分解四类延误——
  - 一次延误：机械故障、机场流控窗口、大风地面等待；
  - 传播延误：同机前段晚到导致过站不足；
  - 风况延误：顶风/顺风改变空中飞行时间；
  - 容量延误：目的地机场 30 分钟到达桶超限排队。
  - 出港延误超过 `cancelThresholdMin` 判定取消；取消后假设调机按原计划时刻恢复（简化假设）。
- **指标（`src/metrics.js`）**：按日与全期输出取消率、平均/P95 到港延误、延误构成与传播系数（传播延误 ÷ 一次延误）。

## 随机种子复现

配置中的 `seed` 是唯一随机源。`src/rng.js` 用 cyrb128+sfc32 从主种子按名称派生三条独立随机流（计划 / 风况 / 运控扰动），各模块互不消耗对方序列。同一种子下，航班计划、逐日风场、扰动与最终结果的 SHA-256 哈希**逐字节一致**（见 `tests/reproducibility.test.js`）。实验目录名 `runId = <名称>-<配置哈希前8位>`，同配置同种子自然落位同一目录。

## 实验与存档隔离

```
sandbox/data/
  experiments/   # 实验区：所有模拟结果只能先落在这里
  archive/       # 正式存档：只读，唯一写入口是 promote()
```

- `ExperimentStore` 与 `ArchiveStore` 分目录物理隔离，`ArchiveStore.save()` 直接抛 `IsolationError`；
- `promote()` 晋升前默认**重新模拟复算**并比对结果哈希，篡改过的实验数据无法通过校验；
- 存档写一次、不可覆盖；runId 校验 + 路径包含检查杜绝路径穿越；
- 数据根可用环境变量 `RISK_SANDBOX_DATA` 覆盖（测试使用临时目录）。

## 目录结构

```
sandbox/
  cli.js            # 命令行入口
  src/
    config.js       # 参数与校验（种子、天数、机队、风况、运控）
    rng.js          # 确定性随机流
    weather.js      # 多日风场
    network.js      # 机场 / 机队 / 航班计划
    engine.js       # 延误传播引擎
    metrics.js      # 指标汇总
    storage.js      # 实验区 / 正式存档隔离存储
    canon.js        # 规范化序列化与内容哈希
  tests/            # 复现性 / 隔离性 / 引擎行为测试
```
