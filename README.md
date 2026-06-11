# NBA 82-0 球员评分实验室

这是一个围绕虎扑「82-0 完美阵容大挑战」页面整理出的本地分析工具。仓库包含抓取下来的活动代码、球员数据解析脚本、FastAPI 可视化前端，以及按原游戏公式复刻的阵容胜场模拟。

原版游戏地址：[虎扑 82-0 完美阵容大挑战](https://activity-static.hupu.com/colorbox-activities/activity-project-ai-1781070826571/index.html?t=1781071082140&night=0&euid=UaubZ4/4CFYrN4V2EqXGdK+OUfB6wVPHRPG00zL563w=&cid=133643064)

## 功能

- 解析 `fetched_activity_project_ai_1781070826571/nba-data.js` 中的 NBA 球员数据。
- 按游戏同款评分公式计算球员评分，并支持按评分、三项和、单项数据排序。
- 支持姓名/英文名、球队、年代、位置、最低评分等查询条件。
- 支持查看某个年代某支球队所有球员的评分明细。
- 提供本地 Web 前端，可查看球员榜单、评分拆分、CSV 导出和五人阵容模拟。

## 环境

推荐使用 Python 3.11+。当前代码只依赖 FastAPI 和 Uvicorn 运行 Web 应用：

```bash
python3 -m pip install -r requirements.txt
```

如果本机已经安装 `fastapi` 和 `uvicorn`，可以直接运行。

## 命令行用法

查看评分榜前 20：

```bash
python3 nba_player_query.py --top 20
```

按姓名查询：

```bash
python3 nba_player_query.py --name 詹姆斯 --top 10
python3 nba_player_query.py --name Jordan --team CHI --top 5
```

查看某年代球队评分明细：

```bash
python3 nba_player_query.py --team LAL --decade 2010s --details
```

导出 CSV：

```bash
python3 nba_player_query.py --team WAS --decade 2020s --details --csv /private/tmp/was_2020s_details.csv
```

## Web 应用

启动本地服务：

```bash
python3 web_app.py --host 127.0.0.1 --port 8000
```

打开：

```text
http://127.0.0.1:8000
```

Web 前端支持：

- 球员榜单、搜索、筛选和排序。
- 切换评分明细列。
- 点击球员查看评分拆分。
- 将球员加入 `PG / SG / SF / PF / C` 阵容槽。
- 自动模拟 82 场战绩、评级、几何平均和球队总评。
- 导出当前页 CSV。

## API

FastAPI 后端提供以下主要接口：

- `GET /api/meta`：返回年代、球队、位置、评分分布等元数据。
- `GET /api/players`：查询球员列表，支持 `name`、`team`、`decade`、`position`、`sort`、`details`、分页等参数。
- `GET /api/players/{player_id}`：返回单个球员评分明细。
- `POST /api/simulate`：提交五个位置的球员 ID，返回阵容模拟结果。

阵容模拟接口示例：

```json
{
  "slots": {
    "PG": "oscar_robertson_sac_1960s",
    "SG": "michael_jordan_chi_1980s",
    "SF": "lebron_james_lal_2010s",
    "PF": "elvin_hayes_hou_1970s",
    "C": "wilt_chamberlain_gsw_1960s"
  }
}
```

## 项目结构

```text
.
├── fetched_activity_project_ai_1781070826571/  # 抓取的活动页面、运行时脚本和球员数据
├── nba_player_query.py                         # CLI 数据查询和评分计算
├── web_app.py                                  # FastAPI 后端入口
├── web/static/                                 # 单页前端
├── requirements.txt                            # Python 运行依赖
└── README.md
```

## 评分说明

球员评分复刻页面中的核心逻辑：

- 按年代基准表比较 `PTS / REB / AST / STL / BLK`。
- 按球员首个可打位置选择权重。
- 老年代缺失抢断/盖帽时，将相关权重重新分配到已有数据项。
- 多位置球员有额外加成。
- 个人评分封顶 100。
- 阵容使用五名球员评分的几何平均，再乘以 1.1 得到球队总评。
- 胜场公式为 `round(82 * min(teamOvr / 110, 1) ** 2.2)`。

## 验证

```bash
python3 -m py_compile nba_player_query.py web_app.py
python3 nba_player_query.py --name Jordan --team CHI --top 5
python3 nba_player_query.py --team LAL --decade 2010s --details --top 10
```
