# 养护系统 + 道具背包

[← 返回首页](index.md)

## 喂食 (Token 补充)

喂食 = 补充 token(饱腹值)，让宠物能继续聊天。

| 食物 | 饱腹恢复 | ~消息数 | 心情 | 健康 | 获取方式 |
|------|---------|--------|------|------|----------|
| 42号口粮 | +75 | ~8条 | +3 | - | 免费，冷却 20min |
| 巴别鱼罐头 | +45 | ~5条 | +12 | - | 商城 30 星币 / 每日任务 |
| 泛银河爆破饮 | +120 | ~12条 | +8 | +5 | 商城 80 星币 / 升级/成就 |
| 不要恐慌胶囊 | +30 | ~3条 | +5 | +15 | 商城 25 星币 / 连续登录 |

**设计要点:** 42号口粮免费保底，用户永远不会被卡死。

### 饱腹值经济

```
hunger 上限: 300 | 聊天: 每条 -10 | 工具调用: 额外 -1 | 时间衰减: 0.3/min

满饱腹 (300) 出发:
  20 轮聊天 (~30min): 消耗 200+9 = 209, 剩余 91 (30%) ✓
  中途喂一次口粮 (+75): 可延长 ~8 条

42号口粮 (CD 20min, +75):
  轻度聊天: 口粮基本够用
  重度聊天: 搭配巴别鱼罐头(+45) / 泛银河爆破饮(+120)
```

---

## 玩耍 (Play)

主要恢复心情，消耗少量饱腹。

| 动作 | 心情 | 饱腹消耗 | 亲密度 | 触发 |
|------|------|---------|--------|------|
| 抚摸 | +8 | - | +2 | 长按宠物 |
| 无限非概率逗猫器 | +15 | -5 | +5 | 养成面板 → 玩耍 |
| 捉迷藏 | +20 | -8 | +8 | 宠物跑到随机位置，点击 |
| 晒太阳 | +10 | -2 | +3 | 拖拽到屏幕顶部 |

## 休息 (Rest)

- **小憩** (15min): 健康 +10，心情 +5，sleep 动画
- **深度睡眠** (60min): 健康 +30，心情 +10，期间不接受互动
- 触发: 养成面板 → 休息，或 health < 40 时气泡提示

## 治疗 (Heal)

| 道具 | 健康恢复 | 冷却 | 获取方式 |
|------|---------|------|----------|
| 马文牌退烧贴 | +20 | 4h | 商城 40 星币 / 每日任务 |
| 深思重启针 | 恢复至满 | 24h | 商城 200 星币(周限1) / 等级奖励 (Lv.10/20/30) |

---

## 道具背包

### 数据结构

```typescript
interface InventoryItem {
  id: string;
  name: string;
  icon: string;
  category: "food" | "toy" | "medicine" | "special";
  description: string;
  quantity: number;
  effects: { hunger?: number; mood?: number; health?: number; intimacy?: number; exp?: number; };
  cooldownMs?: number;
  lastUsedAt?: number;
}
```

### 道具定义表

```typescript
const ITEM_DEFS = {
  ration_42:        { name: "42号口粮",       icon: "🧊", category: "food",     effects: { hunger: 75, mood: 3 },          cooldownMs: 20*60*1000, unlimited: true },
  babel_fish_can:   { name: "巴别鱼罐头",     icon: "🐠", category: "food",     effects: { hunger: 45, mood: 12 } },
  gargle_blaster:   { name: "泛银河爆破饮",   icon: "🌌", category: "food",     effects: { hunger: 120, mood: 8, health: 5 } },
  dont_panic:       { name: "不要恐慌胶囊",   icon: "💊", category: "food",     effects: { hunger: 30, mood: 5, health: 15 } },
  marvin_patch:     { name: "马文牌退烧贴",   icon: "🤖", category: "medicine", effects: { health: 20 },                    cooldownMs: 4*3600*1000 },
  deep_thought:     { name: "深思重启针",     icon: "💉", category: "medicine", effects: { health: 100 },                   cooldownMs: 24*3600*1000 },
  improbability:    { name: "无限非概率逗猫器", icon: "🎲", category: "toy",     effects: { mood: 15, hunger: -5 },          permanent: true },
};
```

### 背包容量

- 初始: 20 格
- Lv.10: 30 格
- Lv.20: 40 格
- 堆叠上限 99
