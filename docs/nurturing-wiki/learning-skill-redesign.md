# 学习与技能系统重构设计

> 状态：草案
> 更新：2026-03-11

---

## 与 ai-system.md 的关系

本文档是 `ai-system.md` 中学习/技能系统的**重构设计**。
- 领域体系、技能追踪机制、RPC 接口等基础概念见 ai-system.md
- 本文档只描述**新增/改动**的设计内容

---

## 一、问题定位

| 问题 | 说明 |
|------|------|
| **课程空洞** | 生成的课程只有标题+描述+复杂度，没有实际内容 |
| **技能无用** | 领悟生成的技能文件过于简单，无法真正帮助AI |
| **缺乏参与感** | 玩家只是等待倒计时，没有真正的学习体验 |
| **缺少个性化** | 技能是自动生成的，不反映玩家的实际需求 |

---

## 二、设计目标

1. **课程有实际价值**：贴近用户真实活动，有益于生活或生产
2. **技能可落地**：生成的技能是真正可用的指导文件
3. **人机协作**：领悟过程中玩家参与确认，输入个人偏好
4. **个性化定制**：技能反映玩家的需求和规范

---

## 三、课程结构重构

### 3.1 新课程结构

**旧结构**（无用）：
```json
{
  "title": "编写单元测试",
  "description": "学习如何编写测试",
  "complexity": 3
}
```

**新结构**（完整）：
```json
{
  "id": "course-xxx",
  "title": "React 组件单元测试实践",
  "categoryName": "技术",
  "description": "掌握 React 组件的测试方法，提升代码质量",
  "complexity": 3,
  
  "learningObjectives": [
    "理解 React Testing Library 的核心 API",
    "学会编写用户行为驱动的测试用例",
    "掌握 mock 和异步测试技巧"
  ],
  
  "lessons": [
    {
      "order": 1,
      "title": "测试基础与 RTL 简介",
      "content": "...",
      "practiceTask": "为一个简单的 Button 组件编写第一个测试"
    },
    {
      "order": 2,
      "title": "用户行为驱动测试",
      "content": "...",
      "practiceTask": "测试一个表单组件的提交逻辑"
    },
    {
      "order": 3,
      "title": "Mock 与异步测试",
      "content": "...",
      "practiceTask": "测试一个调用 API 的组件"
    }
  ],
  
  "skillPreview": {
    "name": "react-testing",
    "title": "React 测试实践",
    "desc": "当主人需要编写或优化 React 组件测试时使用"
  },
  
  "relatedTools": ["web_search", "read", "edit"],
  "generatedFrom": {
    "userActivities": ["编写 React 组件", "使用 vitest", "调试测试失败"],
    "domainContext": "主人最近在开发 React 项目，频繁编写和调试测试用例"
  }
}
```

### 3.2 课程生成提示词

```
你是桌面宠物养成系统的课程设计师。根据主人的实际活动，设计一门真正有用的学习课程。

## 领域
{domainName}

## 主人近期活动
{userActivities}

## 设计要求

1. **实用性**：课程必须能帮助主人解决实际问题或提升某项能力
2. **场景化**：内容要结合主人的实际工作/生活场景
3. **可操作**：每节课要有具体的练习任务，不是空泛的理论
4. **技能导向**：学完后要能产出可复用的技能

## 输出格式（严格 JSON）

{
  "title": "课程名称，8-15字，具体且有吸引力",
  "description": "课程简介，30-50字，说明学完能做什么",
  "complexity": 数字1-5,
  "learningObjectives": ["目标1", "目标2", "目标3"],
  "lessons": [
    {
      "order": 1,
      "title": "第1节标题",
      "content": "知识点讲解，100-200字",
      "practiceTask": "具体练习任务，20-40字"
    }
  ],
  "skillPreview": {
    "name": "skill-id-kebab-case",
    "title": "技能名称，4-8字",
    "desc": "技能触发条件，20-40字"
  },
  "whyRelevant": "为什么这门课程对主人有用，30-50字"
}
```

---

## 四、领悟人机协作流程（新增）

> 现有实现：碎片满 → 自动生成技能
> 新设计：碎片满 → 人机对话 → 玩家确认 → 生成个性化技能

### 4.1 流程

```
碎片收集满
    │
    ▼
宠物气泡："我好像领悟到了什么...要整理一下吗？"
    │
    ▼
玩家点击确认
    │
    ▼
┌─────────────────────────────────┐
│  人机协作对话                    │
│                                 │
│  AI: 你最近在 {领域} 做了什么？  │
│  Player: 回答                   │
│                                 │
│  AI: 你希望这个技能帮你解决什么？ │
│  Player: 回答                   │
│                                 │
│  AI: 有什么偏好或规范？          │
│  Player: 回答（可选）            │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  技能预览                        │
│                                 │
│  - 技能名称                      │
│  - 触发条件                      │
│  - 核心指导内容                  │
│  - 主人偏好规则                  │
│                                 │
│  [确认] [修改]                   │
└─────────────────────────────────┘
    │
    ▼
写入 skills/{skillName}.md
更新图鉴 + 庆祝动画
```

### 4.2 对话提示词

**阶段1：生成问题**
```
你是桌宠角色的内心意识。主人刚完成了「{courseTitle}」的学习，你要帮主人整理成一个技能。

生成2-3个问题，了解主人的需求。

## 输出格式（严格 JSON）
{
  "greeting": "开场白，15-25字",
  "questions": [
    {"id": "problem", "text": "问题，15-25字", "hint": "提示（可选）"}
  ]
}
```

**阶段2：生成技能**
```
你是技能文件生成器。根据主人的回答，生成一个实用的技能文件。

## 主人回答
{playerAnswers}

## 输出格式（严格 JSON）
{
  "skillName": "skill-id-kebab-case",
  "skillTitle": "技能名称，4-8字",
  "skillDesc": "触发条件，20-40字",
  "skillContent": "技能指导内容，200-400字，包含主人偏好",
  "playerRules": ["主人的偏好规则1", "规则2"],
  "summary": "一句话总结"
}
```

### 4.3 技能文件结构

```markdown
---
name: react-testing
description: "当主人需要编写或优化 React 组件测试时使用"
domain: 技术
createdAt: 2026-03-11
source:
  course: React 组件单元测试实践
  playerInput:
    - "我最常遇到的是异步测试失败"
    - "我们项目用的是 vitest"
---

# React 测试实践

## 触发条件
当主人需要编写、调试或优化 React 组件测试时调用。

## 主人偏好
- 项目使用 **vitest** 测试框架
- 关注异步测试的可靠性

## 指导内容

### 1. 测试编写流程
...

### 2. 异步测试技巧
...

### 3. 调试失败测试
...
```

---

## 五、数据结构变更

### 5.1 课程

```typescript
interface Course {
  id: string;
  title: string;
  categoryName: string;
  description: string;
  complexity: number;
  
  // 新增
  learningObjectives: string[];
  lessons: Lesson[];
  skillPreview: SkillPreview;
  relatedTools: string[];
  generatedFrom: {
    userActivities: string[];
    domainContext: string;
  };
}

interface Lesson {
  order: number;
  title: string;
  content: string;
  practiceTask: string;
}
```

### 5.2 领悟会话（新增）

```typescript
interface EpiphanySession {
  courseId: string;
  domainName: string;
  status: 'pending' | 'dialoging' | 'confirming' | 'completed';
  questions: Question[];
  answers: Record<string, string>;
  skillPreview: SkillPreview | null;
  generatedSkill: RealizedSkill | null;
}
```

---

## 六、待讨论

1. **课程是否需要真实学习时间**？还是保持虚拟倒计时？
2. **练习任务是否需要验证**？如何验证？
3. **技能是否可以升级**？升级条件是什么？
4. **同一领域多门课程的关系**？独立还是进阶？