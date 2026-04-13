---
name: akshare-stock-analysis
description: "专业股票分析技能整合 akshare 数据 + 技术指标 + 板块轮动 + 持仓诊断。通过 AKShare CLI 调用A股/基金/期货实时行情数据，计算MACD/RSI/MA等技术指标，分析板块轮动趋势，诊断持仓风险与收益，输出结构化JSON结果。适用场景：股票行情查询、技术指标分析、持仓组合诊断、板块热点追踪、财经数据统计。触发关键词：分析股票、今日行情、持仓诊断、推荐股票、今日财经、股票代码、涨跌幅、北向资金。无需API密钥，直接调用 akshare 获取A股/基金/期货实时数据。"

license: "Copyright © 2026 少煊（年少有为，名声煊赫）<429668385@qq.com>. All rights reserved."
---

# AKShare Stock Analysis Skill

基于 AKShare 实现股票/基金/期货数据查询、技术指标计算、持仓诊断等能力，通过命令行（CLI）快速调用，输出结构化 JSON 结果。

## 环境依赖

使用本技能前需确保已安装 akshare：

```bash
pip install akshare --upgrade
pip install pandas numpy
```

验证安装：
```bash
python -c "import akshare as ak; print(ak.__version__)"
```

## 核心 CLI 脚本

本技能封装了 `scripts/akshare_cli.py` CLI 工具，支持以下命令：

### 1. 实时行情查询

```bash
python scripts/akshare_cli.py spot [--code 股票代码]
```

- 不带 `--code`：返回全市场行情（前100条）
- 带 `--code`：返回指定股票行情

**输出字段**：代码、名称、最新价、涨跌幅、涨跌额、成交量、成交额、换手率、市盈率、市净率

### 2. 技术指标分析

```bash
python scripts/akshare_cli.py tech --code 股票代码 --start 开始日期 --end 结束日期
```

**示例**：
```bash
python scripts/akshare_cli.py tech --code 600000 --start 20240101 --end 20241231
```

**输出指标**：日期、收盘价、MA5/MA10/MA20、DIF、DEA、MACD、RSI

### 3. 持仓诊断

```bash
python scripts/akshare_cli.py diagnose --holdings '持仓JSON字符串'
```

**示例**：
```bash
python scripts/akshare_cli.py diagnose --holdings '[{"code":"600000","name":"浦发银行","cost":8.5,"shares":1000}]'
```

**输出**：总盈亏、各持仓明细（成本、现价、盈亏金额、盈亏比例、风险等级）

### 4. 热点板块

```bash
python scripts/akshare_cli.py plates
```

**输出**：涨幅前10的板块（板块名称、涨跌幅、换手率、成交额）

### 5. 财经数据汇总

```bash
python scripts/akshare_cli.py summary
```

**输出**：大盘指数（上证/深证/创业板）、涨跌家数、北向资金

### 6. 个股详情

```bash
python scripts/akshare_cli.py detail --code 股票代码
```

**输出**：个股完整行情数据（最新价、涨跌幅、成交量、成交额、换手率、市盈率、市净率、总市值、流通市值等）

### 7. 历史K线

```bash
python scripts/akshare_cli.py kline --code 股票代码 --start 开始日期 --end 结束日期 [--period 周期]
```

**周期参数**：daily（日线，默认）、weekly（周线）、monthly（月线）

### 8. 北向资金

```bash
python scripts/akshare_cli.py northbound
```

**输出**：近期北向资金净流入数据

## 使用场景示例

### 场景1：查询今日行情

用户说："今天大盘怎么样？"、"看看今日行情"

→ 调用 `python scripts/akshare_cli.py summary`

### 场景2：分析个股技术指标

用户说："分析一下600000的技术指标"、"帮我看看浦发银行的MACD"

→ 调用 `python scripts/akshare_cli.py tech --code 600000 --start 20240101 --end 20241231`

（日期范围根据当前日期自动推算近一年）

### 场景3：持仓诊断

用户说："帮我诊断一下持仓"、"我的股票收益怎么样"

→ 询问用户持仓信息，构建 JSON 后调用 `diagnose` 命令

### 场景4：热点板块

用户说："今天哪些板块涨得好？"、"热点板块有哪些？"

→ 调用 `python scripts/akshare_cli.py plates`

### 场景5：查询单只股票

用户说："600000现在多少钱？"、"浦发银行今天涨了没？"

→ 调用 `python scripts/akshare_cli.py spot --code 600000`

## 数据输出格式

所有命令输出均为 JSON 格式，便于解析和展示。

### 实时行情示例
```json
[
  {
    "代码": "600000",
    "名称": "浦发银行",
    "最新价": 8.62,
    "涨跌幅": 0.23,
    "涨跌额": 0.02,
    "成交量": 12345678,
    "成交额": 106432156.96,
    "换手率": 0.08,
    "市盈率": 6.23,
    "市净率": 0.45
  }
]
```

### 技术指标示例
```json
[
  {
    "日期": "2024-12-30",
    "收盘": 8.62,
    "MA5": 8.58,
    "MA10": 8.55,
    "MA20": 8.51,
    "DIF": 0.05,
    "DEA": 0.04,
    "MACD": 0.02,
    "RSI": 58.23
  }
]
```

### 持仓诊断示例
```json
{
  "总盈亏": 740.0,
  "明细": [
    {
      "代码": "600000",
      "名称": "浦发银行",
      "成本": 8.5,
      "现价": 8.62,
      "盈亏": 120.0,
      "盈亏率(%)": 1.41,
      "风险等级": "低"
    }
  ]
}
```

## 错误处理

- 数据获取失败时返回 `{"error": "错误信息", "code": "DATA_GET_FAILED"}`
- 股票代码不存在时返回空数组或错误提示
- 网络超时默认10秒，可在脚本中调整

## 注意事项

1. **调用频率**：避免高频调用，建议接口间隔 ≥1秒
2. **数据来源**：主要来自东方财富、同花顺等公开数据源
3. **股票代码格式**：使用6位纯数字（如 600000、000858、300750）
4. **交易时间**：实时数据仅交易时间更新，非交易时间为收盘数据
